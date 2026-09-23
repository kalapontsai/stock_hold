/**
 * stock_hold — Modal component (focus trap + Esc + restore focus)
 *
 * Per COMPONENT-INVENTORY §5 <Modal>:
 *  - role="dialog" aria-modal="true" aria-labelledby
 *  - Focus trap (Tab/Shift+Tab cycles inside)
 *  - Esc closes
 *  - Initial focus → first focusable (or initialFocusRef)
 *  - Restores focus to opener on close
 *  - Body scroll lock
 *  - Fullscreen on mobile (already in CSS via .modal--fullscreen-mobile)
 *
 * Usage:
 *   const m = createModal({ title: "新增交易", onClose: () => {}, size: "lg" });
 *   m.body.appendChild(formEl);
 *   m.show();
 *   m.close();
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function createModal({ title = "", size = "md", onClose, initialFocusRef } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("role", "presentation");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const modal = document.createElement("div");
  modal.className = "modal";
  if (size === "lg") modal.classList.add("modal--lg");
  if (size === "sm") modal.classList.add("modal--sm");
  if (size === "fullscreen-mobile") modal.classList.add("modal--fullscreen-mobile");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "modal-title-" + Math.random().toString(36).slice(2, 8));

  const header = document.createElement("div");
  header.className = "modal__header";
  const titleEl = document.createElement("h2");
  titleEl.className = "modal__title";
  titleEl.id = modal.getAttribute("aria-labelledby");
  titleEl.textContent = title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal__close";
  closeBtn.setAttribute("aria-label", "關閉");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "modal__body";
  modal.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "modal__footer";
  modal.appendChild(footer);

  backdrop.appendChild(modal);
  let previouslyFocused = null;
  let keyHandler = null;
  let isOpen = false;

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = modal.querySelectorAll(FOCUSABLE);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function escClose(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  function open() {
    if (isOpen) return;
    previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    document.body.appendChild(backdrop);
    keyHandler = (e) => { trapFocus(e); escClose(e); };
    document.addEventListener("keydown", keyHandler);
    const focusables = modal.querySelectorAll(FOCUSABLE);
    const target = initialFocusRef?.current
      || (focusables[0] || modal);
    setTimeout(() => target.focus(), 0);
    isOpen = true;
  }

  function close() {
    if (!isOpen) return;
    document.removeEventListener("keydown", keyHandler);
    document.body.style.overflow = "";
    backdrop.remove();
    isOpen = false;
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
    if (typeof onClose === "function") onClose();
  }

  return {
    el: modal,
    body,
    footer,
    titleEl,
    show: open,
    close,
    isOpen: () => isOpen,
  };
}

/**
 * Simple confirm dialog helper built on top of createModal.
 *
 * Usage:
 *   const yes = await confirmDialog({ title: "刪除交易", body: "...", confirmLabel: "刪除", confirmTone: "danger" });
 *   if (yes) ...
 */
export function confirmDialog({
  title = "確認",
  body = "",
  confirmLabel = "確認",
  cancelLabel = "取消",
  confirmTone = "danger",
} = {}) {
  return new Promise((resolve) => {
    const m = createModal({
      title,
      size: "sm",
      onClose: () => resolve(false),
    });
    const p = document.createElement("p");
    p.textContent = body;
    p.style.margin = 0;
    p.style.color = "var(--color-text)";
    m.body.appendChild(p);

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn--secondary";
    cancel.textContent = cancelLabel;
    cancel.addEventListener("click", () => { m.close(); resolve(false); });

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn--" + (confirmTone === "primary" ? "primary" : "danger");
    confirm.textContent = confirmLabel;
    confirm.addEventListener("click", () => { m.close(); resolve(true); });

    m.footer.appendChild(cancel);
    m.footer.appendChild(confirm);
    m.show();
    setTimeout(() => confirm.focus(), 0);
  });
}

/**
 * Toast helper (small, top-right, auto-dismiss).
 *
 * Usage:
 *   toast("已儲存", { tone: "success" });
 */
const TOASTER_ID = "stock-hold-toaster";
function ensureToaster() {
  let el = document.getElementById(TOASTER_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = TOASTER_ID;
  el.className = "toaster";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "false");
  document.body.appendChild(el);
  return el;
}

export function toast(message, { title, tone = "info", durationMs = 3500 } = {}) {
  const toaster = ensureToaster();
  const t = document.createElement("div");
  t.className = "toast";
  if (tone === "success") t.classList.add("toast--success");
  if (tone === "error")   t.classList.add("toast--error");
  if (tone === "warning") t.classList.add("toast--warning");
  t.setAttribute("role", tone === "error" ? "alert" : "status");

  if (title) {
    const ttl = document.createElement("div");
    ttl.className = "toast__title";
    ttl.textContent = title;
    t.appendChild(ttl);
  }
  const msg = document.createElement("div");
  msg.className = "toast__msg";
  msg.textContent = message;
  t.appendChild(msg);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast__close";
  close.setAttribute("aria-label", "關閉");
  close.innerHTML = "&times;";
  close.addEventListener("click", () => t.remove());
  t.appendChild(close);

  toaster.appendChild(t);

  if (durationMs > 0) {
    setTimeout(() => {
      t.style.transition = "opacity 200ms";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 200);
    }, durationMs);
  }

  return () => t.remove();
}
