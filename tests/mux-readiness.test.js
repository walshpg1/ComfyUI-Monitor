'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  scanAudioDir,
  getStableLatestAudio,
  computeMuxStatus,
  isAudioFile,
  AUDIO_EXTENSIONS,
} = require('../mux-readiness');

// ── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mux-test-'));
}

function writeFile(dir, name, content = 'x') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

function rmDir(dir) {
  fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
  fs.rmdirSync(dir);
}

function backdate(filePath, ms) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(filePath, t, t);
}

// ── isAudioFile ────────────────────────────────────────────────────────────

test('isAudioFile returns true for known audio extensions', () => {
  for (const ext of AUDIO_EXTENSIONS) {
    expect(isAudioFile(`track${ext}`)).toBe(true);
    expect(isAudioFile(`TRACK${ext.toUpperCase()}`)).toBe(true);
  }
});

test('isAudioFile returns false for non-audio extensions', () => {
  for (const name of ['video.mp4', 'image.png', 'doc.txt', 'file.mp3']) {
    expect(isAudioFile(name)).toBe(false);
  }
});

// ── scanAudioDir ──────────────────────────────────────────────────────────

test('scanAudioDir returns empty array for an empty directory', () => {
  const dir = makeTmpDir();
  expect(scanAudioDir(dir)).toEqual([]);
  rmDir(dir);
});

test('scanAudioDir returns empty array for a non-existent directory', () => {
  expect(scanAudioDir('/no/such/path/xyz')).toEqual([]);
});

test('scanAudioDir includes .wav files with non-zero size', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'track.wav', 'data');
  const results = scanAudioDir(dir);
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('track.wav');
  expect(results[0].size).toBeGreaterThan(0);
  rmDir(dir);
});

test('scanAudioDir ignores zero-byte files', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'empty.wav', '');
  expect(scanAudioDir(dir)).toHaveLength(0);
  rmDir(dir);
});

test('scanAudioDir ignores non-audio files', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'video.mp4', 'x');
  writeFile(dir, 'image.png', 'x');
  writeFile(dir, 'track.wav', 'x');
  const results = scanAudioDir(dir);
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('track.wav');
  rmDir(dir);
});

test('scanAudioDir sorts newest first by mtime', () => {
  const dir = makeTmpDir();
  const older = writeFile(dir, 'older.wav', 'x');
  const newer = writeFile(dir, 'newer.wav', 'x');
  backdate(older, 10000);
  const results = scanAudioDir(dir);
  expect(results[0].name).toBe('newer.wav');
  expect(results[1].name).toBe('older.wav');
  rmDir(dir);
});

// ── getStableLatestAudio ──────────────────────────────────────────────────

test('returns null when prevSizes is empty (first poll)', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'track.wav', 'x');
  backdate(path.join(dir, 'track.wav'), 10000);
  expect(getStableLatestAudio(dir, new Map())).toBeNull();
  rmDir(dir);
});

test('returns null when file size changed between polls', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'track.wav', 'hello');
  backdate(p, 10000);
  const prevSizes = new Map([[p, 3]]); // size was 3, now 5 → unstable
  expect(getStableLatestAudio(dir, prevSizes)).toBeNull();
  rmDir(dir);
});

test('returns null when file was recently modified (within stability window)', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'track.wav', 'data');
  // mtime is NOW — too recent
  const stat = fs.statSync(p);
  const prevSizes = new Map([[p, stat.size]]);
  expect(getStableLatestAudio(dir, prevSizes)).toBeNull();
  rmDir(dir);
});

test('returns the file when size is stable and mtime is old enough', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'track.wav', 'data');
  backdate(p, 10000);
  const stat = fs.statSync(p);
  const prevSizes = new Map([[p, stat.size]]);
  const result = getStableLatestAudio(dir, prevSizes);
  expect(result).not.toBeNull();
  expect(result.name).toBe('track.wav');
  rmDir(dir);
});

test('returned entry includes a duration field (null for non-RIFF content)', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'track.wav', 'not-a-riff-header');
  backdate(p, 10000);
  const stat = fs.statSync(p);
  const result = getStableLatestAudio(dir, new Map([[p, stat.size]]));
  expect(result).not.toBeNull();
  expect(result).toHaveProperty('duration');
  // Non-RIFF content → readWavDuration returns null
  expect(result.duration).toBeNull();
  rmDir(dir);
});

test('returns newest stable audio when multiple exist', () => {
  const dir = makeTmpDir();
  const older = writeFile(dir, 'older.wav', 'data');
  const newer = writeFile(dir, 'newer.wav', 'data');
  backdate(older, 20000);
  backdate(newer, 10000);
  const prevSizes = new Map([
    [older, fs.statSync(older).size],
    [newer, fs.statSync(newer).size],
  ]);
  const result = getStableLatestAudio(dir, prevSizes);
  expect(result.name).toBe('newer.wav');
  rmDir(dir);
});

// ── computeMuxStatus ──────────────────────────────────────────────────────

const fakeRender = { name: 'video.mp4', path: '/r/video.mp4', mtime: 0 };
const fakeAudio  = { name: 'audio.wav', path: '/a/audio.wav', mtime: 0 };

test('READY when both render and audio are stable', () => {
  expect(computeMuxStatus(fakeRender, fakeAudio, 1, 1)).toBe('READY');
});

test('WAITING_RENDER when no render candidates at all', () => {
  expect(computeMuxStatus(null, null, 0, 0)).toBe('WAITING_RENDER');
});

test('WAITING_RENDER when no render candidates and audio is stable', () => {
  expect(computeMuxStatus(null, fakeAudio, 0, 1)).toBe('WAITING_RENDER');
});

test('WAITING_AUDIO when render stable but no audio candidates', () => {
  expect(computeMuxStatus(fakeRender, null, 1, 0)).toBe('WAITING_AUDIO');
});

test('PROCESSING when render candidates exist but none stable', () => {
  expect(computeMuxStatus(null, null, 1, 0)).toBe('PROCESSING');
});

test('PROCESSING when audio candidates exist but none stable', () => {
  expect(computeMuxStatus(fakeRender, null, 1, 1)).toBe('PROCESSING');
});

test('PROCESSING when both have candidates but neither stable', () => {
  expect(computeMuxStatus(null, null, 2, 3)).toBe('PROCESSING');
});

test('PROCESSING when render unstable even though audio is stable', () => {
  expect(computeMuxStatus(null, fakeAudio, 1, 1)).toBe('PROCESSING');
});
