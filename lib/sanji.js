var log = require('bunyan').log,
    express = require('express'),
    MxModel = require('mxmqtt'),
    loader = require('./loader'),
    multer = require('multer'),
    fs = require('fs'),
    path = require('path'),
    _ = require('lodash'),
    callbacks = {};



/**
 * Create instance of Sanji
 * @param  {[object]} app     express' instance
 * @param  {[object]} options bag of settings
 * @return {[object]}         Sanji instance
 */
var Sanji = module.exports = function(app, options) {
  var self = this;
  if (!(this instanceof Sanji)) {
    return new Sanji(app, options);
  }

  self.options     = options = options || {};
  self.apiBase     = options.apiBase || '';
  self.ramdiskPath = options.ramdiskPath || '/run/shm/';

  options.watch = function(loader) {
    loader.load();
    self.router = self.createRouter(loader.getRoutes());
    log.info('Sanji Router has been updated.');
  };

  self.sseConns = [];
  self.sseHeartbeat(30000);  // start heartbeat every n seconds
  self.loader = loader(options);
  self.router = self.createRouter(self.loader.getRoutes(), options);
  self.createEventPusher(); // enable event pusher (sanji.system.event)

  return self.router;
};







/**
 * Create an event pusher for models who wants push event to current connections
 * @return {[type]} [description]
 */
Sanji.prototype.createEventPusher = function() {
  var self = this;

  // create model for recieveing events and push to browser
  var eventModel = self.createModel({
    name: 'SANJI-WEB-SYSEVENT-' + require('os').hostname(),
    role: 'model',
    resources: ['/system/event']
  });

  // post handler
  var data = '';
  eventModel.post('/system/event', function(req, res) {
    self.pushEvent('sanji.system.event', req.body);
    log.info('Model: %s event is already pushed.', req.body.name);
  });

  log.info('createEventPusher is enabled.');
};


/**
 * Create express router by input models' routes
 * @param  {[array]} routes models' routes loaded by loader
 * @return {[object]}        express' router
 */
Sanji.prototype.createRouter = function(routes, options) {

  var self = this;

  // create new express router
  var router = express.Router();

  // convert request into mqtt data
  router.use(this.populateMqttData);
  router.use('/sse', this.sse.bind(this));

  // setup each config's route
  routes.forEach(function(route) {
    // if resources is empty
    if (!route) {
      return;
    }

    if ((route.downloadFile && route.downloadFile.ramdisk === true) ||
        (route.deleteFile && route.deleteFile.ramdisk === true) ||
        (route.uploadFile && route.uploadFile.ramdisk === true)) {
      route._bundlePath = self.ramdiskPath;
    }

    // perform download by assigned path
    if (route.downloadFile) {
      self.setupDownloadRoute(router, route);
    }

    // perform delete file
    if (route.deleteFile) {
      self.setupDeleteRoute(router, route);
    }

    // this routing is about file upload
    if (route.uploadFile) {
      router.use(route.uri, _.curry(self.populateFileData.bind(self))(route));
      self.setupUploadFileRoute(router, route);
    }

    // only uploadFile and normal req needs to translate req to sanji message
    if (route.downloadFile || route.deleteFile) {
      return;
    }

    // usual mqtt routing
    self.setupMqttRoute(router, route);
  });

  // create model
  // TODO: set resource by bundle.json. now just use `/#`
  this.model = this.createModel(options);

  return router;
};






Sanji.prototype.createModel = function(options) {
  options = options || {};
  // init options
  options.name       = options.name || 'SANJI-REST-' + require('os').hostname();
  options.brokerIp   = options.brokerIp || 'localhost';
  options.brokerPort = options.brokerPort || 1883;
  options.role       = options.role || 'view';
  options.resources  = options.resources || ['/#'];

  if (options.resources.length === 0) {
    log.warn('Model %s have no resouces', options.name);
  }

  // create model
  var model = new MxModel({
    host: options.brokerIp,
    port: options.brokerPort
  });
  model.set('name', options.name);
  model.set('role', options.role);
  model.set('resources', options.resources);
  model.listen();

  return model;
};






/**
 * Convert Http request to Sanji request
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
Sanji.prototype.populateMqttData = function(req, res, next) {
  var mqttData = {
    resource: req.url,
    method: req.method.toLowerCase()
  };

  if (req.body && req.body.length!==0) {
    mqttData.data = req.body;
  }

  req.mqttData = mqttData;
  log.trace('mqttData', mqttData);

  return next();
};


/**
 * Populate File Description for Resource has upload ability
 * @param  {[type]}   route [description]
 * @param  {[type]}   req   [description]
 * @param  {[type]}   res   [description]
 * @param  {Function} next  [description]
 * @return {[type]}         [description]
 */
