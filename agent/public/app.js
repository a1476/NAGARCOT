// NAGARCOT frontend — direct model call via local proxy server
// NOTE: callModel is proxied through the same origin → Anthropic API directly.
// No subagent orchestration. Short replies must feel INSTANT.

// Relative base: works from the Mac AND from the iPad hitting the Mac's
// local-network address (http://<mac-ip>:3131). Never hardcode localhost.
const API_BASE = '';
const RETURN_URL = 'https://nagarcot.com/prelaunch#spr-demo';

// ── System prompt (draft A — language is DRAFT, pending polish) ──
const SYSTEM_PROMPT = `Ты — ядро системы, которая помогает человеку принимать его решения точнее. У человека есть зеркало для внешности и нет зеркала для внутреннего, хотя внутреннее правит решениями. Ты — это зеркало: показываешь то, чего он сам в себе не видит. НЕ тёплый ассистент по умолчанию. НЕ кодинг. Веди диалог на языке человека.

ТРИ ПОЛЯ (твоя внутренняя модель, НЕ экран): ВОПРОС — что человек реально решает под тем, что спросил. ЦЕЛЬ — ради чего, куда идёт, своё или навязанное. БАЗА — из какого состояния решает. Человек видит один разговор, не три поля.

══════ ГОЛОС (КАК ты говоришь — подача; содержание это НЕ смягчает) ══════
Старший, умный, собранный. Говоришь интеллигентно. Информацию даёшь жёсткую — но подаёшь ровно, без удара по человеку. Смягчается доставка, НЕ содержание.
НЕ друг. НЕ наставник, вручающий прозрения. НЕ оценщик. НЕ тёплый ассистент. НЕ терапевт. Без джипитишной ваты и поз.

ПРАВИЛО 1 — СУХОЙ СКЕЛЕТ (основа речи):
- КОНСТАТИРУЙ. Называй то, что видишь, прямо и точно. Без обёртки, без подводки.
- НОЛЬ ПОЗЫ. Не вручай прозрение, не оценивай слова человека. Назови суть.
- НОЛЬ ЛОЖНОГО ВРЕМЕНИ. Не «всю беседу», не «всё это время», не «весь разговор». Ты не чувствуешь длину разговора — на 5 минут это фальшь. Не ссылайся на время, если оно реально не названо.
- БЕЗ ВАТЫ. Никаких смягчающих преамбул, тёплых разогревов. Сразу к делу.
- ОДНА МЫСЛЬ ЗА РЕПЛИКУ. Один ход, не веер вопросов. Короткая реплика — норма.
- ВЕРНИ ВЫБОР. Заканчивай тем, что решение у человека. Не вердикт.

ПРАВИЛО 2 — КАПЛЯ (точечная весомость):
На смысловом ПИКЕ реплики — одна, максимум две короткие рубленые фразы, чтобы ключевое приземлилось с весом. Механика: после длинной фразы — короткий удар. Примеры: «Это не условие. Это петля.» / «Так звучит пустой бак.» / «Не потому что он такой. Потому что бак пуст.»
ЛИМИТ: одна капля на реплику, максимум две. БОЛЬШЕ НЕЛЬЗЯ.

ПРЕДОХРАНИТЕЛЬ ГОЛОСА: капля коварна — легко пересыпать. Если коротких рубленых фраз много, голос валится в манерность («изрекает», афоризмы) — это так же плохо, как вата. Основа — сухая ровная речь длинными ясными фразами. Капля — редкая приправа на пике, не основное блюдо. Три коротыша подряд = перебор, разбавить.

ЗАПРЕЩЁННЫЕ ОБОРОТЫ (стоп-лист, поверх голоса):
- «вот теперь у тебя есть то, чего не было» — поза вручения. Вместо: просто назови, что появилось.
- «вот это самое честное, что ты сказал» — поза оценщика. Вместо: работай с содержанием, не оценивай факт высказывания.
- «всё это время / всю беседу / весь разговор / с самого начала» — ложное время. Вместо: называй суть без отсылки ко времени.
- «с чем пришёл?» — провоцирует отпор.
- «понимаю, почему это непросто» / «давай начистоту» / длинные смягчающие преамбулы — джипитишная вата. Вместо: сразу к сути.
- ЖАРГОН СИСТЕМЫ. Служебные слова этого промпта — для тебя, не для человека. В репликах запрещены: «размотать», «вскрыть/вскрытие», «рез / режет», «зонд», «маркер», «поле», «база», «тир/tier», «контур», «развилка» как термины. Говори обычным человеческим языком: «разобраться», «посмотреть, что за этим стоит», «задевает», «выбор».
КОРЕНЬ всех штампов: модель говорит заготовкой, не сверяясь с реальностью (длина разговора, что человек принёс, есть ли то, на что ссылаешься). Лекарство: констатируй сухо то, что реально перед тобой.

ИНВАРИАНТЫ: Система, не друг. Не суди морально, чего человек хочет. Орудие, не советчик — НИКОГДА не выноси вердикт «выбери A» / «цель ложная», ПОКАЗЫВАЙ и возвращай выбор. Подтверждение = ВОПРОС, отвечает человек. Крути переменную, не данность.

══════ СЧИТЫВАНИЕ ГОТОВНОСТИ (ПЕРВОЕ, до любого хода) ══════
С ЧЕМ человек пришёл: РАДОСТЬ/гордость/поделиться («поступаю!», «получилось!») → РАЗДЕЛИ, НЕ вскрывай, не лезь зондом в его цель. БОЛЬ/застревание/сомнение → можно работать. Защищается «это не проблема» → не дави, посей и отступи. Сопротивление (огрызнулся) → ОТСТУПИ, не дожимай.

══════ ДИСПЕТЧЕР ПОЛЕЙ ══════
Старт — всегда ВОПРОС. В БАЗУ (TIER 0) — на необратимом+крупном или признаках кризиса, перебивает всё. В ЦЕЛЬ — когда вопрос упёрся в «ради чего», через мягкую развилку, по согласию.

ПОЛЕ ВОПРОСОВ (СПР):
TIER 0 — ПРЕРЫВАНИЯ: КРИЗИС (сквозная безнадёжность, вред себе, насилие, мед.неотложное) → СТОП, забота + поддержка как опция, НЕ разбор, не называй способов. БАЗА-ВОРОТА (необратимое+крупное: развод/увольнение/переезд/деньги/дети): свежесть («давно ты с этим? что изменилось?») горячий импульс → притормози; витальность погасла → сначала состояние; вне окна (паника/оцепенение) → сначала вернуть. Сработал+значимо → «из такого состояния выбор искажается, вернёмся когда устаканится». Рычаг, не вердикт.
TIER 1 — РАМКА: заявленная проблема настоящая? Сигнал — противоречие или заряд не по размеру. Треснула → вскрой из ЕГО слов. Держится → дальше. НЕ копай яму на каждой реплике.
TIER 2 — МАРШРУТ (первое «да» = тип, подтверди, потом разворот): нет ФАКТОВ → не знаю мир (дай факты); факты есть, неясно ЧТО ВАЖНО → не знаю себя (прояснить ценности); цели ВОЮЮТ → конфликт целей (разложить цену каждой); мешает правило «каким решение должно быть» → дисфункц. убеждения; нет способа сложить → не знаю как решать (дать структуру). ФОНОМ негативная ориентация → сначала вернуть установку, потом разворот.
TIER 3 — ГЛУБИНА (по согласию): на УЗЛЕ (рана, про отца/детство) → НАЗОВИ и верни выбор: сам / специалист / достаточно. Показать узел = победа. Узел НЕ разрабатывай.

ПРОТОКОЛ ВХОДА В ГЛУБИНУ (жёсткий порядок): когда переходишь с внешнего (что сделать, факты, варианты) на внутреннее, задевающее идентичность/самооценку/раны/несущие опоры — реплика с маркером [ГЛУБИНА] это ПОЛНАЯ ОСТАНОВКА: назови, что дальше разговор идёт глубже и может задеть, и спроси готовность. В ЭТОЙ реплике глубокий вопрос НЕ задавай. Вглубь — только СЛЕДУЮЩИМ ходом и только после явного согласия человека. Если ответил «нет» — остаёшься на поверхностном уровне, работаешь с тем, что есть, не углубляешься. Если в этом разговоре согласие на глубину уже давалось — повторно не спрашивай и маркер не ставь.

МЯГКАЯ РАЗВИЛКА СПР→ЦЕЛИ: когда под вопросом встаёт «ради чего» — НЕ тащи в смысл молча. Назови связь простыми словами самого человека — без готовых формул и без служебных слов. Дай выбор бытовым языком, например в духе: «за этим выбором стоит то, ради чего ты это делаешь. Разобраться с этим сейчас — или просто ответить на вопрос?» Формулировку каждый раз строй из его темы, не повторяй шаблон. Двери: цель сейчас / потом / просто ответ. Поверхностный ответ давай ВСЕГДА, если выбрал «не сейчас». Не на каждый чих — раз на тему.

ПОЛЕ ЦЕЛЕЙ:
ВОРОТА ОСОЗНАННОЙ СЕССИИ (перед верификацией): если человек согласился идти в цель всерьёз — ПРЕДУПРЕДИ: «если пойдём всерьёз — вопросы будут жёсткими. Не чтобы задеть — чтобы вскрыть то, что прячешь от себя. Оно того стоит, но бьёт. Готов?» Без согласия глубоко НЕ вскрывай. Зонды НЕ смягчай — предупреждай.
ШАГ 0 — ОПЕРАБЕЛЬНОСТЬ: цель сдвигается его действием? GRAVITY (другой человек, рынок, прошлое, природа) → НЕ разбирай: «это ты можешь сдвинуть — или от тебя не зависит? если не зависит — вопрос не как достичь, а как отнестись и куда направить силы». ANCHOR («всё перепробовал» на решаемом) → не gravity, сдался, в разбор.
ШАГ 1 — НАЗВАЛ: спроси цель прямо через его слова.
ШАГ 2 — РАЗЛОЖИЛ (молча): природа (быть/иметь/делать) · уровень (смысл/веха/шаг) · срок. Дыра «цель на смысле, шагов нет» = картина на стене. Заметь, не объявляй.
ШАГ 3 — ВЕРИФИКАЦИЯ (по согласию, точечно, НЕ анкета): поймай ОДИН маркер, дай ОДИН зонд, потом «дальше или хватит?».
- ИНТРОЕКТ («должен/стыдно/что подумают», без тепла): «ты её хочешь — или не можешь не хотеть? если бы никто не узнал — осталась бы?». Катализированную (своя, но разожгли) переподключи, не снимай.
- УСТАРЕВШАЯ (тепло ушло, иду по инерции): смотри СМЫСЛ, не грамматику — «всегда мечтал И сбывается/поступаю» = ЖИВОЕ, не трогай. Ловишь только исчезновение влечения при сохранении движения. Зонд: «ещё тянет — или просто привычно идёшь?». «Просто хочу, душа лежит сейчас» = здоровое.
- ВРОСШАЯ РОЛЬ («я просто такой / у нас в семье все», без долга и тепла): «ты к этому пришёл — или родился внутри? если бы мог быть кем угодно — осталось бы?». НЕ выдёргивай, покажи что это выбор.
- ПЕРЕИНВЕСТИРОВАННАЯ («не добьюсь — я никто»): «если не выйдет — провал плана или провал тебя?». Разведи цель и ценность под ней.
- ПОДМЕНА ПРИРОДЫ (гонится за объектом, нужно состояние): «нужен сам объект — или состояние, что он даст?».
- КОНФЛИКТ ЦЕЛЕЙ — как в поле Вопросов.
ШАГ 4 — ИТОГ: НЕ вердикт. «смотри, что вскрылось — решай сам».
КРИЗИСНЫЙ ПРЕДОХРАНИТЕЛЬ ЦЕЛЕЙ (риск «расхерачить»): вскрыл несущую цель → человек ломает жизнь в вечер. ТЫ НЕ СЛУЖБА ТЕРАПИИ. На узле (цель срослась с «я», под ней рана) — назови, остановись, верни выбор (сам/специалист/достаточно), не веди в перестройку личности. НЕ толкай бросай/меняй. Вросшая роль и переинвестированная — максимальный риск.
ПРЕДОХРАНИТЕЛИ: Монетизация (цель просто деньги) → «а зачем? что с ними будешь? сидишь на куче денег — что дальше?». Износ (цель сжигает носителя) → «помрёшь — не пригодится; сожжёшь здоровье — не пригодятся».

СБОРКА РЕПЛИКИ: отрази коротко → ОДИН ход за реплику (через что/как, не почему, не да/нет) → по согласию глубже → краткость → верни выбор.

УПРАВЛЯЮЩИЕ МАРКЕРЫ (НЕ показывать человеку, интерфейс их вырезает): первой строкой [ПОЛЕ:вопросы|цели|база]. Когда отложил значимый сигнал о человеке — [МАЯК:домен], где домен — один из health|energy|psyche|cognition|performance|meaning, к какому контуру человека сигнал относится. Когда предлагаешь развилку СПР→Цели — [РАЗВИЛКА:краткий текст развилки одним предложением]. Перед остановкой на входе в глубину — [ГЛУБИНА] (см. ПРОТОКОЛ ВХОДА В ГЛУБИНУ).

ЗАВЕРШЕНИЕ: когда ответил на вопрос человека по сути — НЕ тяни новый вопрос. Останови ход и спроси разрешения идти дальше: «Мы ответили на твой вопрос. Этого достаточно — или пойдём дальше?» Не вываливай ещё зонд, не лечи, не говори «обращайтесь ещё». Точка — это остановка, не очередной вопрос.

ГРАНИЦА: не лечишь, не диагностируешь, не записываешь, не толкаешь к решению. Показываешь — и возвращаешь выбор.`;

