const seriesForm = document.getElementById("seriesForm");
const seriesMessage = document.getElementById("seriesMessage");
const seriesGrid = document.getElementById("seriesGrid");

const uploadForm = document.getElementById("uploadForm");
const uploadMessage = document.getElementById("uploadMessage");
const uploadFileInfo = document.getElementById("uploadFileInfo");
const uploadProgressWrap = document.getElementById("uploadProgressWrap");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const uploadPercent = document.getElementById("uploadPercent");
const uploadBytes = document.getElementById("uploadBytes");
const uploadBtn = document.getElementById("uploadBtn");
const headerInput = document.getElementById("headerInput");
const headerPreview = document.getElementById("headerPreview");
const ffmpegBanner = document.getElementById("ffmpegBanner");
const resumePanel = document.getElementById("resumePanel");
const resumeList = document.getElementById("resumeList");
const resumeEmpty = document.getElementById("resumeEmpty");
let ffmpegAvailable = true;
let headerObjectUrl = null;

function formatBytesCompact(bytes) {
  if (bytes == null) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

const allowedExtensions = [
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
  ".wmv",
  ".ts"
];

function isPlayable(fileName) {
  const lower = String(fileName || "").toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
}

const resumableKey = "pixmovie_resumable_uploads";

function loadResumableSessions() {
  try {
    const raw = localStorage.getItem(resumableKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveResumableSessions(next) {
  localStorage.setItem(resumableKey, JSON.stringify(next));
}

async function registerUploadSync() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (registration && "sync" in registration) {
      await registration.sync.register("pixmovie-upload");
    }
  } catch {
    // ignore
  }
}

function buildSessionKey({ kind, file, seriesId, seasonNumber, episodeNumber }) {
  return [
    kind,
    seriesId || "",
    seasonNumber || "",
    episodeNumber || "",
    file.name,
    file.size,
    file.lastModified || 0
  ].join("|");
}

function storeSession(key, payload) {
  const sessions = loadResumableSessions();
  sessions[key] = payload;
  saveResumableSessions(sessions);
  renderResumePanel();
}

function clearSession(key) {
  const sessions = loadResumableSessions();
  delete sessions[key];
  saveResumableSessions(sessions);
  renderResumePanel();
}

async function initResumableUpload(payload) {
  return apiFetch("/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function fetchUploadStatus(uploadId) {
  return apiFetch(`/uploads/${uploadId}/status`);
}

async function uploadChunk(uploadId, chunk, start, end, total) {
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Range": `bytes ${start}-${end}/${total}`
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/uploads/${uploadId}/chunk`, {
    method: "PUT",
    headers,
    body: chunk
  });
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }
  if (!res.ok) {
    const error = new Error(data.message || `Chunk upload failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function notifyStatus(target, text) {
  if (!target) return;
  if (typeof target === "function") {
    target(text);
  } else {
    target.textContent = text;
  }
}

function waitForOnlineAndVisible(statusTarget) {
  if (navigator.onLine && !document.hidden) {
    notifyStatus(statusTarget, "Resuming upload...");
    return Promise.resolve();
  }
  notifyStatus(
    statusTarget,
    navigator.onLine
      ? "Upload paused while app is minimized. Return to continue."
      : "Upload paused. Waiting for connection..."
  );
  registerUploadSync();
  return new Promise((resolve) => {
    const handler = () => {
      if (navigator.onLine && !document.hidden) {
        window.removeEventListener("online", handler);
        document.removeEventListener("visibilitychange", handler);
        resolve();
      }
    };
    window.addEventListener("online", handler);
    document.addEventListener("visibilitychange", handler);
  });
}

function renderResumePanel() {
  if (!resumeList || !resumeEmpty) return;
  const sessions = loadResumableSessions();
  const entries = Object.entries(sessions);
  resumeList.innerHTML = "";
  if (!entries.length) {
    resumeEmpty.classList.remove("hidden");
    return;
  }
  resumeEmpty.classList.add("hidden");

  entries.forEach(([key, session]) => {
    const card = document.createElement("div");
    card.className = "resume-card";

    const header = document.createElement("div");
    header.className = "resume-header";

    const title = document.createElement("strong");
    title.textContent = session.fileName || "Untitled upload";

    const meta = document.createElement("div");
    meta.className = "resume-meta";
    const received = Number(session.received || 0);
    const size = Number(session.size || 0);
    const percent = size ? Math.floor((received / size) * 100) : 0;
    const kindLabel = session.kind === "episode" ? "Episode" : "Movie";
    const episodeLabel =
      session.kind === "episode"
        ? ` • S${session.seasonNumber || 1}E${session.episodeNumber || "?"}`
        : "";
    meta.textContent = `${kindLabel}${episodeLabel} • ${formatBytesCompact(
      received
    )} / ${formatBytesCompact(size)} • ${percent}%`;

    header.append(title, meta);

    const message = document.createElement("div");
    message.className = "movie-meta";
    message.textContent = "Waiting for file to resume.";

    const actions = document.createElement("div");
    actions.className = "resume-actions";

    const resumeBtn = document.createElement("button");
    resumeBtn.className = "btn small";
    resumeBtn.type = "button";
    resumeBtn.textContent = "Resume";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn ghost small";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    resumeBtn.addEventListener("click", () => resumeSession(key, session, message, resumeBtn));
    cancelBtn.addEventListener("click", () => cancelSession(key, session, message));

    actions.append(resumeBtn, cancelBtn);
    card.append(header, message, actions);
    resumeList.appendChild(card);
  });
}

function cancelSession(key, session, messageEl) {
  if (messageEl) messageEl.textContent = "Cancelling...";
  apiFetch(`/uploads/${session.uploadId}`, { method: "DELETE" })
    .catch(() => {})
    .finally(() => {
      clearSession(key);
    });
}

function resumeSession(key, session, messageEl, buttonEl) {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept =
    "video/mp4,video/webm,video/quicktime,video/x-matroska,video/x-msvideo,video/mpeg,video/mp2t";
  picker.addEventListener("change", async () => {
    const file = picker.files[0];
    if (!file) return;
    if (file.name !== session.fileName || file.size !== Number(session.size || 0)) {
      if (messageEl) {
        messageEl.textContent = "Selected file does not match this upload.";
      }
      return;
    }
    if (!ffmpegAvailable) {
      if (messageEl) {
        messageEl.textContent = "FFmpeg is required to process uploads on this server.";
      }
      if (ffmpegBanner) ffmpegBanner.classList.remove("hidden");
      return;
    }
    if (buttonEl) buttonEl.disabled = true;
    if (messageEl) messageEl.textContent = "Resuming upload...";
    try {
      await resumableUpload({
        kind: session.kind,
        file,
        title: session.title || "",
        seriesId: session.seriesId,
        seasonNumber: session.seasonNumber,
        episodeNumber: session.episodeNumber,
        onProgress: (loaded, total) => {
          if (messageEl) {
            const percent = total ? Math.floor((loaded / total) * 100) : 0;
            messageEl.textContent = `Uploading... ${percent}%`;
          }
        },
        onStatus: (text) => {
          if (messageEl && text) messageEl.textContent = text;
        }
      });
      clearSession(key);
      if (messageEl) messageEl.textContent = "Upload complete. Processing now.";
    } catch (err) {
      if (messageEl) messageEl.textContent = err.message || "Upload failed.";
    } finally {
      if (buttonEl) buttonEl.disabled = false;
    }
  });
  picker.click();
}

async function resumableUpload({
  kind,
  file,
  title,
  seriesId,
  seasonNumber,
  episodeNumber,
  onProgress,
  onStatus
}) {
  registerUploadSync();
  const sessionKey = buildSessionKey({ kind, file, seriesId, seasonNumber, episodeNumber });
  const sessions = loadResumableSessions();
  let session = sessions[sessionKey] || null;

  if (!session) {
    const init = await initResumableUpload({
      kind,
      title,
      fileName: file.name,
      size: file.size,
      seriesId,
      seasonNumber,
      episodeNumber
    });
    session = {
      uploadId: init.uploadId,
      chunkSize: init.chunkSize,
      fileName: file.name,
      size: file.size,
      lastModified: file.lastModified || 0,
      title: title || "",
      kind,
      seriesId,
      seasonNumber,
      episodeNumber
    };
    storeSession(sessionKey, session);
  }

  const status = await fetchUploadStatus(session.uploadId);
  let offset = Number(status.received || 0);
  const chunkSize = Number(session.chunkSize || status.chunkSize || 8 * 1024 * 1024);

  if (onProgress) onProgress(offset, file.size);
  if (onStatus && offset > 0) {
    onStatus(`Resuming upload at ${formatBytesCompact(offset)}...`);
  }

  while (offset < file.size) {
    await waitForOnlineAndVisible(onStatus);
    const chunk = file.slice(offset, offset + chunkSize);
    const end = offset + chunk.size - 1;
    try {
      const result = await uploadChunk(session.uploadId, chunk, offset, end, file.size);
      offset = Number(result.received || end + 1);
      if (onProgress) onProgress(offset, file.size);
      storeSession(sessionKey, { ...session, received: offset });
    } catch (err) {
      if (err.status === 409 && err.data && typeof err.data.expected === "number") {
        offset = Number(err.data.expected);
        if (onProgress) onProgress(offset, file.size);
        continue;
      }
      throw err;
    }
  }

  const movie = await apiFetch(`/uploads/${session.uploadId}/complete`, { method: "POST" });
  clearSession(sessionKey);
  return movie;
}

function setProgress(bar, percentEl, bytesEl, loaded, total) {
  const percent = total ? Math.floor((loaded / total) * 100) : 0;
  bar.style.width = `${percent}%`;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (bytesEl) {
    bytesEl.textContent = `${formatBytesCompact(loaded)} / ${formatBytesCompact(total || 0)}`;
  }
}

function clearHeaderPreview() {
  if (!headerPreview) return;
  if (headerObjectUrl) {
    URL.revokeObjectURL(headerObjectUrl);
    headerObjectUrl = null;
  }
  headerPreview.style.backgroundImage = "";
  headerPreview.classList.add("hidden");
}

async function loadCurrentUser() {
  if (!requireAuth()) return null;
  try {
    const user = await apiFetch("/users/me");
    setNavUser(user);
    bindLogout();
    return user;
  } catch (err) {
    setToken(null);
    window.location.href = "index.html";
    return null;
  }
}

async function checkFfmpeg() {
  try {
    const data = await apiFetch("/system/ffmpeg");
    ffmpegAvailable = Boolean(data.available);
    if (!ffmpegAvailable && ffmpegBanner) {
      ffmpegBanner.classList.remove("hidden");
    }
  } catch (err) {
    // Ignore check failures
  }
}

function buildSeasonPanel(series, seasonNumber) {
  const panel = document.createElement("div");
  panel.className = "season-panel";
  panel.dataset.seriesId = series._id;
  panel.dataset.seasonNumber = seasonNumber;

  const header = document.createElement("div");
  header.className = "season-header";

  const title = document.createElement("h4");
  title.textContent = `Season ${seasonNumber}`;

  const controls = document.createElement("div");
  controls.className = "season-controls";

  const countInput = document.createElement("input");
  countInput.className = "input mini-input";
  countInput.type = "number";
  countInput.min = "1";
  countInput.placeholder = "Episodes";

  const generateBtn = document.createElement("button");
  generateBtn.className = "btn ghost small";
  generateBtn.type = "button";
  generateBtn.textContent = "Create Upload Slots";

  controls.append(countInput, generateBtn);
  header.append(title, controls);

  const slots = document.createElement("div");
  slots.className = "episode-slots";

  const episodeList = document.createElement("div");
  episodeList.className = "episode-list";
  episodeList.dataset.seriesId = series._id;
  episodeList.dataset.seasonNumber = seasonNumber;

  panel.append(header, slots, episodeList);

  function createEpisodeSlot(episodeNumber) {
    const form = document.createElement("form");
    form.className = "episode-slot";
    form.dataset.seriesId = series._id;
    form.dataset.seasonNumber = seasonNumber;
    form.dataset.episodeNumber = episodeNumber;

    const label = document.createElement("div");
    label.className = "episode-label";
    label.textContent = `Episode ${episodeNumber}`;

    const titleInput = document.createElement("input");
    titleInput.className = "input";
    titleInput.name = "title";
    titleInput.placeholder = `Episode ${episodeNumber} title`;

    const episodeInput = document.createElement("input");
    episodeInput.type = "hidden";
    episodeInput.name = "episodeNumber";
    episodeInput.value = String(episodeNumber);

    const fileInput = document.createElement("input");
    fileInput.className = "input";
    fileInput.name = "video";
    fileInput.type = "file";
    fileInput.accept =
      "video/mp4,video/webm,video/quicktime,video/x-matroska,video/x-msvideo,video/mpeg,video/mp2t";
    fileInput.required = true;

    const button = document.createElement("button");
    button.className = "btn small";
    button.type = "submit";
    button.textContent = "Upload";

    const progressWrap = document.createElement("div");
    progressWrap.className = "progress hidden";
    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressWrap.appendChild(progressBar);

    const stats = document.createElement("div");
    stats.className = "upload-stats";
    const percent = document.createElement("span");
    percent.textContent = "0%";
    const bytes = document.createElement("span");
    bytes.textContent = "0 MB / 0 MB";
    stats.append(percent, bytes);

    const message = document.createElement("p");
    message.className = "movie-meta";

    const fields = document.createElement("div");
    fields.className = "slot-fields";
    fields.append(titleInput, fileInput, button);

    form.append(episodeInput, label, fields, progressWrap, stats, message);

    form.addEventListener("submit", (e) =>
      handleEpisodeUpload(e, {
        seriesId: series._id,
        seasonNumber,
        episodeNumber,
        progressWrap,
        progressBar,
        percent,
        bytes,
        message,
        fileInput
      })
    );

    fileInput.addEventListener("change", () => {
      if (!fileInput.files[0]) {
        progressWrap.classList.add("hidden");
        setProgress(progressBar, percent, bytes, 0, 0);
        return;
      }
      progressWrap.classList.remove("hidden");
      setProgress(progressBar, percent, bytes, 0, fileInput.files[0].size);
      const resumeKey = buildSessionKey({
        kind: "episode",
        file: fileInput.files[0],
        seriesId: series._id,
        seasonNumber,
        episodeNumber
      });
      const sessions = loadResumableSessions();
      if (sessions[resumeKey]) {
        message.textContent = "Resume available. Press upload to continue.";
      }
    });

    return form;
  }

  function renderSlots(count) {
    slots.innerHTML = "";
    const total = Math.max(1, Number(count) || 1);
    for (let i = 1; i <= total; i += 1) {
      slots.appendChild(createEpisodeSlot(i));
    }
  }

  generateBtn.addEventListener("click", () => {
    renderSlots(countInput.value);
  });

  renderSlots(1);

  return panel;
}

async function handleEpisodeUpload(
  event,
  {
    seriesId,
    seasonNumber,
    episodeNumber,
    progressWrap,
    progressBar,
    percent,
    bytes,
    message,
    fileInput
  }
) {
  event.preventDefault();
  message.textContent = "";
  const form = event.target;
  const file = fileInput.files[0];
  if (!file) {
    message.textContent = "Select a video file.";
    return;
  }
  if (!isPlayable(file.name)) {
    message.textContent =
      "Unsupported format. Use MP4, WebM, MOV, MKV, AVI, MPG, MPEG, WMV, TS, or M4V.";
    return;
  }
  if (!ffmpegAvailable) {
    message.textContent = "FFmpeg is required to process uploads on this server.";
    if (ffmpegBanner) ffmpegBanner.classList.remove("hidden");
    return;
  }

  progressWrap.classList.remove("hidden");
  setProgress(progressBar, percent, bytes, 0, file.size);
  message.textContent = "Preparing upload...";

  try {
    const title = String(form.title?.value || "").trim() || `Episode ${episodeNumber}`;
    await resumableUpload({
      kind: "episode",
      file,
      title,
      seriesId,
      seasonNumber,
      episodeNumber,
      onProgress: (loaded, total) => {
        setProgress(progressBar, percent, bytes, loaded, total);
      },
      onStatus: (text) => {
        if (text) message.textContent = text;
      }
    });

    form.reset();
    setProgress(progressBar, percent, bytes, 0, 0);
    message.textContent = "Episode uploaded. Processing now.";
    await loadEpisodes(seriesId);
  } catch (err) {
    message.textContent = err.message || "Upload failed.";
  }
}

async function loadSeries() {
  const list = await apiFetch("/series/mine");
  seriesGrid.innerHTML = "";
  if (!list.length) {
    seriesGrid.textContent = "No series yet. Create your first series folder.";
    return;
  }

  list.forEach((series) => {
    const card = document.createElement("div");
    card.className = "series-card";

    if (series.headerImage) {
      const banner = document.createElement("div");
      banner.className = "series-banner";
      banner.style.backgroundImage = `url("${series.headerImage}")`;
      card.appendChild(banner);
    }

    const header = document.createElement("div");
    header.className = "series-header";

    const title = document.createElement("h3");
    title.textContent = series.title;

    const meta = document.createElement("span");
    meta.className = "badge";
    meta.textContent = `${series.seasonsCount} seasons`;

    header.append(title, meta);

    const alert = document.createElement("div");
    alert.className = "series-alert hidden";
    alert.dataset.seriesId = series._id;

    const headerActions = document.createElement("div");
    headerActions.className = "series-actions";

    const headerBtn = document.createElement("button");
    headerBtn.className = "btn ghost small";
    headerBtn.type = "button";
    headerBtn.textContent = series.headerImage ? "Change Header" : "Add Header";

    const headerInput = document.createElement("input");
    headerInput.type = "file";
    headerInput.accept = "image/*";
    headerInput.className = "hidden";

    headerBtn.addEventListener("click", () => headerInput.click());

    headerInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const alertText = (message, isError = false) => {
        alert.textContent = message;
        alert.classList.remove("hidden");
        alert.style.borderColor = isError ? "rgba(239, 68, 68, 0.55)" : "";
        alert.style.background = isError ? "rgba(239, 68, 68, 0.12)" : "";
        alert.style.color = isError ? "#991b1b" : "";
      };

      try {
        const formData = new FormData();
        formData.append("header", file);
        await apiFetch(`/series/${series._id}/header`, {
          method: "PUT",
          body: formData
        });
        headerInput.value = "";
        alertText("Series header updated.");
        await loadSeries();
      } catch (err) {
        alertText(err.message || "Failed to update header.", true);
      }
    });

    headerActions.append(headerBtn, headerInput);

    const seasonsGrid = document.createElement("div");
    seasonsGrid.className = "seasons-grid";
    for (let season = 1; season <= Number(series.seasonsCount || 1); season += 1) {
      seasonsGrid.appendChild(buildSeasonPanel(series, season));
    }

    card.append(header, headerActions, alert, seasonsGrid);
    seriesGrid.appendChild(card);
  });

  await Promise.all(list.map((series) => loadEpisodes(series._id)));
}

async function loadEpisodes(seriesId) {
  try {
    const episodes = await apiFetch(`/series/${seriesId}/episodes`);
    const grouped = episodes.reduce((acc, episode) => {
      const season = Number(episode.seasonNumber || 1);
      if (!acc[season]) acc[season] = [];
      acc[season].push(episode);
      return acc;
    }, {});

    const lists = document.querySelectorAll(
      `.episode-list[data-series-id="${seriesId}"]`
    );
    lists.forEach((list) => {
      const seasonNumber = Number(list.dataset.seasonNumber || 1);
      const items = grouped[seasonNumber] || [];
      list.innerHTML = "";
      if (!items.length) {
        list.textContent = "No episodes uploaded yet.";
        return;
      }
      items.forEach((episode) => {
        const row = document.createElement("div");
        row.className = "episode-row";
        row.textContent = `Episode ${episode.episodeNumber || 0}: ${episode.title}`;
        list.appendChild(row);
      });
    });
  } catch (err) {
    // Ignore for now
  }
}

seriesForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  seriesMessage.textContent = "";
  const form = e.target;
  const formData = new FormData(form);

  try {
    await apiFetch("/series", {
      method: "POST",
      body: formData
    });
    form.reset();
    seriesMessage.textContent = "Series folder created.";
    clearHeaderPreview();
    await loadSeries();
  } catch (err) {
    seriesMessage.textContent = err.message;
  }
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  uploadMessage.textContent = "";
  const form = e.target;
  const file = form.video.files[0];
  if (!file) {
    uploadMessage.textContent = "Please choose a video file.";
    return;
  }
  if (!isPlayable(file.name)) {
    uploadMessage.textContent =
      "Unsupported format. Use MP4, WebM, MOV, MKV, AVI, MPG, MPEG, WMV, TS, or M4V.";
    return;
  }
  if (!ffmpegAvailable) {
    uploadMessage.textContent = "FFmpeg is required to process uploads on this server.";
    if (ffmpegBanner) ffmpegBanner.classList.remove("hidden");
    return;
  }

  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";
  uploadProgressWrap.classList.remove("hidden");
  setProgress(uploadProgressBar, uploadPercent, uploadBytes, 0, file.size);
  uploadMessage.textContent = "Preparing upload...";

  try {
    await resumableUpload({
      kind: "movie",
      file,
      title: String(form.title?.value || "").trim(),
      onProgress: (loaded, total) => {
        setProgress(uploadProgressBar, uploadPercent, uploadBytes, loaded, total);
      },
      onStatus: (text) => {
        if (text) uploadMessage.textContent = text;
      }
    });

    form.reset();
    uploadFileInfo.textContent = "No file selected.";
    setProgress(uploadProgressBar, uploadPercent, uploadBytes, 0, 0);
    uploadMessage.textContent = "Upload complete. Processing now.";
  } catch (err) {
    uploadMessage.textContent = err.message || "Upload failed.";
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload & Seed";
  }
});

