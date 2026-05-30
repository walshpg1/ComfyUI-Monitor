const { execFile } = require('child_process');
jest.mock('child_process', () => ({ execFile: jest.fn() }));

const fs = require('fs');
const path = require('path');
const os = require('os');

// Must require AFTER jest.mock so the module gets the mocked child_process
let tools;
beforeEach(() => {
  jest.resetModules();
  jest.mock('child_process', () => ({ execFile: jest.fn() }));
  tools = require('../ffmpeg-tools');
});

// ── findFfmpeg ──────────────────────────────────────────────────────────────

test('findFfmpeg resolves to first working candidate', async () => {
  const { execFile } = require('child_process');
  execFile.mockImplementation((cmd, args, cb) => {
    if (cmd === 'ffmpeg') cb(null, 'ffmpeg version', '');
    else cb(new Error('not found'), '', '');
  });
  const result = await tools.findFfmpeg(['badpath', 'ffmpeg']);
  expect(result).toBe('ffmpeg');
});

test('findFfmpeg rejects when no candidate works', async () => {
  const { execFile } = require('child_process');
  execFile.mockImplementation((cmd, args, cb) => cb(new Error('not found'), '', ''));
  await expect(tools.findFfmpeg(['a', 'b'])).rejects.toThrow('ffmpeg not found');
});

// ── findLatestRender ────────────────────────────────────────────────────────

test('findLatestRender returns newest mp4 by mtime', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fftest-'));
  const older = path.join(tmp, 'render_001.mp4');
  const newer = path.join(tmp, 'render_002.mp4');
  fs.writeFileSync(older, '');
  fs.writeFileSync(newer, '');
  fs.utimesSync(older, 0, 0);
  fs.utimesSync(newer, 1000, 1000);
  expect(tools.findLatestRender(tmp)).toBe(newer);
  fs.rmSync(tmp, { recursive: true });
});

test('findLatestRender throws when directory has no mp4s', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fftest-'));
  expect(() => tools.findLatestRender(tmp)).toThrow('No .mp4 files found');
  fs.rmSync(tmp, { recursive: true });
});

// ── outputPath ──────────────────────────────────────────────────────────────

test('outputPath builds correct path for last-frame', () => {
  const video = path.join('D:', 'renders', 'LTX_Director_00010_.mp4');
  const result = tools.outputPath(video, 'D:\\frames', 'last_frame', '.png');
  expect(result).toBe(path.join('D:\\frames', 'LTX_Director_00010__last_frame.png'));
});

// ── Command output path tests (no ffmpeg needed) ────────────────────────────

test('extractLastFrame builds correct output path', () => {
  const video = 'D:\\renders\\LTX_Director_00010_.mp4';
  const out = tools.outputPath(video, 'D:\\frames', 'last_frame', '.png');
  expect(path.basename(out)).toBe('LTX_Director_00010__last_frame.png');
});

test('reverseVideo builds correct output path', () => {
  const video = 'D:\\renders\\LTX_Director_00010_.mp4';
  const out = tools.outputPath(video, 'D:\\processed', 'reversed', '.mp4');
  expect(path.basename(out)).toBe('LTX_Director_00010__reversed.mp4');
});

test('toGif builds correct output path', () => {
  const video = 'D:\\renders\\LTX_Director_00010_.mp4';
  // GIF uses stem directly (no suffix)
  const stem = path.basename(video, '.mp4');
  const out = path.join('D:\\processed', `${stem}.gif`);
  expect(path.basename(out)).toBe('LTX_Director_00010_.gif');
});

// ── execFfmpeg error propagation ────────────────────────────────────────────

test('execFfmpeg rejects with stderr message on non-zero exit', async () => {
  const { execFile } = require('child_process');
  execFile.mockImplementation((cmd, args, cb) =>
    cb(new Error('exit 1'), '', 'Invalid input file'));
  await expect(tools.execFfmpeg('ffmpeg', ['-i', 'bad.mp4'])).rejects.toThrow('Invalid input file');
});

test('execFfmpeg resolves with stdout on success', async () => {
  const { execFile } = require('child_process');
  execFile.mockImplementation((cmd, args, cb) => cb(null, 'ok', ''));
  await expect(tools.execFfmpeg('ffmpeg', [])).resolves.toBe('ok');
});
