const fs = require('fs');
const path = require('path');
const os = require('os');
const { createStore } = require('../store');

function tempPath() {
  return path.join(os.tmpdir(), `comfyui-test-${Date.now()}-${Math.random()}.json`);
}

afterEach(() => {
  // temp files are cleaned up by OS
});

test('loadHistory returns empty array when file does not exist', () => {
  const store = createStore(tempPath());
  expect(store.loadHistory()).toEqual([]);
});

test('addError persists entry to file and returns it', () => {
  const store = createStore(tempPath());
  const entry = store.addError({
    nodeId: '46',
    nodeType: 'LTXDirector',
    exceptionType: 'ValueError',
    message: 'missing prompt',
    traceback: ['line1']
  });
  expect(entry.id).toBeTruthy();
  expect(entry.node_id).toBe('46');
  expect(entry.node_type).toBe('LTXDirector');
  expect(entry.exception_type).toBe('ValueError');
  expect(entry.message).toBe('missing prompt');
  expect(entry.traceback).toEqual(['line1']);
  expect(entry.explanation).toBeNull();
  expect(entry.timestamp).toBeTruthy();
});

test('loadHistory returns previously added entry', () => {
  const p = tempPath();
  const store = createStore(p);
  store.addError({ nodeId: '1', nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback: [] });
  const history = store.loadHistory();
  expect(history).toHaveLength(1);
  expect(history[0].node_type).toBe('X');
});

test('addError prepends newest entry (newest first)', () => {
  const store = createStore(tempPath());
  store.addError({ nodeId: '1', nodeType: 'A', exceptionType: 'E', message: 'first', traceback: [] });
  store.addError({ nodeId: '2', nodeType: 'B', exceptionType: 'E', message: 'second', traceback: [] });
  const history = store.loadHistory();
  expect(history[0].message).toBe('second');
  expect(history[1].message).toBe('first');
});

test('updateExplanation sets explanation field by id', () => {
  const store = createStore(tempPath());
  const entry = store.addError({ nodeId: '1', nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback: [] });
  store.updateExplanation(entry.id, 'The node was missing a value.');
  const history = store.loadHistory();
  expect(history[0].explanation).toBe('The node was missing a value.');
});

test('clearHistory empties the file', () => {
  const store = createStore(tempPath());
  store.addError({ nodeId: '1', nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback: [] });
  store.clearHistory();
  expect(store.loadHistory()).toEqual([]);
});

test('addError trims to 100 entries maximum', () => {
  const store = createStore(tempPath());
  for (let i = 0; i < 102; i++) {
    store.addError({ nodeId: String(i), nodeType: 'X', exceptionType: 'Y', message: `msg${i}`, traceback: [] });
  }
  expect(store.loadHistory()).toHaveLength(100);
});
