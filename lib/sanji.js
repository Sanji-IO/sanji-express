var bunyan = require('bunyan'),
    log = bunyan.createLogger({name: 'Sanji-REST', level: 'trace'}),
    express = require('express'),
    MxModel = require('mxmqtt'),
    loader = require('./loader'),
    multer = require('multer'),
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
  this.apiPrefix = '';
  this.loader = loader(options);
  this.router = this.createRouter(this.loader.getRoutes());
  this.model = this.createModel();

  return this.router;
};

Sanji.prototype.defaultCallback = function(req, res) {
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

/**
 * Create express router by input models' routes
 * @param  {[array]} routes models' routes loaded by loader
 * @return {[object]}        express' router
 */
Sanji.prototype.createRouter = function(routes) {

  // create new express router
  var router = express.Router();

  // convert request into mqtt data
  router.use(this.populateMqttData);

  // setup each config's route
  routes.forEach(function(route) {

    // this routing is about file upload
    if (route.file) {
      router.route(route.uri).post(multer(route.file));
      log.debug('FileUpload route add: %s', route.uri);
      log.debug(route.file);
      return;
    }

    // else normal routing
    route.methods  = route.methods  || ['get', 'put', 'post', 'delete'];
    route.callback = route.callback || this.defaultCallback;

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
  });

  return router;
}

Sanji.prototype.createModel = function(options) {
  options = options || {};
  // init options
  options.name      = options.name || 'SANJI-REST-' + require('os').hostname();
  options.mq_ip     = options.mq_ip || 'localhost';
  options.mq_port   = options.mq_port || 1883;
  options.role      = options.role || 'view'
  options.resources = options.resources || [];

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

Sanji.prototype.populateMqttData = function(req, res, next) {

  var mqttData = {
    resource: req.path.replace(this.apiPrefix, ''),
    method: req.method.toLowerCase()
  };

  if (req.body && req.body.length!==0) {
    mqttData.data = req.body;
  }

  if (req.files && req.files.length > 0) {
    mqttData.data.files = req.files;
    res.json(mqttData);
    return;
  }

  req.mqttData = mqttData;
  log.trace('mqttData', mqttData);

  return next();
}
