var express = require('express');
var debug = require('debug')('sanji:express:mqtt');
var TimeoutError = require('bluebird').TimeoutError;
var _ = require('lodash');
var NODE_ENV = process.env.NODE_ENV || 'test';
var requestTimeoutTime = 60000;
var SanjiExpressMqtt;
var setupMqttRoute;
var defaultCallback;

if (NODE_ENV === 'test') {
  requestTimeoutTime = 10;
}

defaultCallback = function defaultCallback(req, res) {
  debug('%s %s', req.method, req.url);

  var respFunc;
  var respRemoteFunc;
  var reqPromise;
  var mqttData = req.mqttData;

  respFunc = function respFunc(result) {
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

    if (result.data.code) {
      // null translate to {} for preventing breaks some JSON Parser
      // need more investigate...
      if (result.data.data === null) {
        result.data.data = {};
      }

      res.status(result.data.code).json(result.data.data);
      return;
    }

    res.status(result.code).json(result.data);
  };

  if (req.remoteRequest === undefined) {
    reqPromise = req.bundle.publish[mqttData.method](
      mqttData.resource, mqttData.data)
      .then(respFunc);
  } else {
    reqPromise = req.bundle
      .publish[mqttData.method]('/remote/' + req.remoteRequest.targetId, {
        resource: req.remoteRequest.resource,
        method: mqttData.method,
        data: mqttData.data
      })
      .then(respRemoteFunc);
  }

  reqPromise
    .timeout(requestTimeoutTime)
    .catch(TimeoutError, function() {
      res.status(408).json({message: 'Request timeout.'});
    })
    .catch(function(e) {
      debug(e);
      res.status(500).json({message: 'Internal Server Error', log: e});
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
  router.all('*', defaultCallback);
};

module.exports = SanjiExpressMqtt = function(options) {

  var router = express.Router();

  setupMqttRoute(router);

  return router;
};
