const urlParams = new URLSearchParams(window.location.search);
const seriesId = urlParams.get("id");

const seriesTitle = document.getElementById("seriesTitle");
const seriesMeta = document.getElementById("seriesMeta");
const seriesBanner = document.getElementById("seriesBanner");
const seriesEpisodes = document.getElementById("seriesEpisodes");

function renderEpisodeCard(episode) {
  const card = document.createElement("div");
  card.className = "episode-slot";

  const label = document.createElement("div");
  label.className = "episode-label";
  label.textContent = `Episode ${episode.episodeNumber || "?"}`;

  const title = document.createElement("div");
  title.className = "movie-meta";
  title.textContent = episode.title || "";

  const watchBtn = document.createElement("button");
  watchBtn.className = "btn small";
  watchBtn.type = "button";
  watchBtn.textContent = "Watch";
  watchBtn.onclick = () => {
    window.location.href = `player.html?id=${episode._id}`;
  };

  card.append(label, title, watchBtn);
  return card;
}

async function loadSeries() {
  if (!seriesId) {
    seriesTitle.textContent = "Series not found";
    return;
  }
  const data = await apiFetch(`/series/${seriesId}`);
  seriesTitle.textContent = data.title;
  seriesMeta.textContent = `${data.seasonsCount || 1} seasons`;
  if (seriesBanner) {
    if (data.headerImage) {
      seriesBanner.style.backgroundImage = `url("${data.headerImage}")`;
    } else {
      seriesBanner.style.backgroundImage =
        "linear-gradient(140deg, rgba(15, 118, 110, 0.35), rgba(245, 158, 11, 0.35))";
    }
  }
}

async function loadEpisodes() {
  if (!seriesId) return;
  const episodes = await apiFetch(`/series/${seriesId}/episodes`);
  const grouped = episodes.reduce((acc, episode) => {
    const season = Number(episode.seasonNumber || 1);
    if (!acc[season]) acc[season] = [];
    acc[season].push(episode);
    return acc;
  }, {});

  seriesEpisodes.innerHTML = "";
  const seasons = Object.keys(grouped).sort((a, b) => Number(a) - Number(b));
  if (!seasons.length) {
    seriesEpisodes.textContent = "No episodes yet.";
    return;
  }

  seasons.forEach((seasonKey) => {
    const panel = document.createElement("div");
    panel.className = "season-panel";

    const header = document.createElement("div");
    header.className = "season-header";
    const title = document.createElement("h4");
    title.textContent = `Season ${seasonKey}`;
    header.appendChild(title);

    const list = document.createElement("div");
    list.className = "episode-slots";
    grouped[seasonKey]
      .sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber))
      .forEach((episode) => list.appendChild(renderEpisodeCard(episode)));

    panel.append(header, list);
    seriesEpisodes.appendChild(panel);
  });
}

async function boot() {
  try {
    await loadSeries();
    await loadEpisodes();
  } catch (err) {
    seriesEpisodes.textContent = "Unable to load episodes.";
  }
  if (typeof setNavUser === "function") {
    if (token) {
      apiFetch("/users/me")
        .then((user) => {
          setNavUser(user);
          bindLogout();
        })
        .catch(() => {
          setToken(null);
          setNavUser(null);
        });
    } else {
      setNavUser(null);
    }
  }
}

boot();
