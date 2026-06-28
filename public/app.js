// NAGARCOT frontend — direct model call via local proxy server
// NOTE: callModel is proxied through localhost:3131 → Anthropic API directly.
// No subagent orchestration. Short replies must feel INSTANT.

const API_BASE = 'http://localhost:3131';

// ── System prompt (draft A — language is DRAFT, pending polish) ──
const SYSTEM_PROMPT = `Ты — ядро системы, которая помогает человеку принимать его решения точнее. У человека есть зеркало для внешности и нет зеркала для внутреннего, хотя внутреннее правит решениями. Ты — это зеркало: показываешь то, чего он сам в себе не видит. НЕ тёплый ассистент по умолчанию. НЕ кодинг.

[ЯЗЫК ЧЕРНОВОЙ — подлежит отдельной внимательной полировке. Не финал.]

ТРИ ПОЛЯ (твоя внутренняя модель, НЕ экран):
- ВОПРОС — что человек реально решает под тем, что спросил.
- ЦЕЛЬ — ради чего; куда идёт; своё или навязанное.
- БАЗА — из какого состояния решает; можно ли отсюда решать.
Человек видит один разговор, не три поля.

═══ КРАТКОСТЬ (ВАЖНО) ═══
Реплика короткая И ёмкая. ОДИН ход за реплику — один зонд, не веер из вопросов. Один удар, который попадает. НЕ вываливай всё, что знаешь. Длинно — ТОЛЬКО когда человек сам пришёл за глубоким разбором и согласился. По умолчанию — коротко.

ИНВАРИАНТЫ:
- Система, не друг. Без лести, без догадок о чувствах. Не суди морально, чего человек хочет.
- Орудие, не советчик. НИКОГДА не выноси вердикт «выбери A» / «цель ложная». ПОКАЗЫВАЙ, возвращай выбор.
- Подтверждение = ВОПРОС, отвечает человек. Не диагноз.
- Крути переменную, не данность. Возвращай отсутствующее.

═══ СЧИТЫВАНИЕ ГОТОВНОСТИ (ПЕРВОЕ, до любого хода — КРИТИЧНО) ═══
С ЧЕМ человек пришёл:
- РАДОСТЬ / гордость / поделиться → РАЗДЕЛИ, НЕ вскрывай. Поддержи, задай простой человеческий вопрос. НЕ лезь зондом в его цель.
- БОЛЬ / застревание / сомнение / «не знаю что делать» → можно работать, вскрывать.
- Защищается → не дави, посей и отступи.
- Сопротивление (огрызнулся, закрылся) → ОТСТУПИ, НЕ дожимай.

═══ ДИСПЕТЧЕР ПОЛЕЙ ═══
- Старт — всегда ВОПРОС.
- В БАЗУ (TIER 0) — на необратимом+крупном или признаках кризиса. Перебивает всё.
- В ЦЕЛЬ — когда вопрос упёрся в «ради чего», ЧЕРЕЗ мягкую развилку, по согласию.

═══ ПОЛЕ ВОПРОСОВ (СПР) ═══
TIER 0 — ПРЕРЫВАНИЯ:
• КРИЗИС (сквозная безнадёжность, вред себе, насилие, мед.неотложное) → СТОП. Забота + поддержка как опция.
• БАЗА-ВОРОТА (необратимое+крупное): свежесть, витальность, окно — горячий импульс → притормози.

TIER 1 — РАМКА: заявленная проблема настоящая? Треснула → вскрой. Держится → дальше.

TIER 2 — МАРШРУТ:
- нет ФАКТОВ → дай факты, не вердикт
- факты есть, неясно ЧТО ВАЖНО → прояснить ценности
- цели ВОЮЮТ → разложить цену каждой
- мешает правило → вскрыть мягко
- нет способа сложить → дать структуру

TIER 3 — ГЛУБИНА (по согласию): на УЗЛЕ — назови и верни выбор. Узел НЕ разрабатывай.

═══ МЯГКАЯ РАЗВИЛКА СПР→ЦЕЛИ ═══
Когда под вопросом встаёт «ради чего» — назови связь, дай выбор:
«за этим выбором — твоя цель. Размотать сейчас — или просто ответить по поверхности?»
Двери: цель сейчас / потом / просто ответ. Поверхностный ответ давай ВСЕГДА, если выбрал «не сейчас».

═══ ПОЛЕ ЦЕЛЕЙ ═══
ВОРОТА ОСОЗНАННОЙ СЕССИИ: если человек согласился идти в цель всерьёз — ПРЕДУПРЕДИ:
«если пойдём всерьёз — вопросы будут жёсткими. Готов?»

ШАГ 0 — ОПЕРАБЕЛЬНОСТЬ: цель сдвигается его действием?
ШАГ 1 — НАЗВАЛ: спроси цель прямо через его слова.
ШАГ 2 — РАЗЛОЖИЛ: природа / уровень / срок.
ШАГ 3 — ВЕРИФИКАЦИЯ (по согласию, один маркер, один зонд):
- ИНТРОЕКТ / УСТАРЕВШАЯ / ВРОСШАЯ РОЛЬ / ПЕРЕИНВЕСТИРОВАННАЯ / ПОДМЕНА ПРИРОДЫ / КОНФЛИКТ
ШАГ 4 — ИТОГ: «смотри, что вскрылось — решай сам».

═══ СБОРКА РЕПЛИКИ ═══
Отрази коротко → ОДИН зонд → по согласию глубже → КРАТКОСТЬ → верни выбор.
ГРАНИЦА: не лечишь, не диагностируешь, не толкаешь к решению. Показываешь — и возвращаешь выбор.

═══ УПРАВЛЯЮЩИЕ МАРКЕРЫ (для интерфейса — НЕ показывай человеку как текст) ═══
В КАЖДОМ ответе первой строкой ставь маркер активного поля:
[ПОЛЕ:вопросы] | [ПОЛЕ:цели] | [ПОЛЕ:база]
Когда отложил сигнал о человеке вниз (увидел про него что-то значимое — состояние, паттерн, узел):
[МАЯК]
Когда предлагаешь мягкую развилку СПР→Цели:
[РАЗВИЛКА]
Маркеры — служебные, интерфейс их вырежет и не покажет. Текст реплики пиши как обычно.`;

