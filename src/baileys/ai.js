const fetch = require('node-fetch');
const config = require('../config');

async function askAnthropic(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropicModel,
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content?.map((c) => c.text || '').join('\n').trim() || '(no response)';
}

async function askOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 800,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '(no response)';
}

async function askAI(prompt) {
  if (config.aiProvider === 'openai') {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set in .env');
    return askOpenAI(prompt);
  }
  if (!config.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  return askAnthropic(prompt);
}

module.exports = { askAI };
