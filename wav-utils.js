'use strict';
const fs = require('fs');

function readWavDuration(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 44) return null;
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
    if (buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    const byteRate = buf.readUInt32LE(28);
    if (byteRate === 0) return null;
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const chunkId   = buf.toString('ascii', offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      if (chunkId === 'data') return Math.ceil(chunkSize / byteRate);
      offset += 8 + chunkSize;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { readWavDuration };
