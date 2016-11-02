var express = require('express');
var debug = require('debug')('sanji-express:upload-helper');
var Promise = require('bluebird');
var objectAssign = require('object-assign');
var request = require('request');
var Busboy = require('busboy');
var pass = require('stream').PassThrough;

var sanjiHelper = function (req, res, next) {
  var respFunc = function (resp) {
    if (resp.code !== 200) {
      var err = new Error(resp.data.message);
      err.code = resp.code;
      return next(err);
    }

    res.json(resp.data);
  };

  var respRemoteFunc = function (result) {
    if (result.data && !result.data.code) {
      return res.status(result.code).json(result.data);
    }

    result.data.data = (result.data.data === null) ? {} : result.data.data;
    if (result.data.code === 200) {
      return res.json(result.data.data);
    }

    return res.status(result.data.code).json(result.data.data);
  };

  var jsonData = JSON.parse(req.body.jsonData || '{}');
  var reqData = objectAssign(
    {
      file: {
        url: process.env.SITE_URL + req.filebin.url,
        physicalPath: req.filebin.physicalPath,
        headers: req.headers
      }
    },
    jsonData
  );

  debug('reqData', reqData);

  if (req.remoteRequest === undefined) {
    debug('Upload Help --> local');
    req.bundle
      .publish[req.method.toLowerCase()](req.query.resource, reqData)
      .then(respFunc)
      .catch(next);
  } else {
    debug('Upload Help --> remote:' + req.remoteRequest.targetId);
    req.bundle
      .publish
      .post('/remote/' + req.remoteRequest.targetId, {
        resource: req.query.resource + req.remoteRequest.querystring,
        method: req.method.toLowerCase(),
        data: reqData
      })
      .then(respRemoteFunc)
      .catch(next);
  }
};

var proxyToFileBin = function (req, res, next) {
  if (!req.query.resource) {
    debug('No resource');
    return res.status(400).json({ message: 'No resource' });
  }

  var parseFormField = new Promise(function (resolve, reject) {
    var busboy = new Busboy({ headers: req.headers });
    req.pipe(busboy);
    busboy.on('field', function (
        fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
      debug('busboy: got field [' + fieldname + ']: value: ' + val);
      req.body = req.body || {};
      req.body[fieldname] = val;
    });

    busboy.on('error', function (err) {
      debug('busboy: error');
      debug(err);
      reject(err);
    });

    busboy.on('finish', function () {
      debug('busyboy: finished');
      resolve();
    });
  });

  var proxy = new Promise(function (resolve, reject) {
    var apiRequest = req.pipe(request({
      url: process.env.SITE_URL + '/api/v1/files/upload',
      method: req.method.toLowerCase(),
      json: true,
      rejectUnauthorized: false,
      headers: {
        'X-Mx-AccessToken': req.get('X-Mx-AccessToken')
      }
    }, function (err, response, body) {
      if (err) return next(err);
      req.filebin = body;
      resolve();
    }));

    apiRequest.on('error', function (err) {
      debug('apiRequest: error');
      debug(err);
      reject(err);
    });
  });

  Promise.all([proxy, parseFormField])
    .then(function () {
      return next();
    })
    .catch(function (err) {
      return next(err);
    });
};

module.exports = SanjiExpressUploadHepler = function () {
  var router = express.Router();

  router.post('*',
    proxyToFileBin,
    sanjiHelper
  );

  router.put('*',
    proxyToFileBin,
    sanjiHelper
  );

  return router;
};
