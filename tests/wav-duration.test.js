'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWavDuration } = require('../wav-utils');

// Builds a minimal valid WAV buffer with the given byteRate and data chunk size.
// The buffer is exactly 44 bytes (RIFF + fmt + data headers, no PCM payload bytes).
function buildWav(byteRate, dataChunkSize) {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataChunkSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);           // fmt chunk payload size (PCM)
  buf.writeUInt16LE(1, 20);            // PCM format
  buf.writeUInt16LE(2, 22);            // channels
  buf.writeUInt32LE(byteRate / 4, 24); // sampleRate (byteRate / 4 for 16-bit stereo)
  buf.writeUInt32LE(byteRate, 28);     // byteRate
  buf.writeUInt16LE(4, 32);            // blockAlign
  buf.writeUInt16LE(16, 34);           // bitsPerSample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataChunkSize, 40);
  return buf;
}

function writeTmp(buf) {
  const p = path.join(os.tmpdir(), `wav-test-${Date.now()}-${Math.random()}.wav`);
  fs.writeFileSync(p, buf);
  return p;
}

test('returns correct duration for a 10-second WAV', () => {
  const byteRate = 176400; // 44100 * 2ch * 2bytes
  const dataSize = byteRate * 10;
  const p = writeTmp(buildWav(byteRate, dataSize));
  expect(readWavDuration(p)).toBe(10);
  fs.unlinkSync(p);
});

test('returns correct duration for a 3-second WAV', () => {
  const byteRate = 176400;
  const dataSize = byteRate * 3;
  const p = writeTmp(buildWav(byteRate, dataSize));
  expect(readWavDuration(p)).toBe(3);
  fs.unlinkSync(p);
});

test('rounds up fractional seconds with Math.ceil', () => {
  const byteRate = 176400;
  // 3.5 seconds of data
  const dataSize = Math.floor(byteRate * 3.5);
  const p = writeTmp(buildWav(byteRate, dataSize));
  // Math.ceil(3.5) = 4
  expect(readWavDuration(p)).toBe(4);
  fs.unlinkSync(p);
});

test('returns null for a file that does not exist', () => {
  expect(readWavDuration('/nonexistent/path/file.wav')).toBeNull();
});

test('returns null for a buffer shorter than 44 bytes', () => {
  const p = writeTmp(Buffer.alloc(20));
  expect(readWavDuration(p)).toBeNull();
  fs.unlinkSync(p);
});

test('returns null when RIFF magic is missing', () => {
  const buf = buildWav(176400, 176400);
  buf.write('XXXX', 0, 'ascii');
  const p = writeTmp(buf);
  expect(readWavDuration(p)).toBeNull();
  fs.unlinkSync(p);
});

test('returns null when WAVE magic is missing', () => {
  const buf = buildWav(176400, 176400);
  buf.write('XXXX', 8, 'ascii');
  const p = writeTmp(buf);
  expect(readWavDuration(p)).toBeNull();
  fs.unlinkSync(p);
});

test('returns null when byteRate is zero', () => {
  const buf = buildWav(176400, 176400);
  buf.writeUInt32LE(0, 28); // overwrite byteRate with 0
  const p = writeTmp(buf);
  expect(readWavDuration(p)).toBeNull();
  fs.unlinkSync(p);
});

test('returns null when no data chunk is present', () => {
  // Replace "data" chunk id with "junk"
  const buf = buildWav(176400, 176400);
  buf.write('junk', 36, 'ascii');
  const p = writeTmp(buf);
  expect(readWavDuration(p)).toBeNull();
  fs.unlinkSync(p);
});

// Verify the new list-audio shape: { filename, duration } objects
test('pipeline:list-audio shape: filename is preserved, duration is a number or null', () => {
  // Simulate what the IPC handler now returns
  const byteRate = 176400;
  const dataSize = byteRate * 5;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-list-test-'));
  const wavPath = path.join(tmpDir, 'test.wav');
  fs.writeFileSync(wavPath, buildWav(byteRate, dataSize));

  const files = fs.readdirSync(tmpDir)
    .filter(f => f.toLowerCase().endsWith('.wav'))
    .map(filename => ({
      filename,
      duration: readWavDuration(path.join(tmpDir, filename)),
    }));

  expect(files).toHaveLength(1);
  expect(files[0].filename).toBe('test.wav');
  expect(files[0].duration).toBe(5);

  fs.unlinkSync(wavPath);
  fs.rmdirSync(tmpDir);
});
