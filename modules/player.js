// === Player module ===
// HLS setup, video controls, overlay, progress bar, PiP, quality menu,
// seek, keyboard shortcuts, fullscreen, viewer heartbeat.

import { CONFIG } from "./config.js";
import { state, dom, MAX_RECONNECT_ATTEMPTS } from "./state.js";
import { formatTime } from "./utils.js";
import { authHeaders } from "./auth.js";
import { stopListPolling } from "./streams.js";
import { stopVodPolling } from "./vod.js";

// Callbacks injected by the orchestrator
let onClosePlayer = null; // called when player is closed (returns to list)

// ============================
// Status
// ============================

function setStatus(status) {
  if (status === state.currentStatus) return;
  state.currentStatus = status;

  switch (status) {
    case "connecting":
      dom.liveBadge.textContent = "ANSLUTER";
      dom.liveBadge.className = "live-badge connecting";
      showOverlay("Ansluter till s\u00e4ndningen\u2026", true);
      break;
    case "live":
      dom.liveBadge.textContent = "LIVE";
      dom.liveBadge.className = "live-badge live";
      hideOverlay();
      break;
    case "offline":
      dom.liveBadge.textContent = "OFFLINE";
      dom.liveBadge.className = "live-badge offline";
      showOverlay("Ingen s\u00e4ndning just nu", false);
      break;
    case "paused":
      dom.liveBadge.textContent = "PAUS";
      dom.liveBadge.className = "live-badge paused";
      showOverlay("S\u00e4ndningen \u00e4r pausad \u2014 \u00e5terkommer snart", false);
      break;
    case "vod":
      dom.liveBadge.textContent = "REPRIS";
      dom.liveBadge.className = "live-badge vod";
      break;
  }
}

// ============================
// Overlay
// ============================

function hideOverlay() {
  dom.overlay.classList.add("hidden");
}

function showOverlay(msg, showSpinner) {
  dom.overlayText.textContent = msg;
  dom.overlay.classList.remove("hidden");
  if (dom.overlaySpinner) {
    dom.overlaySpinner.style.display = showSpinner ? "block" : "none";
  }
}

// ============================
// HLS
// ============================

function destroyHls() {
  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
}

function tryConnect() {
  if (!state.currentStreamUrl) return;

  if (Hls.isSupported()) {
    startHls();
  } else if (dom.video.canPlayType("application/vnd.apple.mpegurl")) {
    startNative();
  } else {
    showOverlay("Din webbl\u00e4sare st\u00f6der inte HLS-uppspelning", false);
  }
}

function startHls() {
  destroyHls();

  state.hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 15,
    maxMaxBufferLength: 30,
    manifestLoadingTimeOut: 10000,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1000,
    levelLoadingTimeOut: 10000,
    levelLoadingMaxRetry: 6,
    fragLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 6,
    liveSyncDurationCount: 3,
    liveBackBufferLength: 30,
  });

  state.hls.loadSource(state.currentStreamUrl);
  state.hls.attachMedia(dom.video);

  state.hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
  state.hls.on(Hls.Events.ERROR, onHlsError);
  state.hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
}

function startNative() {
  dom.video.src = state.currentStreamUrl;
  dom.video.addEventListener(
    "loadedmetadata",
    () => {
      setStatus("live");
      buildNativeQualityMenu();
    },
    { once: true }
  );
  dom.video.addEventListener(
    "error",
    () => {
      setStatus("offline");
    },
    { once: true }
  );
}

// --- VOD HLS ---

function tryConnectVod() {
  if (!state.currentStreamUrl) return;

  if (Hls.isSupported()) {
    startHlsVod();
  } else if (dom.video.canPlayType("application/vnd.apple.mpegurl")) {
    dom.video.src = state.currentStreamUrl;
    dom.video.addEventListener(
      "loadedmetadata",
      () => {
        buildNativeQualityMenu();
        dom.video.play().catch(() => {});
      },
      { once: true }
    );
    dom.video.addEventListener(
      "error",
      () => {
        showOverlay("Kunde inte spela upp reprisen", false);
      },
      { once: true }
    );
  } else {
    showOverlay("Din webbl\u00e4sare st\u00f6der inte HLS-uppspelning", false);
  }
}

