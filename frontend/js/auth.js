import { auth, ApiError } from "./api-client.js";

const form = document.querySelector("#auth-form");
const message = document.querySelector("#auth-message");
const submit = document.querySelector("#auth-submit");
let mode = "login";

function setMode(next) {
  mode = next;
  document.querySelectorAll("[data-register-only]").forEach((field) => { field.hidden = mode !== "register"; });
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("btn--primary", active);
    button.classList.toggle("btn--ghost", !active);
    button.setAttribute("aria-selected", String(active));
  });
  submit.textContent = mode === "login" ? "登入" : "建立帳號";
  message.hidden = true;
}

document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.hidden = true;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    submit.disabled = true;
    if (mode === "register") {
      if (data.password !== data.password_confirm) throw new ApiError("VALIDATION_ERROR", "兩次密碼不一致。");
      await auth.register({ username: data.username, email: data.email, password: data.password });
    } else {
      await auth.login({ username: data.identity, password: data.password });
    }
    window.location.href = "./dashboard.html";
  } catch (error) {
    message.textContent = error?.message || "操作失敗，請稍後再試。";
    message.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
