const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const MAX_ENTRIES = 100;
const DEFAULT_PATH = 'D:\\AIStudio\\Infrastructure\\comfyui-monitor-history.json';

function createStore(historyPath) {
  function loadHistory() {
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch {
      return [];
    }
  }

  function saveHistory(entries) {
    fs.writeFileSync(historyPath, JSON.stringify(entries, null, 2));
  }

  function addError(event) {
    const entries = loadHistory();
    const entry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      node_id: event.nodeId,
      node_type: event.nodeType,
      exception_type: event.exceptionType,
      message: event.message,
      traceback: event.traceback || [],
      explanation: null
    };
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(MAX_ENTRIES);
    saveHistory(entries);
    return entry;
  }

  function updateExplanation(id, explanation) {
    const entries = loadHistory();
    const entry = entries.find(e => e.id === id);
    if (entry) {
      entry.explanation = explanation;
      saveHistory(entries);
    }
  }

  function clearHistory() {
    saveHistory([]);
  }

  return { loadHistory, addError, updateExplanation, clearHistory };
}

module.exports = createStore(DEFAULT_PATH);
module.exports.createStore = createStore;
