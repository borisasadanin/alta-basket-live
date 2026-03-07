// === Älta IF Basket — Stream List + HLS Player ===

// --- DOM refs ---
const streamListView = document.getElementById("streamListView");
const streamGrid = document.getElementById("streamGrid");
const emptyState = document.getElementById("emptyState");
const playerView = document.getElementById("playerView");
const backBtn = document.getElementById("backBtn");

const video = document.getElementById("video");
const wrapper = document.getElementById("videoWrapper");
const overlay = document.getElementById("overlay");
const overlayText = overlay.querySelector(".overlay-text");
const overlaySpinner = document.getElementById("overlaySpinner");
const playBtn = document.getElementById("playBtn");
const muteBtn = document.getElementById("muteBtn");
const volumeSlider = document.getElementById("volumeSlider");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const qualityBtn = document.getElementById("qualityBtn");
const qualityLabel = document.getElementById("qualityLabel");
const qualityMenu = document.getElementById("qualityMenu");
const liveBadge = document.getElementById("liveBadge");
const statusDot = document.getElementById("statusDot");
const streamTitle = document.getElementById("streamTitle");
const streamDesc = document.getElementById("streamDesc");

const iconPlay = playBtn.querySelector(".icon-play");
const iconPause = playBtn.querySelector(".icon-pause");
const iconVol = muteBtn.querySelector(".icon-vol");
const iconMuted = muteBtn.querySelector(".icon-muted");
const iconFsEnter = fullscreenBtn.querySelector(".icon-fs-enter");
const iconFsExit = fullscreenBtn.querySelector(".icon-fs-exit");

let hls = null;
let controlsTimeout = null;
let streamPollTimer = null;
let listPollTimer = null;
let currentStatus = "offline";
let currentStreamUrl = null;

// ============================
// Stream List
// ============================

async function fetchStreams() {
  try {
    const res = await fetch(`${CONFIG.API_URL}/api/streams`);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch {
    return null;
  }
}

function renderStreamList(streams) {
  if (!streams || streams.length === 0) {
    streamGrid.innerHTML = "";
    streamGrid.classList.add("hidden");
    emptyState.classList.remove("hidden");
    statusDot.className = "status-dot offline";
    return;
  }

  emptyState.classList.add("hidden");
  streamGrid.classList.remove("hidden");
  statusDot.className = "status-dot live";

  streamGrid.innerHTML = streams
    .map(
      (s) => `
    <button class="stream-card" data-hls="${s.hlsUrl}" data-name="${s.name}">
      <div class="stream-card-badge">LIVE</div>
      <div class="stream-card-name">${s.name}</div>
    </button>`
    )
    .join("");

  streamGrid.querySelectorAll(".stream-card").forEach((card) => {
    card.addEventListener("click", () => {
      openPlayer(card.dataset.hls, card.dataset.name);
    });
  });
}

async function pollStreamList() {
  const streams = await fetchStreams();
  if (streams !== null) {
    renderStreamList(streams);
  }
}

function startListPolling() {
  clearInterval(listPollTimer);
  pollStreamList();
  listPollTimer = setInterval(pollStreamList, CONFIG.LIST_POLL_INTERVAL);
}

function stopListPolling() {
  clearInterval(listPollTimer);
}

// ============================
// Player
// ============================

function openPlayer(hlsUrl, name) {
  currentStreamUrl = hlsUrl;
  stopListPolling();

  streamListView.classList.add("hidden");
  playerView.classList.remove("hidden");

  streamTitle.textContent = name;
  streamDesc.textContent = "Följ matchen live.";

  setStatus("connecting");
  tryConnect();
  startStreamPolling();
}

function closePlayer() {
  destroyHls();
  stopStreamPolling();
  currentStreamUrl = null;

  playerView.classList.add("hidden");
  streamListView.classList.remove("hidden");

  setStatus("offline");
  startListPolling();
}

// --- Status ---

function setStatus(status) {
  if (status === currentStatus) return;
  currentStatus = status;

  switch (status) {
    case "connecting":
      liveBadge.textContent = "ANSLUTER";
      liveBadge.className = "live-badge connecting";
      showOverlay("Ansluter till sändningen\u2026", true);
      break;
    case "live":
      liveBadge.textContent = "LIVE";
      liveBadge.className = "live-badge live";
      hideOverlay();
      break;
    case "offline":
      liveBadge.textContent = "OFFLINE";
      liveBadge.className = "live-badge offline";
      showOverlay("Ingen sändning just nu", false);
      break;
  }
}

// --- HLS ---

function tryConnect() {
  if (!currentStreamUrl) return;

  if (Hls.isSupported()) {
    startHls();
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    startNative();
  } else {
    showOverlay("Din webbläsare stöder inte HLS-uppspelning", false);
  }
}

function startHls() {
  destroyHls();

  hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferLength: 10,
    maxMaxBufferLength: 30,
    manifestLoadingTimeOut: 8000,
    manifestLoadingMaxRetry: 1,
    manifestLoadingRetryDelay: 2000,
    levelLoadingTimeOut: 8000,
    levelLoadingMaxRetry: 1,
    fragLoadingTimeOut: 8000,
    fragLoadingMaxRetry: 1,
  });

  hls.loadSource(currentStreamUrl);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
  hls.on(Hls.Events.ERROR, onHlsError);
  hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
}

function startNative() {
  video.src = currentStreamUrl;
  video.addEventListener(
    "loadedmetadata",
    () => {
      setStatus("live");
      buildNativeQualityMenu();
    },
    { once: true }
  );
  video.addEventListener(
    "error",
    () => {
      setStatus("offline");
    },
    { once: true }
  );
}

function destroyHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

