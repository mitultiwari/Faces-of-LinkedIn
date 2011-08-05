var http        = require('http'),

FaceAPI = function() {

  this.options = { host: 'api.face.com',
                   port: 80 };

  /* Function: faces.detect
   * ======================
   * @urls: array of image urls to pass to the Face API
   * @options: map of options as specified by the API documentation
   *
   * Valid options:
   * attributes
   */
  this.detect = function(urls, callback, /*optional*/options) {
    var response = '';
    if (typeof urls !== 'string') {
      // Assume this is an array object. Just concat with comma.
      urls = urls.join(',');
    }
    if (this.keysSet()) {
      this.options.path = '/faces/detect.json?api_key=' + this.api_key + '&api_secret=' + this.api_secret + '&urls=' + urls;
      if (typeof options !== 'undefined') {
        if (options.attributes) {
          this.options.path += '&attributes=' + options.attributes;
        }
      }
      req = http.get(this.options, function(res) {
        console.log('[FaceAPI] STATUS: ' + res.statusCode);
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
          response += chunk;
        });
        res.on('end', function() {
          callback(JSON.parse(response));
        });
      });
    }
    else {
      // no keys set, throw some sort of error.
    }
  };

  this.setAPIKeys = function(key, secret) {
    this.api_key    = key;
    this.api_secret = secret;
  };

  this.keysSet = function() {
    return typeof this.api_key === 'string' && typeof this.api_secret === 'string';
  };
};

module.exports = new FaceAPI();
