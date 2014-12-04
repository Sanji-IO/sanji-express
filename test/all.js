var bunyan = require('bunyan'),
    log = bunyan.log = bunyan.createLogger({name: 'Sanji-REST', level: 'trace'}),
    SanjiExpress = require('../lib/core'),
    express = require('express');

var app = express();
var rest = new SanjiExpress(app, {
  bundlePath: './sample_config'
});

// app.use(cros);
app.listen(7890);
