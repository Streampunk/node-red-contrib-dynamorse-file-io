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

const redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
const util = require('util');
const promisify = util.promisify ? util.promisify : require('util.promisify');
const klv = require('kelvinadon');
const fs = require('fs');
const url = require('url');
const H = require('highland');
const Grain = require('node-red-contrib-dynamorse-core').Grain;
const Timecode = require('node-red-contrib-dynamorse-core').Timecode;
const crypto = require('crypto');
const uuid = require('uuid');
const swapBytes = require('../util/swapBytes.js');

const fsaccess = promisify(fs.access);

function makeID (pkid, trkID) {
  var hash = crypto.createHash('sha1');
  hash.update(Buffer.from(uuid.parse(pkid)));
  hash.update(typeof trkID === 'number' ? 'TrackID' + trkID : trkID, 'utf8');
  var dig = hash.digest();
  // Make a legal V5 UUID identifier wrt rfc4122
  dig[6] = (dig[6] & 0x0f) | 0x50;
  dig[8] = (dig[8] & 0x3f) | 0x80;
  return uuid.unparse(dig);
}

function makeTags(x) {
  if (!x.description) return {};
  var des = x.description;
  var tags = {
    descriptor : des.ObjectClass,
    sourceID: makeID(x.sourcePackageID[1], x.track.TrackID),
    flowID: uuid.v4()
  };
  switch (des.ObjectClass) {
  case 'MPEGVideoDescriptor':
    tags.clockRate = '90000';
    tags.width = des.StoredWidth;
    tags.height = (des.FrameLayout === 'SeparateFields') ?
      2 * des.StoredHeight : des.StoredHeight;
    tags.depth = des.ComponentDepth;
    tags.format = 'video';
    tags.encodingName = 'H264'; // TODO fix up ... could be MPEG-2 video?
    if (!des.VerticalSubsampling) des.VerticalSubsampling = 1;
    switch ( des.HorizontalSubsampling << 4 | des.VerticalSubsampling ) {
    case 0x11: tags.sampling = 'YCbCr-4:4:4'; break;
    case 0x21: tags.sampling = 'YCbCr-4:2:2'; break;
    case 0x22: tags.sampling = 'YCbCr-4:2:0'; break;
    case 0x41: tags.sampling = 'YCbCr-4:1:1'; break;
    default: break;
    }
    switch (des.CodingEquations) {
    case 'CodingEquations_ITU601':
      tags.colorimetry = 'BT601-5'; break;
    case 'CodingEquations_SMPTE240M':
      tags.colorimetry = 'SMPTE240M'; break;
    case 'CodingEquations_ITU2020_NCL':
      tags.colorimetry = 'BT2020-2'; break;
    case 'CodingEquations_ITU709':
    default:
      tags.colorimetry = 'BT709-2'; break;
    }
    tags.sampleRate = des.SampleRate[0]/des.SampleRate[1];
    tags.interlace = (des.FrameLayout === 'SeparateFields');
    if (Array.isArray(des.SampleRate)) {
      tags.grainDuration = [des.SampleRate[1], des.SampleRate[0]];
    }
    return tags;
  case 'CDCIDescriptor':
    tags.clockRate = '90000';
    tags.width = des.StoredWidth;
    tags.height = (des.FrameLayout === 'SeparateFields') ?
      2 * des.StoredHeight : des.StoredHeight;
    tags.depth = des.ComponentDepth;
    tags.format = 'video';
    tags.encodingName = 'H264'; // TODO fix up ... could be MPEG-2 video?
    if (!des.VerticalSubsampling) des.VerticalSubsampling = 1;
    switch (des.HorizontalSubsampling << 4 | des.VerticalSubsampling) {
    case 0x11: tags.sampling = 'YCbCr-4:4:4'; break;
    case 0x21: tags.sampling = 'YCbCr-4:2:2'; break;
    case 0x22: tags.sampling = 'YCbCr-4:2:0'; break;
    case 0x41: tags.sampling = 'YCbCr-4:1:1'; break;
    default: break;
    }
    switch (des.CodingEquations) {
    case 'CodingEquations_ITU601':
      tags.colorimetry = 'BT601-5'; break;
    case 'CodingEquations_SMPTE240M':
      tags.colorimetry = 'SMPTE240M'; break;
    case 'CodingEquations_ITU2020_NCL':
      tags.colorimetry = 'BT2020-2'; break;
    case 'CodingEquations_ITU709':
    default:
      tags.colorimetry = 'BT709-2'; break;
    }
    tags.sampleRate = des.SampleRate[0]/des.SampleRate[1];
    tags.interlace = (des.FrameLayout === 'SeparateFields');
    if (Array.isArray(des.SampleRate)) {
      tags.grainDuration = [des.SampleRate[1], des.SampleRate[0]];
    }
    return tags;
  case 'AES3PCMDescriptor':
    tags.clockRate = des.AudioSampleRate[1] === 1 ? des.AudioSampleRate[0] : 48000;
    tags.format = 'audio';
    tags.channels = des.ChannelCount;
    tags.encodingName = `L${des.QuantizationBits}`;
    tags.bitsPerSample = des.QuantizationBits;
    tags.blockAlign = des.BlockAlign;
    tags.grainDuration = [ x.track.EditRate[1], x.track.EditRate[0] ];
    return tags;
  default:
    return {};
  }
}

