var bunyan = require('bunyan'),
    log = bunyan.log = bunyan.createLogger({name: 'Sanji-REST', level: 'debug'}),
    path = require('path'),
    should = require('should'),
    sinon = require('sinon'),
    request = require('supertest'),
    express = require('express'),
    SanjiExpress = require('../index'),
    Promise = require('bluebird'),
    rimraf = require('rimraf'),
    fs = require('fs');

function makeMockPromise(resource, data) {
  return new Promise(function (resolve) {
    return resolve({
      code: 200,
      data: {
        resource: resource,
        data: data
      }
    });
  });
}

describe('SanjiExpress', function() {

  var app, se,
      BUNDLES_HOME = __dirname;

  beforeEach(function() {
    process.env.BUNDLES_HOME = BUNDLES_HOME;
    app = express();
    app.use(require('body-parser').json());
    se = new SanjiExpress(app);

    ['get', 'post', 'put', 'delete'].forEach(function(method) {
      se.bundle.publish[method] = makeMockPromise;
    });
  });

  describe('CRUD translate to MQTT', function() {

    it('should get code 404 if resource not exist', function(done) {
      request(app)
        .get('/somewhere/you/never/find')
        .expect(404)
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

      var filepath = BUNDLES_HOME + '/sample_config/deletes/test';

      beforeEach(function(done) {
        fs.writeFile(filepath, 'test', done);
      });

      afterEach(function(done) {
        fs.unlink(filepath, function() {
          done();
        });
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
        // rimraf.sync(uploadDir);
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
            res.body.data._file.files.should.eql(['test.js']);
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
            var downloadLink = res.body.data.publicLinks['test.js'];
            res.body.data.publicLinks['test.js'].should.be.equal('/download/2d408aaa5a340d732402a346a7f915ed8a3d8a04');

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
