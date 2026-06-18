'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { scanVideoDir, getStableLatestRender, isVideoFile, VIDEO_EXTENSIONS } = require('../pipeline');

// ── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
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

// Back-date a file's mtime by setting it to (now - ms) ago
function backdate(filePath, ms) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(filePath, t, t);
}

// ── isVideoFile ────────────────────────────────────────────────────────────

test('isVideoFile returns true for known video extensions', () => {
  for (const ext of VIDEO_EXTENSIONS) {
    expect(isVideoFile(`video${ext}`)).toBe(true);
    expect(isVideoFile(`VIDEO${ext.toUpperCase()}`)).toBe(true);
  }
});

test('isVideoFile returns false for non-video extensions', () => {
  for (const name of ['audio.wav', 'image.png', 'doc.txt', 'file.mp3']) {
    expect(isVideoFile(name)).toBe(false);
  }
});

// ── scanVideoDir ──────────────────────────────────────────────────────────

test('scanVideoDir returns empty array for an empty directory', () => {
  const dir = makeTmpDir();
  expect(scanVideoDir(dir)).toEqual([]);
  rmDir(dir);
});

test('scanVideoDir returns empty array for a non-existent directory', () => {
  expect(scanVideoDir('/no/such/dir/abc')).toEqual([]);
});

test('scanVideoDir includes .mp4 files with non-zero size', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'video.mp4', 'data');
  const results = scanVideoDir(dir);
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('video.mp4');
  expect(results[0].size).toBeGreaterThan(0);
  rmDir(dir);
});

test('scanVideoDir ignores zero-byte files', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'empty.mp4', '');
  expect(scanVideoDir(dir)).toHaveLength(0);
  rmDir(dir);
});

test('scanVideoDir ignores non-video files', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'audio.wav', 'x');
  writeFile(dir, 'image.png', 'x');
  writeFile(dir, 'video.mp4', 'x');
  const results = scanVideoDir(dir);
  expect(results).toHaveLength(1);
  expect(results[0].name).toBe('video.mp4');
  rmDir(dir);
});

test('scanVideoDir sorts newest first by mtime', () => {
  const dir = makeTmpDir();
  const older = writeFile(dir, 'older.mp4', 'x');
  const newer = writeFile(dir, 'newer.mp4', 'x');
  backdate(older, 10000); // older.mp4 is 10 seconds older
  const results = scanVideoDir(dir);
  expect(results[0].name).toBe('newer.mp4');
  expect(results[1].name).toBe('older.mp4');
  rmDir(dir);
});

// ── getStableLatestRender ─────────────────────────────────────────────────

test('returns null when prevSizes is empty (first poll)', () => {
  const dir = makeTmpDir();
  writeFile(dir, 'video.mp4', 'x');
  backdate(path.join(dir, 'video.mp4'), 10000);
  expect(getStableLatestRender(dir, new Map())).toBeNull();
  rmDir(dir);
});

test('returns null when file size changed between polls', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'video.mp4', 'small');
  backdate(p, 10000);
  // prevSizes says size was 3, but it's now 5 → unstable
  const prevSizes = new Map([[p, 3]]);
  expect(getStableLatestRender(dir, prevSizes)).toBeNull();
  rmDir(dir);
});

test('returns null when file was recently modified (within stability window)', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'video.mp4', 'data');
  // mtime is NOW — too recent, not stable
  const stat = fs.statSync(p);
  const prevSizes = new Map([[p, stat.size]]);
  expect(getStableLatestRender(dir, prevSizes)).toBeNull();
  rmDir(dir);
});

test('returns the file when size is stable and mtime is old enough', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'video.mp4', 'data');
  backdate(p, 10000); // 10 seconds old, well past stability window
  const stat = fs.statSync(p);
  const prevSizes = new Map([[p, stat.size]]);
  const result = getStableLatestRender(dir, prevSizes);
  expect(result).not.toBeNull();
  expect(result.name).toBe('video.mp4');
  rmDir(dir);
});

test('returns newest stable file when multiple exist', () => {
  const dir = makeTmpDir();
  const older = writeFile(dir, 'older.mp4', 'data');
  const newer = writeFile(dir, 'newer.mp4', 'data');
  backdate(older, 20000);
  backdate(newer, 10000);
  const olderStat = fs.statSync(older);
  const newerStat = fs.statSync(newer);
  const prevSizes = new Map([
    [older, olderStat.size],
    [newer, newerStat.size],
  ]);
  const result = getStableLatestRender(dir, prevSizes);
  expect(result.name).toBe('newer.mp4');
  rmDir(dir);
});

test('ignores zero-byte files even if they appear in prevSizes', () => {
  const dir = makeTmpDir();
  const p = writeFile(dir, 'empty.mp4', '');
  backdate(p, 10000);
  const prevSizes = new Map([[p, 0]]);
  expect(getStableLatestRender(dir, prevSizes)).toBeNull();
  rmDir(dir);
});
