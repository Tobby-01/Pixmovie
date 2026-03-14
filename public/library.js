const movieGrid = document.getElementById("movieGrid");
const searchInput = document.getElementById("searchInput");

const heroBanner = document.getElementById("heroBanner");
const heroTitle = document.getElementById("heroTitle");
const heroMeta = document.getElementById("heroMeta");
const heroWatchBtn = document.getElementById("heroWatchBtn");
const heroWatchlistBtn = document.getElementById("heroWatchlistBtn");

const continueSection = document.getElementById("continueSection");
const continueRow = document.getElementById("continueRow");
const watchlistSection = document.getElementById("watchlistSection");
const watchlistRow = document.getElementById("watchlistRow");
const seriesRow = document.getElementById("seriesRow");

let currentUser = null;
let watchlistIds = new Set();
let heroMovie = null;

function setAuthUI(user) {
  setNavUser(user);
  bindLogout();
}

function formatEpisodeTitle(movie) {
  if (!movie.isEpisode) return movie.title;
  const series = movie.seriesTitle || "Series";
  const season = movie.seasonNumber ? String(movie.seasonNumber).padStart(2, "0") : "??";
  const episode = movie.episodeNumber ? String(movie.episodeNumber).padStart(2, "0") : "??";
  const rawTitle = String(movie.title || "");
  const title =
    rawTitle && !/^\d+$/.test(rawTitle) ? rawTitle : `Episode ${Number(episode) || episode}`;
  return `${series} S${season}E${episode} - ${title}`;
}

function formatRating(movie) {
  if (!movie || !movie.ratingCount) return "No ratings";
  const avg = Number(movie.ratingAverage || 0).toFixed(1);
  return `${avg} / 5 (${movie.ratingCount})`;
}

function createPosterImage(movie) {
  const url = movie.headerImage || "";
  if (url) return `url("${url}")`;
  return "linear-gradient(140deg, rgba(15, 118, 110, 0.35), rgba(245, 158, 11, 0.35))";
}

function createUploaderLink(movie) {
  if (!movie.uploader) return "";
  const uploaderId = movie.uploader._id || movie.uploader;
  const uploaderName = movie.uploader.username || "Creator";
  if (!uploaderId) return uploaderName;
  return `<a class="link" href="user.html?id=${uploaderId}">${uploaderName}</a>`;
}

