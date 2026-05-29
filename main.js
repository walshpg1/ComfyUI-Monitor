require('dotenv').config();
const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const { connectToComfyUI } = require('./comfyui-ws');
const { explainError } = require('./ai-explainer');
const store = require('./store');

const WS_URL   = process.env.COMFYUI_WS_URL || 'ws://localhost:8188/ws';
const API_KEY  = process.env.ANTHROPIC_API_KEY || null;

let mainWindow;
let lastError  = null;
let connection = null;

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

  mainWindow.webContents.once('did-finish-load', () => {
    const history = store.loadHistory();
    send('comfyui:history', { entries: history });

    connection = connectToComfyUI(WS_URL, (event) => {
      switch (event.type) {
        case 'connected':
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
