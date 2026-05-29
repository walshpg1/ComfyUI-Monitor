const api = window.comfyMonitor;

const state = {
  completed: 0,
  sessionErrors: 0,
  runStart: null,
  elapsedTimer: null,
  stage: 1,
  prevStagePct: 0,
  stage2Start: null,
  errorCards: new Map()
};

const el = id => document.getElementById(id);
const connDot     = el('conn-dot');
const connLabel   = el('conn-label');
const statStatus  = el('stat-status');
const statCompleted = el('stat-completed');
const statErrors  = el('stat-errors');
const statElapsed = el('stat-elapsed');
const workflowName = el('workflow-name');
const stage1Label = el('stage1-label');
const stage1Bar   = el('stage1-bar');
const stage1Pct   = el('stage1-pct');
const stage1Eta   = el('stage1-eta');
const stage2Section = el('stage2-section');
const stage2Bar   = el('stage2-bar');
const stage2Pct   = el('stage2-pct');
const stage2Eta   = el('stage2-eta');
const errorList   = el('error-list');
const wsStatus    = el('ws-status');
const btnCopy     = el('btn-copy');
const btnClear    = el('btn-clear');
const cardTpl     = el('error-card-tpl');

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function setConnection(connected, url) {
  connDot.className = `dot dot--${connected ? 'connected' : 'disconnected'}`;
  connLabel.textContent = connected ? url : 'Disconnected';
  wsStatus.textContent = connected ? `Connected · ${url}` : 'Disconnected';
}

function setStatus(text, cls) {
  statStatus.className = `stat-value stat-value--${cls}`;
  statStatus.textContent = text;
}

function startElapsed() {
  state.runStart = Date.now();
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    statElapsed.textContent = fmtTime(Date.now() - state.runStart);
  }, 1000);
}

function stopElapsed() {
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
  statElapsed.textContent = '--:--';
}

function etaStr(elapsed, step, total) {
  if (step <= 0 || elapsed <= 0) return '';
  const remaining = Math.round((elapsed / step) * (total - step));
  return `~${fmtTime(remaining * 1000)} remaining`;
}

function updateStage1(step, total) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  const elapsed = state.runStart ? (Date.now() - state.runStart) / 1000 : 0;
  stage1Bar.style.width = `${pct}%`;
  stage1Pct.textContent = `${pct}%`;
  stage1Eta.textContent = etaStr(elapsed, step, total);
  stage1Label.textContent = `Stage 1 — Step ${step} of ${total}`;
  state.prevStagePct = pct;
}

function updateStage2(step, total) {
  stage2Section.className = 'stage2-section stage2-section--active';
  stage2Bar.className = 'progress-bar';
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  const elapsed = state.stage2Start ? (Date.now() - state.stage2Start) / 1000 : 0;
  stage2Bar.style.width = `${pct}%`;
  stage2Pct.textContent = `${pct}%`;
  stage2Eta.textContent = etaStr(elapsed, step, total);
  // Mark stage 1 complete when stage 2 starts
  stage1Bar.style.width = '100%';
  stage1Pct.textContent = '100%';
  stage1Eta.textContent = '';
  stage1Label.textContent = 'Stage 1 — complete';
}

function createCard(err, explanation) {
  const clone = cardTpl.content.cloneNode(true);
  const card = clone.querySelector('.error-card');
  card.dataset.id = err.id;
  card.querySelector('.error-type').textContent = err.exception_type;
  card.querySelector('.error-time').textContent =
    new Date(err.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  card.querySelector('.error-summary').textContent =
    `${err.node_type} #${err.node_id} — ${err.message.slice(0, 60)}`;
  card.querySelector('.error-message').textContent = err.message;
  if (explanation) card.querySelector('.claude-text').textContent = explanation;
  card.addEventListener('click', () => toggleCard(card));
  return card;
}

function toggleCard(card, force) {
  const detail = card.querySelector('.error-detail');
  const expand = force !== undefined ? force : detail.hidden;
  detail.hidden = !expand;
  card.className = `error-card error-card--${expand ? 'expanded' : 'collapsed'}`;
}

function addCard(err) {
  const card = createCard(err, null);
  errorList.insertBefore(card, errorList.firstChild);
  state.errorCards.set(err.id, card);
  toggleCard(card, true);
  // Collapse all others
  for (const [id, c] of state.errorCards) {
    if (id !== err.id) toggleCard(c, false);
  }
  // Trim to 20
  while (errorList.children.length > 20) {
    const last = errorList.lastChild;
    state.errorCards.delete(last.dataset.id);
    errorList.removeChild(last);
  }
  state.sessionErrors++;
  statErrors.textContent = state.sessionErrors;
}

// IPC events from main process
api.onEvent((channel, data) => {
  switch (channel) {

    case 'comfyui:connected':
      setConnection(true, data.url);
      setStatus('Idle', 'idle');
      break;

    case 'comfyui:disconnected':
      setConnection(false);
      setStatus('Disconnected', 'disconnected');
      break;

    case 'comfyui:run-start':
      workflowName.textContent = data.workflowName || 'Unknown workflow';
      stage1Label.textContent = 'Starting...';
      stage1Bar.style.width = '0%';
      stage1Pct.textContent = '0%';
      stage1Eta.textContent = '';
      stage2Section.className = 'stage2-section stage2-section--waiting';
      stage2Bar.className = 'progress-bar progress-bar--dim';
      stage2Bar.style.width = '0%';
      stage2Pct.textContent = 'Waiting...';
      stage2Eta.textContent = '';
      state.stage = 1;
      state.prevStagePct = 0;
      state.stage2Start = null;
      setStatus('Running', 'running');
      startElapsed();
      break;

    case 'comfyui:progress':
      // Detect stage 2: step resets to a low number after stage 1 was well advanced
      if (data.step <= 2 && state.stage === 1 && state.prevStagePct > 80) {
        state.stage = 2;
        state.stage2Start = Date.now();
      }
      if (state.stage === 2) {
        updateStage2(data.step, data.total);
      } else {
        updateStage1(data.step, data.total);
      }
      break;

    case 'comfyui:run-complete':
      setStatus('Idle', 'idle');
      stopElapsed();
      stage1Bar.style.width = '100%';
      stage1Pct.textContent = '100%';
      stage1Eta.textContent = '';
      stage1Label.textContent = 'Complete';
      state.completed++;
      statCompleted.textContent = state.completed;
      state.stage = 1;
      state.prevStagePct = 0;
      break;

    case 'comfyui:error':
      addCard(data);
      break;

    case 'comfyui:explanation-chunk': {
      const card = state.errorCards.get(data.id);
      if (card) card.querySelector('.claude-text').textContent += data.chunk;
      break;
    }

    case 'comfyui:history':
      data.entries.forEach(err => {
        const card = createCard(err, err.explanation);
        errorList.appendChild(card);
        toggleCard(card, false);
        state.errorCards.set(err.id, card);
      });
      break;
  }
});

btnCopy.addEventListener('click', () => api.copyError());

btnClear.addEventListener('click', () => {
  api.clearHistory();
  errorList.innerHTML = '';
  state.errorCards.clear();
  state.sessionErrors = 0;
  statErrors.textContent = '0';
});
