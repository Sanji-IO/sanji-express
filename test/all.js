var sanji = require('../lib/sanji'),
    express = require('express'),
    app = express();

var bunyan = require('bunyan'),
    log = bunyan.log = bunyan.createLogger({name: 'Sanji-REST', level: 'trace'});

var rest = sanji(app, {modelPath: '/home/zack/samba/sanji-web/test/sample_config'});
app.use(rest);
app.listen(7890);
