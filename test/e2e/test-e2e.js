var bunyan = require('bunyan'),
    log = bunyan.log = bunyan.createLogger({name: 'Sanji-REST'}),
    app = require('express')(),
    SanjiExpress = require('../../index');

new SanjiExpress(app, {
  brokerHost: 'localhost',
  borkerPort: 1883,
  bundlesHome: '/home/zack/github/sanji-node-express/test'
});

app.listen(5566);
