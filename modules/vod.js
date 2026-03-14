// === VOD module ===
// VOD list fetching, rendering, polling.

import { CONFIG } from "./config.js";
import { state, dom } from "./state.js";
import { escapeHtml, formatDuration, formatDate } from "./utils.js";
import { authHeaders, showPinScreen } from "./auth.js";
import { openVodPlayer } from "./player.js";

// ============================
// Fetch & render
// ============================

async function fetchVod() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/vod`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
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

function renderVodList(vods) {
  if (!vods || vods.length === 0) {
    dom.vodGrid.innerHTML = "";
    dom.vodGrid.classList.add("hidden");
    dom.vodEmptyState.classList.remove("hidden");
    return;
  }

  dom.vodEmptyState.classList.add("hidden");
  dom.vodGrid.classList.remove("hidden");

  dom.vodGrid.innerHTML = vods
    .map((v) => {
      const duration = formatDuration(v.durationSeconds);
      const date = formatDate(v.matchDate);
      const teams =
        v.homeTeam && v.awayTeam
          ? `${escapeHtml(v.homeTeam)} vs ${escapeHtml(v.awayTeam)}`
          : "";
      return `
    <button class="vod-card" data-hls="${escapeHtml(v.hlsUrl)}" data-title="${escapeHtml(v.matchTitle || "")}" data-id="${escapeHtml(v.id)}">
      <div class="vod-card-top">
        <div class="vod-card-badge">REPRIS</div>
        ${duration ? `<div class="vod-card-duration">${escapeHtml(duration)}</div>` : ""}
      </div>
      <div class="vod-card-title">${escapeHtml(v.matchTitle || "Inspelning")}</div>
      ${teams ? `<div class="vod-card-teams">${teams}</div>` : ""}
      <div class="vod-card-meta">
        ${date ? `<span>${escapeHtml(date)}</span>` : ""}
        ${v.location ? `<span>${escapeHtml(v.location)}</span>` : ""}
        ${v.cameraName ? `<span class="vod-card-camera">${escapeHtml(v.cameraName)}</span>` : ""}
      </div>
    </button>`;
    })
    .join("");

  dom.vodGrid.querySelectorAll(".vod-card").forEach((card) => {
    card.addEventListener("click", () => {
      openVodPlayer(card.dataset.hls, card.dataset.title, card.dataset.id);
    });
  });
}

// ============================
// Polling
// ============================

async function pollVodList() {
  const vods = await fetchVod();
  if (vods !== null) {
    renderVodList(vods);
  }
}

export function startVodPolling() {
  clearInterval(state.vodPollTimer);
  pollVodList();
  state.vodPollTimer = setInterval(pollVodList, CONFIG.VOD_POLL_INTERVAL);
}

export function stopVodPolling() {
  clearInterval(state.vodPollTimer);
}

// ============================
// Init
// ============================

export function initVod() {
  // No special init needed -- polling is started by the orchestrator
}