const FIELD_DESCRIPTIONS = {
  вопросы: 'СПР — что вы реально решаете. Не то, что звучит в вопросе, а то, что стоит за ним.',
  цели: 'Цели — ради чего. Куда вы идёте, своё это или навязанное, и можно ли отсюда идти.',
  база: null, // placeholder tab
};

// ── State ──
let messages = []; // { role: 'user'|'assistant', content: string }
let currentField = 'вопросы';
let isTyping = false;

// ── DOM refs ──
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const bifurcationEl = document.getElementById('bifurcation');
const dropsContainer = document.getElementById('drops-container');
const animLayer = document.getElementById('animation-layer');
const fieldDescText = document.getElementById('field-desc-text');
const fieldDesc = document.getElementById('field-description');

// ── Marker parsing ──
function parseMarkers(text) {
  const markers = { field: null, beacon: false, bifurcation: false };
  const fieldMatch = text.match(/\[ПОЛЕ:(вопросы|цели|база)\]/);
  if (fieldMatch) markers.field = fieldMatch[1];
  if (text.includes('[МАЯК]')) markers.beacon = true;
  if (text.includes('[РАЗВИЛКА]')) markers.bifurcation = true;
  return markers;
}

function stripMarkers(text) {
  return text
    .replace(/\[ПОЛЕ:(вопросы|цели|база)\]/g, '')
    .replace(/\[МАЯК\]/g, '')
    .replace(/\[РАЗВИЛКА\]/g, '')
    .replace(/^\n+/, '')
    .trim();
}

// ── Field switching ──
function setField(field) {
  currentField = field;
  document.body.dataset.field = field;

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.field === field);
  });

  const desc = FIELD_DESCRIPTIONS[field];
  if (desc) {
    fieldDesc.style.display = '';
    fieldDescText.textContent = desc;
  } else {
    fieldDesc.style.display = 'none';
  }
}

// ── Tab clicks ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const field = tab.dataset.field;
    if (field === 'база') {
      setField('база');
      showBaseStub();
    } else {
      setField(field);
    }
  });
});

function showBaseStub() {
  const stub = document.createElement('div');
  stub.className = 'message agent field-база';
  stub.textContent = 'Здесь со временем накапливается понимание вашего базового состояния. Серьёзные решения стоит принимать, когда оно стабильно. Отсюда вырастет ваш базовый профиль — связь с тем, что копится внизу.';
  messagesEl.appendChild(stub);
  scrollToBottom();
}

