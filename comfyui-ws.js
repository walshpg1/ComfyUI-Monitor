const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

function parseMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return null; }

  const { type, data } = msg;

  if (!data || typeof data !== 'object') return null;

  switch (type) {
    case 'status':
      return { type: 'status' };

    case 'execution_start':
      return { type: 'run-start', promptId: data.prompt_id };

    case 'progress':
      return { type: 'progress', step: data.value, total: data.max, promptId: data.prompt_id };

    case 'execution_error':
      return {
        type: 'error',
        promptId: data.prompt_id,
        nodeId: data.node_id,
        nodeType: data.node_type,
        exceptionType: data.exception_type,
        message: data.exception_message,
        traceback: data.traceback || []
      };

    case 'execution_success':
      return { type: 'run-complete', promptId: data.prompt_id };

    case 'executing':
      if (data.node === null) return { type: 'run-complete', promptId: data.prompt_id };
      // Non-null node means a specific node is executing (mid-run), not a completion signal
      return null;

    default:
      return null;
  }
}

function connectToComfyUI(wsUrl, onEvent) {
  let ws;
  let reconnectTimer;
  let closed = false;
  const clientId = uuidv4();
  const urlWithClient = `${wsUrl}?clientId=${clientId}`;

  function connect() {
    console.log('[ws] connecting to', urlWithClient);
    ws = new WebSocket(urlWithClient);

    ws.on('open', () => onEvent({ type: 'connected' }));

    ws.on('message', (data) => {
      const event = parseMessage(data.toString());
      if (event) onEvent(event);
    });

    ws.on('close', () => {
      if (closed) return;
      onEvent({ type: 'disconnected' });
      reconnectTimer = setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
      console.error('[ws] error:', err.message);
    });
  }

  connect();

  return {
    close() {
      closed = true;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    }
  };
}

module.exports = { connectToComfyUI, parseMessage };
