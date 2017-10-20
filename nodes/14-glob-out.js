/* Copyright 2017 Streampunk Media Ltd.

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

var util = require('util');
require('util.promisify').shim(); // TODO Remove when on Node 8+
var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var fs = require('fs');
var H = require('highland');
var path = require('path');

const zeros = '00000000';
var fsaccess = util.promisify(fs.access);
var fsmkdir = util.promisify(fs.mkdir);
var writeFile = H.wrapCallback(fs.writeFile);

function pad(x) {
  if (isNaN(+x) || x < 0) return zeros;
  var s = x.toString();
  return `${zeros.slice(0, -s.length)}${s}`;
}

function replaceStar(x, n) {
  return x.replace(/\*/, pad(n));
}

module.exports = function (RED) {
  function GlobOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);

    this.srcTags = null;
    var sentCount = 0;
    var headerStream = null;
    var started = false;
    var parallel = +config.parallel;
    var hgrain = null;
    var hend = null;
    var hstream = null;
    var timedNext = null;

    config.glob = config.glob.replace(/[/\\]/g, path.sep);
    var lastSlash = config.glob.lastIndexOf(path.sep);
    var pathParts = (lastSlash >= 0) ?
      [ config.glob.slice(0, lastSlash), config.glob.slice(lastSlash + 1)] :
      [ '.', config.glob];
    pathParts[1] = (pathParts[1].length === 0) ? '*' : pathParts[1];

    var flowFormat = config.flowSelect.slice(0, 5);
    var flowIndex = +config.flowSelect.slice(6);

    var setupPromise = fsaccess(pathParts[0], fs.W_OK)
      .then(x => x, () => {
        return fsmkdir(pathParts[0]);
      })
      .then(x => {
        if (config.headers) {
          var headerFile = (config.headers.indexOf(path.sep) >= 0 &&
              !config.header.startsWith('..')) ?
            config.headers : pathParts[0] + path.sep + config.headers;
          return new Promise((fulfil, reject) => {
            headerStream = fs.createWriteStream(headerFile, { defaultEncoding : 'utf8' });
            headerStream.once('error', reject);
            headerStream.once('open', () => {
              headerStream.write('[\n');
              fulfil(x);
            });
          });
        } else {
          return x;
        }
      });
    var node = this;

    var startTime = process.hrtime();
    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        this.warn('Received non-Grain payload.');
        return next();
      }
      this.log(`Received grain ${sentCount}.`);
      if (!timedNext) {
        timedNext = (n) => {
          var diffTime = process.hrtime(startTime);
          var diff = (sentCount * +config.timeout) -
              (diffTime[0] * 1000 + diffTime[1] / 1000000|0);
          // console.log('+++', sentCount, diff);
          setTimeout(n, (diff > 0) ? diff : 0);
        };
      }
      if (!hstream) {
        hstream = H((hpush, hnext) => {
          // console.log(`*** Updating hgrain fn ${sentCount}.`);
          hgrain = x => { hpush(null, x); hnext(); };
          hend = () => { hpush(null, H.nil); };
        })
          .map(x => {
            var name = replaceStar(pathParts[0] + path.sep + pathParts[1], sentCount++);
            timedNext(next);
            return writeFile(name, x).map(() => name);
          })
          .parallel(parallel)
          .errors(this.warn)
          .each(n => { node.log(`${process.hrtime()}: written file: ${n}.`); })
          .done(() => { node.log('Closing highland stream.'); });
      }
      var nextJob = this.srcTags ?
        Promise.resolve(x) :
        setupPromise.then(() => {
          return this.findCable(x);
        })
          .then(f => {
            // TODO improve cable filtering
            if (f && f.length > 0 && Array.isArray(f[0][flowFormat]) && f[0][flowFormat].length >= flowIndex) {
              this.srcTags = f[0][flowFormat][flowIndex].tags;
              // console.log('+++ src tags', this.srcTags);
            } else {
              return Promise.reject(`Logical cable does not contain ${flowFormat}[${flowIndex}].`);
            }
            return x;
          });

      nextJob.then(g => {
        hgrain(g.buffers[0]);
        if (headerStream) {
          if (started === false) {
            var contentType = 'application/octet-stream';
            var encodingName = this.srcTags.encodingName;
            if ((this.srcTags.packing) && (this.srcTags.packing).toLowerCase() === 'v210') {
              encodingName = 'x-v210';
            }
            if (this.srcTags.format === 'video' &&
                (encodingName === 'raw' || encodingName === 'x-v210')) {
              contentType = `video/${encodingName}; sampling=${this.srcTags.sampling}; ` +
                `width=${this.srcTags.width}; height=${this.srcTags.height}; depth=${this.srcTags.depth}; ` +
                `colorimetry=${this.srcTags.colorimetry}; interlace=${(this.srcTags.interlace) ? 1 : 0}`;
            } else {
              contentType = `${this.srcTags.format}/${this.srcTags.encodingName}`;
              if (this.srcTags.clockRate) contentType += `; rate=${this.srcTags.clockRate}`;
              if (this.srcTags.channels) contentType += `; channels=${this.srcTags.channels}`;
            }
            var gjson = g.toJSON();
            gjson.contentType = contentType;
            headerStream.write(JSON.stringify(gjson, null, 2));
            started = true;
          } else {
            headerStream.write(',\n' + JSON.stringify(x, null, 2));
          }
        }
      }).catch(e => {
        this.preFlightError(`Error setting up glob: ${e}`);
      });
    });
    this.done(() => {
      this.log('Thank goodness that is over!');
      if (hend) { hend(); }
      if (headerStream) {
        headerStream.end(']');
      }
    });
    this.errors((err, next) => {
      this.log(`Received error ${err.toString()}.`);
      if (timedNext) timedNext(next);
      else setImmediate(next);
    });
  }
  util.inherits(GlobOut, redioactive.Spout);
  RED.nodes.registerType('glob-out', GlobOut);
};
