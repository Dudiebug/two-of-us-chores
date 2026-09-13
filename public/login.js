const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");
const password = document.querySelector("#loginPassword");
document.querySelector("#togglePassword").addEventListener("click", (event) => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  event.currentTarget.setAttribute("aria-pressed", String(visible));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  if (!form.reportValidity()) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ userId: document.querySelector("#loginUser").value, password: document.querySelector("#loginPassword").value }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Unable to sign in");
    document.querySelector("#loginPassword").value = "";
    location.replace("/app");
  } catch (requestError) {
    error.textContent = requestError.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
