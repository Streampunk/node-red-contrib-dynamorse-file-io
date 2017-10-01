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
require('util.promisify').shim(); // TOTO Remove when on Node 8+
var SDPProcessing = require('node-red-contrib-dynamorse-core').SDPProcessing;
var fs = require('fs');
var grainConcater = require('../util/grainConcater.js');
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var H = require('highland');
var uuid = require('uuid');

const emptyBuf = Buffer.alloc(0);

function rawInlet(file, sizes, loop) {
  var flowID = uuid.v4();
  var sourceID = uuid.v4();
  var bufs = [];
  var desired = (typeof sizes === 'number') ? sizes : 0;
  var remaining = null;
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
  var nextLength = null;
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
  return H((push, next) => {
      push(null, H(fs.createReadStream(file)));
      grainCount = 0;
      next();
    })
    .take(loop ? Number.MAX_SAFE_INTEGER : 1)
    .sequence()
    .consume((typeof sizes === 'number') ? fixedChomper : variableChomper);
}

module.exports = function (RED) {
  var fsaccess = util.promisify(fs.access);
  var fsreadFile = util.promisify(fs.readFile);
  function RawFileIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);
    if (!this.context().global.get('updated'))
      return this.log(`Waiting for global context to be updated. ${this.context().global.get('updated')}`);
    var node = this;

    this.tags = {};
    this.grainCount = 0;
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    this.exts = RED.nodes.getNode(
      this.context().global.get('rtp_ext_id')).getConfig();
    var nodeAPI = this.context().global.get('nodeAPI');
    var ledger = this.context().global.get('ledger');
    this.headers = [];
    this.source = null;
    this.flow = null;
    this.configDuration = [ +config.grainDuration.split('/')[0],
                            +config.grainDuration.split('/')[1] ];

    switch (config.encodingName) {
      case 'raw':
      case 'h264':
      case 'smpte291':
        config.format = 'video';
        break;
      case 'L16':
      case 'L24':
        config.format = 'audio';
        break;
      default:
        config.format = 'application';
        break;
    }

    fsaccess(config.file, fs.R_OK)
    .then(() => {
      if (config.headers) {
        return fsaccess(config.headers, fs.R_OK);
      }
      if (+config.grainSize <= 0)
        return Promise.reject(new Error('No headers file and grain size is zero.'));
    })
    .then(() => {
      if (config.headers) {
        return fsreadFile(config.headers).then(JSON.parse).then(heads => {
          node.headers = heads;
          if (node.headers.length > 0 && node.headers[0].contentType) {
            var contentType = node.headers[0].contentType;
            var tags = {};
            var mime = contentType.match(/^\s*(\w+)\/([\w\-]+)/);
            tags.format = [ mime[1] ];
            tags.encodingName = [ mime[2] ];
            if (mime[1] === 'video') {
              if (mime[2] === 'raw' || mime[2] === 'x-v210') {
                tags.clockRate = [ '90000' ];
              }
              tags.packing = ( mime[2] === 'x-v210' ) ? [ 'v210' ] : [ 'pgroup' ];
              console.log('***!!!£££ tags.packing = ', tags.packing, mime[2]);
            }
            var parameters = contentType.match(/\b(\w+)=(\S+)\b/g);
            parameters.forEach(p => {
              var splitP = p.split('=');
              if (splitP[0] === 'rate') splitP[0] = 'clockRate';
              tags[splitP[0]] = [ splitP[1] ];
            });
            if (tags.packing === 'v210') tags.encodingName = [ 'raw' ];
            console.log('TAGS', tags);
            return tags;
          }
          return null;
        });
      } else {
        return null;
      }
    })
    .then(tags => {
      if (!tags) {
        node.log("Failed to read tags - trying via configuration.");
        return node.sdpURLReader(config);
      } else {
        return tags;
      }
    })
    .then(tags => {
      node.tags = tags;
      var localName = config.name || `${config.type}-${config.id}`;
      var localDescription = config.description || `${config.type}-${config.id}`;
      var pipelinesID = config.device ?
        RED.nodes.getNode(config.device).nmos_id :
        node.context().global.get('pipelinesID');
      node.source = new ledger.Source(
        (config.regenerate === false && node.headers.length > 0) ? node.headers[0].source_id : null,
        null, localName, localDescription,
        "urn:x-nmos:format:" + node.tags.format[0], null, null, pipelinesID, null);
      node.flow = new ledger.Flow(
        (config.regenerate === false && node.headers.length > 0) ? node.headers[0].flow_id : null,
        null, localName, localDescription,
        "urn:x-nmos:format:" + node.tags.format[0], node.tags, node.source.id,
        (config.regenerate === true && node.headers.length > 0) ? [ node.headers[0].flow_id ] : []);
      return nodeAPI.putResource(node.source)
        .then(() => nodeAPI.putResource(node.flow));
    })
    .then(() => {
      node.highland(
        rawInlet(
          config.file,
          (node.headers.length === 0) ? +config.grainSize : node.headers,
          config.loop)
        .map(g => {
          if (node.headers.length > 0 && config.regenerate === false) {
            return new Grain(g.buffers, g.ptpSync, g.ptpOrigin, g.timecode,
              node.flow.id, node.source.id, g.duration);
          } // otherwise regenerate grain metadata
          var grainTime = Buffer.allocUnsafe(10);
          grainTime.writeUIntBE(node.baseTime[0], 0, 6);
          grainTime.writeUInt32BE(node.baseTime[1], 6);
          var grainDuration = g.getDuration();
          if (isNaN(grainDuration[0])) grainDuration = node.configDuration;
          node.baseTime[1] = ( node.baseTime[1] +
            grainDuration[0] * 1000000000 / grainDuration[1]|0 );
          node.baseTime = [ node.baseTime[0] + node.baseTime[1] / 1000000000|0,
            node.baseTime[1] % 1000000000];
          return new Grain(g.buffers, grainTime,
            (node.headers.length === 0) ? grainTime : g.ptpOrigin,
            g.timecode, node.flow.id, node.source.id, g.duration);
        })
        .pipe(grainConcater(node.tags))
      );
    })
    .catch(node.preFlightError);
    node.log('Set up promises for raw file in.');
  }
  util.inherits(RawFileIn, redioactive.Funnel);
  RED.nodes.registerType("raw-file-in", RawFileIn);

  RawFileIn.prototype.sdpToTags = SDPProcessing.sdpToTags;
  RawFileIn.prototype.setTag = SDPProcessing.setTag;
  RawFileIn.prototype.sdpURLReader = util.promisify(SDPProcessing.sdpURLReader);
  RawFileIn.prototype.sdpToExt = SDPProcessing.sdpToExt;
}
