var bunyan = require('bunyan'),
    log = bunyan.log = bunyan.createLogger({name: 'Sanji-REST', level: 'debug'});
    sanji = require('../lib/sanji'),
    express = require('express'),
    app = express();

/**
 * CORS support.
 */
function cros(req, res, next) {

  if (!req.get('Origin')) {
    return next();
  }

  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE, PUT');
  res.set('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type');

  if ('OPTIONS' === req.method) {
    return res.send(200);
  }

  return next();
}

var rest = sanji(app, {
    modelPath: './sample_config'
  });
app.use(cros);
app.use('/v1/api', rest);
app.listen(7890);