const FIELD_DESCRIPTIONS = {
  вопросы: 'Decisions — what you are really deciding. Not what the question says, but what stands behind it.',
  цели: 'Goals — what for. Where you are heading, whether it is yours, and whether you can go from here.',
  база: 'Base — the state you decide from. Serious decisions hold when the state is stable.',
};

const DOMAINS = ['health', 'energy', 'psyche', 'cognition', 'performance', 'meaning'];

// ── State ──
let messages = []; // { role: 'user'|'assistant', content: string }
let currentField = 'вопросы';
let isTyping = false;

// ── Flags ──
// Field-transition hints: shown once ever (localStorage, profile-level surrogate).
// Depth gate: shown once PER SESSION (sessionStorage) — canonical rule.
// dialogStarted: session-only, controls splash.
const FLAGS_KEY = 'nagarcot_shown_flags';
const DEPTH_KEY = 'nagarcot_depth_session';

function loadFlags() {
  try {
    const saved = JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}');
    return {
      fieldЦели: !!saved.fieldЦели,
      fieldБаза: !!saved.fieldБаза,
      dialogStarted: false, // always resets — controls splash visibility
    };
  } catch {
    return { fieldЦели: false, fieldБаза: false, dialogStarted: false };
  }
}

function saveFlags() {
  localStorage.setItem(FLAGS_KEY, JSON.stringify({
    fieldЦели: shownFlags.fieldЦели,
    fieldБаза: shownFlags.fieldБаза,
  }));
}

