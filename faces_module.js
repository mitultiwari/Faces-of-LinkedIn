var redis   = require('redis').createClient(),
    face    = require('./face_api_client.js'),

FaceClient = function(key, secret) {

  var _this = this,

  redisMsetCallback = function(err, res) {
    if (err) {
      console.log('[REDIS] Mset error: ' + err);
    }
    else {
      console.log('[REDIS] Mset response: ' + res);
    }
  },

  redisIncrCallback = function(err, res) {
    if (err) {
      console.log('[REDIS] Incr error: ' + err);
    }
    else {
      console.log('[REDIS] Incr response: ' + res);
    }
  },

  findProfileByUrl = function(url) {
    var i, len, picUrl;
    if (!_this.profiles) {
      console.log('[ERROR] no profiles!!');
    }
    for (i in _this.profiles) {
      picUrl = _this.profiles[i].pictureUrl;
      if (picUrl && picUrl === url) {
        return _this.profiles[i];
      }
    }
    console.log('[ERROR] couldn\'t find profile by url');
  },

  getTopTitlesForAttr = function(attr, callback) {
    redis.sort(attr + ':title:set', 'by', attr + ':title:*:count', 'limit', 0, 5, 'get', attr + ':title:*:count', 'get', '#', 'desc', callback);
  },

  getAttributesFromPhotoObj = function(photo) {
    var attributes, attributesArr = [];
    if (!photo.tags || !photo.tags.length || !photo.tags[0].attributes) {
      console.log('[LOG] No photo attributes found');
      return ['noattrs'];
    }
    attributes = photo.tags[0].attributes;
    if (attributes.glasses) {
      if (attributes.glasses.value === 'true') {
        attributesArr.push('glasses');
      }
      else if (attributes.glasses.value === 'false') {
        attributesArr.push('noglasses');
      }
    }
    if (attributes.smiling) {
      if (attributes.smiling.value === 'true') {
        attributesArr.push('smiling');
      }
      else if (attributes.smiling.value === 'false') {
        attributesArr.push('nosmiling');
      }
    }
    if (attributes.mood) {
      attributesArr.push(attributes.mood.value);
    }
    return attributesArr;
  };

  this.attrs = ['smiling',
                'nosmiling',
                'glasses',
                'noglasses',
                'happy',
                'sad',
                'neutral',
                'angry',
                'surprised',
                'noattrs'],

  // At this point, we have all profile data in this.response.
  // However, we want to do some data aggregation as well.
  this.aggregateData = function(photoAttributes, last) {
    var i, j, k, len, attrLen, profile, title, photo, positions,
        attributes = [],
        photos = photoAttributes.photos;

    last = typeof last !=='undefined' ? last : false;
    if (last) {
      console.log('[LOG] Invoking callback');
      _this.retrieveCallback(_this.response);
    }

    // store a count of job titles for each attribute
    if (photos) {
      for (i=0, len=photos.length; i<len; ++i) {
        photo = photos[i];
        profile = findProfileByUrl(photo.url);
        attributes = getAttributesFromPhotoObj(photo);
        if (!profile) {
          console.log('[ERROR] No profile found!');
        }
        // "threeCurrentPositions":{"values":{"0":{"title":"Guy"}},"_total":"1"},
        if (profile && profile.threeCurrentPositions && profile.threeCurrentPositions.values) {
          positions = profile.threeCurrentPositions.values;
          for (j=0; j<3; ++j) {
            if (positions[j]) {
              title = positions[j].title;
              if (title) {
                for (k=0, attrLen=attributes.length; k<attrLen; ++k) {
                  redis.incrby([attributes[k], 'title', title, 'count'].join(':'), 1, redisIncrCallback);
                  redis.sadd([attributes[k], 'title', 'set'].join(':'), title);
                }
              }
            }
            else {
              break;
            }
          }
        }
      }
    }
  };

  this.handleFaceResult = function(response) {
    // TODO: cache in redis.
    // TODO: send to browser
    var photoAttrsArr = [], // array of attributes to store in redis
        attrs;
    for (i=0,photos=response.photos,len=photos.length; i<len; ++i) {
      photo = photos[i];
      if (!photo.tags || !photo.tags.length || !photo.tags[0].attributes || !photo.tags[0].attributes.glasses) {
        // no attributes
        attrs = { face: false,
                  url: photo.url ? photo.url : '' };
        _this.response.push(JSON.stringify(attrs));
      }
      else {
        // yes attributes
        attrs = photo.tags[0].attributes;
        attrs.url = photo.url;
        _this.response.push(JSON.stringify(attrs)); // add to response to send to browser
      }
      photoAttrsArr.push('photoattrs:' + photo.url);
      photoAttrsArr.push(JSON.stringify(attrs));
    }
    if (photoAttrsArr.length) {
      redis.mset(photoAttrsArr, redisMsetCallback);
    }
    if (_this.response.length === _this.urls.length) {
      _this.aggregateData(response, true);
    }
    else {
      _this.aggregateData(response);
    }
    // need to use socket.io
  };

  this.handleCachedAttributes = function(err, response) {
    var i = 0,
        len = response.length,
        nullAttrUrls = [], // array of picture urls with no cached info
        urlBuffer = [],
        MAX_DETECT = 30,
        result = {}, // what we send back to browser.
        attrs,
        start,
        end,
        id;     // linkedin profile id

    console.log('============== IN handleCachedAttributes ==============');

    _this.response = [];
    for (; i<len; ++i) {
      id = _this.profiles[i].id;
      attrs = response[i];
      result[id] = attrs;
      if (!attrs) {
        // if no cached result, add to array to request from face.com
        nullAttrUrls.push(_this.profiles[i].pictureUrl);
      }
      else {
        _this.response.push(attrs);
      }
    }
    len = nullAttrUrls.length;
    console.log(['LOG:', len, 'urls with no attributes'].join(' '));

    if (_this.response.length === _this.urls.length) {
      // all photo attributes were cached! just return the response.
      _this.retrieveCallback(_this.response);
    }

    // fetch non-cached picture attriubtes from face.com
    start = 0;
    while(start < len) {
      end = start + MAX_DETECT < len ? start+MAX_DETECT : len;
      face.detect(nullAttrUrls.slice(start, end), _this.handleFaceResult, { attributes: 'glasses,mood,smiling' });
      start = end;
    }
  };

  this.getTopTitles = function(callback) {
    var topTitles = [],
        _this = this,
        j = 0,
        i, len;

    for (i=0, len=this.attrs.length; i<len; ++i) {
      getTopTitlesForAttr(this.attrs[i], function(err, res) {
        if (err) {
          console.log(err);
          return;
        }
        topTitles.push({
          name: _this.attrs[j++],
          value: res
        });
        if (topTitles.length === _this.attrs.length) {
          callback(topTitles);
        }
      });
    }
  };

  this.retrieveCached = function(data, callback) {
    var i = 0,
        len = data.profiles.length,
        profile,
        profilesArr = []; // array of profiles to store in redis

    this.urls = [];
    this.profiles = data.profiles;
    this.retrieveCallback = callback;

    for (i in this.profiles) {
      this.urls.push('photoattrs:' + this.profiles[i].pictureUrl);
      profilesArr.push('profile:' + this.profiles[i].pictureUrl);
      profilesArr.push(JSON.stringify(this.profiles[i]));
    }
    if (profilesArr.length) {
      redis.mset(profilesArr, redisMsetCallback);
      redis.mset(profilesArr, redisMsetCallback);
    }

    // expire profile keys
    for (i=0, len = profilesArr.length; i<len; ++i) {
      if (i%2 === 0) {
        redis.expire(profilesArr[i], 3600);
      }
    }

    redis.mget(this.urls, this.handleCachedAttributes);
    //face.detect(urls.slice(0,30), this.handleCachedAttributes, { attributes: 'glasses,mood,face,smiling' });
  };

  this.retrieveJobTitleStats = function(callback) {
  };

  (function() {
    face.setAPIKeys(key, secret);
  })();
};

module.exports = new FaceClient('41be1e8bc43f9b5d79b421cd8995ba5f', 'f39eda942819dc053b16d26b8d25f76d');
