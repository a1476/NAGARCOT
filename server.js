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

// ══════════════════════════════════════════════════════════════════
// GOALS MODULE — isolated, does not touch SPR logic
// ══════════════════════════════════════════════════════════════════
const GOALS_FILE = path.join(__dirname, 'data', 'goals.json');

function loadGoals() {
  try {
    return JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8'));
  } catch {
    return { candidates: [], goals: [], rejections: [], events: [] };
  }
}

function saveGoals(data) {
  const dir = path.dirname(GOALS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GOALS_FILE, JSON.stringify(data, null, 2));
}

function goalsEvent(data, type, payload) {
  data.events.push({ ts: new Date().toISOString(), type, ...payload });
}

// Signal: in-memory (resets on server restart = new session semantics)
const signal = {
  active: false,
  givenThisSession: false,
  pendingSignal: false,
  inDepthMode: false,
};

function trySetSignal(candidate) {
  if (candidate.isHypothesis) return;
  if (candidate.layer > 2) return;
  if (candidate.warmth < 0.6) return;
  if (candidate.announced) return;
  if (signal.givenThisSession) return;
  if (signal.inDepthMode) { signal.pendingSignal = true; return; }
  signal.active = true;
  signal.givenThisSession = true;
  candidate.announced = true;
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36);
}

// Verification questions (same as mockup)
const VERIFY_QUESTIONS = [
  { id: 'q1', text: 'Если это получится — что ты увидишь?', options: ['конкретную сцену вижу ясно', 'направление чувствую, картинки нет'] },
  { id: 'q2', text: 'Это движение к чему-то или уход от чего-то?', options: ['скорее к', 'скорее от', 'и то и то'], pollenNote: 'ОТ-рамка' },
  { id: 'q3', text: 'Если бы никто никогда не узнал — стал бы?', options: ['да, это моё', 'честно — вряд ли', 'не знаю'], pollenNote: 'интроект' },
];

// Test corpus data
const TEST_CANDIDATES = [
  { id:'K1', text:'хочу наконец уйти с этой работы и открыть своё', isHypothesis:false, layer:1, warmth:0.9, pollen:['ОТ-рамка («уйти с»)'], source:{sessionId:'',date:''}, status:'new', laterCount:0, announced:false, history:[] },
  { id:'K2', text:'важно, чтобы дети видели меня не выжатым', isHypothesis:false, layer:2, warmth:0.7, pollen:[], source:{sessionId:'',date:''}, status:'new', laterCount:0, announced:false, history:[] },
  { id:'K3', text:'вернуть физическую форму', isHypothesis:true, layer:3, warmth:0.4, pollen:['повторные упоминания бега, усталости от тела (3 сессии)'], source:{sessionId:'',date:''}, status:'new', laterCount:0, announced:false, history:[] },
  { id:'K4', text:'надо уже заняться английским, стыдно перед собой', isHypothesis:false, layer:1, warmth:0.6, pollen:['интроект («надо», «стыдно»)'], source:{sessionId:'',date:''}, status:'new', laterCount:0, announced:false, history:[] },
  { id:'K5', text:'переехать в другую страну', isHypothesis:false, layer:1, warmth:0.8, pollen:[], source:{sessionId:'',date:''}, status:'rejected', laterCount:0, announced:false, history:[] },
];
const TEST_GOALS = [
  { id:'C1', text:'пробежать полумарафон осенью', group:'личные', state:'принята', passport:{q1:null,q2:null,q3:null,q4_gap:null}, axes:{term:null,nature:null,height:null}, pollen:['кризис действия: режим кризиса'], links:[], createdAt:'2026-06-12', history:[], detection:null, verifiedSteps:null, door:'Проверить' },
  { id:'C2', text:'закрыть ипотеку за три года', group:'внешние', state:'в пути', passport:{q1:null,q2:null,q3:null,q4_gap:null}, axes:{term:null,nature:null,height:null}, pollen:['остывание: не звучала в речи 5 недель'], links:[], createdAt:'2026-06-03', history:[], detection:'Ипотека давно не звучала. Как она сейчас?', frictionShown:false, verifiedSteps:null, door:'Как движется' },
  { id:'C3', text:'раз в неделю время вдвоём с женой', group:'социальные', state:'проверена', passport:{q1:null,q2:null,q3:null,q4_gap:'заявлено «для нас двоих», в речи звучит «чтобы не развалилось» — зазор помечен'}, axes:{term:null,nature:null,height:null}, pollen:[], links:[], createdAt:'2026-06-15', history:[], detection:null, verifiedSteps:null, door:'Собрать путь' },
  { id:'C4', text:'выучить испанский', group:'личные', state:'давно не тронута', passport:{q1:null,q2:null,q3:null,q4_gap:null}, axes:{term:null,nature:null,height:null}, pollen:[], links:[], createdAt:'2026-05-01', history:[], detection:null, verifiedSteps:null, door:'Ещё тянет?' },
];
const TEST_REJECTIONS = [{ candidateId:'K5', date:'2026-06-28', context:'сессия про работу', warmthAtRejection:0.8, note:'тёплое чтение × явный отказ → расхождение записано в пыльцу как сигнал осторожности' }];