// ── Render message ──
function addMessage(role, text, field) {
  const el = document.createElement('div');
  el.className = `message ${role}`;
  if (role === 'agent' && field) el.classList.add(`field-${field}`);
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function addErrorMessage(text) {
  const el = document.createElement('div');
  el.className = 'message error';
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Typing indicator ──
function showTyping() {
  const el = document.createElement('div');
  el.className = 'message agent typing-indicator';
  el.id = 'typing-indicator';
  el.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(el);
  scrollToBottom();
}

function hideTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// ── Flying drop animation ──
function fireBeacon() {
  // Find start position: bottom of last agent message
  const agentMsgs = messagesEl.querySelectorAll('.message.agent');
  const lastMsg = agentMsgs[agentMsgs.length - 1];
  if (!lastMsg) return;

  const msgRect = lastMsg.getBoundingClientRect();
  const dropZoneRect = document.getElementById('drop-zone').getBoundingClientRect();

  const startX = msgRect.left + msgRect.width * 0.15;
  const startY = msgRect.bottom;
  const endX = dropZoneRect.left + dropZoneRect.width / 2 + (Math.random() - 0.5) * 80;
  const endY = dropZoneRect.top + dropZoneRect.height * 0.4;

  const drop = document.createElement('div');
  drop.className = 'flying-drop';
  drop.style.left = startX + 'px';
  drop.style.top = startY + 'px';
  drop.style.background = getComputedStyle(document.body).getPropertyValue('--accent').trim();
  animLayer.appendChild(drop);

  const duration = 700;
  const start = performance.now();

  function animate(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out quad

    // Arc: drop slightly toward the centre, then down
    const arcX = startX + (endX - startX) * ease;
    const arcY = startY + (endY - startY) * ease - Math.sin(t * Math.PI) * 60;

    drop.style.left = arcX + 'px';
    drop.style.top = arcY + 'px';
    drop.style.opacity = t > 0.85 ? (1 - (t - 0.85) / 0.15) * 0.8 : 0.8;

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      drop.remove();
      // Add permanent dot to drops container
      const dot = document.createElement('div');
      dot.className = 'drop-particle';
      dot.style.background = getComputedStyle(document.body).getPropertyValue('--accent').trim();
      dropsContainer.appendChild(dot);
    }
  }

  requestAnimationFrame(animate);
}

// ── Bifurcation card ──
function showBifurcation() {
  bifurcationEl.classList.remove('hidden');
  scrollToBottom();
}

function hideBifurcation() {
  bifurcationEl.classList.add('hidden');
}

document.querySelectorAll('.bif-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    hideBifurcation();
    let userMsg = '';
    if (choice === 'now') userMsg = 'Да, давайте разберём цели сейчас.';
    else if (choice === 'later') userMsg = 'Потом, не сейчас.';
    else userMsg = 'Просто ответь на вопрос.';
    sendMessage(userMsg);
  });
});

// ── Call model ──
async function callModel(userText) {
  messages.push({ role: 'user', content: userText });

  isTyping = true;
  sendBtn.disabled = true;
  showTyping();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt: SYSTEM_PROMPT, messages }),
    });

    const data = await res.json();
    hideTyping();
    isTyping = false;
    sendBtn.disabled = false;

    if (data.error) {
      const errMap = {
        no_key: 'API-ключ не задан. Откройте настройки (⚙) и введите ключ.',
        local: 'Режим «Локалка» недоступен. Переключитесь на API-режим в настройках.',
        api_error: `Ошибка API: ${data.message}`,
      };
      addErrorMessage(errMap[data.error] || data.message);
      messages.pop(); // don't keep failed message in history
      return;
    }

    const rawText = data.text;
    const markers = parseMarkers(rawText);
    const cleanText = stripMarkers(rawText);

    // Update field if marker present
    if (markers.field) setField(markers.field);

    // Add to history with clean text
    messages.push({ role: 'assistant', content: cleanText });

    // Render
    addMessage('agent', cleanText, currentField);

    // Beacon: fire drop after a short delay for drama
    if (markers.beacon) {
      setTimeout(fireBeacon, 350);
    }

    // Bifurcation card
    if (markers.bifurcation) {
      setTimeout(showBifurcation, 200);
    } else {
      hideBifurcation();
    }

  } catch (e) {
    hideTyping();
    isTyping = false;
    sendBtn.disabled = false;
    addErrorMessage('Сервер недоступен. Убедитесь, что запущен node server.js на порту 3131.');
    messages.pop();
  }
}

// ── Send ──
function sendMessage(text) {
  text = (text || inputEl.value).trim();
  if (!text || isTyping) return;

  hideBifurcation();
  addMessage('user', text);
  inputEl.value = '';
  inputEl.style.height = 'auto';
  callModel(text);
}

sendBtn.addEventListener('click', () => sendMessage());

inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
});

// ── Settings panel ──
const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const modeLocal = document.getElementById('mode-local');
const modeApi = document.getElementById('mode-api');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const settingsStatus = document.getElementById('settings-status');

function openSettings() {
  settingsOverlay.classList.remove('hidden');
  settingsPanel.classList.remove('hidden');
  loadSettingsUI();
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
  settingsPanel.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

async function loadSettingsUI() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    const cfg = await res.json();
    setModeUI(cfg.mode);
    if (cfg.hasKey) apiKeyInput.placeholder = '•••••••••••••• (задан)';
  } catch {
    settingsStatus.textContent = 'Не удалось загрузить настройки. Сервер запущен?';
  }
}

function setModeUI(mode) {
  modeLocal.classList.toggle('active', mode === 'local');
  modeApi.classList.toggle('active', mode === 'api');
}

[modeLocal, modeApi].forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    setModeUI(mode);
    await fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    settingsStatus.textContent = `Режим переключён: ${mode === 'api' ? 'API / Ключ' : 'Локалка'}`;
    setTimeout(() => settingsStatus.textContent = '', 2000);
  });
});

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  await fetch(`${API_BASE}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key }),
  });
  apiKeyInput.value = '';
  apiKeyInput.placeholder = '•••••••••••••• (задан)';
  settingsStatus.textContent = 'Ключ сохранён.';
  setTimeout(() => settingsStatus.textContent = '', 2000);
});

// ── Init ──
function init() {
  setField('вопросы');
}

init();
