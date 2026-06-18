'use strict';
const fs   = require('fs');
const path = require('path');
const { readWavDuration } = require('./wav-utils');

const AUDIO_EXTENSIONS = ['.wav'];
// Must match pipeline.js STABLE_DELTA_MS — both sides agree on what "stable" means
const STABLE_DELTA_MS  = 7000;

function isAudioFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return AUDIO_EXTENSIONS.includes(ext);
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

/**
 * Returns audio candidates sorted newest-first, filtering zero-byte files.
 * Does NOT apply stability filtering.
 */
function scanAudioDir(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(isAudioFile)
      .map(f => {
        const full = path.join(dir, f);
        const stat = safeStat(full);
        if (!stat || stat.size === 0) return null;
        return { name: f, path: full, size: stat.size, mtime: stat.mtime.getTime() };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/**
 * Returns the newest audio file whose size is stable (unchanged since the
 * previous poll snapshot) and whose mtime is older than STABLE_DELTA_MS.
 * Attaches `duration` (seconds from RIFF header) to the returned entry.
 *
 * prevSizes: Map<absolutePath, number>
 */
function getStableLatestAudio(dir, prevSizes) {
  const candidates = scanAudioDir(dir);
  const now = Date.now();
  for (const entry of candidates) {
    const prev = prevSizes.get(entry.path);
    if (prev !== undefined && prev === entry.size && now - entry.mtime >= STABLE_DELTA_MS) {
      return { ...entry, duration: readWavDuration(entry.path) };
    }
  }
  return null;
}

/**
 * Computes the mux readiness status string.
 *
 * @param {object|null} stableRender      — result of getStableLatestRender, or null
 * @param {object|null} stableAudio       — result of getStableLatestAudio, or null
 * @param {number}      renderCandidates  — count of non-zero-byte video candidates
 * @param {number}      audioCandidates   — count of non-zero-byte audio candidates
 * @returns {'READY'|'WAITING_RENDER'|'WAITING_AUDIO'|'PROCESSING'}
 */
function computeMuxStatus(stableRender, stableAudio, renderCandidates, audioCandidates) {
  if (stableRender && stableAudio) return 'READY';

  const renderProcessing = !stableRender && renderCandidates > 0;
  const audioProcessing  = !stableAudio  && audioCandidates  > 0;
  if (renderProcessing || audioProcessing) return 'PROCESSING';

  if (!stableRender) return 'WAITING_RENDER';
  return 'WAITING_AUDIO';
}

module.exports = {
  scanAudioDir,
  getStableLatestAudio,
  computeMuxStatus,
  isAudioFile,
  AUDIO_EXTENSIONS,
  STABLE_DELTA_MS,
};
