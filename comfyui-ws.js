const WebSocket = require('ws');

function parseMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return null; }

  const { type, data } = msg;

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
      return null;

    default:
      return null;
  }
}

function connectToComfyUI(wsUrl, onEvent) {
  let ws;
  let reconnectTimer;
  let closed = false;

  function connect() {
    ws = new WebSocket(wsUrl);

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

    ws.on('error', () => {
      // close event fires after error — reconnect handled there
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