function buildActionButton(label, className, onClick) {
  const button = document.createElement("button");
  button.className = className || "btn small";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderPosterCard(movie, options = {}) {
  const { showWatchlist = true, progress = null } = options;
  const card = document.createElement("div");
  card.className = "poster-card";

  const poster = document.createElement("div");
  poster.className = "poster-image";
  poster.style.backgroundImage = createPosterImage(movie);

  const info = document.createElement("div");
  info.className = "poster-info";

  const title = document.createElement("h4");
  title.textContent = formatEpisodeTitle(movie);

  const meta = document.createElement("div");
  meta.className = "movie-meta";
  const uploader = createUploaderLink(movie);
  if (movie.isEpisode) {
    const season = movie.seasonNumber || "?";
    const episode = movie.episodeNumber || "?";
    meta.innerHTML = `Season ${season} - Episode ${episode}${uploader ? ` by ${uploader}` : ""}`;
  } else {
    const date = movie.uploadDate ? new Date(movie.uploadDate).toLocaleDateString() : "";
    meta.innerHTML = `${date}${uploader ? ` by ${uploader}` : ""}`;
  }

  const stats = document.createElement("div");
  stats.className = "movie-meta";
  stats.textContent = `${movie.views || 0} views - ${formatRating(movie)}`;

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const watchButton = buildActionButton("Watch", "btn small", () => {
    window.location.href = `player.html?id=${movie._id}`;
  });
  actions.appendChild(watchButton);

  if (showWatchlist && token) {
    const inList = watchlistIds.has(String(movie._id));
    const label = inList ? "Remove" : "Add";
    const watchlistBtn = buildActionButton(label, "btn ghost small", async () => {
      try {
        if (watchlistIds.has(String(movie._id))) {
          await apiFetch(`/users/me/watchlist/${movie._id}`, { method: "DELETE" });
          watchlistIds.delete(String(movie._id));
        } else {
          await apiFetch(`/users/me/watchlist/${movie._id}`, { method: "POST" });
          watchlistIds.add(String(movie._id));
        }
        await loadWatchlist();
        await loadMovies(searchInput.value.trim());
      } catch (err) {
        alert(err.message);
      }
    });
    actions.appendChild(watchlistBtn);
  }

  info.append(title, meta, stats, actions);
  card.append(poster, info);

  if (progress != null) {
    const progressWrap = document.createElement("div");
    progressWrap.className = "poster-progress";
    const bar = document.createElement("div");
    bar.className = "poster-progress-bar";
    bar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    progressWrap.appendChild(bar);
    card.appendChild(progressWrap);
  }

  return card;
}

function renderSeriesCard(series) {
  const card = document.createElement("div");
  card.className = "poster-card series-card-mini";

  const poster = document.createElement("div");
  poster.className = "poster-image";
  poster.style.backgroundImage = series.headerImage
    ? `url("${series.headerImage}")`
    : "linear-gradient(140deg, rgba(148, 163, 184, 0.5), rgba(226, 232, 240, 0.9))";

  const info = document.createElement("div");
  info.className = "poster-info";

  const title = document.createElement("h4");
  title.textContent = series.title;

  const meta = document.createElement("div");
  meta.className = "movie-meta";
  meta.textContent = `${series.seasonsCount || 1} seasons`;

  const button = buildActionButton("View Episodes", "btn small", () => {
    window.location.href = `series.html?id=${series._id}`;
  });

  info.append(title, meta, button);
  card.append(poster, info);
  return card;
}

async function loadMovies(query = "") {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  const movies = await apiFetch(`/movies${q}`);
  movieGrid.innerHTML = "";
  if (!movies.length) {
    movieGrid.textContent = "No movies yet. Be the first to upload.";
    return;
  }

  if (!heroMovie) {
    heroMovie = movies.find((movie) => movie.headerImage) || movies[0];
    if (heroMovie && heroBanner) {
      heroBanner.style.backgroundImage = createPosterImage(heroMovie);
      heroTitle.textContent = formatEpisodeTitle(heroMovie);
      heroMeta.textContent = `${heroMovie.views || 0} views - ${formatRating(heroMovie)}`;
      if (heroWatchlistBtn && watchlistIds.has(String(heroMovie._id))) {
        heroWatchlistBtn.textContent = "Remove from Watchlist";
      }
      heroWatchBtn.onclick = () => {
        window.location.href = `player.html?id=${heroMovie._id}`;
      };
      if (heroWatchlistBtn) {
        heroWatchlistBtn.onclick = async () => {
          if (!token) {
            window.location.href = "login.html";
            return;
          }
          try {
            if (watchlistIds.has(String(heroMovie._id))) {
              await apiFetch(`/users/me/watchlist/${heroMovie._id}`, { method: "DELETE" });
              watchlistIds.delete(String(heroMovie._id));
              heroWatchlistBtn.textContent = "Add to Watchlist";
            } else {
              await apiFetch(`/users/me/watchlist/${heroMovie._id}`, { method: "POST" });
              watchlistIds.add(String(heroMovie._id));
              heroWatchlistBtn.textContent = "Remove from Watchlist";
            }
            await loadWatchlist();
          } catch (err) {
            alert(err.message);
          }
        };
      }
    }
  }

  movies.forEach((movie) => {
    movieGrid.appendChild(renderPosterCard(movie));
  });
}

async function loadCurrentUser() {
  if (!token) {
    setAuthUI(null);
    return null;
  }
  try {
    const user = await apiFetch("/users/me");
    currentUser = user;
    setAuthUI(user);
    watchlistIds = new Set((user.watchlistIds || []).map(String));
    return user;
  } catch (err) {
    setToken(null);
    currentUser = null;
    setAuthUI(null);
    return null;
  }
}

async function loadWatchlist() {
  if (!token || !watchlistRow || !watchlistSection) return;
  const list = await apiFetch("/users/me/watchlist");
  watchlistRow.innerHTML = "";
  if (!list.length) {
    watchlistSection.classList.add("hidden");
    return;
  }
  watchlistSection.classList.remove("hidden");
  list.forEach((movie) => watchlistRow.appendChild(renderPosterCard(movie, { showWatchlist: true })));
}

async function loadContinueWatching() {
  if (!token || !continueRow || !continueSection) return;
  const trackHistorySetting = localStorage.getItem("pixmovie_track_history");
  if (trackHistorySetting === "0") {
    continueSection.classList.add("hidden");
    return;
  }
  const list = await apiFetch("/users/me/history");
  const filtered = (list || []).filter((entry) => Number(entry.progress || 0) < 0.96);
  continueRow.innerHTML = "";
  if (!filtered.length) {
    continueSection.classList.add("hidden");
    return;
  }
  continueSection.classList.remove("hidden");
  filtered.forEach((entry) => {
    if (!entry.movie) return;
    continueRow.appendChild(renderPosterCard(entry.movie, { progress: entry.progress || 0 }));
  });
}

async function loadSeries() {
  if (!seriesRow) return;
  const series = await apiFetch("/series");
  seriesRow.innerHTML = "";
  if (!series.length) {
    seriesRow.textContent = "No series yet.";
    return;
  }
  series.forEach((item) => seriesRow.appendChild(renderSeriesCard(item)));
}

searchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  clearTimeout(window.__pixmovieSearchTimer);
  window.__pixmovieSearchTimer = setTimeout(() => loadMovies(query), 300);
});

async function boot() {
  await loadCurrentUser();
  try {
    await loadSeries();
    await loadContinueWatching();
    await loadWatchlist();
    await loadMovies();
  } catch (err) {
    movieGrid.textContent = "Unable to load movies.";
  }
}

boot();
