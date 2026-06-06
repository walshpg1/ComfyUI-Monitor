const { contextBridge, ipcRenderer } = require('electron');
const { definitions } = require('./workflows/definitions');

const CHANNELS = [
  'comfyui:connected',
  'comfyui:disconnected',
  'comfyui:run-start',
  'comfyui:progress',
  'comfyui:run-complete',
  'comfyui:error',
  'comfyui:explanation-chunk',
  'comfyui:history',
  'pipeline:jobs-update',
  'pipeline:render-ready',
];

contextBridge.exposeInMainWorld('comfyMonitor', {
  workflowDefs: definitions,
  onEvent(callback) {
    CHANNELS.forEach(ch => {
      ipcRenderer.on(ch, (_event, data) => callback(ch, data));
    });
  },
  copyError:        () => ipcRenderer.invoke('copy-last-error'),
  clearHistory:     () => ipcRenderer.invoke('clear-history'),
  runTool:          (tool, args) => ipcRenderer.invoke('tools:run', { tool, args }),
  listAudio:        ()           => ipcRenderer.invoke('pipeline:list-audio'),
  openAvatarDialog: ()           => ipcRenderer.invoke('pipeline:open-avatar-dialog'),
  submitJob:        (job)        => ipcRenderer.invoke('pipeline:submit-job', job),
});