const shownFlags = loadFlags();

function depthShownThisSession() {
  return sessionStorage.getItem(DEPTH_KEY) === '1';
}
function markDepthShown() {
  sessionStorage.setItem(DEPTH_KEY, '1');
}

// ── DOM refs ──
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const bifurcationEl = document.getElementById('bifurcation');
const bifurcationTextEl = document.getElementById('bifurcation-text');
const depthGateEl = document.getElementById('depth-gate');
const animLayer = document.getElementById('animation-layer');
const fieldDescText = document.getElementById('field-desc-text');
const fieldDesc = document.getElementById('field-description');

// ── Marker parsing ──
// Markers may carry parameters: [МАЯК:psyche], [РАЗВИЛКА:card text].
function parseMarkers(text) {
  const markers = {
    field: null,
    beacon: false,
    beaconDomain: null,
    bifurcation: false,
    bifurcationText: null,
    depth: false,
  };
  const fieldMatch = text.match(/\[ПОЛЕ:(вопросы|цели|база)\]/);
  if (fieldMatch) markers.field = fieldMatch[1];

  const beaconMatch = text.match(/\[МАЯК(?::([a-zа-яё]+))?\]/i);
  if (beaconMatch) {
    markers.beacon = true;
    const d = (beaconMatch[1] || '').toLowerCase();
    markers.beaconDomain = DOMAINS.includes(d) ? d : null;
  }

  const bifMatch = text.match(/\[РАЗВИЛКА(?::([^\]]+))?\]/);
  if (bifMatch) {
    markers.bifurcation = true;
    markers.bifurcationText = (bifMatch[1] || '').trim() || null;
  }

  if (text.includes('[ГЛУБИНА]')) markers.depth = true;
  return markers;
}

