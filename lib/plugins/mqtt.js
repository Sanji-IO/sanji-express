var express = require('express'),
    log = require('sanji-logger')('sanji-rest').child({module: 'mqtt'}),
    TimeoutError = require('bluebird').TimeoutError,
    _ = require('lodash'),
    SanjiExpressMqtt,
    setupMqttRoute,
    defaultCallback;

defaultCallback = function defaultCallback(req, res) {
  log.debug('%s %s', req.method, req.url);

  var respFunc,
      timeoutFunc,
      reqPromise,
      sendTo = req.params[1] || 'self',
      mqttData = req.mqttData;

  respFunc = function respFunc(result) {
    if (res.locals && !_.isArray(result.data)) {
      result.data = _.merge(res.locals, result.data);
    }
    res.status(result.code).json(result.data);
  };

  timeoutFunc = function() {
    res.status(400).json({'message': 'request timeout'});
  };

  if (sendTo === 'self') {
    reqPromise = req.bundle.publish[mqttData.method](mqttData.resource, mqttData.data)
  } else {
    reqPromise = req.bundle.publish[mqttData.method]('/remote/' + sendTo, {
      resource: req.params[2],
      method: mqttData.method,
      data: mqttData.data
    });
  }

  reqPromise
    .then(respFunc, respFunc)
    .timeout(60000)
    .catch(TimeoutError, function() {
      timeoutFunc();
    });
};

setupMqttRoute = function setupMqttRoute(router) {

  // TODO: This should change to send notify using event message...
  // only uploadFile and normal req needs to translate req to sanji message
  // if (route.file.download || route.file.delete) {
  //   return;
  // }

  // route remote resource first, if url contains "/cg-id/resource"
  // others, treat as local resource
  router.all(/^(\/(cg\-[\w]+))?(\/.*)$/, defaultCallback);

};

module.exports = SanjiExpressMqtt = function(options) {

  var router = express.Router();

  setupMqttRoute(router);

  return router;
};
