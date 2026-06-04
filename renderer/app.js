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
let latestRenderPath = null;
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

const jobProcessingList  = el('job-processing-list');
const jobCompletedList   = el('job-completed-list');
const renderEmpty        = el('render-empty');
const renderRow          = el('render-row');
const renderFilename     = el('render-filename');
const renderMeta         = el('render-meta');
const renderToolStatus   = el('render-tool-status');

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

function makeJobCard(job, statusClass, statusLabel, showBar) {
  const card = document.createElement('div');
  card.className = 'job-card';

  const status = document.createElement('div');
  status.className = `job-card-status job-card-status--${statusClass}`;
  status.textContent = statusLabel;

  const name = document.createElement('div');
  name.className = 'job-card-name';
  name.textContent = job.avatar ?? job.name ?? 'Unknown';

  const meta = document.createElement('div');
  meta.className = 'job-card-meta';
  meta.textContent = `${job.workflow ?? ''} · ${job.platform ?? ''}`;

  card.appendChild(status);
  card.appendChild(name);
  card.appendChild(meta);

  if (showBar) {
    const track = document.createElement('div');
    track.className = 'job-card-bar-track';
    const fill = document.createElement('div');
    fill.className = 'job-card-bar-fill';
    track.appendChild(fill);
    card.appendChild(track);
  }

  return card;
}

function renderList(container, jobs, statusClass, statusLabel, showBar, emptyMsg) {
  container.innerHTML = '';
  if (jobs.length === 0 && emptyMsg) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = emptyMsg;
    container.appendChild(empty);
  } else {
    for (const job of jobs) {
      container.appendChild(makeJobCard(job, statusClass, statusLabel, showBar));
    }
  }
}

function renderJobQueue(data) {
  const { processing, completed } = data;

  renderList(jobProcessingList, processing, 'processing', '● Processing', true, 'No active jobs');
  renderList(jobCompletedList, completed, 'completed', '✓ Done', false, null);

  const panelProcessing = el('jobs-panel-processing');
  const panelCompleted  = el('jobs-panel-completed');
  if (panelProcessing && panelCompleted) {
    renderList(panelProcessing, processing, 'processing', '● Processing', true, 'No active jobs');
    renderList(panelCompleted, completed, 'completed', '✓ Done', false, null);
  }
}

function renderLatestRender(data) {
  latestRenderPath = data.path;
  renderEmpty.hidden = true;
  renderRow.hidden   = false;
  renderFilename.textContent = data.name;
  renderMeta.textContent = data.path;
  renderToolStatus.textContent = '';
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

    case 'pipeline:jobs-update':
      renderJobQueue(data);
      break;

    case 'pipeline:render-ready':
      renderLatestRender(data);
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

// ── Tab switching ──────────────────────────────────────────────────────────
const tabMonitor  = el('tab-monitor');
const tabTools    = el('tab-tools');
const tabJobs     = el('tab-jobs');
const tabSubmit   = el('tab-submit');
const monitorView = el('monitor-view');
const toolsPanel  = el('tools-panel');
const jobsPanel   = el('jobs-panel');
const submitPanel = el('submit-panel');

function showTab(name) {
  const isMonitor = name === 'monitor';
  const isTools   = name === 'tools';
  const isJobs    = name === 'jobs';
  const isSubmit  = name === 'submit';
  monitorView.hidden  = !isMonitor;
  toolsPanel.hidden   = !isTools;
  jobsPanel.hidden    = !isJobs;
  submitPanel.hidden  = !isSubmit;
  tabMonitor.className = `tab-btn${isMonitor ? ' tab-btn--active' : ''}`;
  tabTools.className   = `tab-btn${isTools   ? ' tab-btn--active' : ''}`;
  tabJobs.className    = `tab-btn${isJobs    ? ' tab-btn--active' : ''}`;
  tabSubmit.className  = `tab-btn${isSubmit  ? ' tab-btn--active' : ''}`;
  if (isSubmit) loadAudioList().catch(err => {
    audioList.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'audio-empty';
    div.textContent = `Error: ${err.message}`;
    audioList.appendChild(div);
  });
}

tabMonitor.addEventListener('click', () => showTab('monitor'));
tabTools.addEventListener('click',   () => showTab('tools'));
tabJobs.addEventListener('click',    () => showTab('jobs'));
tabSubmit.addEventListener('click',  () => showTab('submit'));

// ── Tools panel ────────────────────────────────────────────────────────────
const toolsStatus  = el('tools-status');
const infoResult   = el('info-result');
const inputSeconds = el('input-seconds');

function setToolsStatus(msg, ok) {
  toolsStatus.textContent = msg;
  toolsStatus.className = `tools-status tools-status--${ok ? 'ok' : 'err'}`;
}

document.querySelectorAll('.btn-run').forEach(btn => {
  btn.addEventListener('click', async () => {
    const tool = btn.dataset.tool;
    const args = {};
    if (tool === 'frame-at-time') {
      const secs = parseFloat(inputSeconds.value);
      if (isNaN(secs) || secs < 0) {
        setToolsStatus('Enter a valid number of seconds first.', false);
        return;
      }
      args.seconds = secs;
    }

    btn.disabled = true;
    btn.classList.add('btn-run--running');
    setToolsStatus('Running…', true);
    infoResult.hidden = true;

    let result;
    try {
      result = await api.runTool(tool, args);
    } catch (err) {
      setToolsStatus(err.message || 'IPC error', false);
      btn.disabled = false;
      btn.classList.remove('btn-run--running');
      return;
    }

    btn.disabled = false;
    btn.classList.remove('btn-run--running');

    if (result.ok) {
      if (tool === 'info' && result.info) {
        const { filename, resolution, fps, duration, codec, size } = result.info;
        infoResult.textContent =
          `${filename}\n${resolution} · ${fps}fps · ${duration}\n${codec} · ${size}`;
        infoResult.hidden = false;
        setToolsStatus('Info loaded.', true);
      } else if (result.path) {
        setToolsStatus(result.path, true);
      } else {
        setToolsStatus('Done.', true);
      }
    } else {
      setToolsStatus(result.error || 'Unknown error', false);
    }
  });
});

document.querySelectorAll('.btn-render-tool').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!latestRenderPath) {
      renderToolStatus.textContent = 'No render loaded.';
      return;
    }
    const tool = btn.dataset.tool;
    btn.disabled = true;
    renderToolStatus.textContent = 'Running…';

    let result;
    try {
      result = await api.runTool(tool, { video: latestRenderPath });
    } catch (err) {
      renderToolStatus.textContent = err.message || 'IPC error';
      btn.disabled = false;
      return;
    }

    btn.disabled = false;
    renderToolStatus.textContent = result.ok
      ? (result.path ? result.path.split('\\').pop() : 'Done.')
      : (result.error || 'Error');
  });
});

