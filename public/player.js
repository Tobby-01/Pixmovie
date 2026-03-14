const urlParams = new URLSearchParams(window.location.search);
const movieId = urlParams.get("id");
const apiBase = typeof API_BASE !== "undefined" ? API_BASE : "/api";

const playerTitle = document.getElementById("playerTitle");
const playerMeta = document.getElementById("playerMeta");
const playerBanner = document.getElementById("playerBanner");
const playerBannerImg = document.getElementById("playerBannerImg");
const playerStatus = document.getElementById("playerStatus");
const progressBar = document.getElementById("progressBar");
const statPeers = document.getElementById("statPeers");
const statLive = document.getElementById("statLive");
const statSpeed = document.getElementById("statSpeed");
const statProgress = document.getElementById("statProgress");
const video = document.getElementById("video");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const streamBtn = document.getElementById("streamBtn");
const swarmBtn = document.getElementById("swarmBtn");
const lowDataBtn = document.getElementById("lowDataBtn");
const hlsProgress = document.getElementById("hlsProgress");
const hlsProgressBar = document.getElementById("hlsProgressBar");
const hlsProgressMeta = document.getElementById("hlsProgressMeta");

const watchlistBtn = document.getElementById("watchlistBtn");
const ratingSummary = document.getElementById("ratingSummary");
const ratingStars = document.getElementById("ratingStars");
const ratingComment = document.getElementById("ratingComment");
const ratingSubmit = document.getElementById("ratingSubmit");
const ratingList = document.getElementById("ratingList");
const ratingMessage = document.getElementById("ratingMessage");

const trackers = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz",
  "wss://tracker.files.fm:7073/announce"
];

let currentUser = null;
let watchlistIds = new Set();
let selectedScore = 0;
let lastProgressSent = 0;
let lowDataMode = false;
let livePingTimer = null;
let viewerId = null;
const dataModeSetting = localStorage.getItem("pixmovie_data_mode") || "balanced";
const preferSwarmSetting = localStorage.getItem("pixmovie_prefer_swarm") === "1";
const autoResumeSetting = localStorage.getItem("pixmovie_autoresume");
const trackHistorySetting = localStorage.getItem("pixmovie_track_history");
const autoResumeEnabled = autoResumeSetting == null ? true : autoResumeSetting === "1";
const trackHistoryEnabled = trackHistorySetting == null ? true : trackHistorySetting === "1";

function formatSpeed(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB/s`;
}

function getViewerId() {
  if (viewerId) return viewerId;
  const existing = localStorage.getItem("pixmovie_viewer_id");
  if (existing) {
    viewerId = existing;
    return viewerId;
  }
  const next =
    (typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function" &&
      crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem("pixmovie_viewer_id", next);
  viewerId = next;
  return viewerId;
}

async function updateLiveCount() {
  if (!statLive) return;
  try {
    const data = await apiFetch(`/movies/${movieId}/live`);
    statLive.textContent = data.count != null ? data.count : "0";
  } catch {
    statLive.textContent = "0";
  }
}

function startLivePing() {
  if (livePingTimer) return;
  const id = getViewerId();
  const ping = async () => {
    try {
      await apiFetch(`/movies/${movieId}/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerId: id })
      });
      await updateLiveCount();
    } catch {
      // ignore
    }
  };
  ping();
  livePingTimer = setInterval(ping, 15000);
}

function stopLivePing() {
  if (livePingTimer) {
    clearInterval(livePingTimer);
    livePingTimer = null;
  }
}

async function fetchMovie() {
  const res = await fetch(`${apiBase}/movies/${movieId}`);
  if (!res.ok) {
    throw new Error("Movie not found");
  }
  return res.json();
}

async function recordView() {
  await fetch(`${apiBase}/movies/${movieId}/view`, { method: "POST" });
}

function updateStats(torrent) {
  statPeers.textContent = torrent.numPeers;
  statSpeed.textContent = formatSpeed(torrent.downloadSpeed);
  statProgress.textContent = `${Math.floor(torrent.progress * 100)}%`;
  progressBar.style.width = `${torrent.progress * 100}%`;
}

function setActiveMode(mode) {
  const isStream = mode === "stream";
  streamBtn.classList.toggle("active", isStream);
  swarmBtn.classList.toggle("active", !isStream);
}

function setLowDataMode(enabled) {
  lowDataMode = enabled;
  if (lowDataBtn) {
    lowDataBtn.classList.toggle("active", enabled);
  }
}

function setWatchlistState(inList) {
  if (!watchlistBtn) return;
  watchlistBtn.textContent = inList ? "Remove from Watchlist" : "Add to Watchlist";
}

