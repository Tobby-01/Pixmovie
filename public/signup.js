const signupForm = document.getElementById("signupForm");
const signupMessage = document.getElementById("signupMessage");

bindLogout();
setNavUser(null);

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  signupMessage.textContent = "";
  const form = e.target;
  const payload = {
    username: form.username.value.trim(),
    email: form.email.value.trim(),
    password: form.password.value
  };

  try {
    const data = await apiFetch("/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setToken(data.token);
    setNavUser(data.user);
    window.location.href = "index.html";
  } catch (err) {
    signupMessage.textContent = err.message;
  }
});
