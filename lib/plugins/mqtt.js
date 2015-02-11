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

  respRemoteFunc = function respRemoteFunc(result) {
    // result sample data
    // {
    //   "data": {
    //     "data": {
    //       "lat": 0,
    //       "lon": 0
    //     },
    //     "method": "get",
    //     "code": 200,
    //     "id": 2606,
    //     "resource": "/system/gps",
    //     "sign": [
    //       "gps"
    //     ]
    //   },
    //   "method": "get",
    //   "code": 200,
    //   "id": 4410,
    //   "resource": "/remote/cg-1234",
    //   "sign": [
    //     "remote"
    //   ]
    // }
    if (res.locals) {
      result.data = _.merge(res.locals, result.data);
    }

    if (result.code === 200 && result.data.code) {
      res.status(result.data.code).json(result.data.data);
      return;
    }

    res.status(result.code).json(result.data);
  };

  timeoutFunc = function() {
    res.status(400).json({'message': 'request timeout'});
  };

  if (sendTo === 'self') {
    reqPromise = req.bundle.publish[mqttData.method](
      mqttData.resource, mqttData.data)
      .then(respFunc, respFunc)
  } else {
    reqPromise = req.bundle.publish[mqttData.method]('/remote/' + sendTo, {
        resource: req.params[2],
        method: mqttData.method,
        data: mqttData.data
      })
      .then(respRemoteFunc, respRemoteFunc)
  }

  reqPromise
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
