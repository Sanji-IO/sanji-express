var should = require('should'),
    request = require('supertest'),
    express = require('express'),
    SanjiExpress = require('../index'),
    Promise = require('bluebird'),
    rimraf = require('rimraf'),
    ioc = require('socket.io-client'),
    fs = require('fs');


function makeMockPromise(resource, data, dest) {
  return new Promise(function (resolve) {
    return resolve({
      code: 200,
      data: {
        resource: resource,
        data: data,
        destination: dest
      }
    });
  });
}

function client(srv, nsp, opts){
  if ('object' === typeof nsp) {
    opts = nsp;
    nsp = null;
  }
  var addr = srv.address();
  if (!addr) {
    addr = srv.listen().address();
  }
  var url = 'ws://' + addr.address + ':' + addr.port + (nsp || '');
  return ioc(url, opts);
}

describe('SanjiExpress', function() {

  var app, se, io, server,
      BUNDLES_HOME = __dirname;

  beforeEach(function() {
    app = express();
    app.use(require('body-parser').json());

    // setup socket.io
    server = require('http').Server(app);
    io = require('socket.io')(server);

    // setup SanjiExpress
    se = new SanjiExpress({
      bundlesHome: BUNDLES_HOME,
      io: io
    });
    app.use(se);
    se = se.sanji;

    ['get', 'post', 'put', 'delete'].forEach(function(method) {
      se.bundle.publish[method] = makeMockPromise;
      se.bundle.publish.direct[method] = makeMockPromise;
      se.bundle.publish.event[method] = makeMockPromise;
    });
  });

  describe('CRUD translate to MQTT', function() {

    it('should get code 404 if resource not exist', function(done) {
      request(app)
        .get('/somewhere/you/never/find')
        // .expect(404)
        .end(done);
    });

    it('should translate [GET] method message', function(done) {
      request(app)
        .get('/system/time')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(done);
    });

    it('should translate [PUT] method message with data', function(done) {
      request(app)
        .put('/system/time')
        .send({test: 'okok'})
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          res.body.resource.should.be.equal('/system/time');
          res.body.data.should.be.eql({test: 'okok'});
          done(err);
        });
    });
  });

  describe('SanjiExpressFile', function() {
    describe('get file if config as downloadFile', function() {

      var dirpath = BUNDLES_HOME + '/sample_config/downloads';

      beforeEach(function(done) {
        rimraf.sync(dirpath);
        fs.mkdirSync(dirpath);
        fs.writeFile(dirpath + '/file1', 'file1', function() {
          fs.writeFile(dirpath + '/file2', done);
        });
      });

      afterEach(function() {
        rimraf.sync(dirpath);
      });

      it('should get file with "assigned filename"', function(done) {
        request(app)
          .get('/i/want/to/download/file1')
          .expect(200)
          .expect('Content-Type', /octet-stream/)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }
            res.headers['content-disposition']
              .should.be.equal('attachment; filename=\"file1\"');
            done();
          });
      });

      it('should get file with "non-assigned filename"', function(done) {
        request(app)
          .get('/i/want/to/download/file2')
          .expect(200)
          .expect('Content-Type', /octet-stream/)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }
            res.headers['content-disposition']
              .should.be.equal('attachment; filename=\"file2\"');
            done();
          });
      });
    });

    describe('delete file if config as deleteFile', function() {

      var filepath = BUNDLES_HOME + '/sample_config/deletes/test',
          dirpath = BUNDLES_HOME + '/sample_config/deletes';

      beforeEach(function(done) {
        rimraf.sync(dirpath);
        fs.mkdirSync(dirpath);
        fs.writeFile(filepath, 'test', done);
      });

      afterEach(function() {
        rimraf.sync(dirpath);
      });

      it('should delete file with "assigned filename"', function(done) {
        request(app)
          .delete('/i/want/to/delete/named/test')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(done);
      });

      it('should delete file with "non-assigned filename"', function(done) {
        request(app)
          .delete('/i/want/to/delete/test')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(done);
      });
    });

    describe('upload file if config as uploadFile', function() {

      var uploadDir = BUNDLES_HOME + '/sample_config/uploads';

      beforeEach(function() {
        rimraf.sync(uploadDir);
        fs.mkdirSync(uploadDir);
      });

      afterEach(function() {
        rimraf.sync(uploadDir);
      });

      it('should upload file with "allowed filenames"', function(done) {
        request(app)
          .put('/network/cellular/1')
          .field('formData', '{"test": "ok!"}')
          .attach('firmware.zip', BUNDLES_HOME + '/test.js')
          .expect(200)
          // .expect('Content-Type', /json/)
          .end(function(err, res) {

            if (err) {
              return done(err);
            }
            res.body.data.test.should.be.equal('ok!');
            fs.exists(uploadDir + '/firmware.zip', function(exists) {
              if (exists) {
                return done();
              }
              return done('file not exists.');
            });
          });
      });

      it('should upload file with "non-assigned filename"', function(done) {
        request(app)
          .post('/network/cellular')
          .field('formData', '{"test": "ok!"}')
          .attach('firmware.zip', BUNDLES_HOME + '/test.js')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            res.body.data.test.should.be.equal('ok!');
            res.body.data._file.index.should.eql(['test.js']);
            fs.exists(uploadDir + '/test.js', function(exists) {
              if (exists) {
                return done();
              }
              return done('file not exists.');
            });
          });
      });

      it('should upload file with "publicLink" and "allowed filenames"', function(done) {
        request(app)
          .post('/remote/gateway/upload')
          .attach('whateveryouwant', BUNDLES_HOME + '/test.js')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var downloadLink = res.body.data._file.publicLink['test.js'];
            res.body.data._file.publicLink['test.js'].should.be.equal('/download/2d408aaa5a340d732402a346a7f915ed8a3d8a04');

            fs.exists(uploadDir + '/test.js', function(exists) {
              if (!exists) {
                return done('file not exists.');
              }

              request(app)
                .get(downloadLink)
                .expect(200)
                .expect('Content-Type', /javascript/)
                .end(done);
            });
          });
      });
    });
  });

  describe('SanjiExpressFile + SanjiPuppetMaster', function() {

    describe('Create a job with attachment file', function() {

      var uploadDir = '/tmp';

      beforeEach(function() {
      });

      afterEach(function() {
      });

      it('should upload file with "publicLink" and "allowed filenames"', function(done) {
        request(app)
          .post('/jobs')
          .field('formData', '{"destinations":["AA-BB-CC-DD-11-22","BB-CC-DD-EE-11-22"],"message":{"method":"post","resource":"/system/status","data":{"test":"reqJobData"}}}')
          .attach('test.js', BUNDLES_HOME + '/test.js')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var downloadLink = res.body.requests[0].data
              ._file.publicLink['test.js'];

            res.body.requests[0].data
              ._file.publicLink['test.js']
              .should.be
              .equal('/download/2d408aaa5a340d732402a346a7f915ed8a3d8a04');

            fs.exists(uploadDir + '/test.js', function(exists) {
              if (!exists) {
                return done('file not exists.');
              }

              request(app)
                .get(downloadLink)
                .expect(200)
                .expect('Content-Type', /javascript/)
                .end(done);
            });
          });
      });
    });

    describe('Create a request with attachment file', function() {

      var uploadDir = '/tmp';

      it('should upload file with "publicLink" and "allowed filenames"', function(done) {
        request(app)
          .post('/requests')
          .field('formData', '{"destination": "AA-BB-CC-DD-11-22","message":{"method":"post","resource":"/system/status","data":{"test":"reqRequestData"}}}')
          .attach('test.js', BUNDLES_HOME + '/test.js')
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            var downloadLink = res.body.data._file.publicLink['test.js'];

            res.body.data._file.publicLink['test.js'].should.be
              .equal('/download/2d408aaa5a340d732402a346a7f915ed8a3d8a04');

            fs.exists(uploadDir + '/test.js', function(exists) {
              if (!exists) {
                return done('file not exists.');
              }

              request(app)
                .get(downloadLink)
                .expect(200)
                .expect('Content-Type', /javascript/)
                .end(done);
            });
          });
      });
    });
  });
});
