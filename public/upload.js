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

const allowedExtensions = [".mp4", ".webm", ".mov", ".mkv"];

function isPlayable(fileName) {
  const lower = String(fileName || "").toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
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
    fileInput.accept = "video/mp4,video/webm,video/quicktime,video/x-matroska";
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
    message.textContent = "Unsupported format. Use MP4, WebM, MOV, or MKV.";
    return;
  }
  if (!ffmpegAvailable && file.name.toLowerCase().endsWith(".mkv")) {
    message.textContent = "FFmpeg is required to convert MKV. Install it first.";
    if (ffmpegBanner) ffmpegBanner.classList.remove("hidden");
    return;
  }

  const formData = new FormData(form);
  formData.set("seasonNumber", String(seasonNumber));
  if (episodeNumber) {
    formData.set("episodeNumber", String(episodeNumber));
  }

  progressWrap.classList.remove("hidden");
  setProgress(progressBar, percent, bytes, 0, file.size);
  message.textContent = "Uploading...";

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/series/${seriesId}/episodes`);
  if (token) {
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
  }

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      setProgress(progressBar, percent, bytes, event.loaded, event.total);
    }
  };

  xhr.onload = async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      form.reset();
      setProgress(progressBar, percent, bytes, 0, 0);
      message.textContent = "Episode uploaded and seeding.";
      await loadEpisodes(seriesId);
    } else {
      const card = form.closest(".series-card");
      const alert = card ? card.querySelector(".series-alert") : null;
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        const errorMessage = data.message || "Upload failed.";
        if (/ffmpeg/i.test(errorMessage) && alert) {
          alert.textContent =
            "FFmpeg is not installed on the server. Install it to auto-convert MKV files.";
          alert.classList.remove("hidden");
          message.textContent = "Conversion required. See alert above.";
        } else {
          message.textContent = errorMessage;
        }
      } catch {
        message.textContent = "Upload failed.";
      }
    }
  };

  xhr.onerror = () => {
    message.textContent = "Upload failed. Check your connection.";
  };

  xhr.send(formData);
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
    uploadMessage.textContent = "Unsupported format. Use MP4, WebM, MOV, or MKV.";
    return;
  }
  if (!ffmpegAvailable && file.name.toLowerCase().endsWith(".mkv")) {
    uploadMessage.textContent = "FFmpeg is required to convert MKV. Install it first.";
    if (ffmpegBanner) ffmpegBanner.classList.remove("hidden");
    return;
  }

  const formData = new FormData(form);
  uploadBtn.disabled = true;
  uploadBtn.textContent = "Uploading...";
  uploadProgressWrap.classList.remove("hidden");
  setProgress(uploadProgressBar, uploadPercent, uploadBytes, 0, file.size);
  uploadMessage.textContent = "Uploading...";

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/movies/upload`);
  if (token) {
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
  }

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      setProgress(uploadProgressBar, uploadPercent, uploadBytes, event.loaded, event.total);
    }
  };

  xhr.onload = () => {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload & Seed";
    if (xhr.status >= 200 && xhr.status < 300) {
      form.reset();
      uploadFileInfo.textContent = "No file selected.";
      setProgress(uploadProgressBar, uploadPercent, uploadBytes, 0, 0);
      uploadMessage.textContent = "Upload complete. Seeding now.";
    } else {
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        uploadMessage.textContent = data.message || "Upload failed.";
      } catch {
        uploadMessage.textContent = "Upload failed.";
      }
    }
  };

  xhr.onerror = () => {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Upload & Seed";
    uploadMessage.textContent = "Upload failed. Check your connection.";
  };

  xhr.send(formData);
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
}

boot();
