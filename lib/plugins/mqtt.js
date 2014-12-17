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

  req.bundle.publish[mqttData.method](mqttData.resource, mqttData.data)
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
  router.all('*', defaultCallback);

};

module.exports = SanjiExpressMqtt = function(options) {

  var router = express.Router();

  setupMqttRoute(router);

  return router;
};
