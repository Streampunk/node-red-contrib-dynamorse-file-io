/* Copyright 2018 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var util = require('util');
var fs = require('fs');
var path = require('path');
var Grain = require('node-red-contrib-dynamorse-core').Grain;

module.exports = function (RED) {
  function RawFileOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);

    fs.access(path.dirname(config.file), fs.W_OK, e => {
      if (e) {
        return this.preFlightError(e);
      }
    });
    if (config.headers) {
      fs.access(path.dirname(config.headers), fs.W_OK, e => {
        if (e) {
          return this.preFlightError(e);
        }
      });
    }
    this.log(config.file + ' / ' + config.headers);
    this.essenceStream = fs.createWriteStream(config.file);
    this.essenceStream.on('error', err => {
      this.error(`Failed to write to essence file '${config.file}': ${err}`);
    });
    this.headerStream = (config.headers) ?
      fs.createWriteStream(config.headers, { defaultEncoding: 'utf8' }) : null;
    if (this.headerStream) {
      this.headerStream.on('error', err => {
        this.error(`Failed to write to headers file '${config.headers}': ${err}`);
      });
      this.headerStream.write('[\n');
    }
    this.started = false;

    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        this.warn('Received non-Grain payload.');
        return next();
      }
      // this.log(`Received ${util.inspect(x)}.`);

      var preWriteTime = Date.now();
      this.essenceStream.write(x.buffers[0], () => {
        if (+config.timeout === 0) setImmediate(next);
        else setTimeout(next, +config.timeout - (Date.now() - preWriteTime));
      });

      if (this.headerStream) {
        var contentType = 'application/octet-stream';
        var nextJob = this.started ?
          Promise.resolve(x) :
          this.findCable(x)
            .then(cable => {
              let isVideo = Array.isArray(cable[0].video) && cable[0].video.length > 0;
              let srcTags = isVideo ? cable[0].video[0].tags : cable[0].audio[0].tags;
              
              var encodingName = srcTags.encodingName;
              if ((srcTags.packing).toLowerCase() === 'v210') {
                encodingName = 'x-v210';
              }
              if (srcTags.format === 'video' &&
                  (encodingName === 'raw' || encodingName === 'x-v210')) {
                contentType = `video/${encodingName}; sampling=${srcTags.sampling}; ` +
                  `width=${srcTags.width}; height=${srcTags.height}; depth=${srcTags.depth}; ` +
                  `colorimetry=${srcTags.colorimetry}; interlace=${srcTags.interlace?1:0}`;
              } else {
                contentType = `${srcTags.format}/${srcTags.encodingName}`;
                if (srcTags.clockRate) contentType += `; rate=${srcTags.clockRate}`;
                if (srcTags.channels) contentType += `; channels=${srcTags.channels}`;
              }

              var gjson = x.toJSON();
              gjson.contentType = contentType;
              this.headerStream.write(JSON.stringify(gjson, null, 2));
              this.started = true;
              return Promise.resolve();
            });

        return nextJob.then(g => {
          var p = null;
          if (g) 
            p = this.headerStream.write(',\n' + JSON.stringify(g, null, 2));
          return p;
        })
          .catch(this.warn);
      }
    });

    this.errors((e, next) => {
      this.warn(`Received unhandled error: ${e.message}.`);
      if (+config.timeout === 0) setImmediate(next);
      else setTimeout(next, +config.timeout);
    });

    this.done(() => {
      this.log('Thank goodness that is over!');
      this.essenceStream.end();
      if (this.headerStream) {
        this.headerStream.end(']');
      }
    });

    process.on('SIGINT', () => {
      this.essenceStream.end();
      if (this.headerStream) {
        this.headerStream.end(']');
      }
    });
  }
  util.inherits(RawFileOut, redioactive.Spout);
  RED.nodes.registerType('raw-file-out', RawFileOut);
};
