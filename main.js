require('dotenv').config();
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
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

const WS_URL   = process.env.COMFYUI_WS_URL || 'ws://127.0.0.1:8188/ws';
const API_KEY  = process.env.ANTHROPIC_API_KEY || null;

let mainWindow;
let lastError  = null;
let connection = null;
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
    width: 800,
    height: 520,
    backgroundColor: '#0d0d1a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
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
});

app.on('window-all-closed', () => {
  if (connection) connection.close();
  app.quit();
});
