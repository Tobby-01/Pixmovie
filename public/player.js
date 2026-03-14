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
const statSpeed = document.getElementById("statSpeed");
const statProgress = document.getElementById("statProgress");
const video = document.getElementById("video");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const streamBtn = document.getElementById("streamBtn");
const swarmBtn = document.getElementById("swarmBtn");
const hlsProgress = document.getElementById("hlsProgress");
const hlsProgressBar = document.getElementById("hlsProgressBar");
const hlsProgressMeta = document.getElementById("hlsProgressMeta");

const trackers = [
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
  "wss://tracker.fastcast.nz",
  "wss://tracker.files.fm:7073/announce"
];

function formatSpeed(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB/s`;
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

async function boot() {
  if (typeof bindLogout === "function") {
    bindLogout();
  }
  if (typeof token !== "undefined" && token && typeof apiFetch === "function") {
    if (typeof setNavUser === "function") {
      setNavUser({ username: "Account" });
    }
    apiFetch("/users/me")
      .then((user) => typeof setNavUser === "function" && setNavUser(user))
      .catch((err) => {
        const message = String(err && err.message ? err.message : "");
        if (/token|auth|expired|missing/i.test(message)) {
          if (typeof setToken === "function") setToken(null);
          if (typeof setNavUser === "function") setNavUser(null);
        }
      });
  } else if (typeof setNavUser === "function") {
    setNavUser(null);
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
    const uploader = movie.uploader?.username ? `by ${movie.uploader.username}` : "Unknown";
    playerMeta.textContent = `${uploader} - ${movie.views || 0} views`;
    if (playerBanner && playerBannerImg && movie.headerImage) {
      playerBannerImg.src = movie.headerImage;
      playerBanner.classList.remove("hidden");
    } else if (playerBanner) {
      playerBanner.classList.add("hidden");
    }
    const fileName = String(movie.fileName || movie.filePath || "").toLowerCase();

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
      statSpeed.textContent = "0 MB/s";
      statProgress.textContent = "0%";
      progressBar.style.width = "0%";
    }

    function startSwarmStream() {
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

    async function startHlsStream() {
      stopTorrent();
      stopHls();
      setActiveMode("stream");
      playerStatus.textContent = "Preparing stream...";
      if (hlsProgress) hlsProgress.classList.remove("hidden");
      if (hlsProgressMeta) {
        hlsProgressMeta.textContent = "Preparing stream...";
        hlsProgressMeta.classList.remove("hidden");
      }

      const hlsUrl = `${apiBase}/movies/${movie._id}/hls`;
      let ready = false;
      for (let i = 0; i < 30; i += 1) {
        const res = await fetch(`${hlsUrl}?wait=0`);
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

    streamBtn.addEventListener("click", startServerStream);
    swarmBtn.addEventListener("click", startSwarmStream);

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

    const ext = fileName.split(".").pop();
    const prefersHls = ["mkv", "avi", "wmv", "mpeg", "mpg", "ts", "m4v"].includes(ext);
    if (prefersHls) {
      await startHlsStream();
    } else {
      const canStream = await verifyServerStream();
      if (canStream) {
        startServerStream();
      } else if (window.WebTorrent) {
        startSwarmStream();
      } else {
        await startHlsStream();
      }
    }
  } catch (err) {
    playerStatus.textContent = err.message;
  }
}

boot();