function startHlsVod() {
  destroyHls();

  state.hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    manifestLoadingTimeOut: 15000,
    manifestLoadingMaxRetry: 3,
    manifestLoadingRetryDelay: 2000,
    levelLoadingTimeOut: 15000,
    levelLoadingMaxRetry: 3,
    fragLoadingTimeOut: 15000,
    fragLoadingMaxRetry: 3,
  });

  state.hls.loadSource(state.currentStreamUrl);
  state.hls.attachMedia(dom.video);

  state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
    buildQualityMenu();
    dom.video.play().catch(() => {
      dom.video.muted = true;
      dom.video.play().catch(() => {});
      updateMuteButton();
    });
  });

  state.hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      destroyHls();
      showOverlay("Kunde inte spela upp reprisen", false);
    }
  });

  state.hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
}

// ============================
// HLS callbacks
// ============================

function onManifestParsed() {
  state.hlsReconnectAttempts = 0;
  if (!state.isVodMode && !state.liveStartTime) {
    state.liveStartTime = Date.now();
  }
  setStatus("live");
  buildQualityMenu();
  dom.video.play().catch(() => {
    dom.video.muted = true;
    dom.video.play().catch(() => {});
    updateMuteButton();
  });
  showControls();
}

function onHlsError(_event, data) {
  if (!data.fatal) return;

  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    state.hls.recoverMediaError();
    return;
  }

  // NETWORK_ERROR — try restarting HLS before giving up
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
    state.hlsReconnectAttempts++;
    if (state.hlsReconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      setStatus("connecting");
      showOverlay(
        `Återansluter (${state.hlsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})\u2026`,
        true
      );
      setTimeout(() => {
        if (state.currentStreamUrl) {
          startHls();
        }
      }, 2000);
      return;
    }
  }

  // Exhausted retries or other fatal errors
  destroyHls();
  checkIfStreamStopped();
}

async function checkIfStreamStopped() {
  if (!state.currentStreamId) return;
  try {
    const res = await fetch(
      `${CONFIG.API_URL}/api/streams/${state.currentStreamId}`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      showOverlay("S\u00e4ndningen har avslutats", false);
      setTimeout(closePlayer, 2500);
      return;
    }
    const stream = await res.json();
    if (stream.status === "stopped") {
      showOverlay("S\u00e4ndningen har avslutats", false);
      setTimeout(closePlayer, 2500);
    } else {
      // Stream still exists but HLS failed -- try reconnecting
      state.hlsReconnectAttempts++;
      if (state.hlsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        showOverlay("S\u00e4ndningen verkar ha avbrutits", false);
        setTimeout(closePlayer, 2500);
      } else {
        setStatus("connecting");
        showOverlay(
          `\u00c5teransluter (${state.hlsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})\u2026`,
          true
        );
        setTimeout(tryConnect, 3000);
      }
    }
  } catch {
    setStatus("offline");
  }
}

function onLevelSwitched(_event, data) {
  if (state.hls && state.hls.autoLevelEnabled) {
    const level = state.hls.levels[data.level];
    dom.qualityLabel.textContent = `Auto (${level.height}p)`;
  }
  updateActiveQuality();
}

// ============================
// Quality menu
// ============================

function buildQualityMenu() {
  dom.qualityMenu.innerHTML = "";

  const autoBtn = document.createElement("button");
  autoBtn.className = "quality-option active";
  autoBtn.textContent = "Auto";
  autoBtn.dataset.level = "-1";
  autoBtn.addEventListener("click", () => selectQuality(-1));
  dom.qualityMenu.appendChild(autoBtn);

  state.hls.levels.forEach((level, i) => {
    const btn = document.createElement("button");
    btn.className = "quality-option";
    btn.textContent = `${level.height}p`;
    btn.dataset.level = i;
    btn.addEventListener("click", () => selectQuality(i));
    dom.qualityMenu.appendChild(btn);
  });
}

function buildNativeQualityMenu() {
  dom.qualityMenu.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "quality-option active";
  btn.textContent = "Auto";
  dom.qualityMenu.appendChild(btn);
}

function selectQuality(levelIndex) {
  state.hls.currentLevel = levelIndex;
  if (levelIndex === -1) {
    state.hls.currentLevel = -1;
    dom.qualityLabel.textContent = "Auto";
  } else {
    dom.qualityLabel.textContent = `${state.hls.levels[levelIndex].height}p`;
  }
  updateActiveQuality();
  dom.qualityMenu.classList.remove("open");
}

function updateActiveQuality() {
  if (!state.hls) return;
  const currentLevel = state.hls.autoLevelEnabled ? -1 : state.hls.currentLevel;
  dom.qualityMenu.querySelectorAll(".quality-option").forEach((btn) => {
    btn.classList.toggle(
      "active",
      parseInt(btn.dataset.level) === currentLevel
    );
  });
}

