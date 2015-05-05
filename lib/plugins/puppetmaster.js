var express = require('express');
var SanjiPuppetMaster = require('sanji-puppetmaster');

module.exports = function(bundle, io) {

  var router = express.Router();
  router.use(SanjiPuppetMaster(bundle, io));

  return router;
};
