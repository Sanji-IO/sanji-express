var express = require('express');
var debug = require('debug')('sanji-express:download-helper');
var objectAssign = require('object-assign');

module.exports = SanjiExpressDownloadHepler = function () {
  var router = express.Router();
  router.get('*', function (req, res, next) {
    if (!req.query.resource) {
      debug('No resource');
      return res.status(400).json({ message: 'No resource' });
    }

    var respFunc = function (resp) {
      if (resp.code !== 200) {
        var err = new Error(resp.data.message);
        err.code = resp.code;
        return next(err);
      }

      res.json({
        downloadLink: resp.data.url
      });
    };

    var respRemoteFunc = function (result) {
      if (result.data && !result.data.code) {
        return res.status(result.code).json(result.data);
      }

      result.data.data = (result.data.data === null) ? {} : result.data.data;
      if (result.data.code === 200) {
        return res.json({
          downloadLink: result.data.data.url
        });
      }

      return res.status(result.data.code).json(result.data.data);
    };

    var reqData = {
      url: process.env.SITE_URL + '/api/v1/files/upload',
      headers: req.headers
    };

    if (req.remoteRequest === undefined) {
      debug('Download Help --> local');
      req.bundle
        .publish
        .post(req.query.resource, reqData)
        .then(respFunc)
        .catch(next);
    } else {
      debug('Download Help --> remote:' + req.remoteRequest.targetId);
      req.bundle
        .publish
        .post('/remote/' + req.remoteRequest.targetId, {
          resource: req.query.resource + req.remoteRequest.querystring,
          method: 'post',
          data: reqData
        })
        .then(respRemoteFunc)
        .catch(next);
    }
  });

  return router;
};