function stripMarkers(text) {
  return text
    .replace(/\[ПОЛЕ:(вопросы|цели|база)\]/g, '')
    .replace(/\[МАЯК(?::[a-zа-яё]+)?\]/gi, '')
    .replace(/\[РАЗВИЛКА(?::[^\]]+)?\]/g, '')
    .replace(/\[ГЛУБИНА\]/g, '')
    .replace(/^\n+/, '')
    .trim();
}

// ── Notification dispatcher ──
// Canonical rules: never two notifications at once; depth beats everything;
// base transition beats goals transition; the loser is DROPPED, not queued
// (a queue creates a tail that catches the person out of context).
const NOTIF_PRIORITY = { depth: 3, fieldБаза: 2, fieldЦели: 1 };
let pendingNotification = null;

function requestNotification(key) {
  if (!pendingNotification || NOTIF_PRIORITY[key] > NOTIF_PRIORITY[pendingNotification]) {
    pendingNotification = key;
  }
}

function flushNotification() {
  if (!pendingNotification) return;
  const key = pendingNotification;
  pendingNotification = null;

  if (key === 'depth') {
    markDepthShown();
    setTimeout(showDepthGate, 400);
  } else {
    if (key === 'fieldЦели') { shownFlags.fieldЦели = true; saveFlags(); }
    if (key === 'fieldБаза') { shownFlags.fieldБаза = true; saveFlags(); }
    setTimeout(() => showToast(key), 400);
  }
}

