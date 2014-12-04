var SanjiExpressFile,
    log = require('bunyan').log,
    _ = require('lodash'),
    multer = require('multer'),
    fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    error = require('./error'),
    express = require('express');

var getRouteFilePath = function(bundlePath, fileConfig, errFn) {

  var filename = fileConfig.filename || '', // upload may not have filename
      filePath = path.normalize(path.join(
        bundlePath,
        fileConfig.path,
        filename
      ));

  // for security issue, we strictly limit deleteFile only in bundlePath
  if (filePath.indexOf(bundlePath) === -1) {

    var errObj = {
      code: 403,
      message: 'Permission denied: ' + filePath,
    };

    if ('function' === typeof(errFn)) {
      errFn(errObj);
    }

    return false;
  }

  return filePath;
};

var setupDownloadRoute = function(router, route) {
  var fileConfig = route.file.downloadFile;
  router.get(route.resource, function(req, res) {
    // if route has param 'filename' use it first,
    // otherwise use config downloadFile.filename
    fileConfig.filename = req.params.filename ||
                          fileConfig.filename ||
                          'no_name';

    var filePath = getRouteFilePath(
      route.file._bundlePath,
      fileConfig,
      function(errObj) {
        error(res, errObj);
      }
    );

    if (filePath === false) {
      return;
    }

    res.download(filePath, fileConfig.filename, function(err) {
      if (err) {
        var errObj = {
          code: err.status,
          message: 'Download file failed.',
          err: err
        };
        error(res, errObj);
      }
    });
  });
  log.debug('route add [%s]: %s', 'download file', route.resource);
};

var setupDeleteRoute = function(router, route) {

  var fileConfig = route.file.deleteFile;

  router.delete(route.resource, function(req, res) {
    fileConfig.filename = fileConfig.filename || req.params.filename;

    // if doesn't have filename, raise error
    if (!fileConfig.filename) {
      var errObj = {
        message: 'filename is not exist! Please check your bundle.json'
      };
      error(res, errObj);
      return;
    }

    var filePath = getRouteFilePath(
      route.file._bundlePath,
      fileConfig,
      function(errObj) {
        error(res, errObj);
      }
    );

    if (filePath === false) {
      return;
    }

    fs.unlink(filePath, function(err) {
      if (err) {
        var errObj = {
          message: 'Delete file failed.',
          err: err
        };
        error(res, errObj);
        return;
      }
      res.json();
    });
  });
  log.debug('route add [%s]: %s', 'Download', route.resource);
};

var setupUploadFileRoute = function(router, route) {
  var filenames = [],
      fileConfig = route.file.uploadFile;

  fileConfig.limits = fileConfig.limits || {};

  var uploadHandler = function(req, res, next) {
    // nothing uoloading in this request, skipping...
    if (_.isEmpty(req.files)) {
      return next();
    }

    // if someone exceeded limit, return error.
    // the file which size exceeded limit has been deleted by multer callback.
    for (var filename in req.files) {
      if (req.files[filename].truncated === true) {
        var errObj = {
          code: 400,
          message: 'File size exceeded! route:' + route.resource
        };
        error(res, errObj);
        return;
      }
    }

    // case 1: set allowed files
    if (fileConfig.allowedFiles) {

      // check result have errors or not
      var files = _.pick( req.files, fileConfig.allowedFiles),
          errorFiles = _.omit( req.files, fileConfig.allowedFiles);

      if (!_.isEmpty(errorFiles)) {

        _.map(errorFiles, function(file) {
          fs.unlinkSync(file.path);
        });

        res.status(400).json({
          message: 'Invaild filename (fieldname)',
          log: {
            uploaded: req.files,
            allowedFiles: fileConfig.allowedFiles
          }
        });

        return;
      }

      // rename to fieldname
      for (filename in files) {
        var file = files[filename],
            newPath = file.path.replace(file.name, file.fieldname);
        fs.renameSync(file.path, newPath);
        filenames.push(filename);
      }
      req.mqttData.data.files = filenames;
    }
    else {
    // case 2: free to upload any file, pass fileNames
      for (filename in req.files) {
        filenames.push(req.files[filename].name);
      }

      req.mqttData.data.files = filenames;
    }

    req.mqttData.data.files = filenames;

    // populate mqtt data
    try {
      if (req.body.formData) {
        req.mqttData.data = _.merge(
          req.mqttData.data, JSON.parse(req.body.formData));
        delete req.mqttData.data.formData; // remove formData
      }
    } catch(e) {
      res.status(400).json({
        message: 'Invaild formData',
        log: {
          formData: req.body.formData
        }
      });
    }

    // nothing bad, going on...
    next();
  };

  var filePath = getRouteFilePath(
    route.file._bundlePath,
    fileConfig,
    function(errObj) {
      log.debug('upload file path error @%s', route.resource);
      log.debug(errObj.message);
      log.debug(errObj.log);
    }
  );

  if (filePath === false) {
    return;
  }

  var multerConfig = {
    dest: filePath,
    limits: fileConfig.limits,
    onFileSizeLimit: function(file) {
      fs.unlink(file.path);
      log.debug('file size exceeded! %s has been deleted.', file.path);
    },
    onError: function (error, next) {
      log.err(error);
      next(error);
    }
  };

  if (!fileConfig.allowedFiles) {
    multerConfig.rename = function(fieldname, filename) {
      return filename.replace(/\W+/g, '-').toLowerCase();
    };
  }

  router.route(route.resource)
    .all(multer(multerConfig))
    .post(uploadHandler)
    .put(uploadHandler);

  log.debug('route add [upload file]: %s', route.resource);
};

