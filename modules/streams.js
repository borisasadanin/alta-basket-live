// === Streams module ===
// Stream list fetching, rendering, polling, auto-open logic.

import { CONFIG } from "./config.js";
import { state, dom } from "./state.js";
import { escapeHtml } from "./utils.js";
import { authHeaders, showPinScreen } from "./auth.js";
import { openPlayer } from "./player.js";

// ============================
// Fetch & render
// ============================

async function fetchStreams() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/streams`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      // Token expired or invalid -- show PIN screen
      state.viewerToken = null;
      localStorage.removeItem("viewerToken");
      showPinScreen();
      return null;
    }
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch {
    return null;
  }
}

function renderStreamList(streams) {
  if (!streams || streams.length === 0) {
    dom.streamGrid.innerHTML = "";
    dom.streamGrid.classList.add("hidden");
    dom.emptyState.classList.remove("hidden");
    dom.statusDot.className = "status-dot offline";
    return;
  }

  dom.emptyState.classList.add("hidden");
  dom.streamGrid.classList.remove("hidden");

  const hasLive = streams.some((s) => s.status === "live");
  dom.statusDot.className = hasLive ? "status-dot live" : "status-dot offline";

  const badgeMap = {
    live: { cls: "live", text: "S\u00c4NDER LIVE" },
    waiting: { cls: "waiting", text: "STARTAR..." },
    stopped: { cls: "stopped", text: "AVBRUTEN" },
  };

  dom.streamGrid.innerHTML = streams
    .map((s) => {
      const badge = badgeMap[s.status] || badgeMap.waiting;
      const isStopped = s.status === "stopped";
      return `
    <button class="stream-card ${isStopped ? "stopped" : ""}" data-hls="${escapeHtml(s.hlsUrl)}" data-name="${escapeHtml(s.name)}" data-id="${escapeHtml(s.id)}" ${isStopped ? "disabled" : ""}>
      <div class="stream-card-top">
        <div class="stream-card-badge ${badge.cls}">${escapeHtml(badge.text)}</div>
        ${s.viewers > 0 ? `<div class="stream-card-viewers">${escapeHtml(String(s.viewers))} tittare</div>` : ""}
      </div>
      <div class="stream-card-name">${escapeHtml(s.name)}</div>
    </button>`;
    })
    .join("");

  dom.streamGrid.querySelectorAll(".stream-card:not([disabled])").forEach((card) => {
    card.addEventListener("click", () => {
      openPlayer(card.dataset.hls, card.dataset.name, card.dataset.id);
    });
  });

  // Auto-open if exactly one live stream and no player currently open
  const liveStreams = streams.filter((s) => s.status === "live");
  if (liveStreams.length === 1 && !state.currentStreamId) {
    const s = liveStreams[0];
    openPlayer(s.hlsUrl, s.name, s.id);
  }
}

// ============================
// Polling
// ============================

async function pollStreamList() {
  const streams = await fetchStreams();
  if (streams !== null) {
    renderStreamList(streams);
  }
}

export function startListPolling() {
  clearInterval(state.listPollTimer);
  pollStreamList();
  state.listPollTimer = setInterval(pollStreamList, CONFIG.LIST_POLL_INTERVAL);
}

export function stopListPolling() {
  clearInterval(state.listPollTimer);
}

// ============================
// Init
// ============================

export function initStreams() {
  // No special init needed -- polling is started by the orchestrator
}
