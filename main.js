require('dotenv').config();
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { connectToComfyUI } = require('./comfyui-ws');
const { explainError } = require('./ai-explainer');
const store = require('./store');
const {
  findFfmpeg,
  extractLastFrame, extractFirstFrame, extractFrameAtTime,
  reverseVideo, boomerang, speed2x, slowMotion,
  toGif, toWebp, recompress,
  videoInfo, openInExplorer, copyPath,
  FFMPEG_CANDIDATES,
} = require('./ffmpeg-tools');
const { startPipelineWatch } = require('./pipeline');
const { readWavDuration } = require('./wav-utils');
const { scanClipSets, scanClipsInSet, buildMuxOutputPath, runMux } = require('./mux-engine');

const WS_URL   = process.env.COMFYUI_WS_URL || 'ws://127.0.0.1:8188/ws';
const API_KEY  = process.env.ANTHROPIC_API_KEY || null;

const PIPELINE_INBOX       = 'D:\\AIStudio\\Pipeline\\inbox\\job.json';
const PIPELINE_AVATARS_DIR = 'D:\\AIStudio\\Pipeline\\assets\\avatars';
const PIPELINE_AUDIO_DIR   = 'D:\\AIStudio\\Pipeline\\staging\\audio_ready';
const MASTERED_AUDIO_DIR   = 'D:\\AIStudio\\Outputs\\audio\\mastered';
const MUXED_OUTPUT_DIR     = 'D:\\AIStudio\\Outputs\\video\\muxed';

let mainWindow;
let lastError  = null;
let connection = null;
let pipelineWatcher = null;
let ffmpegPath = null;

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