uploadForm.querySelector('input[type="file"][name="video"]').addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) {
    uploadFileInfo.textContent = "No file selected.";
    uploadProgressWrap.classList.add("hidden");
    setProgress(uploadProgressBar, uploadPercent, uploadBytes, 0, 0);
    return;
  }
  uploadFileInfo.textContent = `${file.name} (${formatBytesCompact(file.size)})`;
  uploadProgressWrap.classList.remove("hidden");
  setProgress(uploadProgressBar, uploadPercent, uploadBytes, 0, file.size);
  const resumeKey = buildSessionKey({ kind: "movie", file });
  const sessions = loadResumableSessions();
  if (sessions[resumeKey]) {
    uploadMessage.textContent = "Resume available. Press upload to continue.";
  }
});

if (headerInput && headerPreview) {
  headerInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) {
      clearHeaderPreview();
      return;
    }
    if (!file.type.startsWith("image/")) {
      if (seriesMessage) {
        seriesMessage.textContent = "Header must be an image file.";
      }
      headerInput.value = "";
      clearHeaderPreview();
      return;
    }
    if (headerObjectUrl) {
      URL.revokeObjectURL(headerObjectUrl);
    }
    headerObjectUrl = URL.createObjectURL(file);
    headerPreview.style.backgroundImage = `url("${headerObjectUrl}")`;
    headerPreview.classList.remove("hidden");
  });
}

async function boot() {
  const user = await loadCurrentUser();
  if (!user) return;
  await checkFfmpeg();
  await loadSeries();
  renderResumePanel();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "resume-uploads") {
      renderResumePanel();
    }
  });
}

boot();