function renderStars(activeScore) {
  if (!ratingStars) return;
  ratingStars.innerHTML = "";
  for (let i = 1; i <= 5; i += 1) {
    const star = document.createElement("button");
    star.type = "button";
    star.className = `star ${i <= activeScore ? "active" : ""}`;
    star.textContent = "★";
    star.addEventListener("click", () => {
      selectedScore = i;
      renderStars(selectedScore);
    });
    ratingStars.appendChild(star);
  }
}

function renderRatingList(items) {
  if (!ratingList) return;
  ratingList.innerHTML = "";
  if (!items.length) {
    ratingList.textContent = "No feedback yet. Be the first to rate.";
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "rating-card";

    const header = document.createElement("div");
    header.className = "rating-header";

    const name = document.createElement("div");
    name.className = "rating-name";
    if (item.user && item.user.username) {
      name.textContent = item.user.username;
    } else {
      name.textContent = "Viewer";
    }

    const score = document.createElement("div");
    score.className = "rating-score";
    score.textContent = `${item.score || 0} / 5`;

    const meta = document.createElement("div");
    meta.className = "movie-meta";
    meta.textContent = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "";

    const comment = document.createElement("div");
    comment.className = "rating-comment";
    comment.textContent = item.comment || "No comment left.";

    header.append(name, score);
    card.append(header, meta, comment);
    ratingList.appendChild(card);
  });
}

async function loadRatings() {
  if (!ratingSummary) return;
  try {
    const data = await apiFetch(`/movies/${movieId}/ratings`);
    const average = Number(data.ratingAverage || 0).toFixed(1);
    if (data.ratingCount) {
      ratingSummary.textContent = `${average} / 5 (${data.ratingCount})`;
    } else {
      ratingSummary.textContent = "No ratings";
    }
    renderRatingList(data.ratings || []);
  } catch (err) {
    ratingSummary.textContent = "No ratings";
  }
}

async function loadCurrentUser() {
  if (!token) {
    setNavUser(null);
    return null;
  }
  try {
    const user = await apiFetch("/users/me");
    currentUser = user;
    setNavUser(user);
    bindLogout();
    watchlistIds = new Set((user.watchlistIds || []).map(String));
    return user;
  } catch (err) {
    setToken(null);
    setNavUser(null);
    return null;
  }
}

async function loadWatchlistState() {
  if (!token || !watchlistBtn) {
    if (watchlistBtn) watchlistBtn.style.display = "none";
    return;
  }
  setWatchlistState(watchlistIds.has(String(movieId)));
  watchlistBtn.addEventListener("click", async () => {
    if (!token) {
      window.location.href = "login.html";
      return;
    }
    try {
      if (watchlistIds.has(String(movieId))) {
        await apiFetch(`/users/me/watchlist/${movieId}`, { method: "DELETE" });
        watchlistIds.delete(String(movieId));
        setWatchlistState(false);
      } else {
        await apiFetch(`/users/me/watchlist/${movieId}`, { method: "POST" });
        watchlistIds.add(String(movieId));
        setWatchlistState(true);
      }
    } catch (err) {
      alert(err.message);
    }
  });
}

async function loadResume() {
  if (!token || !autoResumeEnabled) return;
  try {
    const entry = await apiFetch(`/users/me/history/${movieId}`);
    if (!entry || !entry.lastPosition) return;
    const resumeAt = Number(entry.lastPosition || 0);
    if (resumeAt < 10) return;
    video.addEventListener("loadedmetadata", () => {
      if (video.duration && resumeAt < video.duration - 3) {
        video.currentTime = resumeAt;
      }
    });
  } catch (err) {
    // ignore
  }
}

async function sendProgress(force = false) {
  if (!token || !trackHistoryEnabled) return;
  const now = Date.now();
  if (!force && now - lastProgressSent < 10000) return;
  lastProgressSent = now;
  try {
    await apiFetch("/users/me/history", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        movieId,
        position: video.currentTime || 0,
        duration: video.duration || 0
      })
    });
  } catch {
    // ignore
  }
}

