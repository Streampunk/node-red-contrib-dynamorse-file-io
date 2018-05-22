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

var fs = require('fs');

function readFooter(node, filename) {
  return new Promise((resolve, reject) => {
    var footerBuf = Buffer.allocUnsafe(0);
    var fileSize = fs.statSync(filename).size;

    // Attempt to read the footer to determine whether this is a new format file
    var isNewFormat = false;
    var rs = fs.createReadStream(filename, { start: fileSize-26, end: fileSize-1 });
    rs.on('data', chunk => footerBuf = Buffer.concat([footerBuf, chunk]));
    rs.on('end', () => {
      var sigStr = footerBuf.toString('ascii', 8, 24);
      if ('TRUEVISION-XFILE' === sigStr)
        isNewFormat = true;
      resolve(isNewFormat);
    });
    rs.on('error', err => reject(err));
  });
}

function readHeader(filename/*, isNewFormat*/) {
  this.headerBuf = Buffer.allocUnsafe(0);
  return new Promise((resolve, reject) => {
    var rs = fs.createReadStream(filename, { start: 0, end: 2047 });
    rs.on('data', chunk => this.headerBuf = Buffer.concat([this.headerBuf, chunk]));
    rs.on('end', () => resolve(this));
    rs.on('error', err => reject(err));
  });
}

readHeader.prototype.readAscii = function(o, l) {
  return this.headerBuf.toString('ascii', o, o+l);
};
readHeader.prototype.readUInt8 = function(o) {
  return this.headerBuf.readUInt8(o);
};
readHeader.prototype.readUInt16 = function(o) {
  return this.headerBuf.readUInt16LE(o);
};
readHeader.prototype.readUInt32 = function(o) {
  return this.headerBuf.readUInt32LE(o);
};
  
var makeTags = (node, filename) => {
  node.log('Read TGA Header: ' + filename);
  return readFooter(node, filename)
    .then(isNewFormat => {
      return new readHeader(filename, isNewFormat);
    })
    .then((header) => {
      return new Promise((resolve, reject) => {
        try {
          var idLength = header.readUInt8(0);
          var colMapType = header.readUInt8(1);
          var imageType = header.readUInt8(2);

          // var colMapFirstEntryIndex = header.readUInt16(3);
          var colMapLength = header.readUInt16(5);
          var colMapEntrySize = header.readUInt8(7);

          var xOrg = header.readUInt16(8);
          var yOrg = header.readUInt16(10);
          var width = header.readUInt16(12);
          var height = header.readUInt16(14);
          var bitDepth = header.readUInt8(16);
          var descriptor = header.readUInt8(17);
          node.imageOffset = 18 + idLength + (0 === colMapType ? 0 : colMapLength * colMapEntrySize);
          node.flip.h = (1 === ((descriptor >> 4) & 0x1));
          node.flip.v = (0 === ((descriptor >> 5) & 0x1));
          
          if (colMapType !== 0) throw new Error(`TGA file has unsupported color map type ${colMapType}`);
          if (imageType !== 2) throw new Error(`TGA file has unsupported image type ${imageType}`);
          if ((xOrg !== 0) || (yOrg !== 0)) throw new Error(`TGA file has unsupported origin ${xOrg}, ${yOrg}`);
          if (bitDepth !== 32) throw new Error(`TGA file has unsupported bit depth ${bitDepth}`);
          if (descriptor !== 8) throw new Error(`TGA file has unsupported descriptor ${descriptor.toString(16)}`);
          
          node.log(`TGA image information: ${width}x${height}, org ${xOrg},${yOrg}, depth ${bitDepth}${node.flip.h?', hflip':''}${node.flip.v?', vflip':''}`);

          var tags = {};
          tags.format = 'video';
          tags.encodingName = 'raw';
          tags.clockRate = 90000;
          tags.height = height;
          tags.width = width;
          tags.sampling = 'RGBA-4:4:4:4';
          tags.depth = 8;
          tags.colorimetry = 'BT709-2';
          tags.interlace = false;
          tags.packing = 'RGBA8';
          tags.hasAlpha = true;
          
          resolve(tags);
        } catch(err) {
          reject(err);
        }
      });
    });
};

module.exports = {
  makeTags : makeTags
};