Sanji.prototype.populateFileData = function(route, req, res, next) {
  var fileConfig = route.uploadFile;
  var filePath = this.getRouteFilename(
    route._bundlePath,
    fileConfig,
    function(errObj) {
      log.error('populateFileData path error @%s', route.uri);
      log.error(errObj.message);
      log.error(errObj.log);
    }
  );

  if (filePath === false) {
    return;
  }

  // read all files in filePath, if user define allowFiles then filter them
  var filename = fs.readdirSync(filePath);
  if (fileConfig.allowedFiles && fileConfig.allowedFiles.lenght !== 0) {
    filename = _.intersection(filename, fileConfig.allowedFiles);
  }

  res.locals._file = {
    path: path.join(this.apiBase, route.uri, fileConfig.path),
    filename: filename
  };

  return next();
};


/**
 * Server-Sent Event service
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
Sanji.prototype.sse = function(req, res) {
  var self = this;
  req.socket.setTimeout(Infinity);
  // send headers for event-stream connection
  // see spec for more information
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 3\n');
  res.write('\n');

  // push this res object to our global variable
  self.sseConns.push(res);
  // When the request is closed, e.g. the browser window
  // is closed. We search through the open connections
  // array and remove this connection.
  req.on('close', function() {
    log.debug('sse connection close');
    var toRemove;
    for (var j = 0 ; j < self.sseConns.length ; j++) {
      if (self.sseConns[j] === res) {
        toRemove = j;
        break;
      }
    }
    self.sseConns.splice(toRemove, 1);
  });
};

Sanji.prototype.sseHeartbeat = function(interval) {
  var self = this;
  var pushHeartbeat = function() {
    self.sseConns.forEach(function(res) {
      // push comment message to every connections.
      // http://www.w3.org/TR/eventsource/
      // comment = colon *any-char end-of-line
      res.write(':h\n');
    });
  };

  // set heartbeat
  setInterval( function() {
    pushHeartbeat();
  }, interval);
};

Sanji.prototype.pushEvent = function(event, data) {
  var jsonString = '';
  try {
    jsonString = JSON.stringify(data) || {};
  } catch (e) {
    log.warn(e);
  }

  var count = 0;
  this.sseConns.forEach(function(res) {
    res.write('event: ' + event +'\n');
    res.write('data: ' + jsonString + '\n\n');
    count++;
  });
  log.debug('Pushed event: %s to %d clients.', event, count);
};


Sanji.prototype.setupUploadFileRoute = function(router, route) {

  var self = this;
  var fileConfig = route.uploadFile;
  fileConfig.limits = fileConfig.limits || {};

  var uploadHandler = function(req, res, next) {
    // nothing uoloading in this request, skipping...
    if (_.isEmpty(req.files)) {
      return next();
    }

    // if someone exceeded limit, return error.
    // the file which size exceeded limit has been deleted by multer callback.
    for (var filename in req.files) {
      if (req.files[filename].truncated === true) {
        var errObj = {
          code: 400,
          message: 'File size exceeded! route:' + route.uri
        };
        self.resErr(res, errObj);
        return;
      }
    }

    // case 1: set allowed files
    if (fileConfig.allowedFiles) {
      // check result have errors or not
      var files = _.pick( req.files, fileConfig.allowedFiles);
      var errorFiles = _.omit( req.files, fileConfig.allowedFiles);
      if (!_.isEmpty(errorFiles)) {
        _.map(errorFiles, function(file) {
          fs.unlinkSync(file.path);
        });
        res.json(400, {
            message: 'Invaild filename (fieldname)',
            log: {
              uploaded: req.files,
              allowedFiles: fileConfig.allowedFiles
            }
          });
        return;
      }

      // rename to fieldname
      for (var filename in files) {
        var file = files[filename];
        var newPath = file.path.replace(file.name, file.fieldname);
        fs.renameSync(file.path, newPath);
      }
    } else {
    // case 2: free to upload any file, pass fileNames
      var fileNameList = [];
      for (var filename in req.files) {
        fileNameList.push(req.files[filename].name);
      }

      if (fileNameList.length === 1) {
        req.mqttData.data.fileName = fileNameList[0];
      } else {
        req.mqttData.data.fileName = fileNameList;
      }
    }

    // populate mqtt data
    try {
      if (req.body.formData) {
        req.mqttData.data = _.merge(req.mqttData.data, JSON.parse(req.body.formData));
        delete req.mqttData.data.formData; // remove formData
      }
    } catch(e) {
      res.json(400, {
        message: 'Invaild formData',
        log: {
          formData: req.body.formData
        }
      });
    }

    // nothing bad, going on...
    next();
  };

  var filePath = self.getRouteFilename(
    route._bundlePath,
    fileConfig,
    function(errObj) {
      log.error('Upload file path error @%s', route.uri);
      log.error(errObj.message);
      log.error(errObj.log);
    }
  );

  if (filePath === false) {
    return;
  }

  var multerConfig = {
    dest: filePath,
    limits: fileConfig.limits,
    onFileSizeLimit: (function(file) {
      fs.unlink(file.path);
      log.warn('File size exceeded! %s has been deleted.', file.path);
    }),
    onError: (function (error, next) {
      log.err(error);
      next(error);
    })
  };

  if (!fileConfig.allowedFiles) {
    multerConfig.rename = function(fieldname, filename) {
      return filename.replace(/\W+/g, '-').toLowerCase();
    };
  }

  router.route(route.uri)
    .all(multer(multerConfig))
    .post(uploadHandler)
    .put(uploadHandler);

  log.info('Route add [FileUpload]: %s', route.uri);
};






Sanji.prototype.defaultCallback = function(req, res) {
  log.info('%s %s', req.method, req.url);
  var self = this;
  var respFunc = function(result) {
    if (res.locals) {
      result.data = _.merge(res.locals, result.data);
    }
    res.json(result.code, result.data);
  };

  // async mode
  // (1) ask controller which models will be block (model dependencies)
  // (2) response to client
  // (3) sent event when received response from model via controller
  if (req.query.async) {
    log.debug('async');
    var mqttData = {
      resource: '/controller/resource/dependency?resource=' + req.path,
      method: 'get'
    };

    // replace respFunc to sse pushEvent
    respFunc = function(result) {
      self.pushEvent('sanji.async.response', result);
    };

    // (1)
    this.model.request(mqttData).then(function(result) {
      // (3)
      res.json(result.code, result.data);
    }, function(result) {
      res.json(result.code, result.data);
    });
  }

  // (2)
  this.model.request(req.mqttData).then(respFunc, respFunc);
};





Sanji.prototype.addCallback = function(name, callback) {
  if (callbacks[name]) {
    log.warn('Callback %s has been overwritten.', name);
  }

  callbacks[name] = callback;
  log.info('Callback %s has been added.', name);
};

Sanji.prototype.setupDownloadRoute = function(router, route) {
  var self = this;
  var fileConfig = route.downloadFile;
  router.get(route.uri, function(req, res) {
    // if route has param 'filename' use it first,
    // otherwise use config downloadFile.filename
    fileConfig.filename = req.params.filename || fileConfig.filename || 'no_name';

    var filePath = self.getRouteFilename(
      route._bundlePath,
      fileConfig,
      function(errObj) {
        self.resErr(res, errObj);
      }
    );

    if (filePath === false) {
      return;
    }

    res.download(filePath, fileConfig.filename, function(err) {
      if (err) {
        var errObj = {
          code: err.status,
          message: 'Download file failed.',
          err: err
        }
        self.resErr(res, errObj);
      }
    });
  });
  log.info('Route add [%s]: %s', 'Download', route.uri);
};

Sanji.prototype.setupDeleteRoute = function(router, route) {
  var self = this;
  var fileConfig = route.deleteFile;
  router.delete(route.uri, function(req, res) {
    // if params doesn't have filename, raise error
    if (!req.params.filename) {
      var errObj = {
        message: 'filename is not exist! Please check your bundle.json'
      };
      self.resErr(res, errObj);
      return;
    }

    fileConfig.filename = req.params.filename;

    var filePath = self.getRouteFilename(
      route._bundlePath,
      fileConfig,
      function(errObj) {
        self.resErr(res, errObj);
      }
    );

    if (filePath === false) {
      return;
    }

    fs.unlink(filePath, function(err) {
      if (err) {
        var errObj = {
          message: 'Delete file failed.',
          err: err
        };
        self.resErr(res, errObj);
        return;
      }
      res.json();
    });
  });
  log.info('Route add [%s]: %s', 'Download', route.uri);
};


Sanji.prototype.setupMqttRoute = function(router, route) {

  route.methods  = route.methods  || ['get', 'put', 'post', 'delete'];
  route.callback = route.callback || this.defaultCallback.bind(this);

  if ('function' !== typeof(route.callback)) {
     log.error(
      'Route [%s]: %s callback is not a function.', route.methods, route.uri);
     return;
  }

  if (!Array.isArray(route.methods)) {
    route.methods = [route.methods];
  }

  // setup routing rules and it's callback
  route.methods.forEach(function (method) {
    router[method](route.uri, route.callback);
    log.info('Route add [%s]: %s', method, route.uri);
  });
};


Sanji.prototype.resErr = function(res, errObj) {

  // set defaults
  errObj         = errObj || {};
  errObj.code    = errObj.code || 500;
  errObj.message = errObj.message || 'Unknow error.';
  errObj.err     = errObj.err;

  // log and response
  log.error(errObj.message, errObj.err);
  res.json(errObj.code, {
    message: errObj.message,
    log: errObj.err
  });
};



Sanji.prototype.vaildBundlePath = function(bundlePath, filename) {
  return ;
};

Sanji.prototype.getRouteFilename = function(bundlePath, fileConfig, errFn) {

  var filename = fileConfig.filename || ''; // upload may not have filename
  var filePath = path.normalize(path.join(
    bundlePath,
    fileConfig.path,
    filename
  ));

  // for security issue, we strictly limit deleteFile only in bundlePath
  if (filePath.indexOf(bundlePath) === -1) {

    var errObj = {
      code: 403,
      message: 'Permission denied: ' + filePath,
    };

    if ('function' === typeof(errFn)) {
      errFn(errObj);
    }

    return false;
  }

  return filePath;
};
