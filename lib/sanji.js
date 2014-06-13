var log = require('bunyan').log,
    express = require('express'),
    MxModel = require('mxmqtt'),
    loader = require('./loader'),
    multer = require('multer'),
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

  options = options || {};

  options.watch = function(loader) {
    loader.load();
    self.router = self.createRouter(loader.getRoutes());
    log.info('Sanji Router has been updated.');
  };

  self.sseConns = [];
  self.loader = loader(options);
  self.router = self.createRouter(self.loader.getRoutes(), options);

  return self.router;
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
    // perform download by assigned path
    if (route.downloadFile) {
      self.setupDownloadRoute(router, route);
      return;
    }

    // this routing is about file upload
    if (route.uploadFile) {
      self.setupFileRoute(router, route);
    }

    // usual mqtt routing
    self.setupMqttRoute(router, route);
  });

  // create model
  // TODO: set resource by bundle.json. now just use `/#`
  this.model = this.createModel(options);

  return router;
}






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
  res.write('\n');

  // push this res object to our global variable
  self.sseConns.push(res);
  // When the request is closed, e.g. the browser window
  // is closed. We search through the open connections
  // array and remove this connection.
  req.on('close', function() {
    log.debug('close');
    var toRemove;
    for (var j = 0 ; j < self.sseConns.length ; j++) {
      if (self.sseConns[j] === res) {
        toRemove = j;
        break;
      }
    }
    self.sseConns.splice(j,1);
  });
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


Sanji.prototype.setupFileRoute = function(router, route) {

  var fileConfig = route.uploadFile;

  var onError = function (error, next) {
    log.err(error);
    next(error);
  };

  var rename = function(fieldname, filename) {
    var vaild = false;
    if (fileConfig.allowedFiles) {
      fileConfig.allowedFiles.forEach(function(name) {
        if (name === fieldname) {
          vaild = true;
        }
      });
    }

    return vaild ? fieldname : 'invalid.tmp';
  };

  var uploadHandler = function(req, res, next) {
    // check result have errors or not
    var errorFiles = _.omit( req.files, fileConfig.files);
    if (!_.isEmpty(errorFiles)) {
      res.json(400, {
          message: 'Invaild filename (fieldname)',
          log: {
            uploaded: errorFiles,
            allowedFiles: fileConfig.allowedFiles
          }
        });
      return;
    }

    // populate mqtt data
    req.mqttData.data = JSON.parse(req.body.formData);

    // nothing bad, going on...
    next();
  };

  router.route(route.uri)
    .all(multer({
      dest: fileConfig.dest,
      onError: onError,
      rename: rename
    }))
    .post(uploadHandler)
    .put(uploadHandler);

  log.info('Route add [FileUpload]: %s', route.uri);
};






Sanji.prototype.defaultCallback = function(req, res) {
  log.info('%s %s', req.method, req.url);
  var self = this;
  var respFunc = function(result) {
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
  router.get(route.uri, function(req, res) {
    route.staticFile.name = route.staticFile.name || 'no_name';
    res.download(route.staticFile.path, route.staticFile.name, function(err) {
      if (err) {
        log.error('Download file failed.', err);
        res.json(err.status, {
          message: 'Download file failed.',
          log: err
        });
      }
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
