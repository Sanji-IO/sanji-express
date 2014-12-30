var bunyan = require('bunyan'),
    log = bunyan.log = bunyan.createLogger({name: 'Sanji-REST'}),
    app = require('express')(),
    SanjiExpress = require('../../index');

new SanjiExpress({
  brokerHost: '192.168.31.14',
  borkerPort: 1883,
  loaderOptions: {
    bundlesHome: '/home/zack/github/sanji-node-express/test'
  }
});

// app.listen(5566);