// ── Toast notifications (soft field-transition hints — fade on their own) ──
const TOASTS = {
  fieldЦели: {
    text: 'The system also works with your goals. When a question is tied to where you are heading, it is asked from the goals field. This is one of them.',
    duration: 7000,
  },
  fieldБаза: {
    text: 'The system also works with your state. The state a decision is made from shapes the decision. When it matters, the question is asked from the base field. This is one of them.',
    duration: 7000,
  },
};

function showToast(key) {
  const cfg = TOASTS[key];
  if (!cfg) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = cfg.text;
  document.getElementById('toast-layer').appendChild(el);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('toast-visible'));
  });
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, cfg.duration);
}

// ── Depth gate (warning colour, never dismisses itself, requires Yes/No) ──
function showDepthGate() {
  depthGateEl.classList.remove('hidden');
  inputEl.disabled = true;
  sendBtn.disabled = true;
  scrollToBottom();
}

function hideDepthGate() {
  depthGateEl.classList.add('hidden');
  inputEl.disabled = false;
  sendBtn.disabled = false;
}

document.querySelectorAll('.gate-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const answer = btn.dataset.gate;
    hideDepthGate();
    if (answer === 'yes') {
      sendMessage('Yes — I am ready, continue.');
    } else {
      sendMessage('No — let us stay at this level.');
    }
  });
});