// ============================
// Progress bar
// ============================

function updateProgress() {
  if (state.isSeeking) return;

  if (state.isVodMode) {
    const current = dom.video.currentTime || 0;
    const duration = dom.video.duration || 0;

    dom.timeElapsed.textContent = formatTime(current);
    dom.timeDuration.textContent = formatTime(duration);

    if (duration > 0 && isFinite(duration)) {
      const pct = (current / duration) * 100;
      dom.progressFilled.style.width = pct + "%";
      dom.progressHandle.style.left = pct + "%";
    }

    updateBufferBar(duration);
  } else {
    // Live: show elapsed wall-clock time
    if (state.liveStartTime) {
      const elapsed = (Date.now() - state.liveStartTime) / 1000;
      dom.timeElapsed.textContent = formatTime(elapsed);
      dom.progressFilled.style.width = "100%";
    }
    dom.timeDuration.textContent = "";
  }
}

function updateBufferBar(duration) {
  if (!duration || !isFinite(duration) || duration <= 0) {
    dom.progressBuffered.style.width = "0%";
    return;
  }
  if (dom.video.buffered.length > 0) {
    const bufferedEnd = dom.video.buffered.end(dom.video.buffered.length - 1);
    dom.progressBuffered.style.width = (bufferedEnd / duration) * 100 + "%";
  }
}

function setupProgressForLive() {
  dom.progressContainer.className = "progress-bar-container live";
  dom.progressFilled.style.width = "0%";
  dom.progressBuffered.style.width = "0%";
  dom.timeElapsed.textContent = "0:00";
  dom.timeDuration.textContent = "";
  state.liveStartTime = null;
}

function setupProgressForVod() {
  dom.progressContainer.className = "progress-bar-container vod";
  dom.progressFilled.style.width = "0%";
  dom.progressBuffered.style.width = "0%";
  dom.progressHandle.style.left = "0%";
  dom.timeElapsed.textContent = "0:00";
  dom.timeDuration.textContent = "0:00";
  state.liveStartTime = null;
}

function resetProgress() {
  state.liveStartTime = null;
  state.isSeeking = false;
  dom.progressFilled.style.width = "0%";
  dom.progressBuffered.style.width = "0%";
  dom.progressHandle.style.left = "0%";
  dom.timeElapsed.textContent = "0:00";
  dom.timeDuration.textContent = "0:00";
  dom.progressContainer.classList.remove("seeking");
}

// ============================
// Seek (VOD only)
// ============================

function getSeekPosition(e) {
  const rect = dom.progressBar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function seekTo(ratio) {
  const duration = dom.video.duration;
  if (!duration || !isFinite(duration)) return;
  dom.video.currentTime = ratio * duration;
}

function onProgressClick(e) {
  if (!state.isVodMode) return;
  e.stopPropagation();
  const ratio = getSeekPosition(e);
  seekTo(ratio);
}

function onSeekStart(e) {
  if (!state.isVodMode) return;
  e.stopPropagation();
  state.isSeeking = true;
  dom.progressContainer.classList.add("seeking");

  const ratio = getSeekPosition(e);
  dom.progressFilled.style.width = ratio * 100 + "%";
  dom.progressHandle.style.left = ratio * 100 + "%";
  dom.timeElapsed.textContent = formatTime(ratio * dom.video.duration);

  document.addEventListener("mousemove", onSeekMove);
  document.addEventListener("mouseup", onSeekEnd);
  document.addEventListener("touchmove", onSeekMove, { passive: false });
  document.addEventListener("touchend", onSeekEnd);
}

function onSeekMove(e) {
  if (!state.isSeeking) return;
  e.preventDefault();
  const ratio = getSeekPosition(e);
  dom.progressFilled.style.width = ratio * 100 + "%";
  dom.progressHandle.style.left = ratio * 100 + "%";
  dom.timeElapsed.textContent = formatTime(ratio * dom.video.duration);
}

function onSeekEnd(e) {
  if (!state.isSeeking) return;
  const touch = e.changedTouches ? e.changedTouches[0] : e;
  const rect = dom.progressBar.getBoundingClientRect();
  const clientX = touch.clientX;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  seekTo(ratio);
  state.isSeeking = false;
  dom.progressContainer.classList.remove("seeking");

  document.removeEventListener("mousemove", onSeekMove);
  document.removeEventListener("mouseup", onSeekEnd);
  document.removeEventListener("touchmove", onSeekMove);
  document.removeEventListener("touchend", onSeekEnd);
}

// ============================
// Controls
// ============================

function togglePlay() {
  if (dom.video.paused) {
    dom.video.play();
  } else {
    dom.video.pause();
  }
}

function updatePlayButton() {
  const playing = !dom.video.paused;
  dom.iconPlay.style.display = playing ? "none" : "block";
  dom.iconPause.style.display = playing ? "block" : "none";
}

function toggleMute() {
  dom.video.muted = !dom.video.muted;
  dom.volumeSlider.value = dom.video.muted ? 0 : dom.video.volume;
  updateMuteButton();
}

function updateMuteButton() {
  const muted = dom.video.muted || dom.video.volume === 0;
  dom.iconVol.style.display = muted ? "none" : "block";
  dom.iconMuted.style.display = muted ? "block" : "none";
}

function onVolumeChange() {
  dom.video.volume = parseFloat(dom.volumeSlider.value);
  dom.video.muted = dom.video.volume === 0;
  updateMuteButton();
}

function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    (dom.wrapper.requestFullscreen || dom.wrapper.webkitRequestFullscreen).call(
      dom.wrapper
    );
  }
}

