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
var AWS = require('aws-sdk');
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var grainConcater = require('../util/grainConcater.js');
var uuid = require('uuid');
var H = require('highland');

const emptyBuf = Buffer.alloc(0);

function cloudInlet(s3, objectDetails, sizes, loop, length, queueSize) {
  var flowID = uuid.v4();
  var sourceID = uuid.v4();
  var bufs = [];
  var desired = (typeof sizes === 'number') ? sizes : 0;
  var grainCount = 0;
  var fixedChomper = (err, x, push, next) => {
    if (err) {
      push(err);
      next();
    } else if (x === H.nil) {
      push(null, x);
    } else {
      while (x.length > 0) {
        if (x.length >= desired) {
          bufs.push(x.slice(0, desired));
          push(null, new Grain(bufs, 0, 0, null, flowID, sourceID, null));
          grainCount++;
          x = x.slice(desired);
          bufs = [];
          desired = sizes;
        } else {
          bufs.push(x);
          desired -= x.length;
          x = emptyBuf;
        }
      }
      next();
    }
  };
  var nextGrain = null;
  var variableChomper = (err, x, push, next) => {
    if (err) {
      push(err);
      next();
    } else if (x === H.nil || grainCount >= sizes.length) {
      push(null, H.nil);
    } else {
      while (x.length > 0) {
        if (!nextGrain) {
          nextGrain = sizes[grainCount];
          desired = nextGrain.payloadSize;
        }
        if (x.length >= desired) {
          bufs.push(x.slice(0, desired));
          push(null, new Grain(bufs, nextGrain.ptpSyncTimestamp,
            nextGrain.ptpOriginTimestamp, nextGrain.timecode,
            nextGrain.flow_id, nextGrain.source_id, nextGrain.duration));
          nextGrain = null;
          grainCount ++;
          bufs = [];
          x = x.slice(desired);
        } else {
          bufs.push(x);
          desired -= x.length;
          x = emptyBuf;
        }
      }
      next();
    }
  };
  var chunkCount = 0;
  var chunkMode = (typeof sizes === 'number') && (sizes > 1000000);
  var totalChunks = (chunkMode === true) ? length / sizes|0 : 1;
  var parallels = (chunkMode === true) ?  queueSize : 1;
  var streamCount = 0;
  return H((push, next) => {
    if (chunkMode === true) {
      var leftOffset = (chunkCount * sizes) % length;
      var rightOffset = leftOffset + sizes - 1;
      objectDetails.Range = `bytes=${leftOffset}-${rightOffset}`;
      push(null, H(s3.getObject(objectDetails).createReadStream()));
      streamCount++;
      chunkCount++;
    } else {
      push(null, H(s3.getObject(objectDetails).createReadStream()));
      grainCount = 0;
    }
    next();
  })
    .take(loop ? Number.MAX_SAFE_INTEGER : totalChunks)
    .parallel(parallels)
    .consume((typeof sizes === 'number') ? fixedChomper : variableChomper)
    .doto(() => { console.log('Finished a stream.', streamCount--); });
}

module.exports = function (RED) {
  function CloudStoreIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);
    console.log(util.inspect(config));
    var s3 = new AWS.S3({ region : config.region });
    var flowID = null;
    var sourceID = null;
    this.metadata = null;
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    this.duration = [ 1, 25 ];
    this.chunksize = 1920 * 2;
    this.tags = {};
    this.contentLength = 0;
    s3.headBucket({ Bucket : config.bucket }).promise()
      .then(() => {
        return s3.headObject({
          Bucket: config.bucket,
          Key: config.key }).promise();
      })
      .then(o => {
        this.metadata = o.Metadata;
        this.chunksize = +this.metadata.grainsize;
        this.contentLength = o.ContentLength;
        if (isNaN(this.chunksize)) {
          return Promise.reject('Received chunksize that is non-numerical.');
        }
        this.tags = makeTags(o.ContentType);
        if (config.regenerate === true && this.metadata.starttimesync) {
          let m = this.metadata.starttimesync.match(/^([0-9]+):([0-9]+)$/);
          this.baseTime[0] = +m[1];
          this.baseTime[1] = +m[2];
        }
        if (this.metadata.duration) {
          let m = this.metadata.duration.match(/^([0-9]+)\/([0-9]+)$/);
          this.duration[0] = +m[1];
          this.duration[1] = +m[2];
        }

        let cableSpec = {};
        cableSpec[this.tags.format] = [{ tags : this.tags }];
        cableSpec.backPressure = `${this.tags.format}[0]`;
        this.makeCable(cableSpec);
        flowID = this.flowID();
        sourceID = this.sourceID();
        return Promise.resolve();
      }, e => {
        this.preFlightError(`Uanable to resolve bucket and/or object: ${e}`);
        return Promise.reject(`Uanable to resolve bucket and/or object: ${e}`);
      })
      .then(() => {
        return this.highland(
          cloudInlet(s3, { Bucket: config.bucket, Key: config.key },
            this.chunksize, config.loop, this.contentLength, config.queueSize)
            .map(g => {
              var grainTime = Buffer.allocUnsafe(10);
              grainTime.writeUIntBE(this.baseTime[0], 0, 6);
              grainTime.writeUInt32BE(this.baseTime[1], 6);
              this.baseTime[1] = ( this.baseTime[1] +
                this.duration[0] * 1000000000 / this.duration[1]|0);
              this.baseTime = [ this.baseTime[0] + this.baseTime[1] / 1000000000|0,
                this.baseTime[1] % 1000000000];
              return new Grain(g.buffers, grainTime, grainTime, null,
                flowID, sourceID, this.duration);
            })
            .pipe(grainConcater(this.tags)));
      })
      .catch(e => {
        this.preFlightError(e);
      });
    this.log('Set up promises.');
  }
  util.inherits(CloudStoreIn, redioactive.Funnel);
  RED.nodes.registerType('cloud-store-in', CloudStoreIn);
};

function makeTags(ct) {
  var tags = {};
  var mime = ct.match(/^\s*(\w+)\/([\w-]+)/);
  tags.format = mime[1];
  tags.encodingName = mime[2];
  if (mime[1] === 'video') {
    if (mime[2] === 'raw' || mime[2] === 'x-v210') {
      tags.clockRate = '90000';
    }
    tags.packing = ( mime[2] === 'x-v210' ) ? 'v210' : 'pgroup';
    console.log('***!!!£££ tags.packing = ', tags.packing, mime[2]);
  }
  var parameters = ct.match(/\b(\w+)=(\S+)\b/g);
  parameters.forEach(p => {
    var splitP = p.split('=');
    if (splitP[0] === 'rate') splitP[0] = 'clockRate';
    tags[splitP[0]] = splitP[1];
  });
  if (tags.packing === 'v210') tags.encodingName = 'raw';
  return tags;
}