// --- Stream polling (when player is open but offline) ---

function startStreamPolling() {
  clearInterval(streamPollTimer);
  streamPollTimer = setInterval(() => {
    if (currentStatus !== "live" && currentStreamUrl) {
      checkStream();
    }
  }, CONFIG.STREAM_POLL_INTERVAL);
}

function stopStreamPolling() {
  clearInterval(streamPollTimer);
}

function checkStream() {
  fetch(currentStreamUrl, { method: "HEAD", mode: "cors" })
    .then((res) => {
      if (res.ok && currentStatus !== "live") {
        setStatus("connecting");
        tryConnect();
      } else if (!res.ok && currentStatus === "connecting") {
        setStatus("offline");
      }
    })
    .catch(() => {
      if (currentStatus === "connecting") {
        setStatus("offline");
      }
    });
}

// --- HLS callbacks ---

function onManifestParsed() {
  setStatus("live");
  buildQualityMenu();
  video.play().catch(() => {
    video.muted = true;
    video.play().catch(() => {});
    updateMuteButton();
  });
}

function onHlsError(_event, data) {
  if (data.fatal) {
    destroyHls();
    setStatus("offline");
  }
}

function onLevelSwitched(_event, data) {
  if (hls && hls.autoLevelEnabled) {
    const level = hls.levels[data.level];
    qualityLabel.textContent = `Auto (${level.height}p)`;
  }
  updateActiveQuality();
}

// --- Quality menu ---

function buildQualityMenu() {
  qualityMenu.innerHTML = "";

  const autoBtn = document.createElement("button");
  autoBtn.className = "quality-option active";
  autoBtn.textContent = "Auto";
  autoBtn.dataset.level = "-1";
  autoBtn.addEventListener("click", () => selectQuality(-1));
  qualityMenu.appendChild(autoBtn);

  hls.levels.forEach((level, i) => {
    const btn = document.createElement("button");
    btn.className = "quality-option";
    btn.textContent = `${level.height}p`;
    btn.dataset.level = i;
    btn.addEventListener("click", () => selectQuality(i));
    qualityMenu.appendChild(btn);
  });
}

function buildNativeQualityMenu() {
  qualityMenu.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "quality-option active";
  btn.textContent = "Auto";
  qualityMenu.appendChild(btn);
}

function selectQuality(levelIndex) {
  hls.currentLevel = levelIndex;
  if (levelIndex === -1) {
    hls.currentLevel = -1;
    qualityLabel.textContent = "Auto";
  } else {
    qualityLabel.textContent = `${hls.levels[levelIndex].height}p`;
  }
  updateActiveQuality();
  qualityMenu.classList.remove("open");
}

function updateActiveQuality() {
  if (!hls) return;
  const currentLevel = hls.autoLevelEnabled ? -1 : hls.currentLevel;
  qualityMenu.querySelectorAll(".quality-option").forEach((btn) => {
    btn.classList.toggle(
      "active",
      parseInt(btn.dataset.level) === currentLevel
    );
  });
}

// --- Controls ---

function togglePlay() {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
}

function updatePlayButton() {
  const playing = !video.paused;
  iconPlay.style.display = playing ? "none" : "block";
  iconPause.style.display = playing ? "block" : "none";
}

function toggleMute() {
  video.muted = !video.muted;
  volumeSlider.value = video.muted ? 0 : video.volume;
  updateMuteButton();
}

function updateMuteButton() {
  const muted = video.muted || video.volume === 0;
  iconVol.style.display = muted ? "none" : "block";
  iconMuted.style.display = muted ? "block" : "none";
}

function onVolumeChange() {
  video.volume = parseFloat(volumeSlider.value);
  video.muted = video.volume === 0;
  updateMuteButton();
}

function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    (wrapper.requestFullscreen || wrapper.webkitRequestFullscreen).call(
      wrapper
    );
  }
}

function updateFullscreenButton() {
  const isFs = !!(
    document.fullscreenElement || document.webkitFullscreenElement
  );
  iconFsEnter.style.display = isFs ? "none" : "block";
  iconFsExit.style.display = isFs ? "block" : "none";
}

function showControls() {
  wrapper.classList.add("show-controls");
  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    if (!video.paused) {
      wrapper.classList.remove("show-controls");
    }
  }, 3000);
}

// --- Overlay ---

function hideOverlay() {
  overlay.classList.add("hidden");
}

function showOverlay(msg, showSpinner) {
  overlayText.textContent = msg;
  overlay.classList.remove("hidden");
  if (overlaySpinner) {
    overlaySpinner.style.display = showSpinner ? "block" : "none";
  }
}

// --- Events ---

function bindEvents() {
  backBtn.addEventListener("click", closePlayer);

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMute();
  });
  volumeSlider.addEventListener("input", onVolumeChange);
  volumeSlider.addEventListener("click", (e) => e.stopPropagation());
  fullscreenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });

  qualityBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    qualityMenu.classList.toggle("open");
  });

  document.addEventListener("click", () => {
    qualityMenu.classList.remove("open");
  });

  video.addEventListener("play", updatePlayButton);
  video.addEventListener("pause", updatePlayButton);
  video.addEventListener("volumechange", updateMuteButton);

  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("webkitfullscreenchange", updateFullscreenButton);

  wrapper.addEventListener("click", togglePlay);
  wrapper.addEventListener("mousemove", showControls);
  wrapper.addEventListener("touchstart", showControls);

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (playerView.classList.contains("hidden")) return;
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
      case "Escape":
        closePlayer();
        break;
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentStreamUrl && currentStatus !== "live") {
      checkStream();
    }
  });
}

// --- Init ---

function init() {
  bindEvents();
  startListPolling();
}

init();
