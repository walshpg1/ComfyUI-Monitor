# ComfyUI Monitor

A lightweight Electron desktop app that watches your ComfyUI instance in real time, tracks generation progress, and uses Claude AI to explain errors in plain English as they happen.

---

## What It Does

- **Live progress tracking** — shows the current workflow name, sampler step count, percentage complete, and estimated time remaining. Detects two-stage workflows (e.g. generate + upscale) and tracks each stage separately.
- **Error capture** — every ComfyUI execution error is caught the moment it occurs and displayed in a card showing the node name, exception type, and message.
- **AI explanations** — Claude Haiku reads each error and streams a 2–3 sentence plain-English explanation of what went wrong and exactly how to fix it, directly into the error card.
- **Persistent history** — errors and their explanations are saved to disk so they survive restarts. The last 100 errors are kept.
- **Session counters** — tracks completed runs and error count for the current session.

---

## Setup

### Requirements

- Node.js 20+
- A running ComfyUI instance (default: `localhost:8188`)
- An Anthropic API key (for AI explanations — optional, app works without it)

### Install

```powershell
cd "D:\AIStudio\Apps\ComfyUIMonitor"
npm install
```

### Configure

Edit `.env` in the project root:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
COMFYUI_WS_URL=ws://127.0.0.1:8188/ws
```

If `ANTHROPIC_API_KEY` is missing or empty, error cards will show "Add ANTHROPIC_API_KEY to .env to enable AI explanations" instead of a Claude response. Everything else still works.

### Run

```powershell
npm start
```

---

## UI Overview

```
┌─────────────────────────────────────────────────────┐
│ ● ComfyUI Monitor   localhost:8188                   │  ← Title bar
├──────────┬──────────┬──────────┬────────────────────┤
│  Running │    3     │    2     │      00:01:12       │  ← Stats row
│  Status  │Completed │  Errors  │      Elapsed        │
├──────────────────────┬──────────────────────────────┤
│  Current Generation  │     Recent Errors             │
│                      │                               │
│  LTX Director Fixed  │  ValueError          21:09   │
│  Stage 1 — Step 5/8  │  LTXDirector #46             │
│  ████████░░░░  62%   │  ✨ Claude says               │
│  ~01:20 remaining    │  One of your timeline…        │
│                      │                               │
│  Stage 2 (Upscale)   │  ValueError          19:12 ▸ │
│  ░░░░░░░ Waiting...  │  LTXDirector #46             │
├──────────────────────┴──────────────────────────────┤
│ Connected · ws://localhost:8188  Copy last error | Clear history │
└─────────────────────────────────────────────────────┘
```

### Title Bar
The coloured dot shows connection state: **cyan** = connected, **red** = disconnected. The app reconnects automatically every 3 seconds if the connection drops.

### Stats Row
| Tile | Colour | Meaning |
|------|--------|---------|
| Status | cyan = Running, grey = Idle, red = Disconnected | Current state |
| Completed | green | Successful runs this session |
| Errors | red | Failed runs this session |
| Elapsed | yellow | MM:SS timer for the active run |

### Current Generation (left panel)
Shows the active workflow's progress. Stage 1 is the main sampler pass. Stage 2 (greyed out until active) is the upscale pass — automatically detected when a second sampler starts after the first completes.

### Recent Errors (right panel)
Errors appear newest-first, max 20 visible. The most recent error auto-expands. Click any card to expand/collapse it. Expanded cards show:
- Full exception message
- **✨ Claude says** block (purple left border) — streams in character by character as Claude generates the explanation

### Bottom Bar
- **Copy last error** — copies the most recent error as JSON to the clipboard
- **Clear history** — removes all error cards from the UI and deletes the history file

---

## How It Works

### Architecture

```
ComfyUI WebSocket
      │
      ▼
comfyui-ws.js          Parses raw WS messages into typed events
      │                (status, run-start, progress, error, run-complete)
      ▼
main.js                Electron main process — orchestrates everything
  ├── store.js         Saves errors to JSON, loads history on startup
  ├── ai-explainer.js  Calls Claude Haiku, streams tokens back
  └── IPC channels     Forwards all events to the renderer
      │
      ▼
preload.js             Secure contextBridge — exposes window.comfyMonitor
      │
      ▼
renderer/app.js        Listens on IPC, updates DOM directly (no framework)
renderer/index.html    Single-page shell with <template> for error cards
renderer/styles.css    Dark theme
```

### Data Flow

1. ComfyUI sends WebSocket messages in its own format (snake_case JSON).
2. `comfyui-ws.js` parses them into clean camelCase events (`nodeId`, `exceptionType`, etc.).
3. `main.js` receives each event and routes it:
   - Progress/status events → forwarded directly to renderer via IPC
   - Error events → saved to `store.js` (converted to snake_case for JSON storage), sent to renderer, then streamed through `ai-explainer.js` chunk by chunk
4. `preload.js` bridges the IPC to the renderer's JavaScript context securely.
5. `renderer/app.js` updates the DOM in response to each event.

### AI Explanation Pipeline

When an error arrives:
1. Error is saved to history with `explanation: null`
2. Error card appears in the UI immediately
3. `explainError()` opens a streaming request to Claude Haiku with the node type, exception type, message, and last 10 lines of traceback
4. Each text token is sent to the renderer as a `comfyui:explanation-chunk` IPC message
5. The renderer appends each chunk to the card's `.claude-text` element — creating the character-by-character streaming effect
6. Once streaming completes, the full explanation is saved back to history so it's available on next startup

### History Persistence

Errors are stored at:
```
D:\AIStudio\Infrastructure\comfyui-monitor-history.json
```

Format:
```json
[
  {
    "id": "uuid-v4",
    "timestamp": "2026-05-28T19:12:06.865Z",
    "node_id": "46",
    "node_type": "LTXDirector",
    "exception_type": "ValueError",
    "message": "There is a segment on the timeline missing a prompt!",
    "traceback": ["..."],
    "explanation": "One of your timeline segments has no text prompt..."
  }
]
```

Max 100 entries. Oldest entries are trimmed on write.

---

## Files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process — creates window, manages IPC and WebSocket lifecycle |
| `comfyui-ws.js` | WebSocket client — connects to ComfyUI, parses messages, reconnects on drop |
| `store.js` | JSON history — load, add, update explanation, clear |
| `ai-explainer.js` | Anthropic SDK — async generator that streams Claude's explanation |
| `preload.js` | contextBridge — exposes `window.comfyMonitor` API to renderer securely |
| `renderer/index.html` | App shell — layout, stats tiles, error card `<template>` |
| `renderer/styles.css` | Dark theme — CSS custom properties, all layout |
| `renderer/app.js` | IPC listener — handles all 8 event channels, updates DOM |
| `tests/` | Jest unit tests for the three pure modules (24 tests total) |

---

## Running Tests

```powershell
npm test
```

24 tests across three files:
- `comfyui-ws.test.js` — 12 tests for message parsing (all ComfyUI message types, null/missing data, invalid JSON)
- `store.test.js` — 7 tests for history persistence (add, load, update, clear, 100-entry cap)
- `ai-explainer.test.js` — 5 tests for streaming (no-key fallback, text chunk filtering, traceback slicing)
