const { parseMessage } = require('../comfyui-ws');

test('status message returns status event', () => {
  const result = parseMessage(JSON.stringify({ type: 'status', data: { status: {} } }));
  expect(result).toEqual({ type: 'status' });
});

test('execution_start returns run-start with promptId', () => {
  const result = parseMessage(JSON.stringify({ type: 'execution_start', data: { prompt_id: 'abc123' } }));
  expect(result).toEqual({ type: 'run-start', promptId: 'abc123' });
});

test('progress returns step, total, and promptId', () => {
  const result = parseMessage(JSON.stringify({
    type: 'progress',
    data: { value: 3, max: 8, prompt_id: 'p1' }
  }));
  expect(result).toEqual({ type: 'progress', step: 3, total: 8, promptId: 'p1' });
});

test('execution_error returns error with all fields', () => {
  const input = {
    type: 'execution_error',
    data: {
      prompt_id: 'p1',
      node_id: '46',
      node_type: 'LTXDirector',
      exception_type: 'ValueError',
      exception_message: 'missing prompt',
      traceback: ['line1', 'line2']
    }
  };
  expect(parseMessage(JSON.stringify(input))).toEqual({
    type: 'error',
    promptId: 'p1',
    nodeId: '46',
    nodeType: 'LTXDirector',
    exceptionType: 'ValueError',
    message: 'missing prompt',
    traceback: ['line1', 'line2']
  });
});

test('execution_error with missing traceback defaults to empty array', () => {
  const input = {
    type: 'execution_error',
    data: { prompt_id: 'p1', node_id: '1', node_type: 'X', exception_type: 'Y', exception_message: 'Z' }
  };
  expect(parseMessage(JSON.stringify(input)).traceback).toEqual([]);
});

test('execution_success returns run-complete', () => {
  const result = parseMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'p1' } }));
  expect(result).toEqual({ type: 'run-complete', promptId: 'p1' });
});

test('executing with node null returns run-complete', () => {
  const result = parseMessage(JSON.stringify({ type: 'executing', data: { node: null, prompt_id: 'p1' } }));
  expect(result).toEqual({ type: 'run-complete', promptId: 'p1' });
});

test('executing with non-null node returns null', () => {
  const result = parseMessage(JSON.stringify({ type: 'executing', data: { node: '46', prompt_id: 'p1' } }));
  expect(result).toBeNull();
});

test('unknown message type returns null', () => {
  const result = parseMessage(JSON.stringify({ type: 'crystals', data: {} }));
  expect(result).toBeNull();
});

test('invalid JSON returns null', () => {
  const result = parseMessage('not json {{{');
  expect(result).toBeNull();
});

test('missing data property returns null', () => {
  const result = parseMessage(JSON.stringify({ type: 'execution_start' }));
  expect(result).toBeNull();
});

test('null data returns null', () => {
  const result = parseMessage(JSON.stringify({ type: 'execution_start', data: null }));
  expect(result).toBeNull();
});
