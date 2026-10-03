import { auth, ApiError } from "./api-client.js";

const form = document.querySelector("#auth-form");
const message = document.querySelector("#auth-message");
const submit = document.querySelector("#auth-submit");
let mode = "login";
let recaptchaScriptPromise = null;

async function recaptchaLoginToken() {
  const config = await auth.recaptchaConfig();
  if (!config.enabled) return "";

  if (!window.grecaptcha?.enterprise) {
    if (!recaptchaScriptPromise) {
      recaptchaScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(config.site_key)}`;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => {
          recaptchaScriptPromise = null;
          reject(new ApiError("RECAPTCHA_LOAD_FAILED", "安全驗證載入失敗，請稍後再試。"));
        };
        document.head.append(script);
      });
    }
    await recaptchaScriptPromise;
  }
  if (!window.grecaptcha?.enterprise) {
    recaptchaScriptPromise = null;
    throw new ApiError("RECAPTCHA_LOAD_FAILED", "安全驗證載入失敗，請稍後再試。");
  }

  return new Promise((resolve, reject) => {
    window.grecaptcha.enterprise.ready(async () => {
      try {
        resolve(await window.grecaptcha.enterprise.execute(config.site_key, { action: "LOGIN" }));
      } catch {
        reject(new ApiError("RECAPTCHA_EXECUTE_FAILED", "安全驗證失敗，請稍後再試。"));
      }
    });
  });
}

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
      const recaptchaToken = await recaptchaLoginToken();
      await auth.login({ username: data.identity, password: data.password, recaptcha_token: recaptchaToken });
    }
    window.location.href = "./dashboard.html";
  } catch (error) {
    message.textContent = error?.message || "操作失敗，請稍後再試。";
    message.hidden = false;
  } finally {
    submit.disabled = false;
  }
});
