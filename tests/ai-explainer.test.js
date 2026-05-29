jest.mock('@anthropic-ai/sdk');
const Anthropic = require('@anthropic-ai/sdk');
const { explainError } = require('../ai-explainer');

async function collect(gen) {
  const chunks = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks.join('');
}

test('yields no-key message when apiKey is null', async () => {
  const result = await collect(explainError(
    { nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback: [] },
    null
  ));
  expect(result).toContain('ANTHROPIC_API_KEY');
});

test('yields no-key message when apiKey is empty string', async () => {
  const result = await collect(explainError(
    { nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback: [] },
    ''
  ));
  expect(result).toContain('ANTHROPIC_API_KEY');
});

test('streams text_delta chunks from the API', async () => {
  async function* mockStream() {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
    yield { type: 'message_stop' };
  }

  Anthropic.mockImplementation(() => ({
    messages: { stream: jest.fn().mockReturnValue(mockStream()) }
  }));

  const result = await collect(explainError(
    { nodeType: 'LTXDirector', exceptionType: 'ValueError', message: 'missing prompt', traceback: ['l1', 'l2'] },
    'sk-ant-test'
  ));
  expect(result).toBe('Hello world');
});

test('skips non-text_delta events', async () => {
  async function* mockStream() {
    yield { type: 'message_start', message: {} };
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } };
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
  }

  Anthropic.mockImplementation(() => ({
    messages: { stream: jest.fn().mockReturnValue(mockStream()) }
  }));

  const result = await collect(explainError(
    { nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback: [] },
    'sk-ant-test'
  ));
  expect(result).toBe('Answer');
});

test('uses last 10 lines of traceback', async () => {
  let capturedMessage;

  async function* mockStream() {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } };
  }

  Anthropic.mockImplementation(() => ({
    messages: {
      stream: jest.fn().mockImplementation((params) => {
        capturedMessage = params.messages[0].content;
        return mockStream();
      })
    }
  }));

  const traceback = Array.from({ length: 15 }, (_, i) => `line${i}`);
  await collect(explainError(
    { nodeType: 'X', exceptionType: 'Y', message: 'Z', traceback },
    'sk-ant-test'
  ));

  // Should contain lines 5-14 (last 10), not line4
  expect(capturedMessage).toContain('line14');
  expect(capturedMessage).not.toContain('line4\n');
});
