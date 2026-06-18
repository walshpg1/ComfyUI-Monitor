'use strict';
const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { readWavDuration } = require('./wav-utils');

/**
 * Scans baseDir for immediate subdirectories whose names end with '_clips'.
 * Returns [ { name, path } ] sorted newest-first by mtime.
 */
function scanClipSets(baseDir) {
  try {
    return fs.readdirSync(baseDir)
      .map(name => {
        if (!name.endsWith('_clips')) return null;
        const full = path.join(baseDir, name);
        try {
          const stat = fs.statSync(full);
          if (!stat.isDirectory()) return null;
          return { name, path: full, mtime: stat.mtime.getTime() };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/**
 * Lists WAV files inside clipSetPath with their RIFF durations.
 * Returns [ { name, path, duration } ] sorted by filename (natural order).
 * Zero-byte files are excluded.
 */
function scanClipsInSet(clipSetPath) {
  try {
    return fs.readdirSync(clipSetPath)
      .filter(f => path.extname(f).toLowerCase() === '.wav')
      .map(f => {
        const full = path.join(clipSetPath, f);
        try {
          const stat = fs.statSync(full);
          if (!stat || stat.size === 0) return null;
          return { name: f, path: full, duration: readWavDuration(full) };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Returns a duration compatibility warning object.
 * Both durations may be null (unknown) — returns level:'none' in that case.
 * @returns {{ level: 'none'|'yellow'|'orange', message: string }}
 */
function getDurationWarning(videoDuration, audioDuration) {
  if (videoDuration == null || audioDuration == null) {
    return { level: 'none', message: '' };
  }
  const diff = Math.abs(videoDuration - audioDuration);
  if (diff <= 0.5) return { level: 'none', message: '' };
  const shorter = audioDuration < videoDuration ? 'Audio clip' : 'Video';
  const longer  = audioDuration < videoDuration ? 'video'      : 'audio clip';
  const msg = `${shorter} is ${diff.toFixed(1)}s shorter than ${longer}`;
  return { level: diff <= 2 ? 'yellow' : 'orange', message: msg };
}

/**
 * Returns a collision-safe output file path.
 * Base name: {videoStem}_muxed_{audioStem}.mp4
 * If that exists, appends _2, _3, … up to _99, then falls back to a timestamp.
 */
function buildMuxOutputPath(outputDir, videoStem, audioStem) {
  const base      = `${videoStem}_muxed_${audioStem}`;
  const candidate = path.join(outputDir, `${base}.mp4`);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 2; i <= 99; i++) {
    const p = path.join(outputDir, `${base}_${i}.mp4`);
    if (!fs.existsSync(p)) return p;
  }
  return path.join(outputDir, `${base}_${Date.now()}.mp4`);
}

/**
 * Runs ffmpeg to mux videoPath + audioPath → outputPath.
 * The output directory must already exist before calling this.
 * Resolves with outputPath on success; rejects with Error on failure.
 */
function runMux(ffmpegPath, videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-y',
      '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      outputPath,
    ], (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(0, 400)));
      else     resolve(outputPath);
    });
  });
}

module.exports = {
  scanClipSets,
  scanClipsInSet,
  getDurationWarning,
  buildMuxOutputPath,
  runMux,
};
