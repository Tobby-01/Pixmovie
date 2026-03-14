const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileForm = document.getElementById("profileForm");
const profileMessage = document.getElementById("profileMessage");
const profileMovies = document.getElementById("profileMovies");

const statUploads = document.getElementById("statUploads");
const statViews = document.getElementById("statViews");
const statBandwidth = document.getElementById("statBandwidth");
const analyticsChart = document.getElementById("analyticsChart");

let chartInstance = null;

function formatBytes(bytes) {
  if (!bytes) return "0 GB";
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(2)} GB`;
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

function renderMovieCard(movie) {
  const card = document.createElement("div");
  card.className = "movie-card";

  const title = document.createElement("h4");
  title.textContent = formatEpisodeTitle(movie);

  const meta = document.createElement("div");
  meta.className = "movie-meta";
  if (movie.isEpisode) {
    const season = movie.seasonNumber || "?";
    const episode = movie.episodeNumber || "?";
    meta.textContent = `Season ${season} · Episode ${episode}`;
  } else {
    meta.textContent = new Date(movie.uploadDate).toLocaleDateString();
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

  const deleteButton = document.createElement("button");
  deleteButton.className = "btn danger";
  deleteButton.textContent = "Delete";
  deleteButton.onclick = async () => {
    if (!confirm("Delete this movie from the server? This cannot be undone.")) return;
    try {
      await apiFetch(`/movies/${movie._id}`, { method: "DELETE" });
      await loadProfile();
      await loadAnalytics();
    } catch (err) {
      alert(err.message);
    }
  };

  actions.append(watchButton, deleteButton);
  card.append(title, meta, stats, actions);
  return card;
}

async function loadProfile() {
  const user = await apiFetch("/users/me");
  setNavUser(user);
  bindLogout();

  profileName.textContent = user.username;
  profileEmail.textContent = user.email;
  profileAvatar.src = user.avatarUrl || "https://via.placeholder.com/96?text=PM";

  profileMovies.innerHTML = "";
  if (!user.uploadedMovies.length) {
    profileMovies.textContent = "No uploads yet.";
    return;
  }
  user.uploadedMovies.forEach((movie) => profileMovies.appendChild(renderMovieCard(movie)));
}

async function loadAnalytics() {
  const stats = await apiFetch("/analytics/me");
  statUploads.textContent = stats.uploads || 0;
  statViews.textContent = stats.totalViews || 0;
  statBandwidth.textContent = formatBytes(stats.bandwidthBytes || 0);

  if (!analyticsChart) return;
  const ctx = analyticsChart.getContext("2d");
  const series = stats.series || { labels: [], uploads: [], views: [] };
  const labels = (series.labels || []).map((label) => {
    const parts = String(label).split("-");
    if (parts.length === 3) {
      return `${parts[1]}/${parts[2]}`;
    }
    return label;
  });
  const uploadsSeries = series.uploads || [];
  const viewsSeries = series.views || [];

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = uploadsSeries;
    chartInstance.data.datasets[1].data = viewsSeries;
    chartInstance.update();
    return;
  }

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Uploads",
          data: uploadsSeries,
          borderColor: "#0f766e",
          backgroundColor: "rgba(15, 118, 110, 0.15)",
          tension: 0.35,
          fill: true
        },
        {
          label: "Views",
          data: viewsSeries,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.2)",
          tension: 0.35,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  profileMessage.textContent = "";
  const formData = new FormData(profileForm);

  try {
    const user = await apiFetch("/users/me", {
      method: "PUT",
      body: formData
    });
    profileName.textContent = user.username;
    profileAvatar.src = user.avatarUrl || profileAvatar.src;
    profileMessage.textContent = "Profile updated.";
    setNavUser(user);
  } catch (err) {
    profileMessage.textContent = err.message;
  }
});

async function boot() {
  if (!requireAuth()) return;
  try {
    await loadProfile();
    await loadAnalytics();
  } catch (err) {
    setToken(null);
    window.location.href = "index.html";
  }
}

boot();
