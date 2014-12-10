var log = require('sanji-logger')('sanji-rest').child({module: 'error'});

module.exports = function(res, errObj) {

  // set defaults
  errObj = errObj || {};
  errObj.code = errObj.code || 500;
  errObj.message = errObj.message || 'Unknow error.';
  errObj.err = errObj.err;

  // log and response
  log.debug(errObj.message, errObj.err);
  res.status(errObj.code).json({
    message: errObj.message,
    log: errObj.err
  });
};

