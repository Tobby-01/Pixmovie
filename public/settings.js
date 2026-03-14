const dataMode = document.getElementById("dataMode");
const preferSwarm = document.getElementById("preferSwarm");
const autoResume = document.getElementById("autoResume");
const trackHistory = document.getElementById("trackHistory");
const settingsForm = document.getElementById("settingsForm");
const settingsMessage = document.getElementById("settingsMessage");

function loadSettings() {
  const data = localStorage.getItem("pixmovie_data_mode") || "balanced";
  const swarm = localStorage.getItem("pixmovie_prefer_swarm") || "0";
  const resume = localStorage.getItem("pixmovie_autoresume");
  const history = localStorage.getItem("pixmovie_track_history");

  if (dataMode) dataMode.value = data;
  if (preferSwarm) preferSwarm.value = swarm;
  if (autoResume) autoResume.value = resume == null ? "1" : resume;
  if (trackHistory) trackHistory.value = history == null ? "1" : history;
}

function saveSettings() {
  localStorage.setItem("pixmovie_data_mode", dataMode.value);
  localStorage.setItem("pixmovie_prefer_swarm", preferSwarm.value);
  localStorage.setItem("pixmovie_autoresume", autoResume.value);
  localStorage.setItem("pixmovie_track_history", trackHistory.value);
  if (settingsMessage) {
    settingsMessage.textContent = "Settings saved. They apply to new playback sessions.";
  }
}

settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  saveSettings();
});

function boot() {
  loadSettings();
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