// ── Submit tab ──────────────────────────────────────────────────────────────
const audioList       = el('audio-list');
const avatarThumb     = el('avatar-thumb');
const avatarFilename  = el('avatar-filename');
const btnAvatarBrowse = el('btn-avatar-browse');
const workflowSelect  = el('workflow-select');
const workflowHint    = el('workflow-hint');
const btnSubmitJob    = el('btn-submit-job');
const submitToast     = el('submit-toast');
const toastMsg        = el('toast-msg');
const toastIcon       = el('toast-icon');

const submitState = {
  avatarPath: null,
  audioFile:  null,
  platform:   'tiktok',
};

const WORKFLOW_TIMES = {
  LTX_FFLF_Audio: '~12–15 min',
  LTX_2Stage:     '~15–20 min',
  LTX_3Stage:     '~20–25 min',
  FLOAT:          '~10–12 min',
};

function updateSubmitButton() {
  btnSubmitJob.disabled = !(submitState.avatarPath && submitState.audioFile);
}

async function loadAudioList() {
  audioList.innerHTML = '<div class="audio-empty">Loading…</div>';
  submitState.audioFile = null;
  updateSubmitButton();

  const result = await api.listAudio();
  audioList.innerHTML = '';

  if (!result.ok || result.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'audio-empty';
    empty.textContent = result.ok
      ? 'No .wav files in staging\\audio_ready\\'
      : `Error: ${result.error}`;
    audioList.appendChild(empty);
    return;
  }

  result.files.forEach(filename => {
    const item = document.createElement('div');
    item.className = 'audio-item';
    item.textContent = filename;
    item.addEventListener('click', () => {
      audioList.querySelectorAll('.audio-item')
        .forEach(i => i.classList.remove('audio-item--selected'));
      item.classList.add('audio-item--selected');
      submitState.audioFile = filename;
      updateSubmitButton();
    });
    audioList.appendChild(item);
  });
}

btnAvatarBrowse.addEventListener('click', async () => {
  const result = await api.openAvatarDialog();
  if (!result.ok) return;
  submitState.avatarPath = result.filePath;
  avatarFilename.textContent = result.filePath.split('\\').pop();
  avatarThumb.textContent = '🖼';
  updateSubmitButton();
});

workflowSelect.addEventListener('change', () => {
  workflowHint.textContent = WORKFLOW_TIMES[workflowSelect.value] || '';
});

document.querySelectorAll('.platform-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.platform-btn')
      .forEach(b => b.classList.remove('platform-btn--active'));
    btn.classList.add('platform-btn--active');
    submitState.platform = btn.dataset.platform;
  });
});

btnSubmitJob.addEventListener('click', async () => {
  if (!submitState.avatarPath || !submitState.audioFile) return;
  btnSubmitJob.disabled = true;

  const job = {
    avatar:   submitState.avatarPath.split('\\').pop(),
    audio:    submitState.audioFile,
    workflow: workflowSelect.value,
    platform: submitState.platform,
  };

  const result = await api.submitJob(job);
  btnSubmitJob.disabled = false;

  if (result.ok) {
    toastIcon.textContent = '✓';
    toastMsg.textContent = 'Job queued — n8n will pick it up within 10 seconds';
    submitToast.className = 'submit-toast';
  } else {
    toastIcon.textContent = '✗';
    toastMsg.textContent = `Error: ${result.error}`;
    submitToast.className = 'submit-toast submit-toast--error';
  }

  submitToast.hidden = false;
  setTimeout(() => { submitToast.hidden = true; }, 5000);
});