// Compute what to show in candidates (filter rejections registry)
function visibleCandidates(data) {
  const rejectedIds = new Set(data.rejections.map(r => r.candidateId));
  return data.candidates
    .filter(c => !rejectedIds.has(c.id) && c.status !== 'rejected' && c.status !== 'soft-rejected' && c.status !== 'accepted')
    .sort((a, b) => b.warmth - a.warmth);
}

// Compute vector line
function computeVector(data) {
  const shown = visibleCandidates(data).filter(c => c.status !== 'later' || c.laterCount < 3);
  if (shown.length > 0) return 'Посмотри, что из этого твоё';
  const needsVerify = data.goals.find(g => g.state === 'принята' && g.state !== 'отпущена');
  if (needsVerify) return 'Есть цель, которую стоит проверить — твоя она или «надо»';
  const needsPath = data.goals.find(g => g.state === 'проверена' && g.state !== 'отпущена');
  if (needsPath) return `У «${needsPath.text}» можно собрать первый шаг`;
  return null;
}

function handleGoalsRequest(method, pathname, body, res) {
  const json = (obj, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // GET state
  if (method === 'GET' && pathname === '/api/goals') {
    const data = loadGoals();
    json({
      candidates: visibleCandidates(data),
      allCandidates: data.candidates,
      goals: data.goals.filter(g => g.state !== 'отпущена'),
      historyGoals: data.goals.filter(g => g.state === 'отпущена'),
      rejections: data.rejections,
      verifyQuestions: VERIFY_QUESTIONS,
      signal: { active: signal.active },
      vector: computeVector(data),
      events: data.events.slice(-50),
    });
    return true;
  }

  // POST command
  if (method === 'POST' && pathname === '/api/goals/cmd') {
    const { cmd, ...args } = body;
    const data = loadGoals();
    let response = { ok: true };

    if (cmd === 'signal_dismiss') {
      signal.active = false;
      announcedVerbal = false; // reset for next signal period
      goalsEvent(data, 'signal_dismissed', {});

    } else if (cmd === 'candidate_mine') {
      const c = data.candidates.find(c => c.id === args.id);
      if (!c) return json({ error: 'not_found' }, 404);
      c.status = 'accepted';
      c.history.push({ ts: new Date().toISOString(), action: 'accepted', group: args.group });

      // Determine start question by pollen
      let startQ = 0;
      if (c.pollen.some(p => p.includes('интроект'))) startQ = 2;
      else if (c.pollen.some(p => p.includes('ОТ-рамка'))) startQ = 1;

      const newGoal = {
        id: genId('G'),
        text: c.text,
        group: args.group,
        state: 'принята',
        passport: { q1: null, q2: null, q3: null, q4_gap: null },
        axes: { term: null, nature: null, height: null },
        pollen: [...c.pollen],
        links: [],
        createdAt: new Date().toISOString().slice(0, 10),
        history: [{ ts: new Date().toISOString(), action: 'created', fromCandidate: c.id, group: args.group }],
        detection: null,
        frictionShown: false,
        verifiedSteps: null,
        door: 'Проверить',
        _startQuestion: startQ,
      };

      // IRQ: K1 → friction on C2
      if (c.id === 'K1' || (c.pollen.some(p => p.includes('ОТ-рамка')))) {
        const c2 = data.goals.find(g => g.id === 'C2');
        if (c2) {
          c2.frictionShown = true;
          goalsEvent(data, 'irq_friction', { trigger: c.id, target: 'C2', type: 'resource' });
        }
      }

      data.goals.push(newGoal);
      goalsEvent(data, 'candidate_accepted', { candidateId: c.id, goalId: newGoal.id, group: args.group, startQuestion: startQ });
      response = { ok: true, goalId: newGoal.id, startQuestion: startQ, goal: newGoal };

    } else if (cmd === 'candidate_notmine') {
      const c = data.candidates.find(c => c.id === args.id);
      if (!c) return json({ error: 'not_found' }, 404);
      c.status = 'rejected';
      c.history.push({ ts: new Date().toISOString(), action: 'rejected' });
      data.rejections.push({ candidateId: c.id, date: new Date().toISOString().slice(0, 10), context: 'отклонено вручную', warmthAtRejection: c.warmth });
      goalsEvent(data, 'candidate_rejected', { candidateId: c.id });

    } else if (cmd === 'candidate_later') {
      const c = data.candidates.find(c => c.id === args.id);
      if (!c) return json({ error: 'not_found' }, 404);
      c.laterCount = (c.laterCount || 0) + 1;
      if (c.laterCount >= 3) {
        c.status = 'soft-rejected';
        goalsEvent(data, 'candidate_soft_rejected', { candidateId: c.id, reason: '3x_later' });
      } else {
        goalsEvent(data, 'candidate_later', { candidateId: c.id, count: c.laterCount });
      }

    } else if (cmd === 'goal_create') {
      const newGoal = {
        id: genId('G'),
        text: args.text,
        group: args.group || 'личные',
        state: 'принята',
        passport: { q1: null, q2: null, q3: null, q4_gap: null },
        axes: { term: null, nature: null, height: null },
        pollen: [],
        links: [],
        createdAt: new Date().toISOString().slice(0, 10),
        history: [{ ts: new Date().toISOString(), action: 'created', fromInput: true }],
        detection: null,
        frictionShown: false,
        verifiedSteps: null,
        door: 'Проверить',
        _startQuestion: 0,
      };
      data.goals.push(newGoal);
      goalsEvent(data, 'goal_created', { goalId: newGoal.id, text: args.text });
      response = { ok: true, goalId: newGoal.id, goal: newGoal };

    } else if (cmd === 'goal_text') {
      const g = data.goals.find(g => g.id === args.id);
      if (!g) return json({ error: 'not_found' }, 404);
      g.history.push({ ts: new Date().toISOString(), action: 'text_changed', from: g.text, to: args.text });
      g.text = args.text;
      goalsEvent(data, 'goal_text_changed', { goalId: args.id, text: args.text });

    } else if (cmd === 'goal_status') {
      const g = data.goals.find(g => g.id === args.id);
      if (!g) return json({ error: 'not_found' }, 404);
      const prev = g.state;
      g.state = args.state;
      g.history.push({ ts: new Date().toISOString(), action: 'state_changed', from: prev, to: args.state });
      goalsEvent(data, 'goal_state_changed', { goalId: args.id, from: prev, to: args.state });
      if (args.state === 'достигнута' && args.integration) {
        goalsEvent(data, 'goal_achieved_integration', { goalId: args.id, text: args.integration });
      }
      if (args.state === 'отпущена' && args.rehook) {
        goalsEvent(data, 'goal_released_rehook', { goalId: args.id, text: args.rehook });
      }
      if (args.state === 'отпущена' && !args.rehook) {
        goalsEvent(data, 'goal_released_no_rehook', { goalId: args.id });
      }

    } else if (cmd === 'goal_verify_answer') {
      const g = data.goals.find(g => g.id === args.id);
      if (!g) return json({ error: 'not_found' }, 404);
      const qField = 'q' + (args.qIndex + 1);
      g.passport[qField] = { answer: args.answer, free: !!args.free };
      g.history.push({ ts: new Date().toISOString(), action: 'verify_answer', q: qField, answer: args.answer, free: !!args.free });
      goalsEvent(data, 'goal_verify_answer', { goalId: args.id, q: qField, answer: args.answer, free: !!args.free });

    } else if (cmd === 'goal_verify_done') {
      const g = data.goals.find(g => g.id === args.id);
      if (!g) return json({ error: 'not_found' }, 404);
      g.state = 'проверена';
      g.verifiedSteps = null;
      g.door = 'Собрать путь';
      g.history.push({ ts: new Date().toISOString(), action: 'verified' });
      goalsEvent(data, 'goal_verified', { goalId: args.id });

    } else if (cmd === 'goal_verify_quit') {
      const g = data.goals.find(g => g.id === args.id);
      if (!g) return json({ error: 'not_found' }, 404);
      if (args.stepsCompleted > 0) {
        g.verifiedSteps = args.stepsCompleted;
        g.history.push({ ts: new Date().toISOString(), action: 'verify_partial', steps: args.stepsCompleted });
        goalsEvent(data, 'goal_verify_partial', { goalId: args.id, steps: args.stepsCompleted });
      } else {
        goalsEvent(data, 'goal_verify_quit', { goalId: args.id });
      }
    }

    saveGoals(data);
    json(response);
    return true;
  }

  // Dev: add candidate
  if (method === 'POST' && pathname === '/api/goals/dev/candidate') {
    const data = loadGoals();
    const c = {
      id: body.id || genId('K'),
      text: body.text || 'тестовый кандидат',
      isHypothesis: !!body.isHypothesis,
      layer: body.layer || 1,
      warmth: body.warmth !== undefined ? body.warmth : 0.7,
      pollen: body.pollen || [],
      source: { sessionId: '', date: new Date().toISOString() },
      status: 'new',
      laterCount: 0,
      announced: false,
      history: [],
    };
    data.candidates.push(c);
    goalsEvent(data, 'dev_candidate_added', { candidateId: c.id });
    trySetSignal(c);
    // Save announced flag back
    const saved = data.candidates.find(x => x.id === c.id);
    if (saved) saved.announced = c.announced;
    saveGoals(data);
    json({ ok: true, candidate: c, signal: { active: signal.active } });
    return true;
  }

  // Dev: load test corpus
  if (method === 'POST' && pathname === '/api/goals/dev/load-corpus') {
    const data = {
      candidates: TEST_CANDIDATES.map(c => ({ ...c })),
      goals: TEST_GOALS.map(g => ({ ...g })),
      rejections: TEST_REJECTIONS.map(r => ({ ...r })),
      events: [{ ts: new Date().toISOString(), type: 'dev_corpus_loaded', note: 'K1–K5, C1–C4' }],
    };
    saveGoals(data);
    signal.active = false;
    signal.givenThisSession = false;
    json({ ok: true });
    return true;
  }

  // Dev: clear
  if (method === 'POST' && pathname === '/api/goals/dev/clear') {
    saveGoals({ candidates: [], goals: [], rejections: [], events: [{ ts: new Date().toISOString(), type: 'dev_cleared' }] });
    signal.active = false;
    signal.givenThisSession = false;
    announcedVerbal = false;
    json({ ok: true });
    return true;
  }

  // Harvest status / toggle
  if (pathname === '/api/goals/harvest') {
    if (method === 'GET') {
      json({ enabled: harvestEnabled, session: harvestSession, announcedVerbal });
      return true;
    }
    if (method === 'POST') {
      if (typeof body.enabled === 'boolean') harvestEnabled = body.enabled;
      else harvestEnabled = !harvestEnabled;
      json({ ok: true, enabled: harvestEnabled });
      return true;
    }
  }

  return false; // not a goals route
}
// ══════════════════════════════════════════════════════════════════

// ── CHANNEL 2 — Goals context block injected into agent system prompt ──
let channel2Enabled = true;

// Last injected block for dev panel inspection
let lastChannel2 = { block: '', tokensEst: 0, truncated: [] };

// Rough token estimate: Cyrillic ~3 chars/token, ASCII ~4 chars/token
function estimateTokens(str) {
  return Math.ceil(str.length / 3);
}

const ACTIVE_GOAL_STATES = new Set(['принята', 'проверена', 'в пути', 'давно не тронута']);
const HISTORY_GOAL_STATES = new Set(['достигнута', 'отпущена']);

function buildGoalsBlock() {
  const data = loadGoals();
  const BUDGET = 500; // tokens

  // Build goal lines
  const goalLines = [];
  for (const g of (data.goals || [])) {
    if (!ACTIVE_GOAL_STATES.has(g.state)) continue;
    let line = `Ц: "${g.text}" | ${g.group || '?'} | ${g.state}`;
    // Passport: only filled fields, compressed
    const p = g.passport || {};
    const parts = [];
    if (p.q1) parts.push(p.q1.startsWith('К') ? 'К' : 'ОТ');
    if (p.q2 === 'своё') parts.push('своё');
    else if (p.q2 === 'интроект') parts.push('интроект');
    if (p.q4_gap) parts.push(`зазор:${p.q4_gap}`);
    if (parts.length) line += ` | ${parts.join('; ')}`;
    if (g.crisis) line += ' | КРИЗИС-РЕЖИМ';
    goalLines.push({ line, stale: g.state === 'давно не тронута' });
  }

  // Build candidate lines (no hypotheses, only shown/new, layer 1-2, sort by warmth desc)
  const rejected = new Set((data.rejections || []).map(r => r.candidateId));
  const candLines = (data.candidates || [])
    .filter(c =>
      !c.isHypothesis &&
      (c.status === 'new' || c.status === 'shown') &&
      (c.layer === 1 || c.layer === 2) &&
      !rejected.has(c.id)
    )
    .sort((a, b) => (b.warmth || 0) - (a.warmth || 0))
    .slice(0, 5)
    .map(c => {
      let line = `К[не подтверждено]: "${c.text}" | ${c.warmth}`;
      if (c.pollen && c.pollen.length) line += ` | ${c.pollen.join(', ')}`;
      return line;
    });

  if (!goalLines.length && !candLines.length) {
    lastChannel2 = { block: '', tokensEst: 0, truncated: [] };
    return '';
  }

  // Assemble with budget — truncation priority:
  // 1. Candidates from bottom (lowest warmth)
  // 2. Stale goals
  // 3. Passport compressions (strip them, keep bare formulation)
  const truncated = [];
  let activeGoalLines = goalLines.filter(g => !g.stale).map(g => g.line);
  let staleGoalLines = goalLines.filter(g => g.stale).map(g => g.line);
  let cands = [...candLines];

  function assemble() {
    const lines = [
      ...activeGoalLines,
      ...staleGoalLines,
      ...cands,
    ];
    return '[ПОЛЕ ЦЕЛЕЙ]\n' + lines.join('\n') + '\n[/ПОЛЕ ЦЕЛЕЙ]';
  }

  // Trim candidates from tail until within budget
  while (estimateTokens(assemble()) > BUDGET && cands.length) {
    const dropped = cands.pop();
    truncated.push({ type: 'candidate', text: dropped.slice(0, 60) });
  }

  // Trim stale goals
  while (estimateTokens(assemble()) > BUDGET && staleGoalLines.length) {
    const dropped = staleGoalLines.pop();
    truncated.push({ type: 'stale_goal', text: dropped.slice(0, 60) });
  }

  // Strip passport from active goals (keep bare text)
  if (estimateTokens(assemble()) > BUDGET) {
    activeGoalLines = activeGoalLines.map(l => {
      const match = l.match(/^Ц: "([^"]+)" \| ([^|]+) \| ([^|]+)/);
      return match ? `Ц: "${match[1]}" | ${match[2].trim()} | ${match[3].trim()}` : l;
    });
    truncated.push({ type: 'passport_stripped' });
  }

  const block = assemble();
  const tokensEst = estimateTokens(block);

  if (truncated.length) {
    const d = loadGoals();
    d.events.push({ ts: new Date().toISOString(), type: 'channel2_truncated', truncated });
    saveGoals(d);
  }

  lastChannel2 = { block, tokensEst, truncated };
  return block;
}

