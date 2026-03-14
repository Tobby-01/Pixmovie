const movieGrid = document.getElementById("movieGrid");
const searchInput = document.getElementById("searchInput");

let currentUser = null;

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

function renderMovieCard(movie, options = {}) {
  const { showDelete = false } = options;
  const card = document.createElement("div");
  card.className = "movie-card";

  const title = document.createElement("h4");
  title.textContent = formatEpisodeTitle(movie);

  const meta = document.createElement("div");
  meta.className = "movie-meta";
  const uploaderName = movie.uploader?.username ? ` by ${movie.uploader.username}` : "";
  if (movie.isEpisode) {
    const season = movie.seasonNumber || "?";
    const episode = movie.episodeNumber || "?";
    meta.textContent = `Season ${season} · Episode ${episode}${uploaderName}`;
  } else {
    meta.textContent = `${new Date(movie.uploadDate).toLocaleDateString()}${uploaderName}`;
  }

  const stats = document.createElement("div");
  stats.className = "movie-meta";
  stats.textContent = `${movie.views || 0} views`;

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const watchButton = document.createElement("button");
  watchButton.className = "btn";
  watchButton.textContent = "Watch";
  watchButton.onclick = () => {
    window.location.href = `player.html?id=${movie._id}`;
  };
  actions.appendChild(watchButton);

  if (showDelete) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "btn danger";
    deleteButton.textContent = "Delete";
    deleteButton.onclick = async () => {
      if (!confirm("Delete this movie from the server? This cannot be undone.")) return;
      try {
        await apiFetch(`/movies/${movie._id}`, { method: "DELETE" });
        await loadMovies(searchInput.value.trim());
      } catch (err) {
        alert(err.message);
      }
    };
    actions.appendChild(deleteButton);
  }

  card.append(title, meta, stats, actions);
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

  movies.forEach((movie) => {
    const uploaderId = movie.uploader?._id || movie.uploader;
    const showDelete = currentUser && uploaderId && String(uploaderId) === String(currentUser.id);
    movieGrid.appendChild(renderMovieCard(movie, { showDelete }));
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
    return user;
  } catch (err) {
    setToken(null);
    currentUser = null;
    setAuthUI(null);
    return null;
  }
}

searchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  clearTimeout(window.__pixmovieSearchTimer);
  window.__pixmovieSearchTimer = setTimeout(() => loadMovies(query), 300);
});

async function boot() {
  await loadCurrentUser();
  try {
    await loadMovies();
  } catch (err) {
    movieGrid.textContent = "Unable to load movies.";
  }
}

boot();
