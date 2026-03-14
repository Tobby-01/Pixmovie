const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");

bindLogout();
setNavUser(null);

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMessage.textContent = "";
  const form = e.target;
  const payload = {
    email: form.email.value.trim(),
    password: form.password.value
  };

  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setToken(data.token);
    setNavUser(data.user);
    window.location.href = "index.html";
  } catch (err) {
    loginMessage.textContent = err.message;
  }
});
