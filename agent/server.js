// NAGARCOT local server — proxies model calls, keeps API key out of browser
// ARCHITECTURAL NOTE: callModel must be DIRECT — no subagent orchestration.
// Short replies must feel INSTANT. Direct API call only.
//
// TWO MODES:
// - API mode: direct Anthropic API call with key → fastest, for demos
// - Local mode: spawns claude CLI as subprocess, uses Claude Max subscription
//   Requires one-time auth: run  claude auth login  in terminal first.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

// Claude Code binary — installed by the desktop app
const CLAUDE_BIN = (() => {
  const candidates = [];

  // 1. Local npm dependency
  candidates.push(path.join(__dirname, 'node_modules', '.bin', 'claude'));

  // 2. Desktop app — auto-detect latest version
  try {
    const claudeCodeDir = path.join(
      process.env.HOME || `/Users/${process.env.USER}`,
      'Library', 'Application Support', 'Claude', 'claude-code'
    );
    const versions = fs.readdirSync(claudeCodeDir)
      .filter(d => /^\d+\.\d+\.\d+$/.test(d))
      .sort((a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
        return 0;
      });
    if (versions.length > 0) {
      candidates.push(path.join(claudeCodeDir, versions[0], 'claude.app', 'Contents', 'MacOS', 'claude'));
    }
  } catch {
    // directory may not exist
  }

  // 3. Global installs
  candidates.push('/usr/local/bin/claude');
  candidates.push('/opt/homebrew/bin/claude');

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
})();

const PORT = process.env.PORT || 3131;
const CONFIG_FILE = path.join(__dirname, 'config.local.json');
const DEFAULT_MODEL = 'claude-sonnet-5'; // Sonnet 5, released 2026-06-30

function loadConfig() {
  try {
    const file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // env var overrides file — used in production (Railway)
    if (process.env.ANTHROPIC_API_KEY) file.apiKey = process.env.ANTHROPIC_API_KEY;
    if (process.env.NAGARCOT_MODE) file.mode = process.env.NAGARCOT_MODE;
    if (!file.model) file.model = DEFAULT_MODEL;
    return file;
  } catch {
    return {
      mode: process.env.NAGARCOT_MODE || 'api',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: DEFAULT_MODEL,
    };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Safe JSON parse for incoming request bodies — a malformed request must
// return an error response, never crash the process.
function safeParse(body) {
  try {
    return { ok: true, data: JSON.parse(body) };
  } catch {
    return { ok: false, data: null };
  }
}

// Check if claude CLI is authenticated
async function checkLocalAuth() {
  if (!CLAUDE_BIN) return { ok: false, reason: 'claude binary not found' };
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_BIN, ['auth', 'status'], { env: process.env });
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    proc.on('close', () => {
      try {
        const parsed = JSON.parse(out);
        resolve({ ok: parsed.loggedIn === true, reason: parsed.loggedIn ? '' : 'Not authorized' });
      } catch {
        resolve({ ok: false, reason: out.trim() || 'Auth check failed' });
      }
    });
  });
}

// Call model via claude CLI subprocess (local/subscription mode)
async function callLocalCLI(systemPrompt, messages) {
  if (!CLAUDE_BIN) throw new Error('claude binary not found on this machine');

  // Build a single prompt from conversation history
  // The CLI -p mode takes a single prompt; we prepend history as context
  const historyText = messages.slice(0, -1).map(m =>
    (m.role === 'user' ? 'Человек: ' : 'Ты: ') + m.content
  ).join('\n');
  const lastMsg = messages[messages.length - 1].content;
  const fullPrompt = historyText ? `${historyText}\nЧеловек: ${lastMsg}` : lastMsg;

  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, [
      '-p', fullPrompt,
      '--system-prompt', systemPrompt,
      '--output-format', 'json',
      '--no-session-persistence',
      '--allowedTools', '', // no tools needed, pure chat
    ], { env: process.env });

    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', (code) => {
      try {
        const parsed = JSON.parse(out);
        if (parsed.is_error || !parsed.result) {
          reject(new Error(parsed.result || err || 'Empty response from CLI'));
        } else {
          resolve(parsed.result);
        }
      } catch {
        reject(new Error(err || out || `Process exited with code ${code}`));
      }
    });
  });
}

async function callAnthropicAPI(apiKey, model, systemPrompt, messages) {
  const body = JSON.stringify({
    model: model || DEFAULT_MODEL,
    max_tokens: 2048,
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

  // API: check local CLI auth status
  if (req.method === 'GET' && url.pathname === '/api/local-status') {
    const status = await checkLocalAuth();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...status, hasBin: !!CLAUDE_BIN }));
    return;
  }

  // API: get config
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const cfg = loadConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ mode: cfg.mode, hasKey: !!cfg.apiKey, model: cfg.model }));
    return;
  }

  // API: save config
  if (req.method === 'POST' && url.pathname === '/api/config') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const parsed = safeParse(body);
      if (!parsed.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request', message: 'Malformed JSON body' }));
        return;
      }
      const incoming = parsed.data;
      const cfg = loadConfig();
      if (incoming.mode) cfg.mode = incoming.mode;
      if (incoming.apiKey !== undefined) cfg.apiKey = incoming.apiKey;
      if (incoming.model) cfg.model = incoming.model;
      saveConfig(cfg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // API: call model
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    console.log('[chat] request received');
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const parsed = safeParse(body);
      if (!parsed.ok || !parsed.data || !Array.isArray(parsed.data.messages)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request', message: 'Malformed request body' }));
        return;
      }
      const { systemPrompt, messages } = parsed.data;
      const cfg = loadConfig();
      console.log('[chat] mode=%s hasKey=%s model=%s', cfg.mode, !!cfg.apiKey, cfg.model);

      try {
        let text;
        if (cfg.mode === 'local') {
          text = await callLocalCLI(systemPrompt, messages);
        } else {
          if (!cfg.apiKey) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'no_key', message: 'API key is not set. Open settings (⚙).' }));
            return;
          }
          text = await callAnthropicAPI(cfg.apiKey, cfg.model, systemPrompt, messages);
        }
        console.log('[chat] success, chars=%d', text.length);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (e) {
        console.error('[chat] error:', e.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'local_error', message: e.message }));
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

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

server.listen(PORT, () => {
  console.log(`NAGARCOT running at http://localhost:${PORT}`);
});