async function handleError(event) {
  const entry = store.addError(event);
  lastError = entry;
  send('comfyui:error', entry);

  let fullExplanation = '';
  try {
    for await (const chunk of explainError(event, API_KEY)) {
      fullExplanation += chunk;
      send('comfyui:explanation-chunk', { id: entry.id, chunk });
    }
    store.updateExplanation(entry.id, fullExplanation);
  } catch (err) {
    const msg = `Error fetching explanation: ${err.message}`;
    send('comfyui:explanation-chunk', { id: entry.id, chunk: msg });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 520,
    backgroundColor: '#0d0d1a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[main] did-finish-load fired');
    const history = store.loadHistory();
    send('comfyui:history', { entries: history });

    connection = connectToComfyUI(WS_URL, (event) => {
      switch (event.type) {
        case 'connected':
          console.log('[main] WS connected, sending to renderer');
          send('comfyui:connected', { url: WS_URL });
          break;
        case 'disconnected':
          send('comfyui:disconnected', {});
          break;
        case 'run-start':
          send('comfyui:run-start', { promptId: event.promptId, workflowName: null });
          break;
        case 'progress':
          send('comfyui:progress', { step: event.step, total: event.total });
          break;
        case 'run-complete':
          send('comfyui:run-complete', {});
          break;
        case 'error':
          handleError(event).catch(err => {
            send('comfyui:explanation-chunk', { id: null, chunk: `Unhandled error: ${err.message}` });
          });
          break;
      }
    });

    pipelineWatcher = startPipelineWatch(send);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  findFfmpeg(FFMPEG_CANDIDATES)
    .then(p => { ffmpegPath = p; })
    .catch(() => { ffmpegPath = null; });

  ipcMain.handle('tools:run', async (_event, { tool, args = {} }) => {
    if (!ffmpegPath && !['open-folder', 'copy-path'].includes(tool)) {
      return { ok: false, error: 'ffmpeg not found. Install ffmpeg or add to PATH.' };
    }
    try {
      const videoPath = args.video || undefined;
      switch (tool) {
        case 'last-frame':    return await extractLastFrame(ffmpegPath, videoPath);
        case 'first-frame':   return await extractFirstFrame(ffmpegPath, videoPath);
        case 'frame-at-time': return await extractFrameAtTime(ffmpegPath, args.seconds, videoPath);
        case 'reverse':       return await reverseVideo(ffmpegPath, videoPath);
        case 'boomerang':     return await boomerang(ffmpegPath, videoPath);
        case 'speed-2x':      return await speed2x(ffmpegPath, videoPath);
        case 'slow':          return await slowMotion(ffmpegPath, videoPath);
        case 'to-gif':        return await toGif(ffmpegPath, videoPath);
        case 'to-webp':       return await toWebp(ffmpegPath, videoPath);
        case 'recompress':    return await recompress(ffmpegPath, videoPath);
        case 'info':          return await videoInfo(ffmpegPath, videoPath);
        case 'open-folder': {
          const dir = openInExplorer(videoPath);
          shell.openPath(dir);
          return { ok: true };
        }
        case 'copy-path': {
          const p = copyPath(videoPath);
          clipboard.writeText(p);
          return { ok: true, path: p };
        }
        default:
          return { ok: false, error: `Unknown tool: ${tool}` };
      }
    } catch (err) {
      return { ok: false, error: err.message.slice(0, 200) };
    }
  });

  ipcMain.handle('copy-last-error', () => {
    if (lastError) clipboard.writeText(JSON.stringify(lastError, null, 2));
  });

  ipcMain.handle('clear-history', () => {
    store.clearHistory();
    lastError = null;
  });

  ipcMain.handle('pipeline:list-audio', (_event, { dir, extensions }) => {
    try {
      const files = fs.readdirSync(dir)
        .filter(f => extensions.some(ext => f.toLowerCase().endsWith('.' + ext)))
        .map(filename => ({
          filename,
          duration: readWavDuration(path.join(dir, filename)),
        }));
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err.message, files: [] };
    }
  });

  ipcMain.handle('pipeline:open-avatar-dialog', async (_event, { dir, extensions }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: dir,
      filters: [{ name: 'Images', extensions }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false };
    }
    return { ok: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle('pipeline:get-thumbnail', async (_event, { videoPath }) => {
    if (!ffmpegPath) return { ok: false };
    try {
      const result = await extractFirstFrame(ffmpegPath, videoPath);
      const imgData = fs.readFileSync(result.path);
      return { ok: true, dataUri: `data:image/png;base64,${imgData.toString('base64')}` };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('pipeline:open-render', async (_event, { filePath }) => {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'File no longer exists.' };
    try {
      const errMsg = await shell.openPath(filePath);
      // shell.openPath resolves to '' on success or an error string on failure
      return errMsg ? { ok: false, error: errMsg } : { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('pipeline:reveal-render', (_event, { filePath }) => {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'File no longer exists.' };
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('mux:scan-clip-sets', () => {
    try {
      return { ok: true, clipSets: scanClipSets(MASTERED_AUDIO_DIR) };
    } catch (err) {
      return { ok: false, error: err.message, clipSets: [] };
    }
  });

  ipcMain.handle('mux:scan-clips', (_event, { clipSetPath }) => {
    try {
      return { ok: true, clips: scanClipsInSet(clipSetPath) };
    } catch (err) {
      return { ok: false, error: err.message, clips: [] };
    }
  });

  ipcMain.handle('mux:run', async (_event, { videoPath, audioPath }) => {
    if (!ffmpegPath) return { ok: false, error: 'ffmpeg not found.' };
    if (!fs.existsSync(videoPath)) return { ok: false, error: 'Video file no longer exists.' };
    if (!fs.existsSync(audioPath)) return { ok: false, error: 'Audio clip no longer exists.' };
    try {
      fs.mkdirSync(MUXED_OUTPUT_DIR, { recursive: true });
      const videoStem  = path.basename(videoPath, path.extname(videoPath));
      const audioStem  = path.basename(audioPath, path.extname(audioPath));
      const outputPath = buildMuxOutputPath(MUXED_OUTPUT_DIR, videoStem, audioStem);
      await runMux(ffmpegPath, videoPath, audioPath, outputPath);
      return { ok: true, outputPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('pipeline:submit-job', (_event, job) => {
    try {
      const { avatarPath, ...jobFields } = job;

      // Pre-copy avatar to canonical avatars folder so n8n can always find it
      if (avatarPath) {
        const destAvatar = path.join(PIPELINE_AVATARS_DIR, jobFields.avatar);
        if (path.resolve(avatarPath) !== path.resolve(destAvatar)) {
          fs.copyFileSync(avatarPath, destAvatar);
        }
      }

      // Compute WAV duration and include it so n8n can patch LoadAudioUI correctly
      const audioFile = path.join(PIPELINE_AUDIO_DIR, jobFields.audio);
      const audioDuration = readWavDuration(audioFile);

      const jobJson = { ...jobFields, ...(audioDuration !== null ? { audioDuration } : {}) };
      fs.writeFileSync(PIPELINE_INBOX, JSON.stringify(jobJson, null, 2), 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
});

app.on('window-all-closed', () => {
  if (connection) connection.close();
  if (pipelineWatcher) pipelineWatcher.close();
  app.quit();
});
