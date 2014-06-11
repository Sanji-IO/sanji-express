var bunyan = require('bunyan'),
    log = bunyan.createLogger({name: 'Sanji-REST', level: 'trace'}),
    util = require('util'),
    fs = require('fs'),
    _ = require('lodash');


/**
 * Expose Loader & Creates instance of loader
 * @param  {string} modelPath where models location
 * @param  {object} options    set options
 * @return {object}            an object which provides servals events
 */
var Loader = module.exports = function(options) {
  if (!(this instanceof Loader)) {
    return new Loader(options);
  }

  if ('String' === options) {
    options = {modelPath: options};
  }

  options              = options || {};
  this.modelPath       = options.modelPath || '/home/zack/samba/mar2000/romfsdisk/home/model';
  this.modelConfigName = options.modelConfigName || 'bundle.json';
  this.modelConfigs    = options.modelConfigs || [];
  this.watch           = options.watch === true ? true : false;

  if (this.watch) {
    this.startWatch();
  }
  this.scan();
  this.load();
};

/**
 * Load model config from bundle.json file
 */
Loader.prototype.load = function() {

  var self = this;
  self.configFiles.forEach(function(file) {
    try {
      obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Object.prototype.toString.call(obj) !== '[object Array]') {
        obj = [obj];
      }

      self.modelConfigs = self.modelConfigs.concat(obj);
    } catch(err) {
      log.warn('%s is not a vaild json file.', file);
      log.warn(err);
    }
  });
};

/**
 * Scan all model config files
 * @return {[Loader]} return Loder instance self
 */
Loader.prototype.scan = function() {
  var self = this;
  var configs = [];

  var getConfigFiles = function (start) {
    var configPath = [];
    entries = fs.readdirSync(start);
    entries.forEach(function(file) {
      var path = start + '/' + file;
      if (fs.statSync(path).isFile() && file == self.modelConfigName) {
        configPath = [path];
        log.debug('Found config file: %s', path);
      }
    });

    // if model config file is not found then go deeper
    if (configPath.length == 0) {
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
  require('chokidar').watch(this.modelPath, {ignored: /^(?!.*bundle\.json$).*$/}) // [\/\\]\.
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
  for(var index=0; index < this.modelConfigs.length; index++) {
    routes = routes.concat(this.modelConfigs[index].resources);
  }

  return routes;
};
