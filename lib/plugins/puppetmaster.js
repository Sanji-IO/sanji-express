var express = require('express');
var debug = require('debug')('sanji:express:puppetmaster');
var SanjiExpressFile = require('./file');
var SanjiPuppetMaster = require('sanji-puppetmaster');
var SanjiExpressPuppetMaster;
var setupSanjiPuppetMaster;

setupSanjiPuppetMaster = function setupSanjiPuppetMaster(router, bundle, io) {

  // route config for SanjiExpressFile
  var route = {
    resource: '/jobs',
    file: {
      _bundlePath: '/tmp',
      upload: {
        publicLink: true,
        path: './'
      }
    }
  };

  // setup file upload via SanjiExpressFile
  router.use(SanjiExpressFile(route));
  route.resource = '/requests';
  router.use(SanjiExpressFile(route));

  // setup puppetmaster
  router.use(SanjiPuppetMaster(bundle, io));
};

module.exports = SanjiExpressPuppetMaster = function(bundle, io) {

  var router = express.Router();

  setupSanjiPuppetMaster(router, bundle, io);

  return router;
};
