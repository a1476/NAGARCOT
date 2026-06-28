// NAGARCOT local server — proxies model calls, keeps API key out of browser
// ARCHITECTURAL NOTE: callModel must be DIRECT — no subagent orchestration.
// Short replies must feel INSTANT. Direct API call only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3131;
const CONFIG_FILE = path.join(__dirname, 'config.local.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { mode: 'api', apiKey: '' };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function callAnthropicAPI(apiKey, systemPrompt, messages) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  return new Promise((resolve, reject) => {
    const req = require('https').request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content && parsed.content[0]) {
            resolve(parsed.content[0].text);
          } else {
            reject(new Error(parsed.error?.message || 'No content in response'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: get config
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const cfg = loadConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode: cfg.mode, hasKey: !!cfg.apiKey }));
    return;
  }

  // API: save config
  if (req.method === 'POST' && url.pathname === '/api/config') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const incoming = JSON.parse(body);
      const cfg = loadConfig();
      if (incoming.mode) cfg.mode = incoming.mode;
      if (incoming.apiKey !== undefined) cfg.apiKey = incoming.apiKey;
      saveConfig(cfg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // API: call model
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const { systemPrompt, messages } = JSON.parse(body);
      const cfg = loadConfig();

      if (cfg.mode === 'local') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'local',
          message: 'Режим «Локалка» недоступен программно. Переключитесь на API-режим в настройках.',
        }));
        return;
      }

      if (!cfg.apiKey) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_key', message: 'API-ключ не задан. Откройте настройки.' }));
        return;
      }

      try {
        const text = await callAnthropicAPI(cfg.apiKey, systemPrompt, messages);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'api_error', message: e.message }));
      }
    });
    return;
  }

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`NAGARCOT running at http://localhost:${PORT}`);
});
