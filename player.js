// === Älta IF Basket — HLS Live Player ===

const STREAM_URL =
  "https://eyevinnlab-restreamer.datarhei-restreamer.auto.prod.osaas.io/memfs/51ae4178-6857-44fb-87a5-974077fff9e8.m3u8";

const POLL_INTERVAL = 15000;

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

const iconPlay = playBtn.querySelector(".icon-play");
const iconPause = playBtn.querySelector(".icon-pause");
const iconVol = muteBtn.querySelector(".icon-vol");
const iconMuted = muteBtn.querySelector(".icon-muted");
const iconFsEnter = fullscreenBtn.querySelector(".icon-fs-enter");
const iconFsExit = fullscreenBtn.querySelector(".icon-fs-exit");

let hls = null;
let controlsTimeout = null;
let pollTimer = null;
let currentStatus = "connecting";

// --- State management ---

function setStatus(status) {
  if (status === currentStatus) return;
  currentStatus = status;

  switch (status) {
    case "connecting":
      liveBadge.textContent = "ANSLUTER";
      liveBadge.className = "live-badge connecting";
      statusDot.className = "status-dot connecting";
      showOverlay("Ansluter till sändningen\u2026", true);
      break;
    case "live":
      liveBadge.textContent = "LIVE";
      liveBadge.className = "live-badge live";
      statusDot.className = "status-dot live";
      hideOverlay();
      break;
    case "offline":
      liveBadge.textContent = "OFFLINE";
      liveBadge.className = "live-badge offline";
      statusDot.className = "status-dot offline";
      showOverlay("Ingen s\u00e4ndning just nu", false);
      break;
  }
}

// --- Init ---

function init() {
  setStatus("connecting");
  tryConnect();
  bindEvents();
  startPolling();
}

function tryConnect() {
  if (Hls.isSupported()) {
    startHls();
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    startNative();
  } else {
    showOverlay("Din webbläsare stöder inte HLS-uppspelning", false);
  }
}

function startHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }

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

  hls.loadSource(STREAM_URL);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
  hls.on(Hls.Events.ERROR, onHlsError);
  hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
}

function startNative() {
  video.src = STREAM_URL;
  video.addEventListener("loadedmetadata", () => {
    setStatus("live");
    buildNativeQualityMenu();
  }, { once: true });
  video.addEventListener("error", () => {
    setStatus("offline");
  }, { once: true });
}

// --- Polling: lightweight HEAD check every 15s when offline ---

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (currentStatus !== "live") {
      checkStream();
    }
  }, POLL_INTERVAL);
}

function checkStream() {
  fetch(STREAM_URL, { method: "HEAD", mode: "cors" })
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
    hls.destroy();
    hls = null;
    // Go straight to offline — polling will detect when stream comes back
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
    }
  });

  // Handle page visibility — check stream when tab becomes active
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentStatus !== "live") {
      checkStream();
    }
  });
}

// --- Start ---

init();