function updateFullscreenButton() {
  const isFs = !!(
    document.fullscreenElement || document.webkitFullscreenElement
  );
  dom.iconFsEnter.style.display = isFs ? "none" : "block";
  dom.iconFsExit.style.display = isFs ? "block" : "none";
}

function togglePip() {
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  } else if (document.pictureInPictureEnabled) {
    dom.video.requestPictureInPicture().catch(() => {});
  }
}

function showControls() {
  dom.wrapper.classList.add("show-controls");
  clearTimeout(state.controlsTimeout);
  state.controlsTimeout = setTimeout(() => {
    if (!dom.video.paused) {
      dom.wrapper.classList.remove("show-controls");
    }
  }, 3000);
}

// ============================
// Stream polling (when player is open but offline)
// ============================

function startStreamPolling() {
  clearInterval(state.streamPollTimer);
  state.streamPollTimer = setInterval(pollCurrentStream, 5000);
}

function stopStreamPolling() {
  clearInterval(state.streamPollTimer);
}

async function pollCurrentStream() {
  if (!state.currentStreamId || state.isVodMode) return;
  try {
    const res = await fetch(
      `${CONFIG.API_URL}/api/streams/${state.currentStreamId}`,
      { headers: authHeaders() }
    );
    if (!res.ok) {
      // Stream gone
      showOverlay("S\u00e4ndningen har avslutats", false);
      setTimeout(closePlayer, 2500);
      return;
    }
    const stream = await res.json();
    if (stream.status === "stopped") {
      showOverlay("S\u00e4ndningen har avslutats", false);
      setTimeout(closePlayer, 2500);
    } else if (stream.status === "paused") {
      if (state.currentStatus !== "paused") {
        setStatus("paused");
        // Destroy current HLS to free resources while paused
        destroyHls();
      }
    } else if (stream.status === "live" && state.currentStatus !== "live") {
      setStatus("connecting");
      tryConnect();
    }
  } catch {
    // Network error, keep polling
  }
}

// ============================
// Viewer heartbeat
// ============================

function startViewerHeartbeat() {
  if (state.isVodMode) return; // No heartbeat for VOD
  stopViewerHeartbeat();
  sendViewerHeartbeat();
  state.viewerHeartbeatTimer = setInterval(sendViewerHeartbeat, 30_000);
}

function stopViewerHeartbeat() {
  clearInterval(state.viewerHeartbeatTimer);
}

function sendViewerHeartbeat() {
  if (!state.currentStreamId || state.isVodMode) return;
  fetch(`${CONFIG.API_URL}/api/streams/${state.currentStreamId}/view`, {
    method: "POST",
  }).catch(() => {});
}

// ============================
// Open / Close player
// ============================

/**
 * Open the live-stream player.
 * Called from the streams module when a stream card is clicked.
 */
export function openPlayer(hlsUrl, name, streamId) {
  // Guard: don't re-open the same stream
  if (state.currentStreamId === streamId && !dom.playerView.classList.contains("hidden")) return;

  state.isVodMode = false;
  state.currentStreamUrl = hlsUrl;
  state.currentStreamId = streamId;
  state.hlsReconnectAttempts = 0;
  stopListPolling();
  stopVodPolling();

  dom.streamListView.classList.add("hidden");
  dom.vodListView.classList.add("hidden");
  dom.tabNav.classList.add("hidden");
  dom.playerView.classList.remove("hidden");

  dom.backBtnText.textContent = "Alla s\u00e4ndningar";
  dom.streamTitle.textContent = name;
  dom.streamDesc.textContent = "F\u00f6lj matchen live.";

  setupProgressForLive();
  setStatus("connecting");
  tryConnect();
  startStreamPolling();
  startViewerHeartbeat();
}

