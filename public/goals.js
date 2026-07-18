// Goals module — NC-04 Step 1
// Isolated from SPR dialog. All state lives in server /data/goals.json.

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────────
  let state = null;           // last fetched server state
  let pendingCandidateId = null; // awaiting group picker / hot moment
  let pendingGoalId = null;     // awaiting verify dialog
  let verifyQIndex = 0;
  let verifyStepsDone = 0;

  // ── DOM refs ────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const overlay      = $('goals-overlay');
  const vectorEl     = $('goals-vector');
  const emptyEl      = $('goals-empty');
  const candZone     = $('goals-candidates-zone');
  const candList     = $('goals-candidates-list');
  const activeZone   = $('goals-active-zone');
  const activeList   = $('goals-active-list');
  const historyZone  = $('goals-history-zone');
  const historyList  = $('goals-history-list');
  const irqBar       = $('goals-irq');
  const irqText      = $('goals-irq-text');
  const signalDot    = $('signal-dot');
  const signalTxt    = $('signal-text');

  // Dev panel
  const devSignalState = $('dev-signal-state');
  const devEventLog    = $('dev-event-log');

  // ── API helpers ──────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    return r.json();
  }

  async function getState() {
    state = await api('GET', '/api/goals');
    return state;
  }

  async function cmd(cmdName, args) {
    return api('POST', '/api/goals/cmd', { cmd: cmdName, ...args });
  }

  // ── Signal ───────────────────────────────────────────────────────
  function setSignal(active) {
    if (active) {
      signalDot.classList.remove('hidden');
      signalTxt.classList.remove('hidden');
    } else {
      signalDot.classList.add('hidden');
      signalTxt.classList.add('hidden');
    }
  }

  async function dismissSignal() {
    setSignal(false);
    await cmd('signal_dismiss');
  }

  // ── Render ───────────────────────────────────────────────────────
  const DOOR_SUBTITLES = {
    'Проверить':    'твоя она или «надо»',
    'Собрать путь': 'первый шаг к ней',
    'Как движется': '',
    'Ещё тянет?':   'или уже привычка',
  };

  const STATE_LABELS = {
    'принята':           'принята',
    'проверена':         'проверена',
    'в пути':            'в пути',
    'достигнута':        'достигнута',
    'отпущена':          'отпущена',
    'давно не тронута':  'давно не тронута',
  };

  function warmthBar(w) {
    const pct = Math.round((w || 0) * 100);
    return `<div class="warmth-bar"><div class="warmth-fill" style="width:${pct}%"></div></div>`;
  }

  function pollenTags(pollen) {
    if (!pollen || !pollen.length) return '';
    return pollen.map(p => `<span class="pollen-tag">${p}</span>`).join('');
  }

  function renderCandidates(candidates) {
    candList.innerHTML = '';
    if (!candidates || !candidates.length) {
      candZone.classList.add('hidden');
      return;
    }
    candZone.classList.remove('hidden');
    candidates.forEach(c => {
      const card = document.createElement('div');
      card.className = 'goal-card candidate-card';
      card.dataset.id = c.id;
      const hypLabel = c.isHypothesis ? '<span class="hypothesis-badge">гипотеза</span>' : '';
      card.innerHTML = `
        <div class="card-top">
          <p class="card-text">${c.text}${hypLabel}</p>
          ${warmthBar(c.warmth)}
          <div class="pollen-row">${pollenTags(c.pollen)}</div>
        </div>
        <div class="card-actions">
          <button class="card-btn btn-mine" data-id="${c.id}">Моё</button>
          <button class="card-btn btn-notmine" data-id="${c.id}">Не моё</button>
          <button class="card-btn btn-later" data-id="${c.id}">Позже</button>
        </div>`;
      candList.appendChild(card);
    });
  }

  function goalStateClass(state) {
    const map = {
      'принята': 'state-accepted',
      'проверена': 'state-verified',
      'в пути': 'state-going',
      'достигнута': 'state-achieved',
      'отпущена': 'state-released',
      'давно не тронута': 'state-stale',
    };
    return map[state] || '';
  }

  function renderGoals(goals) {
    activeList.innerHTML = '';
    if (!goals || !goals.length) {
      activeZone.classList.add('hidden');
      return;
    }
    activeZone.classList.remove('hidden');
    goals.forEach(g => {
      const card = document.createElement('div');
      card.className = 'goal-card active-card';
      card.dataset.id = g.id;
      const door = g.door || 'Проверить';
      const subtitle = DOOR_SUBTITLES[door] || '';
      const stateClass = goalStateClass(g.state);
      const detectionLine = g.detection ? `<p class="goal-detection">${g.detection}</p>` : '';
      const verifiedNote = g.verifiedSteps ? `<p class="goal-partial">проверена наполовину (${g.verifiedSteps} шага)</p>` : '';
      const frictionNote = g.frictionShown && !g._frictionDismissed ? `<p class="goal-friction" data-id="${g.id}">⚡ Новая цель может потребовать ресурсов от этой — стоит учесть <button class="friction-close" data-id="${g.id}">✕</button></p>` : '';
      card.innerHTML = `
        <div class="card-top">
          <div class="card-text-row">
            <span class="goal-state-badge ${stateClass}">${STATE_LABELS[g.state] || g.state}</span>
            <p class="card-text">${g.text}</p>
          </div>
          <div class="pollen-row">${pollenTags(g.pollen)}</div>
          ${detectionLine}${verifiedNote}${frictionNote}
        </div>
        <div class="card-actions goal-actions">
          <button class="card-btn btn-door" data-id="${g.id}" data-door="${door}">
            ${door}${subtitle ? `<span class="door-sub"> — ${subtitle}</span>` : ''}
          </button>
          <div class="goal-state-actions">
            <button class="card-btn btn-achieved" data-id="${g.id}">Достигнута</button>
            <button class="card-btn btn-release" data-id="${g.id}">Отпустить</button>
          </div>
        </div>`;
      activeList.appendChild(card);
    });
  }

  function renderHistory(goals) {
    historyList.innerHTML = '';
    if (!goals || !goals.length) {
      historyZone.classList.add('hidden');
      return;
    }
    historyZone.classList.remove('hidden');
    goals.forEach(g => {
      const div = document.createElement('div');
      div.className = 'goal-card history-card';
      div.innerHTML = `<p class="card-text">${g.text}</p><span class="history-state">${g.state}</span>`;
      historyList.appendChild(div);
    });
  }

  function renderVector(vector) {
    if (vector) {
      vectorEl.textContent = vector;
      vectorEl.classList.remove('hidden');
    } else {
      vectorEl.classList.add('hidden');
    }
  }

  function renderDevLog(events) {
    if (!devEventLog) return;
    const last = (events || []).slice(-8).reverse();
    devEventLog.innerHTML = last.map(e =>
      `<div class="dev-log-line"><span class="dev-log-ts">${e.ts.slice(11,19)}</span> ${e.type}</div>`
    ).join('');
    if (devSignalState) {
      devSignalState.textContent = state && state.signal && state.signal.active ? '🟡 активен' : '—';
    }
  }

  async function render() {
    const s = await getState();
    setSignal(s.signal && s.signal.active);
    renderVector(s.vector);
    renderCandidates(s.candidates);
    renderGoals(s.goals);
    renderHistory(s.historyGoals);
    renderDevLog(s.events);

    // Show empty state only if truly empty
    const hasContent = (s.candidates && s.candidates.length) || (s.goals && s.goals.length) || (s.historyGoals && s.historyGoals.length);
    emptyEl.classList.toggle('hidden', !!hasContent);

    // IRQ — show if any goal has frictionShown
    const frictionGoal = s.goals && s.goals.find(g => g.frictionShown && !g._frictionDismissed);
    if (frictionGoal) {
      irqText.textContent = `«${frictionGoal.text}» и новая цель могут конкурировать за ресурс — один из них может тормозить другой`;
      irqBar.classList.remove('hidden');
    } else {
      irqBar.classList.add('hidden');
    }
  }

  // ── Verify dialog ────────────────────────────────────────────────
  const verifyOverlay = $('verify-overlay');
  const verifyGoalText = $('verify-goal-text');
  const verifyQArea = $('verify-question-area');

  function openVerify(goalId, startQuestion) {
    pendingGoalId = goalId;
    verifyQIndex = startQuestion || 0;
    verifyStepsDone = 0;
    const goal = state && state.goals && state.goals.find(g => g.id === goalId);
    verifyGoalText.textContent = goal ? goal.text : '';
    verifyOverlay.classList.remove('hidden');
    renderVerifyQuestion();
  }

  function renderVerifyQuestion() {
    const qs = state && state.verifyQuestions;
    if (!qs || verifyQIndex >= qs.length) {
      // Done
      finishVerify();
      return;
    }
    const q = qs[verifyQIndex];
    const pollenNote = q.pollenNote ? `<span class="verify-pollen">${q.pollenNote}</span>` : '';
    verifyQArea.innerHTML = `
      <p class="verify-q-text">${q.text}${pollenNote}</p>
      <div class="verify-options">
        ${q.options.map((o, i) => `<button class="verify-opt" data-idx="${i}">${o}</button>`).join('')}
      </div>
      <textarea class="verify-free" placeholder="или напиши своё…" rows="2"></textarea>`;
    verifyQArea.querySelectorAll('.verify-opt').forEach(btn => {
      btn.addEventListener('click', () => selectVerifyAnswer(btn.textContent, false));
    });
    verifyQArea.querySelector('.verify-free').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) selectVerifyAnswer(val, true);
      }
    });
  }

  async function selectVerifyAnswer(answer, isFree) {
    await cmd('goal_verify_answer', { id: pendingGoalId, qIndex: verifyQIndex, answer, free: isFree });
    verifyStepsDone++;
    verifyQIndex++;
    if (verifyQIndex >= (state && state.verifyQuestions ? state.verifyQuestions.length : 3)) {
      finishVerify();
    } else {
      renderVerifyQuestion();
    }
  }

  async function finishVerify() {
    await cmd('goal_verify_done', { id: pendingGoalId });
    verifyOverlay.classList.add('hidden');
    pendingGoalId = null;
    await render();
  }

  $('verify-quit').addEventListener('click', async () => {
    if (pendingGoalId) {
      await cmd('goal_verify_quit', { id: pendingGoalId, stepsCompleted: verifyStepsDone });
    }
    verifyOverlay.classList.add('hidden');
    pendingGoalId = null;
    await render();
  });

  // ── Group picker ─────────────────────────────────────────────────
  const groupPicker = $('group-picker');

  function openGroupPicker(candidateId) {
    pendingCandidateId = candidateId;
    groupPicker.classList.remove('hidden');
  }

  groupPicker.querySelectorAll('[data-group]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const group = btn.dataset.group;
      groupPicker.classList.add('hidden');
      const res = await cmd('candidate_mine', { id: pendingCandidateId, group });
      await getState(); // refresh state for hot moment
      openHotMoment(res.goalId, res.startQuestion || 0);
    });
  });

  // ── Hot moment ───────────────────────────────────────────────────
  const hotMoment = $('hot-moment');
  let hotGoalId = null;
  let hotStartQ = 0;

  function openHotMoment(goalId, startQ) {
    hotGoalId = goalId;
    hotStartQ = startQ;
    hotMoment.classList.remove('hidden');
  }

  $('hot-now').addEventListener('click', async () => {
    hotMoment.classList.add('hidden');
    await render();
    openVerify(hotGoalId, hotStartQ);
  });

  $('hot-later').addEventListener('click', async () => {
    hotMoment.classList.add('hidden');
    await render();
  });

  // ── Door actions ─────────────────────────────────────────────────
  function handleDoor(goalId, door) {
    if (door === 'Проверить') {
      const g = state && state.goals && state.goals.find(g => g.id === goalId);
      openVerify(goalId, g && g._startQuestion || 0);
    } else if (door === 'Собрать путь') {
      // DARN-CAT gate — placeholder for step 2
      alert('Собрать путь — шаг 2 (DARN-CAT gate в разработке)');
    } else {
      // Как движется / Ещё тянет? — placeholder
      alert(`Дверь «${door}» — шаг 2`);
    }
  }

  // ── Event delegation ─────────────────────────────────────────────
  overlay.addEventListener('click', async e => {
    const t = e.target.closest('[data-id]') || e.target;
    const id = t.dataset && t.dataset.id;

    if (t.classList.contains('btn-mine') && id) {
      openGroupPicker(id);
    } else if (t.classList.contains('btn-notmine') && id) {
      await cmd('candidate_notmine', { id });
      await render();
    } else if (t.classList.contains('btn-later') && id) {
      await cmd('candidate_later', { id });
      await render();
    } else if (t.classList.contains('btn-door') && id) {
      const door = t.dataset.door;
      handleDoor(id, door);
    } else if (t.classList.contains('btn-achieved') && id) {
      const note = prompt('Что берёшь с собой из этой цели?', '');
      await cmd('goal_status', { id, state: 'достигнута', integration: note || '' });
      await render();
    } else if (t.classList.contains('btn-release') && id) {
      const note = prompt('Что перецепляется в другую цель? (или оставь пустым)', '');
      await cmd('goal_status', { id, state: 'отпущена', rehook: note || '' });
      await render();
    } else if (t.classList.contains('friction-close') && id) {
      // client-side dismiss of friction line
      const goal = state && state.goals && state.goals.find(g => g.id === id);
      if (goal) goal._frictionDismissed = true;
      irqBar.classList.add('hidden');
      t.closest('.goal-friction') && t.closest('.goal-friction').remove();
    }
  });

  $('goals-irq-close').addEventListener('click', () => irqBar.classList.add('hidden'));

  // ── First entry input ────────────────────────────────────────────
  $('goals-first-submit').addEventListener('click', async () => {
    const text = $('goals-first-text').value.trim();
    if (!text) return;
    $('goals-first-text').value = '';
    await cmd('goal_create', { text, group: 'личные' });
    await render();
  });

  $('goals-first-text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('goals-first-submit').click();
    }
  });

  // ── Channel 2 dev controls ───────────────────────────────────────
  async function refreshChannel2() {
    const s = await api('GET', '/api/goals/channel2');
    const toggle = $('dev-ch2-toggle');
    const blockEl = $('dev-ch2-block');
    const tokensEl = $('dev-ch2-tokens');
    if (toggle) toggle.textContent = s.enabled ? 'канал 2: вкл' : 'канал 2: выкл';
    if (toggle) toggle.dataset.on = s.enabled ? '1' : '';
    if (tokensEl) tokensEl.textContent = s.block ? `~${s.tokensEst} токенов${s.truncated && s.truncated.length ? ` | отсечено: ${s.truncated.length}` : ''}` : '';
    if (blockEl) blockEl.textContent = s.block || '(блок пуст)';
  }

  $('dev-ch2-toggle') && $('dev-ch2-toggle').addEventListener('click', async () => {
    await api('POST', '/api/goals/channel2', { enabled: !($('dev-ch2-toggle').dataset.on === '1') });
    await refreshChannel2();
  });

  // ── Harvest dev controls ─────────────────────────────────────────
  async function refreshHarvest() {
    const s = await api('GET', '/api/goals/harvest');
    const toggle = $('dev-harvest-toggle');
    const verbalEl = $('dev-harvest-verbal');
    const statsEl = $('dev-harvest-stats');
    const candsEl = $('dev-harvest-candidates');
    if (toggle) {
      toggle.textContent = s.enabled ? 'жатва: вкл' : 'жатва: выкл';
      toggle.dataset.on = s.enabled ? '1' : '';
    }
    if (verbalEl) verbalEl.textContent = s.announcedVerbal ? '| хвост: объявлен' : '';
    if (statsEl && s.session) {
      const sess = s.session;
      statsEl.textContent = `вызовов: ${sess.calls} | токены: ${sess.inputTokens}+${sess.outputTokens} | эскалаций: ${sess.escalations} | пустых: ${sess.empty}`;
    }
    if (candsEl && s.session && s.session.candidates.length) {
      candsEl.innerHTML = s.session.candidates.map(c =>
        `<div class="dev-harvest-cand"><span class="dev-hc-id">${c.id}</span> <span class="dev-hc-warm">☀${c.warmth}</span> <span class="dev-hc-text">${c.text}</span>${c.rationale ? `<div class="dev-hc-rationale">${c.rationale}</div>` : ''}</div>`
      ).join('');
    } else if (candsEl) {
      candsEl.textContent = s.session && s.session.calls ? '(кандидатов не извлечено)' : '';
    }
  }

  $('dev-harvest-toggle') && $('dev-harvest-toggle').addEventListener('click', async () => {
    await api('POST', '/api/goals/harvest', { enabled: !($('dev-harvest-toggle').dataset.on === '1') });
    await refreshHarvest();
  });

  // Refresh channel2 status on panel open
  document.getElementById('goals-dev-panel').addEventListener('toggle', async () => {
    if (document.getElementById('goals-dev-panel').open) {
      await refreshChannel2();
      await refreshHarvest();
    }
  });

  // ── Dev buttons ──────────────────────────────────────────────────
  $('dev-load-corpus').addEventListener('click', async () => {
    await api('POST', '/api/goals/dev/load-corpus');
    await render();
  });

  $('dev-clear').addEventListener('click', async () => {
    await api('POST', '/api/goals/dev/clear');
    await render();
  });

  $('dev-add-candidate').addEventListener('click', async () => {
    const res = await api('POST', '/api/goals/dev/candidate', {
      text: 'тестовый кандидат — ' + new Date().toLocaleTimeString(),
      layer: 1,
      warmth: 0.75,
      pollen: [],
    });
    setSignal(res.signal && res.signal.active);
    await render();
  });

  // ── Tab integration ───────────────────────────────────────────────
  // Listen for field changes from app.js
  window.addEventListener('nagarcot:field', async e => {
    if (e.detail === 'цели') {
      overlay.classList.remove('hidden');
      await dismissSignal();
      await render();
    } else {
      overlay.classList.add('hidden');
    }
  });

  // Also watch for tab clicks directly (in case event isn't dispatched yet)
  document.querySelectorAll('.tab[data-field]').forEach(tab => {
    tab.addEventListener('click', async () => {
      if (tab.dataset.field === 'цели') {
        overlay.classList.remove('hidden');
        await dismissSignal();
        await render();
      } else {
        overlay.classList.add('hidden');
      }
    });
  });

  // Poll for signal changes every 10s (harvest will push in step 2)
  setInterval(async () => {
    if (overlay.classList.contains('hidden')) {
      // Only refresh signal when not in Goals view
      try {
        const s = await api('GET', '/api/goals');
        setSignal(s.signal && s.signal.active);
      } catch {}
    }
  }, 10000);

})();
