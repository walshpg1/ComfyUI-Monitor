'use strict';
const fs   = require('fs');
const path = require('path');
const { scanAudioDir, getStableLatestAudio, computeMuxStatus } = require('./mux-readiness');

const PIPELINE_BASE   = 'D:\\AIStudio\\Pipeline';
const JOBS_DIR        = path.join(PIPELINE_BASE, 'jobs');
const VIDEO_RAW_DIR   = 'D:\\AIStudio\\Outputs\\video\\raw';
const MUX_AUDIO_DIR   = 'D:\\AIStudio\\Pipeline\\staging\\audio_ready';

// Video extensions to scan — add .webm or .mov here to include them
const VIDEO_EXTENSIONS = ['.mp4'];

const POLL_INTERVAL_MS  = 7000;  // poll every 7 seconds
const STABLE_DELTA_MS   = 7000;  // must not be modified within this window to be stable

function isVideoFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch { return null; }
}

function readJobs(subdir) {
  const dir = path.join(JOBS_DIR, subdir);
  return safeReaddir(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const full = path.join(dir, f);
      try {
        const data  = JSON.parse(fs.readFileSync(full, 'utf8'));
        const mtime = fs.statSync(full).mtime.getTime();
        return { name: f, mtime, ...data };
      } catch { return null; }
    })
    .filter(Boolean);
}

function readJobsState() {
  const processing = readJobs('processing');
  const completed  = readJobs('completed')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 5);
  const failed     = readJobs('failed')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 10);
  return { processing, completed, failed };
}

/**
 * Returns candidates sorted newest-first, filtering out zero-byte files.
 * Does NOT apply stability filtering — callers that need stable files do that.
 */
