'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const RENDERS_DIR   = 'D:\\AIStudio\\Apps\\AIVideoStudio\\renders\\video';
const FRAMES_DIR    = 'D:\\AIStudio\\Apps\\AIVideoStudio\\frames';
const PROCESSED_DIR = 'D:\\AIStudio\\Apps\\AIVideoStudio\\renders\\processed';

const FFMPEG_CANDIDATES = [
  'C:\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe',
  'ffmpeg',
  'C:\\AI\\ComfyAI\\ComfyUI_windows_portable\\python_embeded\\Lib\\site-packages\\imageio_ffmpeg\\binaries\\ffmpeg-win-x86_64-v7.1.exe',
];

function findFfmpeg(candidates = FFMPEG_CANDIDATES) {
  return new Promise((resolve, reject) => {
    const tryNext = (i) => {
      if (i >= candidates.length) return reject(new Error('ffmpeg not found'));
      execFile(candidates[i], ['-version'], (err) => {
        if (err) tryNext(i + 1);
        else resolve(candidates[i]);
      });
    };
    tryNext(0);
  });
}

function findLatestRender(dir = RENDERS_DIR) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp4'))
    .map(f => ({ full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error(`No .mp4 files found in ${dir}`);
  return files[0].full;
}

function outputPath(videoPath, dir, suffix, ext) {
  const stem = path.basename(videoPath, '.mp4');
  return path.join(dir, `${stem}_${suffix}${ext}`);
}

function execFfmpeg(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// ── Frame extraction ────────────────────────────────────────────────────────

async function extractLastFrame(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, FRAMES_DIR, 'last_frame', '.png');
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-sseof', '-1', '-i', video, '-vframes', '1', out]);
  return { ok: true, path: out };
}

async function extractFirstFrame(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, FRAMES_DIR, 'first_frame', '.png');
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-i', video, '-vframes', '1', out]);
  return { ok: true, path: out };
}

async function extractFrameAtTime(ffmpeg, seconds, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, FRAMES_DIR, `at_${seconds}s`, '.png');
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-ss', String(seconds), '-i', video, '-vframes', '1', out]);
  return { ok: true, path: out };
}

// ── Video variants ──────────────────────────────────────────────────────────

async function reverseVideo(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, PROCESSED_DIR, 'reversed', '.mp4');
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-i', video, '-vf', 'reverse', '-an', out]);
  return { ok: true, path: out };
}

async function boomerang(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, PROCESSED_DIR, 'boomerang', '.mp4');
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, [
    '-y', '-i', video,
    '-filter_complex', '[0:v]reverse[r];[0:v][r]concat=n=2:v=1[v]',
    '-map', '[v]', '-an', out,
  ]);
  return { ok: true, path: out };
}

async function speed2x(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, PROCESSED_DIR, '2x', '.mp4');
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-i', video, '-vf', 'setpts=0.5*PTS', '-an', out]);
  return { ok: true, path: out };
}

async function slowMotion(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, PROCESSED_DIR, 'slow', '.mp4');
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-i', video, '-vf', 'setpts=2.0*PTS', '-an', out]);
  return { ok: true, path: out };
}

// ── Export ──────────────────────────────────────────────────────────────────

async function toGif(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const stem = path.basename(video, '.mp4');
  const out = path.join(PROCESSED_DIR, `${stem}.gif`);
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, [
    '-y', '-i', video,
    '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
    out,
  ]);
  return { ok: true, path: out };
}

async function toWebp(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const stem = path.basename(video, '.mp4');
  const out = path.join(PROCESSED_DIR, `${stem}.webp`);
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, ['-y', '-i', video, '-vf', 'fps=15,scale=480:-1', '-loop', '0', out]);
  return { ok: true, path: out };
}

async function recompress(ffmpeg, videoOverride) {
  const video = videoOverride || findLatestRender();
  const out = outputPath(video, PROCESSED_DIR, 'compressed', '.mp4');
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  await execFfmpeg(ffmpeg, [
    '-y', '-i', video,
    '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-c:a', 'copy',
    out,
  ]);
  return { ok: true, path: out };
}

// ── Info & utility ──────────────────────────────────────────────────────────

async function videoInfo(ffmpegPath, videoOverride) {
  const video = videoOverride || findLatestRender();
  const ffprobeDir = path.dirname(ffmpegPath);
  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const ffprobePath = path.basename(ffmpegPath).startsWith('ffmpeg')
    ? path.join(ffprobeDir, ffprobeName)
    : 'ffprobe';

  const stdout = await new Promise((resolve, reject) => {
    execFile(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_streams', video,
    ], (err, out) => {
      if (err) reject(new Error(`ffprobe failed: ${err.message}`));
      else resolve(out);
    });
  });

  const data = JSON.parse(stdout);
  const vs = data.streams.find(s => s.codec_type === 'video') || {};
  const [num, den] = (vs.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = den ? (num / den).toFixed(2) : '?';

  return {
    ok: true,
    info: {
      filename: path.basename(video),
      resolution: vs.width ? `${vs.width}×${vs.height}` : '?',
      fps,
      duration: data.format.duration ? parseFloat(data.format.duration).toFixed(2) + 's' : '?',
      codec: vs.codec_name || '?',
      size: data.format.size ? (data.format.size / 1048576).toFixed(1) + ' MB' : '?',
    },
  };
}

function openInExplorer(videoOverride) {
  const video = videoOverride || findLatestRender();
  return path.dirname(video);
}

function copyPath(videoOverride) {
  const video = videoOverride || findLatestRender();
  return video;
}

module.exports = {
  findFfmpeg, findLatestRender, outputPath, execFfmpeg,
  extractLastFrame, extractFirstFrame, extractFrameAtTime,
  reverseVideo, boomerang, speed2x, slowMotion,
  toGif, toWebp, recompress,
  videoInfo, openInExplorer, copyPath,
  RENDERS_DIR, FRAMES_DIR, PROCESSED_DIR, FFMPEG_CANDIDATES,
};
