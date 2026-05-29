const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'comfyui:connected',
  'comfyui:disconnected',
  'comfyui:run-start',
  'comfyui:progress',
  'comfyui:run-complete',
  'comfyui:error',
  'comfyui:explanation-chunk',
  'comfyui:history'
];

contextBridge.exposeInMainWorld('comfyMonitor', {
  onEvent(callback) {
    CHANNELS.forEach(ch => {
      ipcRenderer.on(ch, (_event, data) => callback(ch, data));
    });
  },
  copyError:    () => ipcRenderer.invoke('copy-last-error'),
  clearHistory: () => ipcRenderer.invoke('clear-history')
});
