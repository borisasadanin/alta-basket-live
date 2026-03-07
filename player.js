// === Älta IF Basket — HLS Live Player ===

// Configure your eyevinn-live-encoding HLS URL here:
const STREAM_URL =
  "https://demo.eyevinn-live-encoding.auto.prod.osaas.io/origin/hls/index.m3u8";

const video = document.getElementById("video");
const wrapper = document.getElementById("videoWrapper");
const overlay = document.getElementById("overlay");
const playBtn = document.getElementById("playBtn");
const muteBtn = document.getElementById("muteBtn");
const volumeSlider = document.getElementById("volumeSlider");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const qualityBtn = document.getElementById("qualityBtn");
const qualityLabel = document.getElementById("qualityLabel");
const qualityMenu = document.getElementById("qualityMenu");
const liveBadge = document.getElementById("liveBadge");

const iconPlay = playBtn.querySelector(".icon-play");
const iconPause = playBtn.querySelector(".icon-pause");
const iconVol = muteBtn.querySelector(".icon-vol");
const iconMuted = muteBtn.querySelector(".icon-muted");
const iconFsEnter = fullscreenBtn.querySelector(".icon-fs-enter");
const iconFsExit = fullscreenBtn.querySelector(".icon-fs-exit");

let hls = null;
let controlsTimeout = null;

// --- Init ---

function init() {
  if (Hls.isSupported()) {
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
    });

    hls.loadSource(STREAM_URL);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
    hls.on(Hls.Events.ERROR, onHlsError);
    hls.on(Hls.Events.LEVEL_SWITCHED, onLevelSwitched);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari — native HLS
    video.src = STREAM_URL;
    video.addEventListener("loadedmetadata", () => {
      hideOverlay();
      buildNativeQualityMenu();
    });
  }

  bindEvents();
}

// --- HLS callbacks ---

function onManifestParsed() {
  hideOverlay();
  buildQualityMenu();
}

function onHlsError(_event, data) {
  if (data.fatal) {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      showOverlay("Kan inte ansluta till strömmen");
      setTimeout(() => hls.loadSource(STREAM_URL), 5000);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
    }
  }
}

function onLevelSwitched(_event, data) {
  if (hls.autoLevelEnabled) {
    const level = hls.levels[data.level];
    qualityLabel.textContent = `Auto (${level.height}p)`;
  }
  updateActiveQuality();
}

// --- Quality menu ---

function buildQualityMenu() {
  qualityMenu.innerHTML = "";

  // Auto option
  const autoBtn = document.createElement("button");
  autoBtn.className = "quality-option active";
  autoBtn.textContent = "Auto";
  autoBtn.dataset.level = "-1";
  autoBtn.addEventListener("click", () => selectQuality(-1));
  qualityMenu.appendChild(autoBtn);

  // Individual levels
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
  // Safari native HLS — no ABR control available
  qualityMenu.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "quality-option active";
  btn.textContent = "Auto";
  qualityMenu.appendChild(btn);
}

function selectQuality(levelIndex) {
  hls.currentLevel = levelIndex;
  if (levelIndex === -1) {
    hls.currentLevel = -1; // auto
    qualityLabel.textContent = "Auto";
  } else {
    qualityLabel.textContent = `${hls.levels[levelIndex].height}p`;
  }
  updateActiveQuality();
  qualityMenu.classList.remove("open");
}

function updateActiveQuality() {
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
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
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
  liveBadge.classList.remove("inactive");
}

function showOverlay(msg) {
  overlay.querySelector(".overlay-text").textContent = msg;
  overlay.classList.remove("hidden");
  liveBadge.classList.add("inactive");
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

  // Close quality menu on outside click
  document.addEventListener("click", () => {
    qualityMenu.classList.remove("open");
  });

  video.addEventListener("play", updatePlayButton);
  video.addEventListener("pause", updatePlayButton);
  video.addEventListener("volumechange", updateMuteButton);

  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("webkitfullscreenchange", updateFullscreenButton);

  // Click on video to play/pause
  wrapper.addEventListener("click", togglePlay);

  // Show controls on mouse/touch movement
  wrapper.addEventListener("mousemove", showControls);
  wrapper.addEventListener("touchstart", showControls);

  // Keyboard shortcuts
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
}

// --- Start ---

init();
