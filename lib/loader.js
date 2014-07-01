var log = require('bunyan').log,
    fs = require('fs'),
    _ = require('lodash');


/**
 * Expose Loader & Creates instance of loader
 * @param  {string} modelPath where models location
 * @param  {object} options    set options
 * @return {object}            an object which provides servals events
 */
var Loader = module.exports = function(options) {
  var self = this;
  if (!(self instanceof Loader)) {
    return new Loader(options);
  }

  if ('String' === options) {
    options = {modelPath: options};
  }

  options              = options || {};
  self.modelPath       = options.modelPath || '/home/zack/samba/mar2000/romfsdisk/home/model';
  self.modelConfigName = options.modelConfigName || 'bundle.json';
  self.modelConfigs    = options.modelConfigs || [];
  self.watch           = options.watch || function() {};

  if (self.watch) {
    log.info('Satrt to watch files...');
    self.startWatch(self.watch);
  }

  self.load();
};

/**
 * Load model config from bundle.json file
 */
Loader.prototype.load = function() {

  var self = this;
  self.scan();
  self.configFiles.forEach(function(file) {
    try {
      obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Object.prototype.toString.call(obj) !== '[object Array]') {
        obj = [obj];
      }

      self.modelConfigs = self.modelConfigs.concat(obj);
    } catch(err) {
      log.error('%s is not a vaild json file.', file);
      log.error(err);
    }
  });
};

/**
 * Scan all model config files
 * @return {[Loader]} return Loder instance self
 */
Loader.prototype.scan = function() {
  var self = this;

  var getConfigFiles = function (start) {
    var configPath = [];
    var entries = fs.readdirSync(start);
    entries.forEach(function(file) {
      var path = start + '/' + file;
      if (fs.statSync(path).isFile() && file === self.modelConfigName) {
        configPath = [path];
        log.info('Found config file: %s', path);
      }
    });

    // if model config file is not found then go deeper
    if (configPath.length === 0) {
      entries.forEach(function(file) {
        var path = start + '/' + file;
        if (fs.statSync(path).isDirectory()) {
          configPath = configPath.concat(getConfigFiles(path));
        }
      });
    }
    return configPath;
  };

  self.configFiles = getConfigFiles(self.modelPath);
  return self;
};

/**
 * Start monitoring bundle.json
 * @return {[type]} [description]
 */
Loader.prototype.startWatch = function(cb) {
  var self = this;
  require('chokidar').watch(this.modelPath, {ignored: /^(?!.*bundle\.json$).*/}) //$[\/\\]\.
  .on('all', function(event, path) {
    log.debug(event, path);
    cb(self);
  });
};

/**
 * Get model's routes (from resources)
 * @return {[array]} [routes]
 */
Loader.prototype.getRoutes = function() {

  var routes = [];
  this.modelConfigs.forEach(function(model) {
    routes = routes.concat(model.resources);
  });

  return routes;
};
