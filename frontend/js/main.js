/**
 * stock_hold — main.js (entry point for every page)
 *
 * - Reads <body data-page="..."> to decide which page module to mount.
 * - Boots the AppShell (header, sidebar, bottom tabbar).
 * - Applies saved theme.
 * - Wires global "update prices" button + offline banner.
 *
 * Pages (in /pages/):
 *   dashboard, transactions, holdings, reports, settings
 *
 * To add a new page: drop a script tag and add a case below.
 */

import { t } from "./i18n.js";
import { mountDashboard } from "./pages/dashboard.js";
import { mountTransactions } from "./pages/transactions.js";
import { mountHoldings } from "./pages/holdings.js";
import { mountReports } from "./pages/reports.js";
import { mountSettings } from "./pages/settings.js";
import { auth, isMock } from "./api-client.js";

const MOUNT_FNS = {
  dashboard:    mountDashboard,
  transactions: mountTransactions,
  holdings:     mountHoldings,
  reports:      mountReports,
  settings:     mountSettings,
};

function getPageKey() {
  const body = document.body;
  return body?.dataset?.page || "dashboard";
}

function applyTheme() {
  try {
    const saved = localStorage.getItem("stock_hold.theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.setAttribute("data-theme", saved);
      return;
    }
  } catch (_) { /* ignore */ }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

function buildShell() {
  const header = document.querySelector(".app__header");
  const sidebar = document.querySelector(".app__sidebar");
  const tabbar = document.querySelector(".app__tabbar");

  if (!header) return;

  const pageKey = getPageKey();
  const pageTitle = {
    dashboard:    t("nav.dashboard"),
    transactions: t("nav.transactions"),
    holdings:     t("nav.holdings"),
    reports:      t("nav.reports"),
    settings:     t("nav.settings"),
  }[pageKey] || t("app.title");

  // --- Header content
  header.innerHTML = `
    <div class="header">
      <button type="button" class="header__hamburger" data-action="toggle-sidebar" aria-label="${t("app.skipToMain")}">
        <span aria-hidden="true">≡</span>
      </button>
      <h1 class="header__title">${pageTitle}</h1>
      <div class="header__actions">
        <button type="button" class="btn btn--ghost btn--icon-only btn--sm" data-action="theme" aria-label="主題切換" title="主題切換">
          <span aria-hidden="true">🌓</span>
        </button>
        <span class="header__user" data-user-name hidden></span>
        <button type="button" class="btn btn--ghost btn--sm" data-action="logout" hidden>登出</button>
      </div>
    </div>
  `;

  // Theme toggle
  header.querySelector("[data-action=theme]").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("stock_hold.theme", next); } catch (_) {}
  });

  header.querySelector("[data-action=logout]").addEventListener("click", async () => {
    try { await auth.logout(); } finally { window.location.href = loginHref(); }
  });

  // --- Sidebar nav (desktop)
  if (sidebar) {
    sidebar.innerHTML = `
      <nav class="sidebar" aria-label="主導覽">
        <div class="sidebar__brand">
          <span aria-hidden="true">📊</span>
          <span>${t("app.title")}</span>
        </div>
        <div class="sidebar__nav">
          ${navLink("dashboard",    "🏠", t("nav.dashboard"),    pageHref("dashboard"),    pageKey)}
          ${navLink("transactions", "💱", t("nav.transactions"), pageHref("transactions"), pageKey)}
          ${navLink("holdings",     "📈", t("nav.holdings"),     pageHref("holdings"),     pageKey)}
          ${navLink("reports",      "📋", t("nav.reports"),      pageHref("reports"),      pageKey)}
          ${navLink("settings",     "⚙", t("nav.settings"),     pageHref("settings"),     pageKey)}
        </div>
      </nav>
    `;
  }

  // --- Bottom tabbar (mobile)
  if (tabbar) {
    tabbar.innerHTML = `
      <nav class="tabbar" aria-label="主導覽">
        ${tabLink("dashboard",    "🏠", t("nav.dashboard"),    pageHref("dashboard"),    pageKey)}
        ${tabLink("transactions", "💱", t("nav.transactions"), pageHref("transactions"), pageKey)}
        ${tabLink("holdings",     "📈", t("nav.holdings"),     pageHref("holdings"),     pageKey)}
        ${tabLink("reports",      "📋", t("nav.reports"),      pageHref("reports"),      pageKey)}
        ${tabLink("settings",     "⚙", t("nav.settings"),     pageHref("settings"),     pageKey)}
      </nav>
    `;
  }
}

export function pageHref(page) {
  return document.body?.dataset?.rootEntry === "true"
    ? `./frontend/${page}.html`
    : `./${page}.html`;
}

function loginHref() {
  return document.body?.dataset?.rootEntry === "true"
    ? "./frontend/login.html"
    : "./login.html";
}

function navLink(key, icon, label, href, currentPage) {
  const isActive = key === currentPage ? "true" : "false";
  return `<a class="nav-link" href="${href}" aria-current="${isActive}">
    <span class="nav-link__icon" aria-hidden="true">${icon}</span>
    <span>${label}</span>
  </a>`;
}

function tabLink(key, icon, label, href, currentPage) {
  const isActive = key === currentPage ? "true" : "false";
  return `<a class="tabbar__item" href="${href}" aria-current="${isActive}">
    <span class="tabbar__icon" aria-hidden="true">${icon}</span>
    <span>${label}</span>
  </a>`;
}

async function boot() {
  applyTheme();
  buildShell();
  window.addEventListener("stock-hold:unauthorized", () => {
    if (!window.location.pathname.endsWith("/login.html")) window.location.href = loginHref();
  }, { once: true });
  if (!isMock()) {
    try {
      const user = await auth.me();
      const name = document.querySelector("[data-user-name]");
      const logout = document.querySelector("[data-action=logout]");
      if (name && logout) {
        name.textContent = user.username;
        name.hidden = false;
        logout.hidden = false;
      }
    } catch (_) { return; }
  }
  const pageKey = getPageKey();
  const mountFn = MOUNT_FNS[pageKey];
  const main = document.querySelector(".app__main");

  if (!main) {
    console.error("Missing .app__main element");
    return;
  }
  if (typeof mountFn !== "function") {
    main.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">⚠️</div>
      <div class="empty-state__title">未知頁面</div>
      <div class="empty-state__msg">data-page="${pageKey}" 沒有對應的頁面模組。</div>
    </div>`;
    return;
  }

  // Add a skip-to-main link for a11y
  const skip = document.createElement("a");
  skip.className = "sr-only sr-only-focusable";
  skip.href = "#main-content";
  skip.textContent = t("app.skipToMain");
  document.body.prepend(skip);
  main.setAttribute("id", "main-content");
  main.setAttribute("tabindex", "-1");

  try {
    await mountFn(main);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty-state">
      <div class="empty-state__icon">⚠️</div>
      <div class="empty-state__title">載入失敗</div>
      <div class="empty-state__msg">${escapeHtml(e?.message || String(e))}</div>
    </div>`;
  }

  // Online/offline banner
  function syncOnline() {
    let banner = document.querySelector(".offline-banner");
    if (navigator.onLine) {
      banner?.remove();
    } else if (!banner) {
      banner = document.createElement("div");
      banner.className = "offline-banner";
      banner.setAttribute("role", "status");
      banner.textContent = t("app.offlineBanner");
      document.body.appendChild(banner);
    }
  }
  window.addEventListener("online", syncOnline);
  window.addEventListener("offline", syncOnline);
  syncOnline();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;" }[c]));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
