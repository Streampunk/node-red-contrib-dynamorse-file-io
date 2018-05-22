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

var util = require('util');
require('util.promisify').shim(); // TODO Remove when on Node 8+
var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var SDPProcessing = require('node-red-contrib-dynamorse-core').SDPProcessing;
var fs = require('fs');
var grainFlipper = require('../util/grainFlipper.js');
var dpx = require('../util/dpx.js');
var tga = require('../util/tga.js');
var Grain = require('node-red-contrib-dynamorse-core').Grain;
var H = require('highland');
var mm = require('micromatch');
var path = require('path');

module.exports = function (RED) {
  var fsaccess = util.promisify(fs.access);
  var fsreadFile = util.promisify(fs.readFile);
  var fsreadDir = util.promisify(fs.readdir);
  var readdir = H.wrapCallback(fs.readdir);
  var readFile = H.wrapCallback(fs.readFile);

  function GlobIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);

    var node = this;
    this.tags = {};
    this.grainCount = 0;
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    // var nodeAPI = this.context().global.get('nodeAPI');
    // var ledger = this.context().global.get('ledger');
    this.headers = [];
    var flowID = null;
    var sourceID = null;
    this.imageOffset = 0;
    this.flip = { h : false, v : false };
    var parallel = +config.parallel;
    
    this.configDuration = [ +config.grainDuration.split('/')[0],
      +config.grainDuration.split('/')[1] ];
    this.grainDuration = this.configDuration;

    config.glob = config.glob.replace(/[/\\]/g, path.sep);
    var lastSlash = config.glob.lastIndexOf(path.sep);
    var pathParts = (lastSlash >= 0) ?
      [ config.glob.slice(0, lastSlash), config.glob.slice(lastSlash + 1)] :
      [ '.', config.glob];
    pathParts[1] = (pathParts[1].length === 0) ? '*' : pathParts[1];

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

    fsaccess(pathParts[0], fs.R_OK)
      .then(() => {
        if (config.headers) {
          return fsaccess(pathParts[0] + path.sep + config.headers, fs.R_OK)
            .then(() => { config.headers = pathParts[0] + path.sep + config.headers; },
              () => { return fsaccess(config.headers, fs.R_OK); });
        }
        if (+config.grainSize <= 0)
          return Promise.reject(new Error('No header file and grain size is zero.'));
        return Promise.resolve();
      })
      .then(() => {
        if (config.headers) {
          return fsreadFile(config.headers).then(JSON.parse).then(heads => {
            node.headers = heads;
            if (node.headers.length > 0 && node.headers[0].contentType) {
              var contentType = node.headers[0].contentType;
              var tags = {};
              var mime = contentType.match(/^\s*(\w+)\/([\w-]+)/);
              tags.format = mime[1];
              tags.encodingName = mime[2];
              if (mime[1] === 'video') {
                if (mime[2] === 'raw' || mime[2] === 'x-v210') {
                  tags.clockRate = 90000;
                }
                tags.packing = ( mime[2] === 'x-v210' ) ? 'v210' : 'pgroup';
                // console.log('***!!!£££ tags.packing = ', tags.packing, mime[2]);
              }
              var parameters = contentType.match(/\b(\w+)=(\S+)\b/g);
              parameters.forEach(p => {
                var splitP = p.split('=');
                if (splitP[0] === 'rate') splitP[0] = 'clockRate';
                tags[splitP[0]] = (isNaN(+splitP[1])) ? splitP[1] : +splitP[1];
              });
              if (typeof tags.interlace === 'number')
                tags.interlace = (tags.interlace === 1);
              if (tags.packing === 'v210') tags.encodingName = 'raw';
              return tags;
            }
            return null;
          });
        } else if ('.dpx' === pathParts[1].slice(-4)) {
          node.log('Creating tags from first dpx file.');
          return fsreadDir(pathParts[0])
            .then(paths =>
              dpx.makeTags(node, pathParts[0] + path.sep + paths.sort()[0]));
        } else if ('.tga' === pathParts[1].slice(-4)) {
          node.log('Creating tags from first tga file.');
          return fsreadDir(pathParts[0])
            .then(paths => 
              tga.makeTags(node, pathParts[0] + path.sep + paths.sort()[0])); 
        } else {
          return null;
        }
      })
      .then(tags => {
        if (!tags) {
          node.log('Failed to read tags - trying via configuration.');
          return node.sdpURLReader(config);
        } else {
          return tags;
        }
      })
      .then(tags => {
        node.tags = tags;
        var cable = {};
        cable[tags.format] = [{ tags : tags }];
        cable.backPressure = `${tags.format}[0]`;
        if (node.headers.length > 0 && config.regenerate === false) {
          cable[tags.format][0].flowID = node.headers[0].flow_id;
          cable[tags.format][0].sourceID = node.headers[0].source_id;
        }
        this.makeCable(cable);
        flowID = this.flowID();
        sourceID = this.sourceID();

        var readLoop = 0;
        var headerIndex = 0;
        node.highland(
          H((push, next) => {
            if (config.loop || readLoop++ === 0) {
              push(null, pathParts[0]); next();
            } else {
              push(null, H.nil);
            }
          })
            .flatMap(x => readdir(x).flatten().filter(y => mm.isMatch(y, pathParts[1])).sort())
            .map(x => readFile(pathParts[0] + path.sep + x))
            .parallel(parallel)
            .map(g => {
              if (node.headers.length > 0 && config.regenerate === false) {
                var hmd = node.headers[headerIndex++];
                return new Grain([g.slice(node.imageOffset)], hmd.ptpSyncTimestamp, hmd.ptpOriginTimestamp,
                  hmd.timecode, flowID, sourceID, hmd.duration);
              } // otherwise regenerate grain metadata
              var grainTime = Buffer.allocUnsafe(10);
              grainTime.writeUIntBE(node.baseTime[0], 0, 6);
              grainTime.writeUInt32BE(node.baseTime[1], 6);
              node.baseTime[1] = ( node.baseTime[1] +
                node.grainDuration[0] * 1000000000 / node.grainDuration[1]|0 );
              node.baseTime = [ node.baseTime[0] + node.baseTime[1] / 1000000000|0,
                node.baseTime[1] % 1000000000];
              return new Grain([g.slice(node.imageOffset)], grainTime,
                (node.headers.length === 0) ? grainTime : g.ptpOrigin,
                g.timecode, flowID, sourceID, node.grainDuration);
            })
            .pipe(grainFlipper(node.tags, node.flip))
        );
      })
      .catch(node.preFlightError);
    node.log('Set up promises for raw file in.');
  }
  util.inherits(GlobIn, redioactive.Funnel);
  RED.nodes.registerType('glob-in', GlobIn);

  GlobIn.prototype.sdpToTags = SDPProcessing.sdpToTags;
  GlobIn.prototype.setTag = SDPProcessing.setTag;
  GlobIn.prototype.sdpURLReader = util.promisify(SDPProcessing.sdpURLReaderDynamorse);
  GlobIn.prototype.sdpToExt = SDPProcessing.sdpToExt;
};
