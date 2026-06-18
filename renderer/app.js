const api = window.comfyMonitor;

const state = {
  completed: 0,
  sessionErrors: 0,
  runStart: null,
  elapsedTimer: null,
  stage: 1,
  prevStagePct: 0,
  stage2Start: null,
  errorCards: new Map(),
  activeWorkflowDef: null,
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
const jobFailedList      = el('job-failed-list');
const renderEmpty        = el('render-empty');
const renderRow          = el('render-row');
const renderThumb        = el('render-thumb');
const renderFilename     = el('render-filename');
const renderMeta         = el('render-meta');
const renderToolStatus   = el('render-tool-status');
const btnOpenRender      = el('btn-open-render');
const btnRevealRender    = el('btn-reveal-render');

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

function setJobCardProgress(pct) {
  const containers = [jobProcessingList, el('jobs-panel-processing')];
  for (const c of containers) {
    if (!c) continue;
    for (const fill of c.querySelectorAll('.job-card-bar-fill')) {
      fill.style.width = pct + '%';
    }
  }
}

function renderJobQueue(data) {
  const { processing, completed, failed = [] } = data;

  renderList(jobProcessingList, processing, 'processing', '● Processing', true, 'No active jobs');
  renderList(jobCompletedList, completed, 'completed', '✓ Done', false, null);
  renderList(jobFailedList, failed, 'failed', '✕ Failed', false, null);

  const panelProcessing = el('jobs-panel-processing');
  const panelCompleted  = el('jobs-panel-completed');
  const panelFailed     = el('jobs-panel-failed');
  if (panelProcessing && panelCompleted) {
    renderList(panelProcessing, processing, 'processing', '● Processing', true, 'No active jobs');
    renderList(panelCompleted, completed, 'completed', '✓ Done', false, null);
  }
  if (panelFailed) {
    renderList(panelFailed, failed, 'failed', '✕ Failed', false, null);
  }
}

function loadRenderThumbnail(videoPath) {
  renderThumb.innerHTML = '&#127916;';
  api.getThumbnail(videoPath).then(result => {
    if (!result.ok) return;
    const img = document.createElement('img');
    img.src = result.dataUri;
    img.className = 'render-thumb-img';
    img.alt = '';
    renderThumb.innerHTML = '';
    renderThumb.appendChild(img);
  }).catch(() => {});
}

function renderLatestRender(data) {
  latestRenderPath = data.path;
  renderEmpty.hidden = true;
  renderRow.hidden   = false;
  renderFilename.textContent = data.name;
  renderMeta.textContent = data.path;
  renderToolStatus.textContent = '';
  btnOpenRender.disabled   = false;
  btnRevealRender.disabled = false;
  loadRenderThumbnail(data.path);
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
      workflowName.textContent = state.activeWorkflowDef
        ? state.activeWorkflowDef.label
        : (data.workflowName || 'Unknown workflow');
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
      setJobCardProgress(0);
      break;

    case 'comfyui:progress': {
      const allowTwoStage = state.activeWorkflowDef ? state.activeWorkflowDef.twoStage : true;
      if (allowTwoStage && data.step <= 2 && state.stage === 1 && state.prevStagePct > 80) {
        state.stage = 2;
        state.stage2Start = Date.now();
        el('stage2-label').textContent = state.activeWorkflowDef?.stages[1] ?? 'Processing';
      }
      if (state.stage === 2) {
        updateStage2(data.step, data.total);
      } else {
        updateStage1(data.step, data.total);
      }
      setJobCardProgress(data.total > 0 ? Math.round(data.step / data.total * 100) : 0);
      break;
    }

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
      setJobCardProgress(100);
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

    case 'pipeline:mux-update':
      updateMuxPanelRender(data.render);
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
const tabMux      = el('tab-mux');
const monitorView = el('monitor-view');
const toolsPanel  = el('tools-panel');
const jobsPanel   = el('jobs-panel');
const submitPanel = el('submit-panel');
const muxPanel    = el('mux-panel');

function showTab(name) {
  const isMonitor = name === 'monitor';
  const isTools   = name === 'tools';
  const isJobs    = name === 'jobs';
  const isSubmit  = name === 'submit';
  const isMux     = name === 'mux';
  monitorView.hidden  = !isMonitor;
  toolsPanel.hidden   = !isTools;
  jobsPanel.hidden    = !isJobs;
  submitPanel.hidden  = !isSubmit;
  muxPanel.hidden     = !isMux;
  tabMonitor.className = `tab-btn${isMonitor ? ' tab-btn--active' : ''}`;
  tabTools.className   = `tab-btn${isTools   ? ' tab-btn--active' : ''}`;
  tabJobs.className    = `tab-btn${isJobs    ? ' tab-btn--active' : ''}`;
  tabSubmit.className  = `tab-btn${isSubmit  ? ' tab-btn--active' : ''}`;
  tabMux.className     = `tab-btn${isMux     ? ' tab-btn--active' : ''}`;
  if (isSubmit) loadAudioList(getActiveWorkflowDef()).catch(err => {
    audioList.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'audio-empty';
    div.textContent = `Error: ${err.message}`;
    audioList.appendChild(div);
  });
  if (isMux) loadMuxClipSets().catch(() => {});
}

tabMonitor.addEventListener('click', () => showTab('monitor'));
tabTools.addEventListener('click',   () => showTab('tools'));
tabJobs.addEventListener('click',    () => showTab('jobs'));
tabSubmit.addEventListener('click',  () => showTab('submit'));
tabMux.addEventListener('click',     () => showTab('mux'));

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

btnOpenRender.addEventListener('click', async () => {
  if (!latestRenderPath) return;
  const result = await api.openRender(latestRenderPath);
  if (!result.ok) renderToolStatus.textContent = result.error || 'Could not open file.';
});

btnRevealRender.addEventListener('click', async () => {
  if (!latestRenderPath) return;
  const result = await api.revealRender(latestRenderPath);
  if (!result.ok) renderToolStatus.textContent = result.error || 'Could not reveal file.';
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

// Populate workflow dropdown from definitions
api.workflowDefs.forEach(def => {
  const opt = document.createElement('option');
  opt.value = def.id;
  opt.textContent = def.label;
  workflowSelect.appendChild(opt);
});
workflowHint.textContent = api.workflowDefs[0]?.estimatedTime ?? '';
applyWorkflowInputs(api.workflowDefs[0] || { inputs: [] });

const submitState = {
  avatarPath: null,
  audioFile:  null,
  platform:   'tiktok',
};

const INPUT_STATES = { avatar: 'avatarPath', audio: 'audioFile' };

function updateSubmitButton() {
  const def = getActiveWorkflowDef();
  const ready = def.inputs
    .filter(i => i !== 'platform')
    .every(i => !!submitState[INPUT_STATES[i]]);
  btnSubmitJob.disabled = !ready;
}

async function loadAudioList(def) {
  audioList.innerHTML = '<div class="audio-empty">Loading…</div>';
  submitState.audioFile = null;
  updateSubmitButton();

  const result = await api.listAudio(def.audioDir, def.audioExtensions);
  audioList.innerHTML = '';

  if (!result.ok || result.files.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'audio-empty';
    empty.textContent = result.ok
      ? `No ${def.audioExtensions.join('/')} files found`
      : `Error: ${result.error}`;
    audioList.appendChild(empty);
    return;
  }

  result.files.forEach(({ filename, duration }) => {
    const item = document.createElement('div');
    item.className = 'audio-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'audio-item-name';
    nameSpan.textContent = filename;
    item.appendChild(nameSpan);

    if (duration !== null) {
      const durSpan = document.createElement('span');
      durSpan.className = 'audio-item-duration';
      durSpan.textContent = `${duration}s`;
      item.appendChild(durSpan);
    }

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
  const def = getActiveWorkflowDef();
  const result = await api.openAvatarDialog(def.avatarDir, def.avatarExtensions);
  if (!result.ok) return;
  submitState.avatarPath = result.filePath;
  avatarFilename.textContent = result.filePath.split('\\').pop();
  avatarThumb.textContent = '🖼';
  updateSubmitButton();
});

function getActiveWorkflowDef() {
  return api.workflowDefs.find(d => d.id === workflowSelect.value) || api.workflowDefs[0];
}

function applyWorkflowInputs(def) {
  document.querySelectorAll('[data-input-section]').forEach(section => {
    section.hidden = !def.inputs.includes(section.dataset.inputSection);
  });
}

workflowSelect.addEventListener('change', () => {
  const def = getActiveWorkflowDef();
  workflowHint.textContent = def.estimatedTime;
  applyWorkflowInputs(def);
  submitState.avatarPath = null;
  submitState.audioFile = null;
  avatarFilename.textContent = 'No file selected';
  avatarThumb.textContent = '👤';
  loadAudioList(def).catch(() => {});
  updateSubmitButton();
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
  const def = getActiveWorkflowDef();
  const requiredMet = def.inputs
    .filter(i => i !== 'platform')
    .every(i => !!submitState[INPUT_STATES[i]]);
  if (!requiredMet) return;
  btnSubmitJob.disabled = true;

  const job = {
    avatar:     submitState.avatarPath.split('\\').pop(),
    avatarPath: submitState.avatarPath,
    audio:      submitState.audioFile,
    workflow:   workflowSelect.value,
    platform:   submitState.platform,
  };

  const result = await api.submitJob(job);
  btnSubmitJob.disabled = false;

  if (result.ok) {
    state.activeWorkflowDef = getActiveWorkflowDef();
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

// ── Mux panel ───────────────────────────────────────────────────────────────
const muxStatusBanner    = el('mux-status-banner');
const muxStatusIcon      = el('mux-status-icon');
const muxStatusLabel     = el('mux-status-label');
const muxRenderName      = el('mux-render-name');
const muxRenderDuration  = el('mux-render-duration');
const muxBtnOpenVideo    = el('mux-btn-open-video');
const muxBtnRevealVideo  = el('mux-btn-reveal-video');
const muxClipSetSelect   = el('mux-clip-set-select');
const muxClipList        = el('mux-clip-list');
const muxDurationWarning = el('mux-duration-warning');
const btnMuxNow          = el('btn-mux-now');
const muxResult          = el('mux-result');
const muxResultPath      = el('mux-result-path');
const muxBtnOpenOutput   = el('mux-btn-open-output');
const muxBtnRevealOutput = el('mux-btn-reveal-output');
const muxHint            = el('mux-hint');

const muxState = {
  videoPath:          null,
  videoDuration:      null,
  selectedClipPath:   null,
  selectedClipDur:    null,
  outputPath:         null,
};

function muxDurationWarn(videoDur, audioDur) {
  if (videoDur == null || audioDur == null) return { level: 'none', message: '' };
  const diff = Math.abs(videoDur - audioDur);
  if (diff <= 0.5) return { level: 'none', message: '' };
  const shorter = audioDur < videoDur ? 'Audio clip' : 'Video';
  const longer  = audioDur < videoDur ? 'video'      : 'audio clip';
  return {
    level: diff <= 2 ? 'yellow' : 'orange',
    message: `${shorter} is ${diff.toFixed(1)}s shorter than ${longer}`,
  };
}

function updateMuxStatus() {
  const hasVideo = !!muxState.videoPath;
  const hasClip  = !!muxState.selectedClipPath;
  if (!hasVideo) {
    muxStatusIcon.textContent  = '⚠';
    muxStatusLabel.textContent = 'Waiting for Render';
    muxStatusBanner.className  = 'mux-status-banner mux-status-banner--waiting';
  } else if (!hasClip) {
    muxStatusIcon.textContent  = '⚠';
    muxStatusLabel.textContent = 'Select an Audio Clip';
    muxStatusBanner.className  = 'mux-status-banner mux-status-banner--waiting';
  } else {
    muxStatusIcon.textContent  = '✓';
    muxStatusLabel.textContent = 'Ready to Mux';
    muxStatusBanner.className  = 'mux-status-banner mux-status-banner--ready';
  }
  btnMuxNow.disabled = !hasVideo || !hasClip;
}

function updateDurationWarning() {
  if (!muxState.selectedClipPath) {
    muxDurationWarning.hidden = true;
    return;
  }
  const warn = muxDurationWarn(muxState.videoDuration, muxState.selectedClipDur);
  if (warn.level === 'none') {
    muxDurationWarning.textContent = '✓ Compatible';
    muxDurationWarning.className   = 'mux-duration-warning mux-duration-warning--ok';
    muxDurationWarning.hidden = false;
    return;
  }
  muxDurationWarning.textContent = '⚠ ' + warn.message;
  muxDurationWarning.className   = `mux-duration-warning mux-duration-warning--${warn.level}`;
  muxDurationWarning.hidden = false;
}

function updateMuxPanelRender(render) {
  const newPath = render ? render.path : null;
  const changed = newPath !== muxState.videoPath;

  muxState.videoPath = newPath;
  if (changed) {
    muxState.videoDuration = null;
    muxRenderDuration.textContent = render ? '…' : '—';
  }

  muxRenderName.textContent       = render ? render.name : 'No render detected';
  muxBtnOpenVideo.disabled        = !render;
  muxBtnRevealVideo.disabled      = !render;

  if (render && changed) {
    // Fetch video duration via existing tools:run / info IPC (non-blocking)
    api.runTool('info', { video: render.path }).then(result => {
      if (result.ok && result.info) {
        const d = parseFloat(result.info.duration);
        muxState.videoDuration = isNaN(d) ? null : d;
        muxRenderDuration.textContent = muxState.videoDuration != null
          ? `${muxState.videoDuration.toFixed(1)}s` : '—';
        updateDurationWarning();
      } else {
        muxRenderDuration.textContent = '—';
      }
    }).catch(() => { muxRenderDuration.textContent = '—'; });
  }

  updateMuxStatus();
  updateDurationWarning();
}

async function loadMuxClipSets() {
  muxClipSetSelect.innerHTML = '<option value="">— Loading… —</option>';
  muxClipList.innerHTML = '<div class="mux-clip-empty">Loading clip sets…</div>';

  const result = await api.scanClipSets();
  muxClipSetSelect.innerHTML = '';

  if (!result.ok || result.clipSets.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = result.ok ? '— No clip sets found —' : `Error: ${result.error}`;
    muxClipSetSelect.appendChild(opt);
    muxClipList.innerHTML = '<div class="mux-clip-empty">No clip sets in Outputs\\audio\\mastered\\</div>';
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Select a clip set —';
  muxClipSetSelect.appendChild(placeholder);

  for (const cs of result.clipSets) {
    const opt = document.createElement('option');
    opt.value = cs.path;
    opt.textContent = cs.name;
    muxClipSetSelect.appendChild(opt);
  }

  muxClipList.innerHTML = '<div class="mux-clip-empty">Select a clip set above</div>';
}

async function loadMuxClips(clipSetPath) {
  muxState.selectedClipPath = null;
  muxState.selectedClipDur  = null;
  muxClipList.innerHTML = '<div class="mux-clip-empty">Loading…</div>';
  updateMuxStatus();
  updateDurationWarning();

  const result = await api.scanClips(clipSetPath);
  muxClipList.innerHTML = '';

  if (!result.ok || result.clips.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mux-clip-empty';
    empty.textContent = result.ok ? 'No WAV clips found' : `Error: ${result.error}`;
    muxClipList.appendChild(empty);
    return;
  }

  result.clips.forEach(clip => {
    const item = document.createElement('div');
    item.className = 'mux-clip-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mux-clip-name';
    nameSpan.textContent = clip.name;

    const durSpan = document.createElement('span');
    durSpan.className = 'mux-clip-dur';
    durSpan.textContent = clip.duration != null ? `${clip.duration}s` : '—';

    item.appendChild(nameSpan);
    item.appendChild(durSpan);

    item.addEventListener('click', () => {
      muxClipList.querySelectorAll('.mux-clip-item')
        .forEach(i => i.classList.remove('mux-clip-item--selected'));
      item.classList.add('mux-clip-item--selected');
      muxState.selectedClipPath = clip.path;
      muxState.selectedClipDur  = clip.duration;
      updateMuxStatus();
      updateDurationWarning();
    });

    muxClipList.appendChild(item);
  });
}

muxClipSetSelect.addEventListener('change', () => {
  const clipSetPath = muxClipSetSelect.value;
  muxState.selectedClipPath = null;
  muxState.selectedClipDur  = null;
  if (!clipSetPath) {
    muxClipList.innerHTML = '<div class="mux-clip-empty">Select a clip set above</div>';
    updateMuxStatus();
    updateDurationWarning();
    return;
  }
  loadMuxClips(clipSetPath).catch(() => {
    muxClipList.innerHTML = '<div class="mux-clip-empty">Error loading clips</div>';
  });
});

muxBtnOpenVideo.addEventListener('click', async () => {
  if (!muxState.videoPath) return;
  const r = await api.openRender(muxState.videoPath);
  if (!r.ok) muxHint.textContent = r.error || 'Could not open video.';
});

muxBtnRevealVideo.addEventListener('click', async () => {
  if (!muxState.videoPath) return;
  const r = await api.revealRender(muxState.videoPath);
  if (!r.ok) muxHint.textContent = r.error || 'Could not reveal video.';
});

btnMuxNow.addEventListener('click', async () => {
  if (!muxState.videoPath || !muxState.selectedClipPath) return;
  btnMuxNow.disabled = true;
  muxResult.hidden   = true;
  muxHint.textContent = 'Muxing…';

  const result = await api.runMux(muxState.videoPath, muxState.selectedClipPath);
  btnMuxNow.disabled = false;

  if (result.ok) {
    muxState.outputPath = result.outputPath;
    muxResultPath.textContent = result.outputPath;
    muxResult.hidden  = false;
    muxHint.textContent = '';
  } else {
    muxHint.textContent = `Error: ${result.error}`;
  }
  updateMuxStatus();
});

muxBtnOpenOutput.addEventListener('click', async () => {
  if (!muxState.outputPath) return;
  const r = await api.openRender(muxState.outputPath);
  if (!r.ok) muxHint.textContent = r.error || 'Could not open output.';
});

muxBtnRevealOutput.addEventListener('click', async () => {
  if (!muxState.outputPath) return;
  const r = await api.revealRender(muxState.outputPath);
  if (!r.ok) muxHint.textContent = r.error || 'Could not reveal output.';
});
