var Promise = require('bluebird');
var should = require('should');
var request = require('supertest');
var express = require('express');
var SanjiExpress = require('../index');
var rimraf = require('rimraf');
var ioc = require('socket.io-client');
var sinon = require('sinon');
var fs = require('fs');

function makeMockPromise(resource, data, dest, delayTime) {
  if (delayTime === undefined || delayTime <= 0) {
    delayTime = 0;
  }

  return new Promise(function(resolve) {
    return resolve({
      code: 200,
      data: {
        resource: resource,
        data: data,
        destination: dest
      }
    });
  })
  .delay(delayTime);
}

function makeMockPromiseWithDelay(delayTime) {
  return function(resource, data, dest) {
    return makeMockPromise(resource, data, dest, delayTime);
  };
}

function client(srv, nsp, opts) {
  if (typeof nsp === 'object') {
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

  var app;
  var se;
  var io;
  var server;
  var BUNDLES_HOME = __dirname;

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

    // se = se.sanji;

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

    it('should get code 408 if controller no response (timeout)', function(done) {
      var clock = sinon.useFakeTimers();
      se.bundle.publish.delete = makeMockPromiseWithDelay(9999999);
      request(app)
        .delete('/system/time')
        .expect(408)
        .expect('Content-Type', /json/)
        .end(done);
      clock.tick(1500);
      clock.restore();
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

  describe('CRUD translate to "remote" MQTT', function() {
    var cgId = 'cg-1234';

    it('should translate [GET] method message to /remote/' + cgId, function(done) {
      request(app)
        .get('/' + cgId + '/system/time')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(done);
    });

    it('should translate [GET] method message to /remote/ with query string' + cgId, function(done) {
      request(app)
        .get('/' + cgId + '/system/time?page=10')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) {
            throw err;
          }

          res.body.data.resource.should.be.eql('/system/time?page=10');
          done();
        });
    });

    it('should translate [PUT] method message with data to /remote/' + cgId, function(done) {
      request(app)
        .put('/' + cgId + '/system/time')
        .send({test: 'okok'})
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          res.body.resource.should.be.equal('/remote/' + cgId);
          res.body.data.should.be.eql({
            data: {test: 'okok'},
            resource: '/system/time',
            method: 'put'
          });
          done(err);
        });
    });
  });

  describe('SanjiExpressDownloadHelper', function() {
    describe('Translate [GET] to download file process', function() {
      it('should respond download link', function(done) {
        se.bundle.publish.post = function(resource, data) {
          resource.should.be.equal('/system/export');
          data.should.have.property('url');
          data.should.have.property('headers');
          return new Promise(function(resolve) {
            resolve({
              code: 200,
              data: {
                url: 'http://localhost/fakedownload'
              }
            });
          });
        };

        request(app)
          .get('/helper/download?resource=/system/export')
          .expect(302)
          .end(done);
      })
    });

    describe('Translate [GET] to download file process (failed)', function() {
      it('should respond download link', function(done) {
        se.bundle.publish.post = function(resource, data) {
          resource.should.be.equal('/system/export');
          data.should.have.property('url');
          data.should.have.property('headers');
          return new Promise(function(resolve) {
            resolve({
              code: 400,
              data: {
                message: 'Unknown error'
              }
            });
          });
        };

        request(app)
          .get('/helper/download?resource=/system/export')
          .expect(400)
          .end(done);
      })
    });

    describe('Translate [GET] to download file process (remote)', function() {
      it('should respond download link', function(done) {
        se.bundle.publish.post = function(resource, data) {
          resource.should.be.equal('/remote/cg-1234');
          data.data.should.have.property('url');
          data.data.should.have.property('headers');
          return new Promise(function(resolve) {
            resolve({
              code: 200,
              data: {
                code: 200,
                method: 'post',
                data: {
                  url: 'http://localhost/fakedownload'
                }
              }
            });
          });
        };

        request(app)
          .get('/cg-1234/helper/download?resource=/system/export&scope=123')
          .expect(302)
          .end(done);
      })
    });

    describe('Translate [GET] to download file process (remote request failed)', function() {
      it('should respond download link', function(done) {
        se.bundle.publish.post = function(resource, data) {
          return new Promise(function(resolve) {
            resolve({
              code: 200,
              data: {
                code: 400,
                method: 'post',
                data: {
                  message: 'Unknown error'
                }
              }
            });
          });
        };

        request(app)
          .get('/cg-1234/helper/download?resource=/system/export')
          .expect(400)
          .end(done);
      })
    });
  });

  describe('SanjiExpressUploadHelper', function () {
    var appUpload;

    beforeEach(function (done) {
      var appUpload = express();
      appUpload.use('/api/v1/files/upload', function (req, res, next) {
        res.json({
          "fieldname": "file",
          "physicalPath": "/var/www/webapp/node_modules/express-filebin/uploads/a7e2dd3244e45fe95b36c53fe5b9bbc4",
          "url": "http://localhost/api/v1/files/download/a7e2dd3244e45fe95b36c53fe5b9bbc4"
        });
      });

      var server = appUpload.listen(function () {
        process.env.SITE_URL = 'http://localhost' + ':'+ server.address().port
        done();
      });
    });

    describe('Translate [POST] to upload file process', function () {
      it('should respond bundle response', function (done) {
        se.bundle.publish.post = function(resource, data) {
          resource.should.be.equal('/system/import');
          data.should.have.property('file');
          data.file.should.have.property('url');
          data.file.should.have.property('headers');
          return new Promise(function (resolve) {
            resolve({
              code: 200,
              data: {
                message: 'OK'
              }
            });
          });
        };

        request(app)
          .post('/helper/upload?resource=/system/import')
          .field('jsonData', JSON.stringify({
            scopes: ['network', 'system']
          }))
          .attach('upload', __dirname + '/sample_config/bundle.json')
          .expect(200)
          .end(function(err, res) {
            done();
          });
      })
    });

    describe('Translate [PUT] to upload file process (remote)', function () {
      it('should respond bundle response', function (done) {
        se.bundle.publish.post = function (resource, data) {
          resource.should.be.equal('/remote/cg-1234');
          data.data.should.have.property('file');
          data.data.file.should.have.property('url');
          data.data.file.should.have.property('headers');

          return new Promise(function (resolve) {
            resolve({
              code: 200,
              data: {
                code: 200,
                method: 'put',
                data: {
                  message: 'Got the file'
                }
              }
            });
          });
        };

        request(app)
          .put('/cg-1234/helper/upload?resource=/system/import')
          .field('jsonData', JSON.stringify({
            scopes: ['network', 'system']
          }))
          .attach('upload', __dirname + '/sample_config/bundle.json')
          .expect(200)
          .end(done);
      });
    });


    describe('Translate [PUT] to upload file process (remote) without jsonData field', function () {
      it('should respond bundle response', function (done) {
        se.bundle.publish.post = function (resource, data) {
          resource.should.be.equal('/remote/cg-1234');
          data.data.should.have.property('file');
          data.data.file.should.have.property('url');
          data.data.file.should.have.property('headers');

          return new Promise(function (resolve) {
            resolve({
              code: 200,
              data: {
                code: 200,
                method: 'put',
                data: {
                  message: 'Got the file'
                }
              }
            });
          });
        };

        request(app)
          .put('/cg-1234/helper/upload?resource=/system/import')
          .set('X-Mx-AccessToken', 'xxxxxxxxxxxxxxxxxxxxxx')
          .attach('upload', __dirname + '/sample_config/bundle.json')
          .expect(200)
          .end(done);
      });
    });
  });
});
