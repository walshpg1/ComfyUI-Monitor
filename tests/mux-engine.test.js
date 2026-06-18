'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { scanClipSets, scanClipsInSet, getDurationWarning, buildMuxOutputPath } = require('../mux-engine');

// ── helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mux-engine-test-'));
}

// Builds a minimal valid WAV buffer (44-byte header, no PCM payload bytes)
function buildWav(byteRate, dataChunkSize) {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataChunkSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(byteRate / 4, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataChunkSize, 40);
  return buf;
}

// ── scanClipSets ─────────────────────────────────────────────────────────────

describe('scanClipSets', () => {
  let base;
  beforeEach(() => { base = tmpDir(); });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  test('returns [] for empty directory', () => {
    expect(scanClipSets(base)).toEqual([]);
  });

  test('returns [] for non-existent directory', () => {
    expect(scanClipSets(path.join(base, 'does-not-exist'))).toEqual([]);
  });

  test('finds subdirs ending in _clips', () => {
    fs.mkdirSync(path.join(base, 'song_one_clips'));
    fs.mkdirSync(path.join(base, 'song_two_clips'));
    const result = scanClipSets(base);
    const names = result.map(r => r.name);
    expect(names).toContain('song_one_clips');
    expect(names).toContain('song_two_clips');
  });

  test('ignores subdirs not ending in _clips', () => {
    fs.mkdirSync(path.join(base, 'song_clips_extra'));
    fs.mkdirSync(path.join(base, 'not_a_clip_set'));
    fs.writeFileSync(path.join(base, 'also_clips'), 'file, not dir');
    const result = scanClipSets(base);
    expect(result).toHaveLength(0);
  });

  test('result entries have name and path', () => {
    fs.mkdirSync(path.join(base, 'track_clips'));
    const result = scanClipSets(base);
    expect(result[0].name).toBe('track_clips');
    expect(result[0].path).toBe(path.join(base, 'track_clips'));
  });

  test('sorts newest-first by mtime', () => {
    const dir1 = path.join(base, 'alpha_clips');
    const dir2 = path.join(base, 'beta_clips');
    fs.mkdirSync(dir1);
    // Small delay so mtimes differ
    fs.mkdirSync(dir2);
    // Touch dir2 to ensure it has a newer mtime
    const now = new Date();
    fs.utimesSync(dir2, now, now);
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(dir1, old, old);
    const result = scanClipSets(base);
    expect(result[0].name).toBe('beta_clips');
  });
});

// ── scanClipsInSet ───────────────────────────────────────────────────────────

describe('scanClipsInSet', () => {
  let base;
  beforeEach(() => { base = tmpDir(); });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  test('returns [] for empty directory', () => {
    expect(scanClipsInSet(base)).toEqual([]);
  });

  test('returns [] for non-existent directory', () => {
    expect(scanClipsInSet(path.join(base, 'nope'))).toEqual([]);
  });

  test('lists WAV files with duration', () => {
    const wav = buildWav(176400, 176400); // 1 second at 44100Hz stereo 16-bit
    fs.writeFileSync(path.join(base, 'clip_01.wav'), wav);
    const result = scanClipsInSet(base);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('clip_01.wav');
    expect(result[0].duration).toBe(1);
  });

  test('ignores non-WAV files', () => {
    fs.writeFileSync(path.join(base, 'readme.txt'), 'hi');
    fs.writeFileSync(path.join(base, 'track.mp3'), Buffer.alloc(100));
    expect(scanClipsInSet(base)).toHaveLength(0);
  });

  test('excludes zero-byte WAV files', () => {
    fs.writeFileSync(path.join(base, 'empty.wav'), Buffer.alloc(0));
    expect(scanClipsInSet(base)).toHaveLength(0);
  });

  test('sorts by filename (natural order)', () => {
    const wav = buildWav(176400, 176400);
    fs.writeFileSync(path.join(base, 'clip_03.wav'), wav);
    fs.writeFileSync(path.join(base, 'clip_01.wav'), wav);
    fs.writeFileSync(path.join(base, 'clip_02.wav'), wav);
    const result = scanClipsInSet(base);
    expect(result.map(r => r.name)).toEqual(['clip_01.wav', 'clip_02.wav', 'clip_03.wav']);
  });

  test('null duration for invalid WAV header', () => {
    fs.writeFileSync(path.join(base, 'bad.wav'), Buffer.from('not-a-wav-file'));
    const result = scanClipsInSet(base);
    expect(result).toHaveLength(1);
    expect(result[0].duration).toBeNull();
  });
});

// ── getDurationWarning ───────────────────────────────────────────────────────

describe('getDurationWarning', () => {
  test('returns none when both durations are null', () => {
    expect(getDurationWarning(null, null).level).toBe('none');
  });

  test('returns none when one duration is null', () => {
    expect(getDurationWarning(10, null).level).toBe('none');
    expect(getDurationWarning(null, 10).level).toBe('none');
  });

  test('returns none when diff ≤ 0.5s', () => {
    expect(getDurationWarning(10, 10).level).toBe('none');
    expect(getDurationWarning(10, 10.5).level).toBe('none');
    expect(getDurationWarning(10.5, 10).level).toBe('none');
  });

  test('returns yellow when diff 0.5–2s (exclusive)', () => {
    const r = getDurationWarning(10, 11.5);
    expect(r.level).toBe('yellow');
    expect(r.message).toContain('1.5s');
  });

  test('returns orange when diff > 2s', () => {
    const r = getDurationWarning(10, 15);
    expect(r.level).toBe('orange');
    expect(r.message).toContain('5.0s');
  });

  test('message identifies which is shorter — audio shorter than video', () => {
    const r = getDurationWarning(10, 7);
    expect(r.message).toMatch(/Audio clip/);
    expect(r.message).toMatch(/video/);
  });

  test('message identifies which is shorter — video shorter than audio', () => {
    const r = getDurationWarning(7, 10);
    expect(r.message).toMatch(/Video/);
    expect(r.message).toMatch(/audio clip/);
  });

  test('boundary at exactly 2s diff is yellow', () => {
    expect(getDurationWarning(10, 12).level).toBe('yellow');
  });

  test('boundary at 2.1s diff is orange', () => {
    expect(getDurationWarning(10, 12.1).level).toBe('orange');
  });
});

// ── buildMuxOutputPath ───────────────────────────────────────────────────────

describe('buildMuxOutputPath', () => {
  let base;
  beforeEach(() => { base = tmpDir(); });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  test('returns base name when no collision', () => {
    const result = buildMuxOutputPath(base, 'video', 'audio');
    expect(result).toBe(path.join(base, 'video_muxed_audio.mp4'));
  });

  test('returns _2 variant when base collides', () => {
    fs.writeFileSync(path.join(base, 'video_muxed_audio.mp4'), '');
    const result = buildMuxOutputPath(base, 'video', 'audio');
    expect(result).toBe(path.join(base, 'video_muxed_audio_2.mp4'));
  });

  test('increments past existing numbered variants', () => {
    fs.writeFileSync(path.join(base, 'video_muxed_audio.mp4'), '');
    fs.writeFileSync(path.join(base, 'video_muxed_audio_2.mp4'), '');
    fs.writeFileSync(path.join(base, 'video_muxed_audio_3.mp4'), '');
    const result = buildMuxOutputPath(base, 'video', 'audio');
    expect(result).toBe(path.join(base, 'video_muxed_audio_4.mp4'));
  });

  test('uses stems in filename', () => {
    const result = buildMuxOutputPath(base, 'my-video', 'my-audio');
    expect(path.basename(result)).toBe('my-video_muxed_my-audio.mp4');
  });
});
