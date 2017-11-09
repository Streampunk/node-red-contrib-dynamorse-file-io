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

const fsaccess = promisify(fs.access);

function makeTags(x) {
  if (!x.description) return {};
  var des = x.description;
  var tags = { descriptor : des.ObjectClass };
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
  default:
    return {};
  }
}

module.exports = function (RED) {
  function MXFIn (config) {
    RED.nodes.createNode(this, config);
    redioactive.Funnel.call(this, config);

    this.flow_id = null;
    this.source_id = null;
    this.tags = {};
    this.grainDuration = [ 0, 1 ];
    this.grainCount = 0;
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];

    var mxfurl = url.parse(config.mxfUrl);
    switch (mxfurl.protocol) {
    case 'file:':
      var pathname = mxfurl.pathname.replace(/%20/g, ' ');
      fsaccess(pathname, fs.R_OK)
        .then(() => {
          this.highland(
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
              .through(klv.trackCacher())
              .through(klv.essenceFilter('picture0'))
              .doto(x => { if (!this.flow_id) this.extractFlowAndSource(x); })
              .map(x => {
                var grainTime = Buffer.allocUnsafe(10);
                grainTime.writeUIntBE(this.baseTime[0], 0, 6);
                grainTime.writeUInt32BE(this.baseTime[1], 6);
                this.baseTime[1] = ( this.baseTime[1] +
                  this.grainDuration[0] * 1000000000 / this.grainDuration[1]|0 );
                this.baseTime = [ this.baseTime[0] + this.baseTime[1] / 1000000000|0,
                  this.baseTime[1] % 1000000000];
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
                this.grainCount++;
                return new Grain(x.value, grainTime, grainTime, timecode,
                  this.flow_id, this.source_id, this.grainDuration);
              })
              .errors(e => this.warn(e))
          );
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

  MXFIn.prototype.extractFlowAndSource = function (x) {
    this.tags = makeTags(x);
    if (this.tags.grainDuration) {
      this.grainDuration = this.tags.grainDuration;
    }

    let cableSpec = {};
    cableSpec[this.tags.format] = [{ tags : this.tags }];
    cableSpec.backPressure = `${this.tags.format}[0]`;
    this.makeCable(cableSpec);
    this.flow_id = this.flowID();
    this.source_id = this.sourceID();
  };
};
