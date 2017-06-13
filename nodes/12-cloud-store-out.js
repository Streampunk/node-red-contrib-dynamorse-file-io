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

var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var util = require('util');
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var AWS = require('aws-sdk');
var Promise = require('Promise');
var stream = require('stream');
var uuid = require('uuid');

module.exports = function (RED) {
  function CloudStoreOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);
    console.log(util.inspect(config));
    var s3 = new AWS.S3({ region: config.region });
    s3.headBucket({ Bucket: config.bucket }, e => {
      if (e) {
        return this.preFlightError(`Error accessing bucket: ${e}`);
      }
    });
    this.writePromise = null;
    this.s3Stream = new stream.PassThrough();
    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        this.warn('Received non-Grain payload.');
        return next();
      }
      if (this.writePromise === null) {
        this.writePromise = new Promise((fulfil, reject) => {
          this.getNMOSFlow(x, (err, f) => {
            if (err) {
              this.warn("Failed to resolve NMOS flow.");
              return reject(err);
            }
            var md = {};
            var contentType = '';
            var encodingName = f.tags.encodingName[0];
            if ((f.tags.packing[0]).toLowerCase() === 'v210') {
              encodingName = 'x-v210';
            }
            if (f.tags.format[0] === 'video' &&
                (encodingName === 'raw' || encodingName === 'x-v210')) {
              contentType = `video/${encodingName}; sampling=${f.tags.sampling[0]}; ` +
                `width=${f.tags.width[0]}; height=${f.tags.height[0]}; depth=${f.tags.depth[0]}; ` +
                `colorimetry=${f.tags.colorimetry[0]}; interlace=0`; //${f.tags.interlace[0]}`;
            } else {
              contentType = `${f.tags.format}/${f.tags.encodingName}`;
              if (f.tags.clockRate) contentType += `; rate=${f.tags.clockRate[0]}`;
              if (f.tags.channels) contentType += `; channels=${f.tags.channels[0]}`;
            }
            md.grainSize = `${x.buffers[0].length}`;
            md.startTimeOrigin = Grain.prototype.formatTimestamp(x.ptpOrigin);
            md.startTimeSync = Grain.prototype.formatTimestamp(x.ptpSync);
            md.flowID = uuid.unparse(x.flow_id);
            md.sourceID = uuid.unparse(x.flow_id);
            if (x.duration) {
              md.duration = Grain.prototype.formatDuration(x.duration);
            }
            var upload = s3.upload({
              Bucket: config.bucket,
              Key: config.key,
              Body: this.s3Stream,
              Metadata: md,
              ContentType: contentType
            }, {
              partSize: +config.partSize * 1024 * 1024,
              queueSize: +config.queueSize
            });
            upload.promise().then(o => {
              this.log(`Finished uploading S3 object ${config.bucket}/${config.key}: ${util.inspect(o)}`);
            }, e => {
              this.error(`Failed to upload S3 object ${config.bucket}/${config.key}: ${e}`)
            });
            this.s3Stream.on('error', e => {
              this.warn(`Error on stream upload: ${e}`);
            });
            upload.on('httpUploadProgress', p => {
              this.log(`Uploaded part to S3: ${util.inspect(p)}`);
            });
            this.log(`Fulfilling writepromise with ${upload}`);
            fulfil(this.s3Stream);
          });
        });
        this.writePromise.catch(e => { this.warn(`Write promise failed: ${e}`); });
      }
      this.writePromise.then(u => {
        this.log('Adding to write promise chain.');
        if (u.write(x.buffers[0])) {
          this.log('Written something ... probably!');
          if (+config.timeout === 0) setImmediate(next);
          else setTimeout(next, +config.timeout);
          return u;
        } else {
          this.log(`Waiting for drain: ${util.inspect(u)}`);
          return new Promise((fulfil, reject) => {
            u.once('drain', () => {
              next();
              return fulfil(u); // Improve timeout function
            });
          });
        }
      }, this.warn);
    });
    this.errors((e, next) => {
      this.warn(`Received unhandled error: ${e.message}.`);
      if (+config.timeout === 0) setImmediate(next);
      else setTimeout(next, +config.timeout);
    });
    this.done(() => {
      this.log('Preparing to finish.');
      if (this.writePromise) {
        this.writePromise.then(u => {
          u.end();
          u.on('finish', () => {
            this.log('Finished writing to S3 stream.');
          });
          u.on('close', () => {
            this.log('Pass through stream has closed.');
          });
        });
      } else {
        this.warn('S3 upload stream was never created.');
      }
    });
    process.on('SIGINT', () => {
      if (this.writePromise) {
        this.writePromise.then(u => {
          u.end();
          return Promise.reject('SIGINT received.');
        });
      }
    });
  }
  util.inherits(CloudStoreOut, redioactive.Spout);
  RED.nodes.registerType("cloud-store-out", CloudStoreOut);
}