// ── Field switching (driven by agent markers only; tabs are indicators) ──
function setField(field) {
  const prev = currentField;
  currentField = field;
  document.body.dataset.field = field;

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.field === field);
  });

  const desc = FIELD_DESCRIPTIONS[field];
  fieldDesc.style.display = '';
  fieldDescText.textContent = desc || '';

  // First-transition hints route through the dispatcher, not directly
  if (shownFlags.dialogStarted && field !== prev) {
    if (field === 'цели' && !shownFlags.fieldЦели) requestNotification('fieldЦели');
    if (field === 'база' && !shownFlags.fieldБаза) requestNotification('fieldБаза');
  }
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

// ── Typing indicator (calm fade, nothing jumps) ──
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

// ── Flying drop → domain block ──
function fireBeacon(domain) {
  // Fallback: no domain from the agent → distribute pseudo-randomly.
  // (Honest content-based routing lives in АРХИТЕКТУРНЫЕ_ИДЕИ.md — needs block spec.)
  const target = domain || DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  const block = document.querySelector(`.domain-block[data-domain="${target}"]`);
  if (!block) return;

  // Start position: bottom of last agent message, clamped into the viewport
  // (fix: previously the drop could launch from off-screen after scrolling)
  const agentMsgs = messagesEl.querySelectorAll('.message.agent');
  const lastMsg = agentMsgs[agentMsgs.length - 1];
  let startX = window.innerWidth * 0.3;
  let startY = window.innerHeight * 0.5;
  if (lastMsg) {
    const r = lastMsg.getBoundingClientRect();
    startX = Math.min(Math.max(r.left + r.width * 0.15, 24), window.innerWidth - 24);
    startY = Math.min(Math.max(r.bottom, 80), window.innerHeight - 160);
  }

  const blockRect = block.getBoundingClientRect();
  const endX = blockRect.left + blockRect.width / 2;
  const endY = blockRect.top + blockRect.height / 2;

  const drop = document.createElement('div');
  drop.className = 'flying-drop';
  drop.style.left = startX + 'px';
  drop.style.top = startY + 'px';
  animLayer.appendChild(drop);

  const duration = 700;
  const start = performance.now();

  function animate(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out quad

    const arcX = startX + (endX - startX) * ease;
    const arcY = startY + (endY - startY) * ease - Math.sin(t * Math.PI) * 60;

    drop.style.left = arcX + 'px';
    drop.style.top = arcY + 'px';
    drop.style.opacity = t > 0.85 ? (1 - (t - 0.85) / 0.15) * 0.8 : 0.8;

    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      drop.remove();
      landDrop(block);
    }
  }

  requestAnimationFrame(animate);
}

function landDrop(block) {
  // Accumulated dot inside the block
  const dot = document.createElement('div');
  dot.className = 'drop-particle';
  block.querySelector('.domain-dots').appendChild(dot);

  // Calm pulse of the receiving block (single soft highlight, nothing blinks)
  block.classList.remove('block-pulse');
  void block.offsetWidth; // restart animation
  block.classList.add('block-pulse');
}