function getChannel2Status() {
  return { enabled: channel2Enabled, ...lastChannel2 };
}
// ── end Channel 2 ──────────────────────────────────────────────────

// ── HARVEST MODULE ─────────────────────────────────────────────────
const HARVEST_PROMPT_FILE = path.join(__dirname, 'data', 'zhatva_prompt_v01.md');
const HAIKU_MODEL = 'claude-haiku-4-5';
const ESCALATION_MODEL = 'claude-sonnet-4-6';
const HARVEST_SESSION_ID = 'sess_' + Date.now().toString(36);

let harvestEnabled = true;
let harvestSession = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  escalations: 0,
  empty: 0,
  candidates: [], // {ts, id, text, rationale, warmth, layer, escalated}
};

// Verbal tail tracking — resets on signal dismiss
let announcedVerbal = false;

const TAIL_STRING = 'Отдельно: пока говорили, я услышала что-то похожее на твою цель — лежит в Целях, посмотри когда захочешь.';

function shouldAddVerbalFlag() {
  return signal.active && !announcedVerbal;
}

function detectTailString(text) {
  return !!(text && text.includes(TAIL_STRING));
}

function loadHarvestPrompt() {
  try { return fs.readFileSync(HARVEST_PROMPT_FILE, 'utf8'); } catch { return null; }
}

