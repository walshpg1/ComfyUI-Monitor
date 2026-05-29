const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = 'You are a ComfyUI expert. When given an error, explain in 2-3 plain sentences what went wrong and exactly how to fix it. Be specific and practical. No preamble.';

async function* explainError(errorObj, apiKey) {
  if (!apiKey) {
    yield 'Add ANTHROPIC_API_KEY to .env to enable AI explanations.';
    return;
  }

  const client = new Anthropic({ apiKey });
  const traceback = (errorObj.traceback || []).slice(-10).join('\n');

  const userMessage =
    `Node type: ${errorObj.nodeType}\n` +
    `Exception type: ${errorObj.exceptionType}\n` +
    `Message: ${errorObj.message}\n` +
    `Traceback (last 10 lines):\n${traceback}`;

  const stream = client.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      yield chunk.delta.text;
    }
  }
}

module.exports = { explainError };
