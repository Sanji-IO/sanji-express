var log = require('sanji-logger')('sanji-rest').child({module: 'download'});
var express = require('express');
var objectAssign = require('object-assign');

module.exports = SanjiExpressDownloadHepler = function(options) {
  options = options || {};
  options = objectAssign({
    url: 'http://you-have-to-set-url/api/v1/files/upload'
  }, options);

  var router = express.Router();
  router.get('*', function(req, res, next) {
    if (!req.query.download) {
      return next();
    }

    var respFunc = function(resp) {
      if (resp.code !== 200) {
        var err = new Error(resp.data.message);
        err.code = resp.code;
        return next(err);
      }

      res.redirect(resp.data.url);
    };

    var respRemoteFunc = function(result) {
      if (result.data && !result.data.code) {
        res.status(result.code).json(result.data);
      }

      result.data.data = (result.data.data === null) ? {} : result.data.data;
      if (result.data.code === 200 ){
        return res.redirect(result.data.data.url);
      }

      return res.status(result.data.code).json(result.data.data);

    };

    var reqData = {
      url: options.url,
      headers: {
        'X-Mx-AccessToken': req.get('X-Mx-AccessToken')
      }
    };

    if (!req.remoteRequest) {
      req.bundle
        .publish
        .post(req.mqttData.resource, reqData)
        .then(respFunc)
        .catch(next);
    } else {
      req.bundle
        .publish
        .post('/remote/' + req.remoteRequest.targetId, {
          resource: req.remoteRequest.resource,
          method: 'post',
          data: reqData
        })
        .then(respRemoteFunc)
        .catch(next);
    }
  });

  return router;
};
