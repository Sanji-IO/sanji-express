var log = require('bunyan').log,
    SanjiExpressFile = require('./plugins/file'),
    express = require('express'),
    Sanji = require('sanji'),
    Loader = require('./loader'),
    _ = require('lodash'),
    util = require('util'),
    eventEmitter = require('events').EventEmitter,
    SanjiExpress;

/**
 * Create instance of Sanji
 * @param  {[object]} app     express' instance
 * @param  {[object]} options bag of settings
 * @return {[object]}         Sanji instance
 */
module.exports = SanjiExpress = function(app, options) {

  eventEmitter.call(this);

  var self = this;

  options = options || {};
  self.apiBase = options.apiBase || '';
  self.ramdiskPath = options.ramdiskPath || '/run/shm/';
  self.loader = new Loader(options.loaderOptions);
  self.router = self.createRouter(self.loader.getRoutes());

  // self.createEventPusher(); // enable event pusher (sanji.system.event)
  return self.router;
};

util.inherits(SanjiExpress, eventEmitter);

/**
 * Create an event pusher for bundles who wants push event to current connections
 * @return {[type]} [description]
 */
SanjiExpress.prototype.createEventPusher = function() {
  var self = this;

  // create bundle for recieveing events and push to browser
  var eventBundle = self.createBundle({
    name: 'SANJI-WEB-SYSEVENT-' + require('os').hostname(),
    role: 'bundle',
    resources: ['/system/event']
  });

  // post handler
  eventBundle.post('/system/event', function(req, res) {
    self.pushEvent('sanji.system.event', req.body);
    log.debug('Bundle: %s event is already pushed.', req.body.name);
  });

  log.debug('createEventPusher is enabled.');
};


/**
 * Create express router by input bundles' routes
 * @param  {[array]} routes bundles' routes loaded by loader
 * @return {[object]}        express' router
 */
SanjiExpress.prototype.createRouter = function(routes) {

  var viewResources = [],
      self = this,
      router = express.Router(); // create new express router

  // convert request into mqtt data
  router.use(this.populateMqttData);

  // setup each config's route
  routes.forEach(function(route) {

    if (!route) {
      return;
    }

    // normalize methods
    route.methods = route.methods || ['get', 'put', 'post', 'delete'];
    if (!Array.isArray(route.methods)) {
      route.methods = [route.methods];
    }

    if (route.file) {
      router.use(
          SanjiExpressFile(route, {ramdiskPath: self.ramdiskPath})
        );
    }

    // TODO: This should change to send notify using event message...
    // only uploadFile and normal req needs to translate req to sanji message
    if (route.downloadFile || route.deleteFile) {
      return;
    }

    // perform mqtt translate [GET, POST, PUT, DELETE]
    self.setupMqttRoute(router, route);

    // only push mqtt related view's resource for register
    viewResources.push(route);
  });

  // create bundle
  this.bundle = this.createViewBundle(viewResources);

  return router;
};

SanjiExpress.prototype.createViewBundle = function(resources) {

  var self = this;
  var profile = {
    name: 'SANJI-REST-' + require('os').hostname(),
    description: 'This is a virtual bundle created by SanjiExpress.',
    role: 'view',
    ttl: 60,
    resources: resources
  };

  // create bundle
  var options = {
    bundlePath: profile
  };

  var bundle = new Sanji(options);
  bundle.run = function() {
    self.emit('ready');
  };
  bundle.start();

  return bundle;
};

/**
 * Convert Http request to Sanji request
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
SanjiExpress.prototype.populateMqttData = function(req, res, next) {

  var mqttData = {
    resource: req.url,
    method: req.method.toLowerCase()
  };

  if (req.body && req.body.length!==0) {
    mqttData.data = req.body;
  }

  req.mqttData = mqttData;
  log.trace('populateMqttData', mqttData);

  return next();
};



/**
 * Server-Sent Event service
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
// SanjiExpress.prototype.sse = function(req, res) {
//   var self = this;
//   req.socket.setTimeout(Infinity);
//   // send headers for event-stream connection
//   // see spec for more information
//   res.writeHead(200, {
//     'Content-Type': 'text/event-stream',
//     'Cache-Control': 'no-cache',
//     'Connection': 'keep-alive'
//   });
//   res.write('retry: 3\n');
//   res.write('\n');

//   // push this res object to our global variable
//   self.sseConns.push(res);
//   // When the request is closed, e.g. the browser window
//   // is closed. We search through the open connections
//   // array and remove this connection.
//   req.on('close', function() {
//     log.debug('sse connection close');
//     var toRemove;
//     for (var j = 0 ; j < self.sseConns.length ; j++) {
//       if (self.sseConns[j] === res) {
//         toRemove = j;
//         break;
//       }
//     }
//     self.sseConns.splice(toRemove, 1);
//   });
// };

// SanjiExpress.prototype.sseHeartbeat = function(interval) {
//   var self = this;
//   var pushHeartbeat = function() {
//     self.sseConns.forEach(function(res) {
//       // push comment message to every connections.
//       // http://www.w3.org/TR/eventsource/
//       // comment = colon *any-char end-of-line
//       res.write(':h\n');
//     });
//   };

//   // set heartbeat
//   setInterval( function() {
//     pushHeartbeat();
//   }, interval);
// };

SanjiExpress.prototype.pushEvent = function(event, data) {

  var jsonString = '';

  try {
    jsonString = JSON.stringify(data) || {};
  } catch (e) {
    log.warn(e);
  }

  var count = 0;
  this.sseConns.forEach(function(res) {
    res.write('event: ' + event +'\n');
    res.write('data: ' + jsonString + '\n\n');
    count++;
  });
  log.debug('pushed event: %s to %d clients.', event, count);
};

SanjiExpress.prototype.defaultCallback = function(req, res) {
  log.debug('%s %s', req.method, req.url);
  var self = this;
  var mqttData = req.mqttData;
  var respFunc = function(result) {
    if (res.locals && !_.isArray(result.data)) {
      result.data = _.merge(res.locals, result.data);
    }
    res.status(result.code).json(result.data);
  };

  // async mode
  // (1) ask controller which bundles will be block (bundle dependencies)
  // (2) response to client
  // (3) sent event when received response from bundle via controller
  if (req.query.async === 'true') {
    log.debug('async');

    // replace respFunc to sse pushEvent
    respFunc = function(result) {
      self.pushEvent('sanji.async.response', result);
    };

    // (1)
    this.bundle.get('/controller/resource/dependency?resource=' + req.path)
      .then(function(result) {
        // (3)
        res.status(result.code).json(result.data);
      });
  }

  // (2)
  this.bundle.publish[mqttData.method](mqttData.resource, mqttData.data)
    .then(respFunc, respFunc);
};

SanjiExpress.prototype.setupMqttRoute = function(router, route) {
  route.callback = route.callback || this.defaultCallback.bind(this);

  if (typeof(route.callback) !== 'function') {
     log.debug(
      'route [%s]: %s callback is not a function.',
      route.methods, route.resource);
     return;
  }

  // setup routing rules and it's callback
  route.methods.forEach(function (method) {
    router[method](route.resource, route.callback);
    log.debug('route add [%s]: %s', method, route.resource);
  });
};

SanjiExpress.prototype.vaildBundlePath = function(bundlePath, filename) {
  return ;
};
