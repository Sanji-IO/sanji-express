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

  if (!(this instanceof Sanji)) {
    return new Sanji(app, options);
  }

  options = options || {};
  this.loader = loader(options);
  this.router = this.createRouter(this.loader.getRoutes());

  return this.router;
};





/**
 * Create express router by input models' routes
 * @param  {[array]} routes models' routes loaded by loader
 * @return {[object]}        express' router
 */
Sanji.prototype.createRouter = function(routes) {

  var self = this;

  // create new express router
  var router = express.Router();

  // convert request into mqtt data
  router.use(this.populateMqttData);

  // setup each config's route
  routes.forEach(function(route) {
    // this routing is about file upload
    if (route.file) {
      self.setupFileRoute(router, route);
    }
    // usual mqtt routing
    self.setupMqttRoute(router, route);
  });

  // create model
  // TODO: set resource by bundle.json. now just use `/#`
  this.model = this.createModel();

  return router;
}






Sanji.prototype.createModel = function(options) {
  options = options || {};
  // init options
  options.name      = options.name || 'SANJI-REST-' + require('os').hostname();
  options.mq_ip     = options.mq_ip || 'localhost';
  options.mq_port   = options.mq_port || 1883;
  options.role      = options.role || 'view'
  options.resources = options.resources || ['/#'];

  if (options.resources.length === 0) {
    log.warn('Model %s have no resouces', options.name);
  }

  // create model
  var model = new MxModel({
    host: options.mq_ip,
    port: options.mq_port
  });
  model.set('name', options.name);
  model.set('role', options.role);
  model.set('resources', options.resources);
  model.listen();

  // log.info('Model %s is listen on %s:%s', );
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
}





Sanji.prototype.setupFileRoute = function(router, route) {

  fileConfig = route.file;

  var onError = function (error, next) {
    log.err(error);
    next(error)
  };

  var rename = function(fieldname, filename) {
    var vaild = false;
    if (fileConfig.files) {
      fileConfig.files.forEach(function(name) {
        if (name === fieldname) {
          vaild = true;
          return;
        }
      });
    }

    return vaild ? fieldname : 'invalid.tmp';
  };

  router.route(route.uri)
    .all(multer({
      dest: fileConfig.dest,
      onError: onError,
      rename: rename
    }))
    .all(function(req, res, next) {
      // check result have errors or not
      errorFiles = _.omit( req.files, fileConfig.files);
      if (!_.isEmpty(errorFiles)) {
        res.json(400, {
            message: 'Invaild filename (fieldname)',
            log: {
              uploaded: errorFiles,
              allowed: fileConfig.files
            }
          });
        return;
      }

      // populate mqtt data
      req.mqttData.data = JSON.parse(req.body.formData);

      // nothing bad, going on...
      next();
    });

  log.debug('Route add [FileUpload]: %s', route.uri);
}






Sanji.prototype.defaultCallback = function(req, res) {
  log.info('%s %s', req.method, req.url);
  this.model.request(req.mqttData).then(function(result) {
    res.json(result.code, result.data);
  }, function(result) {
    res.json(result.code, result.data);
  });
};





Sanji.prototype.addCallback = function(name, callback) {
  if (callbacks[name]) {
    log.warn('Callback %s has been overwritten.', name);
  }

  callbacks[name] = callback;
  log.info('Callback %s has been added.', name);
}



Sanji.prototype.setupMqttRoute = function(router, route) {

  route.methods  = route.methods  || ['get', 'put', 'post', 'delete'];
  route.callback = route.callback || this.defaultCallback.bind(this);

  if ('function' !== typeof(route.callback)) {
     log.warn(
      'Route [%s]: %s callback is not a function.', route.methods, route.uri);
     return;
  }

  if (!Array.isArray(route.methods)) {
    route.methods = [route.methods];
  }

  // setup routing rules and it's callback
  route.methods.forEach(function (method) {
    router[method](route.uri, route.callback);
    log.debug('Route add [%s]: %s', method, route.uri);
  });
}