function scanVideoDir(dir) {
  return safeReaddir(dir)
    .filter(isVideoFile)
    .map(f => {
      const full = path.join(dir, f);
      const stat = safeStat(full);
      if (!stat || stat.size === 0) return null;
      return { name: f, path: full, size: stat.size, mtime: stat.mtime.getTime() };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Returns the newest video file whose size is stable (unchanged since the
 * previous poll snapshot), or null if none qualifies.
 *
 * prevSizes: Map<absolutePath, number>  — sizes from the prior scan
 */
function getStableLatestRender(dir, prevSizes) {
  const candidates = scanVideoDir(dir);
  const now = Date.now();
  for (const entry of candidates) {
    const prev = prevSizes.get(entry.path);
    // File must have been seen before AND its size must be unchanged AND
    // it must not have been modified within the stability window.
    if (prev !== undefined && prev === entry.size && now - entry.mtime >= STABLE_DELTA_MS) {
      return entry;
    }
  }
  return null;
}

function startPipelineWatch(send) {
  const watchers = [];

  // ── Jobs watcher ───────────────────────────────────────────────────────────

  const sendJobs = () => {
    try { send('pipeline:jobs-update', readJobsState()); } catch {}
  };

  try {
    const w = fs.watch(JOBS_DIR, { recursive: true }, () => sendJobs());
    watchers.push(w);
  } catch (e) {
    console.warn('[pipeline] Could not watch jobs dir:', e.message);
  }

  sendJobs();

  // ── Render + Mux poller ────────────────────────────────────────────────────
  // Strategy:
  //   1. Poll every POLL_INTERVAL_MS.
  //   2. Keep size-snapshots from the previous poll; only promote a file to
  //      "latest" once its size is stable across two consecutive polls
  //      and its mtime is older than STABLE_DELTA_MS.
  //   3. fs.watch fires sendRenderPoll immediately on any dir change so the
  //      UI updates promptly for fast-completing files.
  //   4. Track the last values sent to avoid redundant re-emissions.

  let prevRenderSizes = new Map();
  let prevAudioSizes  = new Map();
  let lastSentRenderPath = null;
  let lastSentMuxKey     = null;  // "renderPath|audioPath|status" dedup key

  const buildMuxKey = (render, audio, status) =>
    `${render?.path ?? ''}|${audio?.path ?? ''}|${status}`;

  const sendMuxUpdate = (stableRender, stableAudio, renderCandidates, audioCandidates) => {
    const status = computeMuxStatus(stableRender, stableAudio, renderCandidates, audioCandidates);
    const key    = buildMuxKey(stableRender, stableAudio, status);
    if (key === lastSentMuxKey) return;
    lastSentMuxKey = key;
    send('pipeline:mux-update', {
      status,
      render: stableRender
        ? { name: stableRender.name, path: stableRender.path, mtime: stableRender.mtime }
        : null,
      audio: stableAudio
        ? { name: stableAudio.name, path: stableAudio.path,
            mtime: stableAudio.mtime, duration: stableAudio.duration }
        : null,
    });
  };

  const sendRenderPoll = () => {
    try {
      const renderCandidates = scanVideoDir(VIDEO_RAW_DIR);
      const audioCandidates  = scanAudioDir(MUX_AUDIO_DIR);

      const currentRenderSizes = new Map(renderCandidates.map(c => [c.path, c.size]));
      const currentAudioSizes  = new Map(audioCandidates.map(c  => [c.path, c.size]));

      const stableRender = getStableLatestRender(VIDEO_RAW_DIR, prevRenderSizes);
      const stableAudio  = getStableLatestAudio(MUX_AUDIO_DIR, prevAudioSizes);

      prevRenderSizes = currentRenderSizes;
      prevAudioSizes  = currentAudioSizes;

      if (stableRender && stableRender.path !== lastSentRenderPath) {
        lastSentRenderPath = stableRender.path;
        send('pipeline:render-ready', {
          name: stableRender.name, path: stableRender.path, mtime: stableRender.mtime,
        });
      }

      sendMuxUpdate(stableRender, stableAudio, renderCandidates.length, audioCandidates.length);
    } catch (err) {
      console.warn('[pipeline] poll error:', err.message);
    }
  };

  // Startup scan — files already on disk bypass the stability gate (mtime is old enough).
  // We seed prevSizes so the next scheduled poll can compare sizes.
  const sendStartup = () => {
    try {
      const renderCandidates = scanVideoDir(VIDEO_RAW_DIR);
      const audioCandidates  = scanAudioDir(MUX_AUDIO_DIR);

      prevRenderSizes = new Map(renderCandidates.map(c => [c.path, c.size]));
      prevAudioSizes  = new Map(audioCandidates.map(c  => [c.path, c.size]));

      const now = Date.now();

      const stableRender = renderCandidates.find(c => now - c.mtime >= STABLE_DELTA_MS) ?? null;
      const stableAudio  = (() => {
        const a = audioCandidates.find(c => now - c.mtime >= STABLE_DELTA_MS);
        if (!a) return null;
        const { readWavDuration } = require('./wav-utils');
        return { ...a, duration: readWavDuration(a.path) };
      })();

      if (stableRender) {
        lastSentRenderPath = stableRender.path;
        send('pipeline:render-ready', {
          name: stableRender.name, path: stableRender.path, mtime: stableRender.mtime,
        });
      }

      // Always emit mux state on startup (no dedup — first emission)
      const status = computeMuxStatus(
        stableRender, stableAudio, renderCandidates.length, audioCandidates.length,
      );
      lastSentMuxKey = buildMuxKey(stableRender, stableAudio, status);
      send('pipeline:mux-update', {
        status,
        render: stableRender
          ? { name: stableRender.name, path: stableRender.path, mtime: stableRender.mtime }
          : null,
        audio: stableAudio
          ? { name: stableAudio.name, path: stableAudio.path,
              mtime: stableAudio.mtime, duration: stableAudio.duration }
          : null,
      });
    } catch (err) {
      console.warn('[pipeline] startup scan error:', err.message);
    }
  };

  sendStartup();

  // fs.watch for prompt detection of new/changed files
  try {
    const w = fs.watch(VIDEO_RAW_DIR, () => sendRenderPoll());
    watchers.push(w);
  } catch (e) {
    console.warn('[pipeline] Could not watch video_raw dir:', e.message);
  }

  try {
    const w = fs.watch(MUX_AUDIO_DIR, () => sendRenderPoll());
    watchers.push(w);
  } catch (e) {
    console.warn('[pipeline] Could not watch audio_ready dir:', e.message);
  }

  // Polling as fallback / recovery
  const pollTimer = setInterval(sendRenderPoll, POLL_INTERVAL_MS);

  return {
    close: () => {
      clearInterval(pollTimer);
      watchers.forEach(w => { try { w.close(); } catch {} });
    },
  };
}

module.exports = {
  startPipelineWatch,
  // Exported for tests
  scanVideoDir,
  getStableLatestRender,
  isVideoFile,
  VIDEO_EXTENSIONS,
};
