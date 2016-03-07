var debug = require('debug')('sanji:express:core');
var express = require('express');
var Sanji = require('sanji');
var SanjiExpressMqtt = require('./plugins/mqtt');
var SanjiExpressDownloadHelper = require('./plugins/download-helper');
var SanjiExpressUploadHelper = require('./plugins/upload-helper');

module.exports = function(options) {

  var router = express.Router();
  var bundle;
  options = options || {};

  var createViewBundle = function() {
    // subscribe all view topics, let controller routes mqtt resources
    var _this = this;
    var resources = [{resource: '/#'}];
    var profile;
    var bundleOptions;
    var bundle;

    profile = {
      name: 'SANJI-REST-' + require('os').hostname(),
      description: 'This is a virtual bundle created by SanjiExpress.',
      role: 'view',
      ttl: 60,
      resources: resources
    };

    // create bundle
    bundleOptions = {
      bundlePath: profile,
      connectionOptions: {
        host: options.brokerHost,
        port: options.brokerPort
      }
    };

    bundle = new Sanji(bundleOptions);
    bundle.start();

    return bundle;
  };

  var initializeRequest = function(req, res, next) {
    var mqttData = {
      resource: req.url,
      method: req.method.toLowerCase()
    };

    if (req.body && req.body.length !== 0) {
      mqttData.data = req.body;
    }

    req.mqttData = mqttData;
    req.bundle = bundle;
    debug('initializeRequest', mqttData);

    // Produce remoteRequest object if cg-id detected
    if (!req.params[0]) {
      return next();
    }

    var qs = '';
    if (req._parsedUrl.query) {
      qs = '?' + req._parsedUrl.query;
    }

    req.remoteRequest = {
      targetId: req.params[1],
      resource: req.params[2] + qs,
      querystring: qs
    };

    debug('remoteRequest', req.remoteRequest);
    return next();
  };

  var errorHandler = function(err, req, res, next) {
    res.status(err.code || 500).json({message: err.message});
    debug('errorHandler', err.stack);
  };

  bundle = createViewBundle();

  // convert request into Sanji Message and put bundle to res.bundle
  router.all(/^(\/(cg\-[\w]+))?(\/.*)$/, initializeRequest);

  router.get(/^(\/(cg\-[\w]+))?\/helper\/download$/, SanjiExpressDownloadHelper());

  router.all(/^(\/(cg\-[\w]+))?\/helper\/upload$/, SanjiExpressUploadHelper());

  // perform mqtt translate [GET, POST, PUT, DELETE]
  router.use(SanjiExpressMqtt(options.mqttOptions));

  // Catch all errors
  router.use(errorHandler);

  router.bundle = bundle;

  return router;
};
