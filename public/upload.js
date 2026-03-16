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

function compressionSummary(compression) {
  if (!compression) return "";
  const original = Number(compression.originalBytes || 0);
  const finalBytes = Number(compression.finalBytes || 0);
  if (!original || !finalBytes) return "";
  const savedPercent = Number(compression.savedPercent || 0);
  return `Compressed ${formatBytesCompact(original)} -> ${formatBytesCompact(finalBytes)} (${savedPercent}% smaller).`;
}

const allowedExtensions = [".mp4", ".webm", ".mov", ".mkv"];

function isPlayable(fileName) {
  const lower = String(fileName || "").toLowerCase();
  return allowedExtensions.some((ext) => lower.endsWith(ext));
}

function stripExtension(fileName) {
  return String(fileName || "").replace(/\.[^/.]+$/, "");
}

function normalizeSpaces(value) {
  return String(value || "").replace(/[\s._-]+/g, " ").replace(/\s+/g, " ").trim();
}

function guessEpisodeNumberFromName(fileName, seasonNumber) {
  const raw = stripExtension(fileName);

  const match1 = raw.match(/s(\d{1,2})\s*e(\d{1,3})/i);
  if (match1) {
    const season = Number(match1[1]);
    const episode = Number(match1[2]);
    if (!Number.isFinite(episode) || episode < 1) return null;
    if (Number.isFinite(seasonNumber) && season && seasonNumber !== season) return null;
    return episode;
  }

  const match2 = raw.match(/(\d{1,2})x(\d{1,3})/i);
  if (match2) {
    const season = Number(match2[1]);
    const episode = Number(match2[2]);
    if (!Number.isFinite(episode) || episode < 1) return null;
    if (Number.isFinite(seasonNumber) && season && seasonNumber !== season) return null;
    return episode;
  }

  const match3 = raw.match(/(?:episode|ep)\s*(\d{1,3})/i);
  if (match3) {
    const episode = Number(match3[1]);
    if (Number.isFinite(episode) && episode > 0) return episode;
  }

  return null;
}

