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
const fs = require('fs');
const path = require('path');
const Grain = require('node-red-contrib-dynamorse-core').Grain;
const uuid = require('uuid');
const swapBytes = require('../util/swapBytes.js');

module.exports = function (RED) {
  function WAVOut (config) {
    RED.nodes.createNode(this, config);
    redioactive.Spout.call(this, config);

    this.srcTags = null;
    this.srcFlowID = null;
    this.bitsPerSample = 16;
    var begin = null;
    var sentCount = 0;

    fs.access(path.dirname(config.file), fs.W_OK, e => {
      if (e) {
        return this.preFlightError(e);
      }
    });
    this.wavStream = fs.createWriteStream(config.file);
    this.wavStream.on('error', err => {
      this.error(`Failed to write to essence WAV file '${config.file}': ${err}`);
    });
    this.each((x, next) => {
      if (!Grain.isGrain(x)) {
        this.warn('Received non-Grain payload.');
        return next();
      }
      // this.log(`Received ${util.inspect(x)}.`);
      var nextJob = (this.srcTags) ?
        Promise.resolve(x) :
        this.findCable(x).then(f => {
          if (!Array.isArray(f[0].audio) || (Array.isArray(f[0].audio) && f[0].audio.length < 1)) {
            return Promise.reject('Logical cable does not contain audio.');
          }
          this.srcTags = f[0].audio[0].tags;
          this.srcFlowID = f[0].audio[0].flowID;

          var h = Buffer.allocUnsafe(44);
          h.writeUInt32BE(0x52494646, 0); // RIFF
          h.writeUInt32LE(0xffffffff, 4); // Dummy length to be replaced
          h.writeUInt32BE(0x57415645, 8); // WAVE
          h.writeUInt32BE(0x666d7420, 12); // fmt
          h.writeUInt32LE(16, 16); // Subchunk size
          h.writeUInt16LE(1, 20); // PCM Format
          var channels = this.srcTags.channels;
          h.writeUInt16LE(channels, 22); // No of channels
          var sampleRate = this.srcTags.clockRate;
          h.writeUInt32LE(sampleRate, 24); // sample rate
          this.bitsPerSample = +this.srcTags.encodingName.substring(1);
          h.writeUInt32LE(Math.ceil(sampleRate * channels * (this.bitsPerSample / 8)), 28); // byte rate
          h.writeUInt16LE(Math.ceil(channels * (this.bitsPerSample / 8)), 32); // block align
          h.writeUInt16LE(this.bitsPerSample, 34); // Bits per sampls
          h.writeUInt32BE(0x64617461, 36); // data
          h.writeUInt32LE(0xffffffff, 40); // sub-chunk size ... to be fixed
          this.wavStream.write(h, f);
        });
      nextJob.then(() => {
        if (uuid.unparse(x.flow_id) !== this.srcFlowID)
          return next();

        if (begin === null) begin = process.hrtime();
        this.wavStream.write(swapBytes(x.buffers[0], this.bitsPerSample), () => {
          sentCount++;
          if (config.timeout === 0) {
            setImmediate(next);
          } else {
            var diffTime = process.hrtime(begin);
            var diff = (sentCount * +config.timeout) -
                (diffTime[0] * 1000 + diffTime[1] / 1000000|0);
            setTimeout(next, (diff > 0) ? diff : 0);
          }
        });
      }).catch(e => {
        this.preFlightError(`Could not read tags: ${e}`);
      });
    });
    this.errors((e, next) => {
      this.warn(`Received unhandled error: ${e.message}.`);
      if (config.timeout === 0) setImmediate(next);
      else setTimeout(next, config.timeout);
    });
    this.done(() => {
      this.log('Let\'s wave goodbye!');
      this.wavStream.end(() => {
        this.wsMsg.send({'wavDone': 0});
      });
    });
  }
  util.inherits(WAVOut, redioactive.Spout);
  RED.nodes.registerType('wav-out', WAVOut);
};