async function boot() {
  if (typeof bindLogout === "function") {
    bindLogout();
  }
  await loadCurrentUser();
  await loadWatchlistState();
  lowDataMode = dataModeSetting === "low";
  setLowDataMode(lowDataMode);
  renderStars(selectedScore);
  if (!token && ratingSubmit) {
    ratingSubmit.textContent = "Log in to rate";
    ratingSubmit.onclick = () => {
      window.location.href = "login.html";
    };
  }

  if (!window.WebTorrent) {
    swarmBtn.disabled = true;
  }

  if (!movieId) {
    playerStatus.textContent = "Missing movie ID.";
    return;
  }

  try {
    const movie = await fetchMovie();
    playerTitle.textContent = movie.title;
    const uploaderName = movie.uploader?.username ? movie.uploader.username : "Unknown";
    const uploaderId = movie.uploader?._id || movie.uploader;
    const uploaderText = uploaderId
      ? `by <a class="link" href="user.html?id=${uploaderId}">${uploaderName}</a>`
      : `by ${uploaderName}`;
    playerMeta.innerHTML = `${uploaderText} - ${movie.views || 0} views`;
    if (playerBanner && playerBannerImg && movie.headerImage) {
      playerBannerImg.src = movie.headerImage;
      playerBanner.classList.remove("hidden");
    } else if (playerBanner) {
      playerBanner.classList.add("hidden");
    }
    const fileName = String(movie.fileName || movie.filePath || "").toLowerCase();
    const hasSwarm = Boolean(movie.magnetLink);
    if (!hasSwarm && swarmBtn) {
      swarmBtn.disabled = true;
      swarmBtn.title = "Swarm mode unavailable for this upload.";
    }

    async function verifyServerStream() {
      try {
        const res = await fetch(`${apiBase}/movies/${movie._id}/stream`, {
          headers: { Range: "bytes=0-1" }
        });
        if (res.ok || res.status === 206) {
          return true;
        }
        const message = await res.text();
        playerStatus.textContent = message || "Server stream not available.";
        return false;
      } catch {
        playerStatus.textContent = "Server stream not available.";
        return false;
      }
    }

    let torrentClient = null;
    let torrentInstance = null;
    let viewRecorded = false;
    let triedSwarmFallback = false;
    let hls = null;

    function recordOnce() {
      if (viewRecorded) return;
      viewRecorded = true;
      recordView().catch(() => {});
    }

    function stopTorrent() {
      if (torrentInstance) {
        torrentInstance.destroy();
        torrentInstance = null;
      }
      if (torrentClient) {
        torrentClient.destroy();
        torrentClient = null;
      }
    }

    function stopHls() {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      if (hlsProgress) {
        hlsProgress.classList.add("hidden");
      }
      if (hlsProgressMeta) {
        hlsProgressMeta.classList.add("hidden");
      }
    }

    function startServerStream() {
      stopTorrent();
      stopHls();
      setActiveMode("stream");
      playerStatus.textContent = "Streaming from the server with no local download.";
      video.src = `${apiBase}/movies/${movie._id}/stream`;
      video.load();
      recordOnce();
      statPeers.textContent = "0";
      if (statLive) statLive.textContent = "0";
      statSpeed.textContent = "0 MB/s";
      statProgress.textContent = "0%";
      progressBar.style.width = "0%";
    }

    function startSwarmStream() {
      if (!movie.magnetLink) {
        playerStatus.textContent = "Swarm mode unavailable for this upload.";
        return;
      }
      if (!window.WebTorrent) {
        playerStatus.textContent = "WebTorrent failed to load.";
        return;
      }
      setActiveMode("swarm");
      stopHls();
      video.removeAttribute("src");
      video.load();
      if (!torrentClient) {
        torrentClient = new WebTorrent();
      }
      torrentInstance = torrentClient.add(movie.magnetLink, { announce: trackers });
      recordOnce();

      torrentInstance.on("ready", () => {
        const file =
          torrentInstance.files.find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f.name)) ||
          torrentInstance.files[0];
        if (!file) {
          playerStatus.textContent = "No playable file found in torrent.";
          return;
        }
        file.renderTo(video);
        playerStatus.textContent = "Swarm mode active to reduce server data usage.";
      });

      torrentInstance.on("download", () => updateStats(torrentInstance));
      torrentInstance.on("done", () => updateStats(torrentInstance));
      torrentInstance.on("wire", () => updateStats(torrentInstance));
    }

    async function startHlsStream(options = {}) {
      stopTorrent();
      stopHls();
      setActiveMode("stream");
      playerStatus.textContent = options.lowData ? "Preparing low data stream..." : "Preparing stream...";
      if (hlsProgress) hlsProgress.classList.remove("hidden");
      if (hlsProgressMeta) {
        hlsProgressMeta.textContent = "Preparing stream...";
        hlsProgressMeta.classList.remove("hidden");
      }

      const params = new URLSearchParams();
      if (options.lowData) params.set("low", "1");
      const baseUrl = `${apiBase}/movies/${movie._id}/hls`;
      const hlsUrl = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
      const pollUrl = `${hlsUrl}${hlsUrl.includes("?") ? "&" : "?"}wait=0`;
      let ready = false;
      for (let i = 0; i < 30; i += 1) {
        const res = await fetch(pollUrl);
        if (res.status === 200) {
          ready = true;
          break;
        }
        if (res.status !== 202) {
          const text = await res.text();
          playerStatus.textContent = text || "HLS stream unavailable.";
          return;
        }
        playerStatus.textContent = "Transcoding for playback...";
        if (hlsProgressBar) {
          const percent = Math.min(95, Math.floor(((i + 1) / 30) * 100));
          hlsProgressBar.style.width = `${percent}%`;
        }
        if (hlsProgressMeta) {
          hlsProgressMeta.textContent = `Transcoding... ${Math.min(
            95,
            Math.floor(((i + 1) / 30) * 100)
          )}%`;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (!ready) {
        playerStatus.textContent = "Transcoding is taking too long.";
        if (hlsProgressBar) hlsProgressBar.style.width = "100%";
        if (hlsProgressMeta) hlsProgressMeta.textContent = "Still processing...";
        return;
      }

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = hlsUrl;
        video.load();
        recordOnce();
        playerStatus.textContent = "Streaming via HLS.";
        if (hlsProgressBar) hlsProgressBar.style.width = "100%";
        if (hlsProgressMeta) hlsProgressMeta.textContent = "Stream ready.";
        return;
      }

      if (window.Hls) {
        hls = new Hls();
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        recordOnce();
        playerStatus.textContent = "Streaming via HLS.";
        if (hlsProgressBar) hlsProgressBar.style.width = "100%";
        if (hlsProgressMeta) hlsProgressMeta.textContent = "Stream ready.";
        return;
      }

      playerStatus.textContent = "HLS playback not supported in this browser.";
    }

    streamBtn.addEventListener("click", () => {
      setLowDataMode(false);
      startServerStream();
    });
    swarmBtn.addEventListener("click", startSwarmStream);
    if (lowDataBtn) {
      lowDataBtn.addEventListener("click", () => {
        setLowDataMode(true);
        startHlsStream({ lowData: true }).catch(() => {});
      });
    }

    fullscreenBtn.addEventListener("click", () => {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
        return;
      }
      if (video.requestFullscreen) {
        video.requestFullscreen().catch(() => {});
      } else if (video.webkitRequestFullscreen) {
        video.webkitRequestFullscreen();
      }
    });

    video.addEventListener("error", () => {
      if (triedSwarmFallback) return;
      triedSwarmFallback = true;
      startHlsStream().catch(() => {
        if (window.WebTorrent) {
          playerStatus.textContent = "Server stream failed. Switching to swarm mode.";
          startSwarmStream();
        } else {
          playerStatus.textContent =
            "This format may not be supported in your browser. Try MP4 or enable swarm mode.";
        }
      });
    });

    video.addEventListener("timeupdate", () => sendProgress(false));
    video.addEventListener("pause", () => sendProgress(true));
    video.addEventListener("ended", () => sendProgress(true));
    video.addEventListener("play", startLivePing);
    video.addEventListener("pause", stopLivePing);
    video.addEventListener("ended", stopLivePing);

    const ext = fileName.split(".").pop();
    const prefersHls = ["mkv", "avi", "wmv", "mpeg", "mpg", "ts", "m4v"].includes(ext);
    if (prefersHls) {
      await startHlsStream({ lowData: lowDataMode });
    } else {
      const canStream = await verifyServerStream();
      if (preferSwarmSetting && window.WebTorrent && hasSwarm) {
        startSwarmStream();
      } else if (canStream) {
        startServerStream();
      } else if (window.WebTorrent && hasSwarm) {
        startSwarmStream();
      } else {
        await startHlsStream({ lowData: lowDataMode });
      }
    }

    await loadResume();
    await loadRatings();
    await updateLiveCount();

    if (ratingSubmit) {
      ratingSubmit.addEventListener("click", async () => {
        if (!token) {
          window.location.href = "login.html";
          return;
        }
        if (!selectedScore) {
          if (ratingMessage) ratingMessage.textContent = "Select a star rating first.";
          return;
        }
        try {
          if (ratingMessage) ratingMessage.textContent = "";
          await apiFetch(`/movies/${movieId}/ratings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              score: selectedScore,
              comment: ratingComment ? ratingComment.value.trim() : ""
            })
          });
          if (ratingComment) ratingComment.value = "";
          selectedScore = 0;
          renderStars(selectedScore);
          await loadRatings();
          if (ratingMessage) ratingMessage.textContent = "Thanks for your feedback!";
        } catch (err) {
          if (ratingMessage) ratingMessage.textContent = err.message;
        }
      });
    }
  } catch (err) {
    playerStatus.textContent = err.message;
  }
}

boot();
