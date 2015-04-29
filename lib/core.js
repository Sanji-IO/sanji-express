var log = require('sanji-logger')('sanji-rest').child({module: 'core'}),
    SanjiExpressFile = require('./plugins/file'),
    SanjiExpressMqtt = require('./plugins/mqtt'),
    SanjiExpressDownloadHelper = require('./plugins/download-helper'),
    SanjiExpressPuppetMaster = require('./plugins/puppetmaster'),
    Sanji = require('sanji'),
    express = require('express'),
    Loader = require('./loader'),
    util = require('util'),
    eventEmitter = require('events').EventEmitter,
    SanjiExpress;

/**
 * Create instance of Sanji
 * @param  {[object]} app     express' instance
 * @param  {[object]} options bag of settings
 * @return {[object]}         Sanji instance
 */
module.exports = SanjiExpress = function(options) {

  if (!(this instanceof SanjiExpress)) {
    return new SanjiExpress(options);
  }

  eventEmitter.call(this);

  var router = express.Router(),
      loaderOptions;

  this.options = options || {};
  loaderOptions = this.options.loaderOptions || this.options.bundlesHome;

  // loads all bundle.json config files
  this.loader = new Loader(loaderOptions);

  // creates routing path by loadded routes config
  this.setupBundleRoute(router, this.loader.getRoutes());

  // attach this to router
  router.sanji = this;

  return router;
};

util.inherits(SanjiExpress, eventEmitter);

/**
 * Convert Http request to Sanji request
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
SanjiExpress.prototype.initializeRequest = function(req, res, next) {

  var mqttData = {
    resource: req.url,
    method: req.method.toLowerCase()
  };

  if (req.body && req.body.length !==0) {
    mqttData.data = req.body;
  }

  req.mqttData = mqttData;
  req.bundle = this.bundle;
  log.trace('initializeRequest', mqttData);

  return next();
};

/**
 * Create express router by input bundles' routes
 * @param  {[array]} routes bundles' routes loaded by loader
 * @return {[object]}        express' router
 */
SanjiExpress.prototype.setupBundleRoute = function(router, routes) {

  var self = this,
      ramdiskPath = self.options.ramdiskPath || '/run/shm/';

  // create bundle
  this.bundle = this.createViewBundle(routes);

  // convert request into Sanji Message and put bundle to res.bundle
  router.use(this.initializeRequest.bind(this));

  // creates group/remote bundle path
  router.use(SanjiExpressPuppetMaster(this.bundle, this.options.io));

  router.use(/^(\/(cg\-[\w]+))(\/.*)$/, function(req, res, next) {
    var qs = '';
    if (req._parsedUrl.query) {
      qs = '?' + req._parsedUrl.query;
    }

    req.remoteRequest = {
      targetId: req.params[1],
      resource: req.params[2] + qs
    };
    next();
  });

  router.use(SanjiExpressDownloadHelper());

  // setup each config's route
  routes.forEach(function(route) {
    if (route.file) {
      router.use(SanjiExpressFile(route, {ramdiskPath: ramdiskPath}));
    }
  });

  // perform mqtt translate [GET, POST, PUT, DELETE]
  router.use(SanjiExpressMqtt());

  // Catch all errors
  router.use(errorHandler);

  return router;
};

SanjiExpress.prototype.createViewBundle = function(routes) {

  var self = this,
  // subscribe all view topics, let controller routes mqtt resources
      resources = [{resource: '/#'}],
      profile,
      options,
      bundle;

  // only push mqtt related view's resource for register
  // routes.forEach(function(route) {
  //   if (!route.file || route.file.upload) {
  //     resources.push(route);
  //     return;
  //   }
  // });

  profile = {
    name: 'SANJI-REST-' + require('os').hostname(),
    description: 'This is a virtual bundle created by SanjiExpress.',
    role: 'view',
    ttl: 60,
    resources: resources
  };

  // create bundle
  options = {
    bundlePath: profile,
    connectionOptions: {
      host: self.options.brokerHost,
      port: self.options.brokerPort
    }
  };

  bundle = new Sanji(options);
  bundle.run = function() {
    self.emit('ready');
  };

  bundle.start();

  return bundle;
};

var errorHandler = function(err, req, res, next) {
  res.status(err.code || 500).json({message: err.message});
  log.debug('errorHandler', err.stack);
};
