/**
 * stock_hold — DataTable (sortable, paginated, selectable, responsive card mode)
 *
 * Per COMPONENT-INVENTORY §3 <DataTable>:
 *   columns: [{ key, header, accessor?, cell?, sortable?, align?, width? }]
 *   rowKey: (row) => string
 *   loading, emptyState, stickyHeader, selectable, responsive
 *
 * Accessibility:
 *   - <table><caption>, <th scope="col">, aria-sort, tabindex on rows
 *   - Enter on focused row triggers onRowClick
 *
 * This is a plain DOM (not virtualised) table — fine for MVP scale (≤ 1000 rows
 * expected). For larger lists, swap in a virtualised renderer later.
 */

const SORT_DIRECTIONS = ["none", "ascending", "descending"];

export function createDataTable({
  columns,
  data = [],
  rowKey,
  rowClass,
  onRowClick,
  loading = false,
  emptyState,
  stickyHeader = true,
  selectable = false,
  responsive = true,
  caption = "",
  initialSort = null,
} = {}) {
  const root = document.createElement("div");
  root.className = "table-wrapper";
  if (loading) root.setAttribute("aria-busy", "true");

  const table = document.createElement("table");
  table.className = "table";
  if (responsive) table.classList.add("table--responsive");

  if (caption) {
    const cap = document.createElement("caption");
    cap.textContent = caption;
    table.appendChild(cap);
  }

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const sortState = new Map();
  if (initialSort) sortState.set(initialSort.key, initialSort.direction || "ascending");

  if (selectable) {
    const th = document.createElement("th");
    th.scope = "col";
    th.style.width = "32px";
    const sel = document.createElement("input");
    sel.type = "checkbox";
    sel.className = "checkbox";
    sel.setAttribute("aria-label", "全選");
    th.appendChild(sel);
    headRow.appendChild(th);
  }

  columns.forEach((col) => {
    const th = document.createElement("th");
    th.scope = "col";
    if (col.align) th.style.textAlign = col.align;
    if (col.width) th.style.width = col.width;
    const labelText = col.header ?? col.key;
    th.textContent = labelText;
    if (col.sortable) {
      th.tabIndex = 0;
      th.setAttribute("role", "button");
      th.style.cursor = "pointer";
      th.dataset.key = col.key;
      const dir = sortState.get(col.key) || "none";
      th.setAttribute("aria-sort", dir);
      th.addEventListener("click", () => cycleSort(col.key));
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cycleSort(col.key);
        }
      });
    }
    headRow.appendChild(th);
  });

  if (onRowClick) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = "";
    th.style.width = "32px";
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  root.appendChild(table);

  let currentData = [...data];
  let currentSortKey = initialSort?.key ?? null;
  let currentSortDir = initialSort?.direction ?? "none";
  let selectedKeys = new Set();

  function cycleSort(key) {
    const cur = sortState.get(key) || "none";
    const next = SORT_DIRECTIONS[(SORT_DIRECTIONS.indexOf(cur) + 1) % SORT_DIRECTIONS.length];
    if (next === "none") {
      sortState.delete(key);
      currentSortKey = null;
      currentSortDir = "none";
    } else {
      // clear other columns
      for (const k of sortState.keys()) if (k !== key) sortState.delete(k);
      sortState.set(key, next);
      currentSortKey = key;
      currentSortDir = next;
    }
    // Refresh aria-sort headers
    thead.querySelectorAll("th[aria-sort]").forEach((th) => {
      th.setAttribute("aria-sort", sortState.get(th.dataset.key) || "none");
    });
    render();
  }

  function getCellValue(row, col) {
    if (typeof col.accessor === "function") return col.accessor(row);
    if (col.accessor) return row[col.accessor];
    return row[col.key];
  }

  function render() {
    tbody.innerHTML = "";
    if (loading) {
      for (let i = 0; i < 5; i++) {
        const tr = document.createElement("tr");
        columns.forEach(() => {
          const td = document.createElement("td");
          td.innerHTML = '<div class="skeleton" style="height: 14px; width: 80%"></div>';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      return;
    }

    if (!currentData.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length + (selectable ? 1 : 0) + (onRowClick ? 1 : 0);
      const empty = emptyState || document.createElement("div");
      if (typeof empty === "string") {
        td.innerHTML = `<div class="empty-state"><div class="empty-state__msg">${empty}</div></div>`;
      } else {
        td.appendChild(empty);
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    let rows = [...currentData];
    if (currentSortKey && currentSortDir !== "none") {
      const col = columns.find((c) => c.key === currentSortKey);
      const dir = currentSortDir === "ascending" ? 1 : -1;
      rows.sort((a, b) => {
        let va = getCellValue(a, col);
        let vb = getCellValue(b, col);
        // String comparison that tolerates numbers
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        va = (va ?? "").toString();
        vb = (vb ?? "").toString();
        // Try numeric compare if both look like decimals
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        if (Number.isFinite(na) && Number.isFinite(nb) && /^-?\d/.test(va) && /^-?\d/.test(vb)) {
          return (na - nb) * dir;
        }
        return va.localeCompare(vb, "zh-TW") * dir;
      });
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const key = rowKey(row);
      tr.dataset.key = key;
      // Optional per-row CSS class hook (e.g. `rowClass: r => r.status !== "active" ? "is-inactive" : ""`)
      if (typeof rowClass === "function") {
        const cls = rowClass(row);
        if (cls) String(cls).split(/\s+/).filter(Boolean).forEach((c) => tr.classList.add(c));
      }
      // Use a class instead of an inline style so dark mode can pick its
      // own selected-row background (see .is-selected in components.css).
      if (selectedKeys.has(key)) tr.classList.add("is-selected");

      if (selectable) {
        const td = document.createElement("td");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "checkbox";
        cb.checked = selectedKeys.has(key);
        cb.setAttribute("aria-label", "選取");
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          if (cb.checked) selectedKeys.add(key);
          else selectedKeys.delete(key);
          tr.classList.toggle("is-selected", cb.checked);
        });
        td.appendChild(cb);
        tr.appendChild(td);
      }

      columns.forEach((col) => {
        const td = document.createElement("td");
        td.dataset.label = col.header || col.key;
        if (col.align) td.style.textAlign = col.align;
        if (col.numeric) td.classList.add("num");
        if (typeof col.cell === "function") {
          const content = col.cell(row);
          if (content instanceof Node) td.appendChild(content);
          else td.innerHTML = content;
        } else {
          const raw = getCellValue(row, col);
          td.textContent = raw ?? "—";
        }
        tr.appendChild(td);
      });

      if (onRowClick) {
        const td = document.createElement("td");
        td.className = "table__actions-cell";
        const menu = document.createElement("button");
        menu.type = "button";
        menu.className = "btn btn--ghost btn--icon-only btn--sm";
        menu.setAttribute("aria-label", "列操作");
        menu.innerHTML = "&#x22EE;";
        td.appendChild(menu);
        tr.appendChild(td);
      }

      if (onRowClick) {
        tr.tabIndex = 0;
        tr.addEventListener("click", (e) => {
          if (e.target.closest("input,button")) return;
          onRowClick(row);
        });
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onRowClick(row);
          }
        });
      }

      tbody.appendChild(tr);
    });
  }

  render();

  return {
    el: root,
    setData(next) { currentData = [...next]; render(); },
    getSelected() { return [...selectedKeys]; },
    clearSelection() { selectedKeys.clear(); render(); },
    refresh() { render(); },
    setLoading(v) { loading = v; root.setAttribute("aria-busy", v ? "true" : "false"); render(); },
  };
}
