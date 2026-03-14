const urlParams = new URLSearchParams(window.location.search);
const userId = urlParams.get("id");

const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");
const userBio = document.getElementById("userBio");
const userFollowers = document.getElementById("userFollowers");
const userFollowing = document.getElementById("userFollowing");
const userUploads = document.getElementById("userUploads");
const userUploadsGrid = document.getElementById("userUploadsGrid");
const followBtn = document.getElementById("followBtn");

let currentUser = null;
let followingIds = new Set();

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

  if (movie.headerImage) {
    const banner = document.createElement("div");
    banner.className = "series-banner";
    banner.style.height = "120px";
    banner.style.backgroundImage = `url("${movie.headerImage}")`;
    card.appendChild(banner);
  }

  const title = document.createElement("h4");
  title.textContent = formatEpisodeTitle(movie);

  const meta = document.createElement("div");
  meta.className = "movie-meta";
  meta.textContent = movie.uploadDate ? new Date(movie.uploadDate).toLocaleDateString() : "";

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
  card.append(title, meta, stats, actions);
  return card;
}

async function loadCurrentUser() {
  if (!token) {
    setNavUser(null);
    return null;
  }
  try {
    const user = await apiFetch("/users/me");
    currentUser = user;
    followingIds = new Set((user.followingIds || []).map(String));
    setNavUser(user);
    bindLogout();
    return user;
  } catch {
    setToken(null);
    setNavUser(null);
    return null;
  }
}

async function loadProfile() {
  if (!userId) {
    userName.textContent = "Creator not found";
    return;
  }
  const profile = await apiFetch(`/users/${userId}`);
  userAvatar.src = profile.avatarUrl || "https://via.placeholder.com/96?text=PM";
  userName.textContent = profile.username;
  userBio.textContent = profile.bio || "Creator on PixMovie";
  userFollowers.textContent = `${profile.followersCount || 0} followers`;
  userFollowing.textContent = `${profile.followingCount || 0} following`;
  userUploads.textContent = `${profile.uploadsCount || 0} uploads`;

  if (followBtn) {
    if (!currentUser || String(currentUser.id) === String(profile.id)) {
      followBtn.style.display = "none";
    } else {
      const isFollowing = followingIds.has(String(profile.id));
      followBtn.textContent = isFollowing ? "Unfollow" : "Follow";
      followBtn.onclick = async () => {
        try {
          if (followingIds.has(String(profile.id))) {
            await apiFetch(`/users/${profile.id}/follow`, { method: "DELETE" });
            followingIds.delete(String(profile.id));
            followBtn.textContent = "Follow";
          } else {
            await apiFetch(`/users/${profile.id}/follow`, { method: "POST" });
            followingIds.add(String(profile.id));
            followBtn.textContent = "Unfollow";
          }
          await loadProfile();
        } catch (err) {
          alert(err.message);
        }
      };
    }
  }

  userUploadsGrid.innerHTML = "";
  if (!profile.uploadedMovies || !profile.uploadedMovies.length) {
    userUploadsGrid.textContent = "No uploads yet.";
    return;
  }
  profile.uploadedMovies.forEach((movie) => userUploadsGrid.appendChild(renderMovieCard(movie)));
}

async function boot() {
  await loadCurrentUser();
  try {
    await loadProfile();
  } catch (err) {
    userUploadsGrid.textContent = "Unable to load profile.";
  }
}

boot();
