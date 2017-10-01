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

var fs = require('fs');
var os = require('os');

function readHeader(filename, cb) {
  this.headerBuf = Buffer.allocUnsafe(0);
  this.endianness = '';

  var rs = fs.createReadStream(filename, { start: 0, end: 2047 });
  rs.on('data', chunk => this.headerBuf = Buffer.concat([this.headerBuf, chunk]));
  rs.on('end', () => {
    var magicNum = this.headerBuf.readUInt32LE(0);
    if (0x53445058 === magicNum) // 'SDPX'
      this.endianness = 'LE';
    else if (0x58504453 === magicNum) // 'XPDS'
      this.endianness = 'BE';
    cb('' === this.endianness ? new Error('DPX file doesn\'t have the correct magic number') : null);
  });
  rs.on('error', err => { cb(err); });
}

readHeader.prototype.readAscii = function(o, l, core) {
  var val = this.headerBuf.toString('ascii', o, o+l);
  if (core && !val) throw new Error(`DPX file has invalid core header string at offset ${o}`);
  return val;
}
readHeader.prototype.readUInt8 = function(o, core, d) {
  var val = this.headerBuf.readUInt8(o);
  if (0xFF === val) {
    if (core) throw new Error(`DPX file has invalid core header value at offset ${o}`);
    else val = d;
  }
  return val;
}
readHeader.prototype.readUInt16 = function(o, core, d) {
  var val = this.endianness === 'LE' ? this.headerBuf.readUInt16LE(o) : this.headerBuf.readUInt16BE(o);
  if (0xFFFF === val) {
    if (core) throw new Error(`DPX file has invalid core header value at offset ${o}`);
    else val = d;
  }
  return val;
}
readHeader.prototype.readUInt32 = function(o, core, d) {
  var val = this.endianness === 'LE' ? this.headerBuf.readUInt32LE(o) : this.headerBuf.readUInt32BE(o);
  if (0xFFFFFFFF === val) {
    if (core) throw new Error(`DPX file has invalid core header value at offset ${o}`);
    else val = d;
  }
  return val;
}
readHeader.prototype.readFloat32 = function(o, d) {
  var val = this.headerBuf.readUInt32LE(o);
  if (0xFFFFFFFF === val)
    val = d;
  else
    val = this.endianness === 'LE' ? this.headerBuf.readFloatLE(o) : this.headerBuf.readFloatBE(o);
  return val;
}

var makeTags = (node, filename) => {
  node.log('Read DPX Header: ' + filename);
  return new Promise((resolve, reject) => {
    var header = new readHeader(filename, err => {
      try {
        if (err) throw(err);
        // http://www.simplesystems.org/users/bfriesen/dpx/S268M_Revised.pdf
        node.log(`DPX file is ${header.endianness === 'LE' ? 'little-endian':'big-endian'}`);
        var endianSwap = os.endianness() !== header.endianness;

        // File information header
        var offset = header.readUInt32(4, true);
        node.log(`DPX header format ${header.readAscii(8, 8, true)}`);
        var fileSize = header.readUInt32(16, true);

        // Image information header
        var orient = header.readUInt16(768, true);
        var elems = header.readUInt16(770, true);
        var width = header.readUInt32(772, true);
        var height = header.readUInt32(776, true);

        var dataSign = header.readUInt32(780, true);
        var descriptor = header.readUInt8(800, true);
        var transfer = header.readUInt8(801, true);
        var colour = header.readUInt8(802, true);
        var bitDepth = header.readUInt8(803, true);
        var packing = header.readUInt16(804, true);
        var encoding = header.readUInt16(806, true);
        node.imageOffset = header.readUInt32(808, true);

        // Television information header
        var interlace = header.readUInt8(1928, false, 0);
        var frameRate = header.readFloat32(1940, false, 25.0);

        if (orient !== 0) throw new Error(`DPX file has unsupported orientation ${orient}`);
        if (elems !== 1) throw new Error(`DPX file has unsupported number of elements ${elems}`);
        if (dataSign !== 0) throw new Error(`DPX file has unsupported data sign ${dataSign}`);
        if ((descriptor !== 50) && (descriptor !== 100)) throw new Error(`DPX file has unsupported descriptor ${descriptor}`);
        // if ((transfer !== 2) && (transfer !== 6)) throw new Error(`DPX file has unsupported transfer characteristic ${transfer}`);
        if (bitDepth !== 10) throw new Error(`DPX file has unsupported bit depth ${bitDepth}`);
        if (packing !== 1) throw new Error(`DPX file has unsupported packing method ${packing}`);
        if (encoding !== 0) throw new Error(`DPX file has unsupported encoding method ${encoding}`);
        if ((interlace !== 0) && (interlace !== 1)) interlace = 0;

        node.log(`DPX image information: ${width}x${height}, transfer: ${transfer}, colour: ${colour}, depth: ${bitDepth}, packing: ${packing}, offset: ${offset}, interlace: ${interlace}, framerate: ${frameRate}`);

        if (Math.abs((frameRate * 1001) / 1000 - Math.ceil(frameRate)) < 0.0001)
          node.grainDuration = [ 1001, 1000 * Math.ceil(frameRate) ];
        else
          node.grainDuration = [ 1, Math.ceil(frameRate) ];

        var tags = {};
        tags.format = [ 'video' ];
        tags.encodingName = [ 'raw' ];
        tags.clockRate = [ '90000' ];
        tags.height = [ height.toString() ];
        tags.width = [ width.toString() ];
        tags.sampling = [ 50 === descriptor ? 'RGB-4:4:4' : 'YCbCr-4:2:2' ];
        tags.depth = [ bitDepth.toString() ];
        tags.colorimetry = [ 6 === transfer ? 'BT709-2' : 'BT709-2' ];
        tags.interlace = [ 0 === interlace ? '0' : '1' ];
        tags.packing = [ endianSwap ? 'BGR10-A-BS' : 'BGR10-A' ];

        resolve(tags);
      } catch(err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  makeTags : makeTags
};