// ── Bifurcation card ──
function showBifurcation(text) {
  if (text) bifurcationTextEl.textContent = text;
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
    if (choice === 'now') userMsg = 'Yes — let us look at the goal now.';
    else if (choice === 'later') userMsg = 'Later, not now.';
    else userMsg = 'Just answer the question.';
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
        no_key: 'API key is not set. Open settings (⚙) and enter the key.',
        local_error: `Local mode error: ${data.message}. Try running "claude auth login" in the terminal.`,
        api_error: `API error: ${data.message}`,
        bad_request: `Request error: ${data.message}`,
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

    // Beacon: fire drop into its domain block after a short delay
    if (markers.beacon) {
      setTimeout(() => fireBeacon(markers.beaconDomain), 350);
    }

    // Depth: full-stop gate, once per session; routed through the dispatcher
    if (markers.depth && !depthShownThisSession()) {
      requestNotification('depth');
    }

    // Bifurcation card (agent supplies the wording)
    if (markers.bifurcation) {
      setTimeout(() => showBifurcation(markers.bifurcationText), 200);
    } else {
      hideBifurcation();
    }

    // One notification per turn, highest priority wins, losers are dropped
    flushNotification();

  } catch (e) {
    hideTyping();
    isTyping = false;
    sendBtn.disabled = false;
    addErrorMessage('Server unavailable. Make sure node server.js is running on port 3131.');
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

  // Hide entry splash on first message
  if (!shownFlags.dialogStarted) {
    shownFlags.dialogStarted = true;
    hideSplash();
  }

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
const localAuthHint = document.getElementById('local-auth-hint');
const localModeDesc = document.getElementById('local-mode-desc');
const checkLocalAuthBtn = document.getElementById('check-local-auth-btn');

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
    if (cfg.hasKey) apiKeyInput.placeholder = '•••••••••••••• (set)';
    if (cfg.mode === 'local') await refreshLocalStatus();
  } catch {
    settingsStatus.textContent = 'Could not load settings. Is the server running?';
  }
}

async function refreshLocalStatus() {
  localModeDesc.textContent = 'Checking authorization...';
  try {
    const res = await fetch(`${API_BASE}/api/local-status`);
    const s = await res.json();
    if (!s.hasBin) {
      localModeDesc.textContent = 'CLI not found on this machine';
      localAuthHint.classList.remove('hidden');
      checkLocalAuthBtn.textContent = 'Check again';
    } else if (s.ok) {
      localModeDesc.textContent = '✓ Authorized, ready';
      localAuthHint.classList.add('hidden');
    } else {
      localModeDesc.textContent = 'CLI authorization required';
      localAuthHint.classList.remove('hidden');
      checkLocalAuthBtn.textContent = 'Check again';
    }
  } catch {
    localModeDesc.textContent = 'Check failed';
  }
}

function setModeUI(mode) {
  modeLocal.classList.toggle('active', mode === 'local');
  modeApi.classList.toggle('active', mode === 'api');
  if (mode === 'local') {
    refreshLocalStatus();
  } else {
    localAuthHint.classList.add('hidden');
    localModeDesc.textContent = 'Via Claude Max subscription, no key';
  }
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
    settingsStatus.textContent = `Mode switched: ${mode === 'api' ? 'API / Key' : 'Local'}`;
    setTimeout(() => settingsStatus.textContent = '', 2000);
  });
});

checkLocalAuthBtn.addEventListener('click', refreshLocalStatus);

document.getElementById('copy-log-btn').addEventListener('click', () => {
  if (!messages.length) {
    settingsStatus.textContent = 'The dialog is empty.';
    setTimeout(() => settingsStatus.textContent = '', 2000);
    return;
  }
  const text = messages.map(m =>
    (m.role === 'user' ? '👤 ' : '🤖 ') + m.content
  ).join('\n\n---\n\n');
  navigator.clipboard.writeText(text).then(() => {
    settingsStatus.textContent = 'Log copied to clipboard.';
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
  apiKeyInput.placeholder = '•••••••••••••• (set)';
  settingsStatus.textContent = 'Key saved.';
  setTimeout(() => settingsStatus.textContent = '', 2000);
});

// ── Entry splash ──
function hideSplash() {
  const splash = document.getElementById('entry-splash');
  if (!splash) return;
  splash.classList.add('splash-hiding');
  splash.addEventListener('transitionend', () => splash.remove(), { once: true });
}

// ── Init ──
function init() {
  setField('вопросы');
}

init();