/**
 * Open the VOD player.
 * Called from the VOD module when a VOD card is clicked.
 */
export function openVodPlayer(hlsUrl, title, vodId) {
  state.isVodMode = true;
  state.currentStreamUrl = hlsUrl;
  state.currentStreamId = vodId;
  stopListPolling();
  stopVodPolling();

  dom.streamListView.classList.add("hidden");
  dom.vodListView.classList.add("hidden");
  dom.tabNav.classList.add("hidden");
  dom.playerView.classList.remove("hidden");

  dom.backBtnText.textContent = "Alla repriser";
  dom.streamTitle.textContent = title || "Repris";
  dom.streamDesc.textContent = "Inspelad match.";

  // Set VOD badge
  dom.liveBadge.textContent = "REPRIS";
  dom.liveBadge.className = "live-badge vod";
  state.currentStatus = "vod";

  setupProgressForVod();
  hideOverlay();
  tryConnectVod();
}

/**
 * Close the player and return to the list view.
 * Delegates tab-restoration to the orchestrator callback.
 */
export function closePlayer() {
  destroyHls();
  stopStreamPolling();
  stopViewerHeartbeat();
  resetProgress();
  const wasVod = state.isVodMode;
  state.currentStreamUrl = null;
  state.currentStreamId = null;
  state.isVodMode = false;

  dom.playerView.classList.add("hidden");
  dom.tabNav.classList.remove("hidden");

  setStatus("offline");

  if (onClosePlayer) onClosePlayer(wasVod);
}

// Exported for the visibilitychange handler in the orchestrator
export { startStreamPolling, stopStreamPolling, startViewerHeartbeat, stopViewerHeartbeat, pollCurrentStream };

// ============================
// Event binding
// ============================

function bindPlayerEvents() {
  dom.backBtn.addEventListener("click", closePlayer);

  dom.playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  dom.muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMute();
  });
  dom.volumeSlider.addEventListener("input", onVolumeChange);
  dom.volumeSlider.addEventListener("click", (e) => e.stopPropagation());
  dom.fullscreenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });

  // PiP button
  if (document.pictureInPictureEnabled) {
    dom.pipBtn.style.display = "";
  }
  dom.pipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePip();
  });

  dom.qualityBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dom.qualityMenu.classList.toggle("open");
  });

  document.addEventListener("click", () => {
    dom.qualityMenu.classList.remove("open");
  });

  // Progress bar events
  dom.video.addEventListener("timeupdate", updateProgress);
  dom.video.addEventListener("loadedmetadata", updateProgress);
  dom.progressBar.addEventListener("click", onProgressClick);
  dom.progressBar.addEventListener("mousedown", onSeekStart);
  dom.progressBar.addEventListener("touchstart", onSeekStart, { passive: false });
  dom.progressContainer.addEventListener("click", (e) => e.stopPropagation());

  dom.video.addEventListener("play", updatePlayButton);
  dom.video.addEventListener("pause", updatePlayButton);
  dom.video.addEventListener("volumechange", updateMuteButton);

  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("webkitfullscreenchange", updateFullscreenButton);

  dom.wrapper.addEventListener("click", togglePlay);
  dom.wrapper.addEventListener("mousemove", showControls);
  dom.wrapper.addEventListener("touchstart", showControls);

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (dom.playerView.classList.contains("hidden")) return;
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "m":
        toggleMute();
        break;
      case "f":
        toggleFullscreen();
        break;
      case "p":
        togglePip();
        break;
      case "ArrowLeft":
        if (state.isVodMode) {
          e.preventDefault();
          dom.video.currentTime = Math.max(0, dom.video.currentTime - 10);
        }
        break;
      case "ArrowRight":
        if (state.isVodMode) {
          e.preventDefault();
          dom.video.currentTime = Math.min(
            dom.video.duration || 0,
            dom.video.currentTime + 10
          );
        }
        break;
      case "Escape":
        closePlayer();
        break;
    }
  });
}

/**
 * Initialise the player module.
 * @param {Object} callbacks
 * @param {Function} callbacks.onClosePlayer - called when player closes; receives (wasVod: boolean)
 */
export function initPlayer(callbacks) {
  onClosePlayer = callbacks.onClosePlayer;
  bindPlayerEvents();
}
