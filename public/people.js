const peopleGrid = document.getElementById("peopleGrid");
const peopleSearch = document.getElementById("peopleSearch");

let currentUser = null;
let followingIds = new Set();
let allUsers = [];

function renderUserCard(user) {
  const card = document.createElement("div");
  card.className = "user-card";

  const header = document.createElement("div");
  header.className = "profile-header";

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = user.avatarUrl || "https://via.placeholder.com/64?text=PM";
  avatar.alt = `${user.username} avatar`;

  const info = document.createElement("div");
  const name = document.createElement("h4");
  name.textContent = user.username;
  const bio = document.createElement("div");
  bio.className = "movie-meta";
  bio.textContent = user.bio || "Creator on PixMovie";

  info.append(name, bio);
  header.append(avatar, info);

  const stats = document.createElement("div");
  stats.className = "profile-stats";
  const followers = document.createElement("span");
  followers.className = "stat-mini";
  followers.textContent = `${user.followersCount || 0} followers`;
  const uploads = document.createElement("span");
  uploads.className = "stat-mini";
  uploads.textContent = `${user.uploadsCount || 0} uploads`;
  stats.append(followers, uploads);

  const actions = document.createElement("div");
  actions.className = "user-actions";

  const viewBtn = document.createElement("button");
  viewBtn.className = "btn small";
  viewBtn.type = "button";
  viewBtn.textContent = "View Profile";
  viewBtn.onclick = () => {
    window.location.href = `user.html?id=${user.id}`;
  };
  actions.appendChild(viewBtn);

  if (currentUser && String(currentUser.id) !== String(user.id)) {
    const followBtn = document.createElement("button");
    followBtn.className = "btn ghost small";
    const isFollowing = followingIds.has(String(user.id));
    followBtn.textContent = isFollowing ? "Unfollow" : "Follow";
    followBtn.onclick = async () => {
      try {
        if (followingIds.has(String(user.id))) {
          await apiFetch(`/users/${user.id}/follow`, { method: "DELETE" });
          followingIds.delete(String(user.id));
          followBtn.textContent = "Follow";
        } else {
          await apiFetch(`/users/${user.id}/follow`, { method: "POST" });
          followingIds.add(String(user.id));
          followBtn.textContent = "Unfollow";
        }
        await loadUsers(peopleSearch.value.trim());
      } catch (err) {
        alert(err.message);
      }
    };
    actions.appendChild(followBtn);
  }

  card.append(header, stats, actions);
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
    setNavUser(user);
    bindLogout();
    followingIds = new Set((user.followingIds || []).map(String));
    return user;
  } catch {
    setToken(null);
    setNavUser(null);
    return null;
  }
}

async function loadUsers(filter = "") {
  const list = await apiFetch("/users");
  allUsers = list || [];
  const query = filter.toLowerCase();
  const filtered = query
    ? allUsers.filter((user) => user.username.toLowerCase().includes(query))
    : allUsers;
  peopleGrid.innerHTML = "";
  if (!filtered.length) {
    peopleGrid.textContent = "No creators found.";
    return;
  }
  filtered.forEach((user) => peopleGrid.appendChild(renderUserCard(user)));
}

peopleSearch.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  clearTimeout(window.__pixmoviePeopleTimer);
  window.__pixmoviePeopleTimer = setTimeout(() => loadUsers(query), 300);
});

async function boot() {
  await loadCurrentUser();
  try {
    await loadUsers();
  } catch (err) {
    peopleGrid.textContent = "Unable to load creators.";
  }
}

boot();