function guessEpisodeTitleFromName(fileName, seriesTitle) {
  let text = normalizeSpaces(stripExtension(fileName));
  if (seriesTitle) {
    const safeSeries = normalizeSpaces(seriesTitle);
    if (safeSeries && text.toLowerCase().startsWith(safeSeries.toLowerCase())) {
      text = text.slice(safeSeries.length).trim();
    }
  }
  text = text.replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, "").replace(/\b\d{1,2}x\d{1,3}\b/gi, "");
  text = text.replace(/\b(episode|ep)\s*\d{1,3}\b/gi, "");
  text = normalizeSpaces(text);
  return text;
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

  const bulkPanel = document.createElement("div");
  bulkPanel.className = "bulk-panel";

  const bulkHeader = document.createElement("div");
  bulkHeader.className = "bulk-header";

  const bulkTitle = document.createElement("div");
  bulkTitle.className = "bulk-title";
  bulkTitle.textContent = "Upload a whole season";

  const bulkActions = document.createElement("div");
  bulkActions.className = "bulk-actions";

  const bulkPickBtn = document.createElement("button");
  bulkPickBtn.className = "btn ghost small";
  bulkPickBtn.type = "button";
  bulkPickBtn.textContent = "Select Episodes";

  const bulkUploadBtn = document.createElement("button");
  bulkUploadBtn.className = "btn small";
  bulkUploadBtn.type = "button";
  bulkUploadBtn.textContent = "Upload Selected";
  bulkUploadBtn.disabled = true;

  const bulkClearBtn = document.createElement("button");
  bulkClearBtn.className = "btn ghost small";
  bulkClearBtn.type = "button";
  bulkClearBtn.textContent = "Clear";
  bulkClearBtn.disabled = true;

  bulkActions.append(bulkPickBtn, bulkUploadBtn, bulkClearBtn);
  bulkHeader.append(bulkTitle, bulkActions);

  const bulkHelp = document.createElement("div");
  bulkHelp.className = "movie-meta";
  bulkHelp.textContent =
    "Select multiple episode files. PixMovie will guess episode numbers/titles from filenames, and you can edit them before uploading.";

  const bulkCompressLabel = document.createElement("label");
  bulkCompressLabel.className = "check-row";
  const bulkCompress = document.createElement("input");
  bulkCompress.type = "checkbox";
  bulkCompress.value = "1";
  bulkCompressLabel.append(bulkCompress, " Compress");

  const bulkInput = document.createElement("input");
  bulkInput.type = "file";
  bulkInput.multiple = true;
  bulkInput.accept = "video/mp4,video/webm,video/quicktime,video/x-matroska";
  bulkInput.className = "hidden";

  const bulkList = document.createElement("div");
  bulkList.className = "bulk-list";

  const bulkMessage = document.createElement("p");
  bulkMessage.className = "movie-meta";

  bulkPanel.append(
    bulkHeader,
    bulkHelp,
    bulkCompressLabel,
    bulkInput,
    bulkList,
    bulkMessage
  );

  const slots = document.createElement("div");
  slots.className = "episode-slots";

  const episodeList = document.createElement("div");
  episodeList.className = "episode-list";
  episodeList.dataset.seriesId = series._id;
  episodeList.dataset.seasonNumber = seasonNumber;

  panel.append(header, bulkPanel, slots, episodeList);

  let bulkItems = [];
  let bulkUploading = false;

  function setBulkMessage(text) {
    bulkMessage.textContent = text || "";
  }

  function uploadEpisodeFromFile({
    seriesId,
    seasonNumber,
    episodeNumber,
    title,
    file,
    progressWrap,
    progressBar,
    percent,
    bytes,
    message,
    compress
  }) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.set("seasonNumber", String(seasonNumber));
      formData.set("episodeNumber", String(episodeNumber));
      if (title) formData.set("title", title);
      if (compress) formData.set("compress", "1");
      formData.set("video", file, file.name);

      progressWrap.classList.remove("hidden");
      setProgress(progressBar, percent, bytes, 0, file.size);
      message.textContent = compress ? "Uploading (will compress)..." : "Uploading...";

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

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText || "{}");
            const summary = compressionSummary(data.compression);
            message.textContent = summary ? `Uploaded. ${summary}` : "Uploaded.";
            resolve(data);
          } catch {
            message.textContent = "Uploaded.";
            resolve({});
          }
          return;
        }

        try {
          const data = JSON.parse(xhr.responseText || "{}");
          reject(new Error(data.message || "Upload failed."));
        } catch {
          reject(new Error("Upload failed."));
        }
      };

      xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
      xhr.send(formData);
    });
  }

  function renderBulkList() {
    bulkList.innerHTML = "";
    if (!bulkItems.length) {
      bulkUploadBtn.disabled = true;
      bulkClearBtn.disabled = true;
      return;
    }

    bulkUploadBtn.disabled = false;
    bulkClearBtn.disabled = false;

    bulkItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "bulk-row";

      const epInput = document.createElement("input");
      epInput.className = "input mini-input";
      epInput.type = "number";
      epInput.min = "1";
      epInput.value = String(item.episodeNumber || 1);

      const titleInput = document.createElement("input");
      titleInput.className = "input";
      titleInput.type = "text";
      titleInput.value = item.title || "";
      titleInput.placeholder = `Episode ${item.episodeNumber || 1} title`;

      const meta = document.createElement("div");
      meta.className = "movie-meta";
      meta.textContent = `${item.file.name} (${formatBytesCompact(item.file.size)})`;

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

      const message = document.createElement("div");
      message.className = "movie-meta";

      item.refs = { epInput, titleInput, progressWrap, progressBar, percent, bytes, message };

      epInput.addEventListener("input", () => {
        item.episodeNumber = Number(epInput.value || 1);
        titleInput.placeholder = `Episode ${item.episodeNumber || 1} title`;
      });

      titleInput.addEventListener("input", () => {
        item.title = titleInput.value;
      });

      row.append(epInput, titleInput, meta, progressWrap, stats, message);
      bulkList.appendChild(row);
    });
  }

  bulkPickBtn.addEventListener("click", () => bulkInput.click());

  bulkClearBtn.addEventListener("click", () => {
    if (bulkUploading) return;
    bulkItems = [];
    bulkInput.value = "";
    bulkList.innerHTML = "";
    setBulkMessage("");
    renderBulkList();
  });

  bulkInput.addEventListener("change", () => {
    if (bulkUploading) return;
    setBulkMessage("");
    const files = Array.from(bulkInput.files || []).filter((file) => isPlayable(file.name));
    if (!files.length) {
      bulkItems = [];
      setBulkMessage("Select at least one MP4, WebM, MOV, or MKV file.");
      renderBulkList();
      return;
    }

    const withHints = files.map((file, index) => {
      const guessedEpisode = guessEpisodeNumberFromName(file.name, seasonNumber);
      const guessedTitle = guessEpisodeTitleFromName(file.name, series.title);
      return {
        file,
        episodeNumber: guessedEpisode || index + 1,
        title: guessedTitle || `Episode ${guessedEpisode || index + 1}`,
        refs: null
      };
    });

    withHints.sort((a, b) => {
      const an = Number(a.episodeNumber || 0);
      const bn = Number(b.episodeNumber || 0);
      if (an && bn && an !== bn) return an - bn;
      return a.file.name.localeCompare(b.file.name);
    });

    bulkItems = withHints;
    renderBulkList();
  });

  bulkUploadBtn.addEventListener("click", async () => {
    if (bulkUploading) return;
    if (!bulkItems.length) return;

    if (!ffmpegAvailable) {
      const hasMkv = bulkItems.some((item) => String(item.file.name).toLowerCase().endsWith(".mkv"));
      if (hasMkv) {
        setBulkMessage("FFmpeg is required to convert MKV files on the server. Install it first.");
        if (ffmpegBanner) ffmpegBanner.classList.remove("hidden");
        return;
      }
    }

    bulkUploading = true;
    bulkUploadBtn.disabled = true;
    bulkPickBtn.disabled = true;
    bulkClearBtn.disabled = true;
    setBulkMessage("Uploading episodes...");

    const compress = Boolean(bulkCompress.checked);
    const sorted = bulkItems
      .slice()
      .sort((a, b) => Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0));

    try {
      for (const item of sorted) {
        const refs = item.refs;
        if (!refs) continue;
        await uploadEpisodeFromFile({
          seriesId: series._id,
          seasonNumber,
          episodeNumber: Number(item.episodeNumber || 1),
          title: String(item.title || "").trim(),
          file: item.file,
          progressWrap: refs.progressWrap,
          progressBar: refs.progressBar,
          percent: refs.percent,
          bytes: refs.bytes,
          message: refs.message,
          compress
        });
      }

      setBulkMessage("Season upload complete.");
      await loadEpisodes(series._id);
    } catch (err) {
      setBulkMessage(err.message || "Season upload failed.");
    } finally {
      bulkUploading = false;
      bulkUploadBtn.disabled = false;
      bulkPickBtn.disabled = false;
      bulkClearBtn.disabled = false;
    }
  });

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

    const compressLabel = document.createElement("label");
    compressLabel.className = "check-row";
    const compress = document.createElement("input");
    compress.type = "checkbox";
    compress.name = "compress";
    compress.value = "1";
    compressLabel.append(compress, " Compress");

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
    fields.append(titleInput, fileInput, compressLabel, button);

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
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        const summary = compressionSummary(data.compression);
        message.textContent = summary ? `Episode uploaded. ${summary}` : "Episode uploaded.";
      } catch {
        message.textContent = "Episode uploaded.";
      }
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
        row.className = "episode-row editable";

        const label = document.createElement("div");
        label.className = "episode-label";
        label.textContent = `Ep ${episode.episodeNumber || 0}`;

        const numberInput = document.createElement("input");
        numberInput.className = "input mini-input";
        numberInput.type = "number";
        numberInput.min = "1";
        numberInput.value = String(episode.episodeNumber || 1);

        const titleInput = document.createElement("input");
        titleInput.className = "input";
        titleInput.value = episode.title || "";

        const saveBtn = document.createElement("button");
        saveBtn.className = "btn ghost small";
        saveBtn.type = "button";
        saveBtn.textContent = "Save";

        const status = document.createElement("div");
        status.className = "movie-meta";

        saveBtn.addEventListener("click", async () => {
          status.textContent = "";
          saveBtn.disabled = true;
          try {
            await apiFetch(`/movies/${episode._id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: titleInput.value,
                episodeNumber: Number(numberInput.value || 0)
              })
            });
            status.textContent = "Saved.";
            await loadEpisodes(seriesId);
          } catch (err) {
            status.textContent = err.message || "Save failed.";
          } finally {
            saveBtn.disabled = false;
          }
        });

        row.append(label, numberInput, titleInput, saveBtn, status);
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
      try {
        const data = JSON.parse(xhr.responseText || "{}");
        const summary = compressionSummary(data.compression);
        uploadMessage.textContent = summary ? `Upload complete. ${summary}` : "Upload complete.";
      } catch {
        uploadMessage.textContent = "Upload complete.";
      }
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