var createPublicLink = function(router, downloadBase) {
  var linkDb = {},
      downloadRouter = express.Router();
      downloadBase = downloadBase || '/download';

      router.use(downloadBase, downloadRouter);

      downloadRouter.get('/:filename', function(req, res) {
        var filepath,
            filename = req.params.filename;

        if (!linkDb[filename]) {
          error(res, {
            code: 404,
            message: 'File not found!'
          });
          return;
        }

        filepath = path.join(linkDb[filename].path, linkDb[filename].name);
        res.download(filepath, filename, function(err) {
          if (err) {
            var errObj = {
              code: err.status,
              message: 'Download file failed.',
              err: err
            };
            return error(res, errObj);
          }
        });
        return;
      });

  return function(router, route) {
    var create = function(req, res, next) {
      var files = req.mqttData.data.files,
          fileConfig = route.file.uploadFile,
          publicLinks = req.mqttData.data.publicLinks = {};

      files.forEach(function(filename) {
        var hashedFilename = crypto.createHash('sha1')
          .update(filename)
          .digest('hex');

        // if same path already public link
        linkDb[hashedFilename] = {
          name: filename,
          path: getRouteFilePath(
            route.file._bundlePath,
            fileConfig,
            function(errObj) {
              error(res, errObj);
            }
          )
        };

        publicLinks[filename] = path.join(downloadBase, hashedFilename);
      });

      next();
    };

    router.route(route.resource)
      .post(create)
      .put(create);
  };
};


/**
 * Populate File Description for Resource has upload ability
 * @param  {[type]}   route [description]
 * @param  {[type]}   req   [description]
 * @param  {[type]}   res   [description]
 * @param  {Function} next  [description]
 * @return {[type]}         [description]
 */
var populateIndexData = function(route, req, res, next) {
  var locals, filePath, files, fileConfig, action;

  action = (function(method) {
    if (method === 'get') {
      return 'downloadFile';
    } else if (method === 'delete') {
      return 'deleteFile';
    } else {
      return 'uploadFile';
    }
  })(req.method);

  fileConfig = route.file[action];
  fileConfig.index = (fileConfig.index === undefined) ?
                     true : fileConfig.index;

  if (!fileConfig.index) {
    return next();
  }

  // if method get attach "_file" property to response
  if (action === 'downloadFile') {
    locals = res.locals;
  } else {
    // else, "_file" sends with put/post request to bundles
    locals = req.mqttData.data = req.mqttData.data || {};
  }

  // if locals is array, don't touch it
  if (Array.isArray(locals)) {
    return next();
  }

  filePath = getRouteFilePath(
    route.file._bundlePath,
    fileConfig,
    function(errObj) {
      log.debug('populateIndexData path error @%s', route.resource);
      log.debug(errObj.message);
      log.debug(errObj.log);
    }
  );

  if (filePath === false) {
    return;
  }

  // read all files in filePath, if user define allowFiles then filter them
  files = fs.readdirSync(filePath);
  // if (fileConfig.allowedFiles && fileConfig.allowedFiles.lenght !== 0) {
  //   files = _.intersection(files, fileConfig.allowedFiles);
  // }

  locals._file = {
    files: files
  };

  return next();
};



module.exports = SanjiExpressFile = function(route, options) {

  options = options || {};
  options.ramdiskPath = options.ramdiskPath || '/run/shm/';

  var router = express.Router(),
      config = route.file;

  if ((config.downloadFile && config.downloadFile.ramdisk === true) ||
      (config.deleteFile && config.deleteFile.ramdisk === true) ||
      (config.uploadFile && config.uploadFile.ramdisk === true)) {
    route.file._bundlePath = options.ramdiskPath;
  }

  // perform download by assigned path [GET]
  if (config.downloadFile) {
    setupDownloadRoute(router, route);
  }

  // perform delete file [DELETE]
  if (config.deleteFile) {
    setupDeleteRoute(router, route);
  }

  // perform file upload [PUT, POST]
  if (config.uploadFile) {
    setupUploadFileRoute(router, route);

    // create pulbic link and bypass to bundle for wget/curl downloads
    if (config.uploadFile.createPublicLink) {
      createPublicLink(router)(router, route);
    }
  }

  // try to attemp index of files for them
  router.use(route.resource, _.curry(populateIndexData)(route));

  return router;
};
