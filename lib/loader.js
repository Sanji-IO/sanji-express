var log = require('bunyan').log,
    path = require('path'),
    fs = require('fs'),
    _ = require('lodash'),
    Loader;


/**
 * Expose Loader & Creates instance of loader
 * @param  {string} bundlesHome where bundles location
 * @param  {object} options    set options
 * @return {object}            an object which provides servals events
 */
Loader = module.exports = function(options) {

  var self = this;

  if (typeof (options) === 'string') {
    options = {bundlesHome: options};
  }

  options = options || {};
  self.bundlesHome = options.bundlesHome || process.env.BUNDLES_HOME;
  self.bundleConfigName = options.bundleConfigName || 'bundle.json';
  self.bundleConfigs = options.bundleConfigs || [];
  self.configFiles = options.configFiles || [];
  self.watch = options.watch || function() {};

  self.load(); // scan files and load
  // if (self.watch) {
  //   log.info('Satrt to watch files...');
  //   self.startWatch(self.watch);
  // }
};

/**
 * Load bundle config from bundle.json file
 */
Loader.prototype.load = function load() {

  var self = this;
  self.scan();
  self.configFiles.forEach(function(file) {
    var objs = [];
    try {
      objs = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Object.prototype.toString.call(objs) !== '[object Array]') {
        objs = [objs];
      }

      objs.forEach(function(obj) {
        obj._bundlePath = path.dirname(file);
      });

      self.bundleConfigs = self.bundleConfigs.concat(objs);
    } catch(err) {
      log.debug('%s is not a vaild json file.', file);
      log.debug(err);
    }
  });
};

/**
 * Scan all bundle config files
 * @return {[Loader]} return Loder instance self
 */
Loader.prototype.scan = function scan() {
  var self = this;

  var getConfigFiles = function getConfigFiles(start) {
    var configPath = [];
    var entries = fs.readdirSync(start);
    entries.forEach(function(file) {
      var path = start + '/' + file;
      try {
        if (fs.statSync(path).isFile() && file === self.bundleConfigName) {
          configPath = [path];
          log.debug('found config file: %s', path);
        }
      } catch (e) {
        log.debug('can\'t read file: %s', path);
      }
    });

    // if bundle config file is not found then go deeper
    if (configPath.length === 0) {
      entries.forEach(function(file) {
        var path = start + '/' + file;
        try {
          if (fs.statSync(path).isDirectory()) {
            configPath = configPath.concat(getConfigFiles(path));
          }
        } catch (e) {
          log.debug('can\'t read file: %s', path);
        }
      });
    }
    return configPath;
  };

  self.configFiles = self.configFiles.concat(getConfigFiles(self.bundlesHome));
  return self;
};

/**
 * Start monitoring bundle.json
 * @return {[type]} [description]
 */
Loader.prototype.startWatch = function startWatch(cb) {
  var self = this,
      bundleConfigNameLen = self.bundleConfigName.length;

  require('chokidar').watch(this.bundlesHome, {ignored: /$[\/\\]\./}) //
  .on('all', function(event, path) {
    // only care about bundleConfigName files
    if (path.indexOf(self.bundleConfigName, path.length - bundleConfigNameLen) === -1) {
      return;
    }

    // prevent init add, will do lots of unnecessary cb(self)
    if (event === 'add' && self.configFiles.indexOf(path) > -1) {
      return;
    }

    // flush old settings
    self.bundleConfigs = [];
    // fire callback
    cb(self);
    log.debug(event, path);
  });
};


/**
 * Get bundle's routes (from resources)
 * @return {[array]} [routes]
 */
Loader.prototype.getRoutes = function getRoutes() {

  var routes = [];

  this.bundleConfigs.forEach(function(bundle) {
    // if it is a download/upload related resource
    // put _bundlePath in route's property
    _.map(bundle.resources, function(resource) {
      if (resource.file) {
        resource.file._bundlePath = bundle._bundlePath;
      }
    });

    routes = routes.concat(bundle.resources);
  });

  return routes;
};