function addTracks(tracks, config, mxfType, format, min, max) {
  for ( var i = min ; i <= max; i++ ) {
    if (config[`${mxfType}Track${i}`]) {
      tracks.push({
        mxfType: mxfType,
        format: format,
        index: i,
        filter: `${mxfType}${i}`,
        name: `${format}${i}`,
        grainCount: 0
      });
    }
  }
}

module.exports = function (RED) {
  function MXFIn (config) {
    RED.nodes.createNode(this, config);
    redioactive.Funnel.call(this, config);

    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    this.cable = null;

    var tracks = [];
    addTracks(tracks, this.config, 'picture', 'video', 0, 1);
    addTracks(tracks, this.config, 'sound', 'audio', 0, 15);
    addTracks(tracks, this.config, 'data', 'anc', 0, 15);

    var mxfurl = url.parse(config.mxfUrl);
    switch (mxfurl.protocol) {
    case 'file:':
      var pathname = mxfurl.pathname.replace(/%20/g, ' ');
      fsaccess(pathname, fs.R_OK)
        .then(() => {
          var baseStream =
            H((push, next) => {
              push(null, H(fs.createReadStream(pathname)));
              next();
            })
              .take(config.loop ? Number.MAX_SAFE_INTEGER : 1)
              .sequence()
              .through(klv.kelviniser())
              .through(klv.metatiser())
              .through(klv.stripTheFiller)
              .through(klv.detailing())
              .through(klv.puppeteer())
              .through(klv.trackCacher());
          var streams = tracks.map(t => {
            return baseStream.fork()
              .through(klv.essenceFilter(t.filter))
              .doto(x => { if (!t.tags) t.tags = makeTags(x); })
              .map(x => {
                // FIXME adjust for origin, use timecode, base date from package created
                var grainTime = Buffer.allocUnsafe(10);
                var nanosExtra = ( t.grainCount++ *
                  t.tags.grainDuration[0] / t.tags.grainDuration[1] ) * 1000000000;
                var timeParts = [ this.baseTime[1] + (this.baseTime[0] + nanosExtra) / 1000000000|0,
                  nanosExtra % 1000000000|0];
                grainTime.writeUIntBE(timeParts[0], 0, 6);
                grainTime.writeUInt32BE(timeParts[1], 6);
                var timecode = null;
                if (x.startTimecode) {
                  var startTC = x.startTimecode;
                  var baseTC = startTC.StartTimecode + this.grainCount;
                  timecode = new Timecode( // FIXME drop frame calculations
                    baseTC / (3600 * startTC.FramesPerSecond)|0,
                    (baseTC / (60 * startTC.FramesPerSecond)|0) % 60,
                    (baseTC / startTC.FramesPerSecond|0) % 60,
                    baseTC % startTC.FramesPerSecond,
                    startTC.DropFrame, true);
                }
                if (t.format === 'audio') {
                  x.value = x.value.map(y => swapBytes(y, t.tags.bitsPerSample));
                }
                return new Grain(x.value, grainTime, grainTime, timecode,
                  t.tags.flowID, t.tags.sourceID, t.tags.grainDuration);
              });
          });
          this.highland(H(streams)
            .merge()
            .doto(() => {
              if (!this.cable && tracks.every(x => x.tags !== undefined)) {
                let cableSpec = {};
                for ( let track of tracks ) {
                  if (!cableSpec[track.format]) cableSpec[track.format] = [];
                  cableSpec[track.format].push({
                    name: track.name,
                    tags : track.tags,
                    flowID: track.tags.flowID,
                    sourceID: track.tags.sourceID
                  });
                }
                this.cable = this.makeCable(cableSpec);
              }
            })
            .errors(e => this.error(e)));
          baseStream.resume();
        })
        .catch(this.preFlightError);
      break;
    case 'http:':
      break;
    case 'ftp:':
      break;
    default:
      this.preFlightError('MXF URL must be either file, http or ftp.');
      break;
    }
  }
  util.inherits(MXFIn, redioactive.Funnel);
  RED.nodes.registerType('mxf-in', MXFIn);

//   MXFIn.prototype.extractFlowAndSource = function (x, t) {
//     t.tags = makeTags(x);
//
//     let cableSpec = {};
//     cableSpec[this.tags.format] = [{ tags : this.tags }];
//     cableSpec.backPressure = `${this.tags.format}[0]`;
//     this.makeCable(cableSpec);
//     this[`${strid}_flow_id`] = this.flowID();
//     this[`${strid}_source_id`] = this.sourceID();
//     this[`${strid}_grainCount`] = 0;
//   };
// };
};
