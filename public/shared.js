const API_BASE =
  (typeof window !== "undefined" && window.API_BASE) ? window.API_BASE : "/api";
let token = localStorage.getItem("pixmovie_token");

function setToken(nextToken) {
  token = nextToken;
  if (token) {
    localStorage.setItem("pixmovie_token", token);
  } else {
    localStorage.removeItem("pixmovie_token");
  }
}

async function apiFetch(path, options = {}) {
  const headers = options.headers || {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
    const message = data.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function bindLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  const loginLink = document.getElementById("loginLink");
  const signupLink = document.getElementById("signupLink");
  if (!logoutBtn) return;
  if (token) logoutBtn.style.display = "inline-flex";
  if (loginLink) loginLink.style.display = token ? "none" : "inline-flex";
  if (signupLink) signupLink.style.display = token ? "none" : "inline-flex";
  logoutBtn.addEventListener("click", () => {
    setToken(null);
    window.location.href = "index.html";
  });
}

function bindGuestStream() {
  const guestBtn = document.getElementById("guestStreamBtn");
  if (!guestBtn) return;
  guestBtn.addEventListener("click", () => {
    setToken(null);
    window.location.href = "index.html";
  });
}

function setNavUser(user) {
  const navUser = document.getElementById("navUser");
  const loginLink = document.getElementById("loginLink");
  const signupLink = document.getElementById("signupLink");
  const logoutBtn = document.getElementById("logoutBtn");
  const uploadLink = document.getElementById("uploadLink");
  const profileLink = document.getElementById("profileLink");
  if (!navUser) return;
  if (!user) {
    navUser.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (loginLink) loginLink.style.display = "inline-flex";
    if (signupLink) signupLink.style.display = "inline-flex";
    if (uploadLink) uploadLink.style.display = "none";
    if (profileLink) profileLink.style.display = "none";
    return;
  }
  navUser.textContent = `Hello ${user.username}`;
  navUser.style.display = "inline-flex";
  if (logoutBtn) logoutBtn.style.display = "inline-flex";
  if (loginLink) loginLink.style.display = "none";
  if (signupLink) signupLink.style.display = "none";
  if (uploadLink) uploadLink.style.display = "inline-flex";
  if (profileLink) profileLink.style.display = "inline-flex";
}

bindGuestStream();

function requireAuth() {
  if (!token) {
    window.location.href = "index.html";
    return false;
  }
  return true;
}