async function callHarvestModel(apiKey, model, systemPrompt, userContent) {
  const body = JSON.stringify({
    model,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
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
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const textBlock = Array.isArray(parsed.content) && parsed.content.find(b => b.type === 'text');
          if (textBlock && textBlock.text) {
            resolve({ text: textBlock.text, inputTokens: parsed.usage?.input_tokens || 0, outputTokens: parsed.usage?.output_tokens || 0 });
          } else {
            reject(new Error(parsed.error?.message || 'No text in harvest response'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseHarvestJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function addCandidateFromHarvest(candidate, sessionId) {
  const data = loadGoals();

  // Server-side dedup: exact text match
  const dup = data.candidates.find(c => c.text.trim() === candidate.text.trim());
  if (dup) {
    console.log('[harvest] dedup: matches', dup.id);
    return null;
  }

  const c = {
    id: genId('K'),
    text: candidate.text,
    isHypothesis: false,
    layer: candidate.layer,
    warmth: candidate.warmth,
    pollen: candidate.pollen || [],
    source: { sessionId, date: new Date().toISOString().slice(0, 10), origin: 'harvest' },
    status: 'new',
    laterCount: 0,
    announced: false,
    history: [],
    rationale: candidate.rationale || '',
  };

  data.candidates.push(c);
  goalsEvent(data, 'harvest_candidate_added', { candidateId: c.id, warmth: c.warmth, layer: c.layer });
  trySetSignal(c);
  const saved = data.candidates.find(x => x.id === c.id);
  if (saved) saved.announced = c.announced;
  saveGoals(data);
  return c;
}

function updateMentions(mentions, data) {
  if (!mentions || !mentions.length) return;
  const now = new Date().toISOString();
  for (const id of mentions) {
    const cand = data.candidates.find(c => c.id === id);
    if (cand) { cand.lastMentioned = now; continue; }
    const goal = data.goals.find(g => g.id === id);
    if (goal) goal.lastMentioned = now;
  }
  goalsEvent(data, 'mentions_updated', { ids: mentions });
}

async function runHarvest(agentLastTurn, userTurn, sessionId) {
  if (!harvestEnabled) return;

  const cfg = loadConfig();
  if (!cfg.apiKey) return; // no API key — harvest requires direct API

  const promptSys = loadHarvestPrompt();
  if (!promptSys) {
    console.error('[harvest] prompt file not found:', HARVEST_PROMPT_FILE);
    return;
  }

  const data = loadGoals();
  const existing = [
    ...data.candidates.filter(c => c.status === 'new' || c.status === 'shown').map(c => ({ id: c.id, text: c.text })),
    ...data.goals.filter(g => ACTIVE_GOAL_STATES.has(g.state)).map(g => ({ id: g.id, text: g.text })),
  ];

  const input = JSON.stringify({ agentLastTurn: agentLastTurn || '', userTurn: userTurn || '', existing });

  let result = null;
  let escalated = false;
  let usedModel = HAIKU_MODEL;
  let inputTok = 0, outputTok = 0;

  try {
    const r1 = await callHarvestModel(cfg.apiKey, HAIKU_MODEL, promptSys, input);
    inputTok += r1.inputTokens; outputTok += r1.outputTokens;
    result = parseHarvestJSON(r1.text);
    console.log('[harvest] haiku #1 parsed=%s', !!result);

    if (!result) {
      const r2 = await callHarvestModel(cfg.apiKey, HAIKU_MODEL, promptSys, input);
      inputTok += r2.inputTokens; outputTok += r2.outputTokens;
      result = parseHarvestJSON(r2.text);
      console.log('[harvest] haiku #2 (retry) parsed=%s', !!result);
    }

    if (!result || result.confidence === 'low') {
      usedModel = ESCALATION_MODEL;
      escalated = true;
      const r3 = await callHarvestModel(cfg.apiKey, ESCALATION_MODEL, promptSys, input);
      inputTok += r3.inputTokens; outputTok += r3.outputTokens;
      result = parseHarvestJSON(r3.text);
      console.log('[harvest] sonnet escalation parsed=%s', !!result);
    }
  } catch (e) {
    console.error('[harvest] call failed:', e.message);
    return;
  }

  harvestSession.calls++;
  harvestSession.inputTokens += inputTok;
  harvestSession.outputTokens += outputTok;
  if (escalated) harvestSession.escalations++;

  if (!result || !Array.isArray(result.candidates)) {
    harvestSession.empty++;
    return;
  }

  // Process mentions first
  if (Array.isArray(result.mentions) && result.mentions.length) {
    const freshData = loadGoals();
    updateMentions(result.mentions, freshData);
    saveGoals(freshData);
  }

  let addedCount = 0;
  for (const cand of result.candidates) {
    if (!cand.text || !cand.layer || cand.warmth == null) continue;
    const added = addCandidateFromHarvest(cand, sessionId);
    if (added) {
      addedCount++;
      harvestSession.candidates.push({
        ts: new Date().toISOString(),
        id: added.id,
        text: added.text.slice(0, 80),
        rationale: cand.rationale || '',
        warmth: cand.warmth,
        layer: cand.layer,
        escalated,
      });
    }
  }

  if (!addedCount) harvestSession.empty++;

  console.log('[harvest] done model=%s escalated=%s added=%d toks=%d+%d',
    usedModel, escalated, addedCount, inputTok, outputTok);
}
// ── end Harvest ────────────────────────────────────────────────────

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
          const textBlock = Array.isArray(parsed.content) && parsed.content.find(b => b.type === 'text');
          if (textBlock && textBlock.text) {
            resolve(textBlock.text);
          } else {
            reject(new Error(parsed.error?.message || 'No text block in response'));
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

  // Channel 2 toggle
  if (url.pathname === '/api/goals/channel2') {
    if (req.method === 'GET') {
      if (channel2Enabled) buildGoalsBlock(); // refresh for dev panel
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getChannel2Status()));
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const parsed = safeParse(body);
        if (parsed.ok && parsed.data && typeof parsed.data.enabled === 'boolean') {
          channel2Enabled = parsed.data.enabled;
        } else {
          channel2Enabled = !channel2Enabled;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: channel2Enabled }));
      });
      return;
    }
  }

  // Goals module routes (GET /api/goals, POST /api/goals/*)
  if (url.pathname.startsWith('/api/goals')) {
    if (req.method === 'GET') {
      handleGoalsRequest('GET', url.pathname, {}, res);
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const parsed = safeParse(body);
        handleGoalsRequest('POST', url.pathname, parsed.ok ? parsed.data || {} : {}, res);
      });
      return;
    }
  }

  // API: call model
  if (req.method === 'POST' && url.pathname === '/api/chat') {
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

      // Channel 2: inject goals context block into system prompt
      let finalSystemPrompt = systemPrompt;
      if (channel2Enabled) {
        const block = buildGoalsBlock();
        if (block) finalSystemPrompt = systemPrompt + '\n\n' + block;
      } else {
        lastChannel2 = { block: '', tokensEst: 0, truncated: [] };
      }

      // Verbal closure flag: inject service instruction when signal active and not yet verbally announced
      if (shouldAddVerbalFlag()) {
        finalSystemPrompt = finalSystemPrompt + '\n\n[СЛУЖЕБНОЕ: в Целях лежит новое услышанное, человек не смотрел. При закрытии разбора добавь хвост-строку.]';
      }

      try {
        let text;
        if (cfg.mode === 'local') {
          text = await callLocalCLI(finalSystemPrompt, messages);
        } else {
          if (!cfg.apiKey) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'no_key', message: 'API key is not set. Open settings (⚙).' }));
            return;
          }
          text = await callAnthropicAPI(cfg.apiKey, cfg.model, finalSystemPrompt, messages);
        }

        // Detect verbal tail string → mark verbal announced
        if (detectTailString(text)) {
          announcedVerbal = true;
          console.log('[harvest] verbal tail detected, announcedVerbal=true');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));

        // Fire harvest async (non-blocking, silent failure on error)
        const prevAgentMsg = messages.length >= 2 && messages[messages.length - 2]?.role === 'assistant'
          ? messages[messages.length - 2].content : '';
        const userTurn = messages[messages.length - 1]?.content || '';
        setImmediate(() => {
          runHarvest(prevAgentMsg, userTurn, HARVEST_SESSION_ID).catch(e =>
            console.error('[harvest] async error:', e.message)
          );
        });

      } catch (e) {
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

server.listen(PORT, () => {
  console.log(`NAGARCOT running at http://localhost:${PORT}`);
});
