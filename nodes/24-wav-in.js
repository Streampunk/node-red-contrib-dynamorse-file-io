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

const redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
const util = require('util');
const H = require('highland');
const fs = require('fs');
const Grain = require('node-red-contrib-dynamorse-core').Grain;
const swapBytes = require('../util/swapBytes.js');

function wavInlet(file, loop, grps) {
  var bitsPerSample = 16;
  var channels = 2;
  var blockAlign = 4;
  var sampleRate = 48000;
  var foundHeader = false;
  var foundData = false;
  var grainCount = 0;
  var leftOver = null;
  var pattern = [ 1902 ];
  var nextLen = 0;
  var wavConsumer = (err, b, push, next) => {
    if (err) {
      push(err);
      next();
    }
    else if (b === H.nil) {
      if (leftOver && leftOver.length > 0) push (null, leftOver);
      push(null, b);
    } else {
      var position = 0;
      if (b.length >= 36 &&
          b.readUInt32BE(0) === 0x52494646 && // RIFF
          b.readUInt32BE(8) == 0x57415645) { // WAVE
        bitsPerSample = b.readUInt16LE(34);
        channels = b.readUInt16LE(22);
        sampleRate = b.readUInt32LE(24);
        blockAlign = b.readUInt16LE(32);
        var grainDuration = null;
        switch (grps) {
        default:
        case '25':
          grainDuration = [ 1, 25 ];
          pattern = [ 1920 ];
          break;
        case '29.97':
          grainDuration = [ 1001, 30000 ];
          pattern = [ 1602, 1601, 1602, 1601, 1602 ];
          break;
        case '50':
          grainDuration = [ 1, 50 ];
          pattern = [ 960 ];
          break;
        case '59.94':
          grainDuration = [ 1001, 60000 ];
          pattern = [ 801, 801, 801, 800, 801, 801, 801, 800, 801, 801 ];
          break;
        }
        var tags = {
          format : 'audio',
          channels : channels,
          clockRate : sampleRate,
          encodingName : `L${bitsPerSample}`,
          blockAlign : blockAlign,
          grainDuration : grainDuration
        };
        push(null, tags);
        foundHeader = true;
        foundData = false;
        position += 36;
      }
      if (foundHeader) {
        while (!foundData && position < b.length) {
          if (b.readUInt32BE(position) === 0x64617461) { // data
            foundData = true;
            position += 8;
          }
          else { position += 1; }
        }
        if (foundData) {
          nextLen = pattern[grainCount % pattern.length] * blockAlign;
          if (leftOver && leftOver.length > 0 &&
              position + nextLen - leftOver.length <= b.length) {
            var overlap = Buffer.concat(
              [leftOver, b.slice(position, position + nextLen - leftOver.length)],
              nextLen);
            push(null, swapBytes(overlap, bitsPerSample));
            position += nextLen - leftOver.length;
            grainCount++;
            nextLen = pattern[grainCount % pattern.length] * blockAlign;
            leftOver = null;
          }
          while (position + nextLen <= b.length) {
            push(null, swapBytes(b.slice(position, position + nextLen), bitsPerSample));
            grainCount++;
            position += nextLen;
            nextLen = pattern[grainCount % pattern.length] * blockAlign;
          }
          if (position < b.length) {
            leftOver = b.slice(position);
          } else {
            leftOver = null;
          }
        }
      }
      next();
    }
  };
  return H((push, next) => {
    push(null, H(fs.createReadStream(file)));
    next();
  })
    .take(loop ? Number.MAX_SAFE_INTEGER : 1)
    .sequence()
    .consume(wavConsumer);
}

module.exports = function (RED) {
  function WAVIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);

    fs.access(config.file, fs.R_OK, e => {
      if (e) {
        return this.preFlightError(e);
      }
    });
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    this.blockAlign = 4;
    this.sampleRate = 48000;
    var flowID = null;
    var sourceID = null;

    this.highland(
      wavInlet(config.file, config.loop, config.grps)
        .doto(tags => {
          if (typeof tags === 'object' && !Buffer.isBuffer(tags)) { // Assume it is tags
            this.makeCable({ audio : [{ tags : tags }], backPressure : 'audio[0]' });
            flowID = this.flowID();
            sourceID = this.sourceID();
            this.blockAlign = tags.blockAlign;
            this.sampleRate = tags.clockRate;
          }
        })
        .filter(Buffer.isBuffer)
        .map(b => {
          var grainTime = Buffer.allocUnsafe(10);
          grainTime.writeUIntBE(this.baseTime[0], 0, 6);
          grainTime.writeUInt32BE(this.baseTime[1], 6);
          var grainDuration = [ b.length / this.blockAlign|0, this.sampleRate ];
          this.baseTime[1] = ( this.baseTime[1] +
            grainDuration[0] * 1000000000 / grainDuration[1]|0 );
          this.baseTime = [ this.baseTime[0] + this.baseTime[1] / 1000000000|0,
            this.baseTime[1] % 1000000000];
          return new Grain([b], grainTime, grainTime, null,
            flowID, sourceID, grainDuration);
        })
    );
  }
  util.inherits(WAVIn, redioactive.Funnel);
  RED.nodes.registerType('wav-in', WAVIn);
};
