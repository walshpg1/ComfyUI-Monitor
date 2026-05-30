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

module.exports = {
  findFfmpeg, findLatestRender, outputPath, execFfmpeg,
  RENDERS_DIR, FRAMES_DIR, PROCESSED_DIR, FFMPEG_CANDIDATES,
};
