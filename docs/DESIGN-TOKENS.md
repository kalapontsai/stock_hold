# stock_hold Design Tokens

> Phase 2 設計輸入。提供給 Phase 3（frontend-developer）兩份對照：
> **A. CSS Custom Properties（首選）** 寫進 `assets/tokens.css`，全站可即時生效；
> **B. Tailwind config（optional）** 給 `tailwind.config.ts` 用，可與 A 並存。
> 兩份值需 **完全同步**——改一邊必改另一邊，PR 內檢查清單明列。

---

## 1. 設計決策摘要

| 項目       | 決定                            | 理由                                             |
| ---------- | ------------------------------- | ------------------------------------------------ |
| 主色調     | 冷色藍 (`blue-500` 系)         | 金融/中性，常用不踩雷，對色盲 (deuteranopia) 友善 |
| 漲跌配色   | 綠漲 `#10B981` / 紅跌 `#EF4444` | 台股慣例已顛倒為紅漲綠跌；保持一致可免訓練成本    |
| 中文字型   | Noto Sans TC                    | Google Fonts CDN，覆蓋繁體全字符與金融符號        |
| 數字字型   | JetBrains Mono                  | 等寬數字，便於損益、表單欄對齊                    |
| 圓角基調   | 8px（md）為主，12px（lg）卡片  | 對齊現代 SaaS 主流，台灣用戶接受度高              |
| 模式       | 預設淺色 + 深色 + 跟隨系統      | 設定頁可切換                                      |
| 單位       | `4px` 為基準                    | 全部 spacing 為 4 的倍數，例外僅 typography       |

---

## 2. 顏色（Color Tokens）

### 2.1 主要品牌色 Primary（Blue）
WCAG AA 驗證：`white` 上的 `#1D4ED8` (700) 對比 8.6:1；`#3B82F6` (500) 對比 4.6:1（≥ AA normal）。

| token                          | hex       | 用途                              |
| ------------------------------ | --------- | --------------------------------- |
| `--color-primary-50`           | `#EFF6FF` | hover bg、selected row bg          |
| `--color-primary-100`          | `#DBEAFE` | info bg、chip                     |
| `--color-primary-200`          | `#BFDBFE` | focus ring 淡化、graph fill 輔   |
| `--color-primary-300`          | `#93C5FD` | placeholder、disabled fg          |
| `--color-primary-400`          | `#60A5FA` | secondary action                  |
| `--color-primary-500`          | `#3B82F6` | **brand default** — primary btn bg |
| `--color-primary-600`          | `#2563EB` | primary btn hover                 |
| `--color-primary-700`          | `#1D4ED8` | active press、深色 footer         |
| `--color-primary-800`          | `#1E40AF` | dark mode 主色                    |
| `--color-primary-900`          | `#1E3A8A` | 最深的鏈結/標題                   |

### 2.2 成功 / 正向（Success）
> 漲、已實現 +、對帳通過、Skill 執行成功。

| token                       | hex       |
| --------------------------- | --------- |
| `--color-success-50`        | `#ECFDF5` |
| `--color-success-100`       | `#D1FAE5` |
| `--color-success-300`       | `#6EE7B7` |
| `--color-success-500`       | `#10B981` ← semantic `positive` |
| `--color-success-700`       | `#047857` |
| `--color-success-900`       | `#064E3B` |

### 2.3 危險 / 負向（Danger）
> 跌、已實現 −、刪除確認、validation error、對帳差異超過容忍值。

| token                       | hex       |
| --------------------------- | --------- |
| `--color-danger-50`         | `#FEF2F2` |
| `--color-danger-100`        | `#FEE2E2` |
| `--color-danger-300`        | `#FCA5A5` |
| `--color-danger-500`        | `#EF4444` ← semantic `negative` |
| `--color-danger-700`        | `#B91C1C` |
| `--color-danger-900`        | `#7F1D1D` |

### 2.4 警告（Warning）
> 警示、未對帳、配息預扣稅、token 即將過期。

| token                       | hex       |
| --------------------------- | --------- |
| `--color-warning-50`        | `#FFFBEB` |
| `--color-warning-100`       | `#FEF3C7` |
| `--color-warning-300`       | `#FCD34D` |
| `--color-warning-500`       | `#F59E0B` |
| `--color-warning-700`       | `#B45309` |
| `--color-warning-900`       | `#78350F` |

### 2.5 中性色（Neutral — slate）
> 文字、背景、邊框、表格 zebra、divider。

| token                        | hex       | 用途                          |
| ---------------------------- | --------- | ----------------------------- |
| `--color-neutral-0`          | `#FFFFFF` | 主要背景                      |
| `--color-neutral-50`         | `#F8FAFC` | 卡片次背景、zebra stripe      |
| `--color-neutral-100`        | `#F1F5F9` | hover bg、表頭底色            |
| `--color-neutral-200`        | `#E2E8F0` | divider、input border         |
| `--color-neutral-300`        | `#CBD5E1` | disabled border、chip stroke  |
| `--color-neutral-400`        | `#94A3B8` | placeholder、disabled fg      |
| `--color-neutral-500`        | `#64748B` | secondary text、icon muted     |
| `--color-neutral-600`        | `#475569` | body text（淺色模式）         |
| `--color-neutral-700`        | `#334155` | title text                    |
| `--color-neutral-800`        | `#1E293B` | heading text                  |
| `--color-neutral-900`        | `#0F172A` | 主背景（深色模式）            |
| `--color-neutral-950`        | `#020617` | 極深的對比強調                |

### 2.6 語意色（Semantic aliases）
> 程式碼內請優先使用 semantic 而不是直接 `primary-500`，
> 這樣日後改 brand 不需到處改數值。

```css
:root {
  --color-text:           var(--color-neutral-700);
  --color-text-muted:     var(--color-neutral-500);
  --color-text-inverse:   var(--color-neutral-0);
  --color-heading:        var(--color-neutral-800);

  --color-bg:             var(--color-neutral-0);
  --color-bg-elevated:    var(--color-neutral-50);
  --color-bg-subtle:      var(--color-neutral-100);

  --color-border:         var(--color-neutral-200);
  --color-border-strong:  var(--color-neutral-300);

  --color-link:           var(--color-primary-700);
  --color-positive:       var(--color-success-500);
  --color-negative:       var(--color-danger-500);
  --color-warning:        var(--color-warning-500);

  --color-focus-ring:     var(--color-primary-500);
}
```

### 2.7 深色模式（Dark Theme）
使用 `data-theme="dark"` 切換；Phase 3 務必在所有模態預設 readable。

```css
[data-theme="dark"] {
  --color-primary-500: #60A5FA;   /* 在深色上用更亮的藍，提 contrast */
  --color-primary-600: #3B82F6;
  --color-primary-700: #2563EB;

  --color-text:         var(--color-neutral-200);
  --color-text-muted:   var(--color-neutral-400);
  --color-heading:      var(--color-neutral-50);

  --color-bg:           var(--color-neutral-900);
  --color-bg-elevated:  var(--color-neutral-800);
  --color-bg-subtle:    var(--color-neutral-700);

  --color-border:        var(--color-neutral-700);
  --color-border-strong: var(--color-neutral-600);

  --color-link:          #93C5FD;
  --color-positive:      #34D399;  /* dark 上更亮 */
  --color-negative:      #F87171;
  --color-warning:       #FBBF24;
}
```

### 2.8 圖表色盤（Chart palette — 用於 Pie/Bar）
從上述色階抽出，確保與品牌一致，並彼此有 ≥ 1.5 亮度差。

```css
--chart-1: var(--color-primary-500);   /* 藍 */
--chart-2: var(--color-success-500);   /* 綠 */
--chart-3: var(--color-warning-500);   /* 橘 */
--chart-4: var(--color-danger-500);    /* 紅 */
--chart-5: #8B5CF6;                    /* 紫 — 額外 */
--chart-6: #14B8A6;                    /* 青 — 額外 */
```

---

## 3. 字體（Typography）

### 3.1 字型家族
```css
:root {
  --font-family-sans:   "Inter", "Noto Sans TC", -apple-system, BlinkMacSystemFont,
                        "Segoe UI", "Microsoft JhengHei", "PingFang TC",
                        "Helvetica Neue", Arial, system-ui, sans-serif;

  --font-family-mono:   "JetBrains Mono", "SF Mono", "Menlo", "Consolas",
                        "Source Han Mono TC", monospace;

  /* 純數字欄專用 */
  --font-family-number: var(--font-family-mono);
}
```

> **理由**：Inter 對拉丁字 + 介面 fine；Noto Sans TC 補繁中；`font-feature-settings: "tnum"` 開等寬數字；
> JetBrains Mono 為實際等寬字型，用於價格、數量、P/L 表格，避免上下行錯位。

### 3.2 字級（Type Scale）
1rem = 16px，`6 級制 + 4 延伸`，總計 9 級。

| token                | rem      | px    | line-height | 用途                                |
| -------------------- | -------- | ----- | ----------- | ----------------------------------- |
| `--text-xs`          | 0.75rem  | 12    | 1.5 (18px)  | helper、chip、tab badge              |
| `--text-sm`          | 0.875rem | 14    | 1.5 (21px)  | table body、caption                 |
| `--text-base`        | 1rem     | 16    | 1.5 (24px)  | body、表單 input                    |
| `--text-lg`          | 1.125rem | 18    | 1.5 (27px)  | section title                       |
| `--text-xl`          | 1.25rem  | 20    | 1.4 (28px)  | h4、小卡片標題                      |
| `--text-2xl`         | 1.5rem   | 24    | 1.3 (32px)  | h3、metric card value small         |
| `--text-3xl`         | 1.875rem | 30    | 1.25 (38px) | h2、metric card value               |
| `--text-4xl`         | 2.25rem  | 36    | 1.2 (44px)  | h1、dashboard 總資產 hero           |
| `--text-display`     | 3rem     | 48    | 1.1 (53px)  | 第一頁 hero（罕用）                 |

### 3.3 字重
```css
--font-weight-regular:  400;
--font-weight-medium:   500;  /* 預設按鈕、表頭 */
--font-weight-semibold: 600;  /* h2-h4 */
--font-weight-bold:     700;  /* h1、數字強調 */
```

### 3.4 數字對齊（Tabular Numbers — Phase 3 必須）
全部金額欄、股數欄、價格欄：
```css
.font-tabular { font-feature-settings: "tnum" 1, "cv11" 1; }
```
或 utility class：
```css
.num { font-variant-numeric: tabular-nums; }
```

---

## 4. 間距（Spacing）

4px 為基準，符合台灣常見 8-point grid。

| token            | rem    | px   | 常用場景                                |
| ---------------- | ------ | ---- | --------------------------------------- |
| `--space-0`      | 0      | 0    | reset                                   |
| `--space-1`      | 0.25rem| 4    | chip 內 padding-y、icon 與文字間距      |
| `--space-2`      | 0.5rem | 8    | input gap、tab padding                  |
| `--space-3`      | 0.75rem| 12   | button padding-y、卡片 padding          |
| `--space-4`      | 1rem   | 16   | form field、card 預設 padding           |
| `--space-6`      | 1.5rem | 24   | section gap、modal padding              |
| `--space-8`      | 2rem   | 32   | 卡片之間、tab 之間                      |
| `--space-12`     | 3rem   | 48   | page section boundary                   |
| `--space-16`     | 4rem   | 64   | header / footer padding-y               |
| `--space-24`     | 6rem   | 96   | extreme（罕用）                         |

行內安全：`inline-spacing` 用 `--space-1`～`--space-2`。

---

## 5. 圓角（Radius）

| token              | px   | 用途                                       |
| ------------------ | ---- | ------------------------------------------ |
| `--radius-sm`      | 4    | tag、small chip                            |
| `--radius-md`      | 8    | button、input、checkbox                    |
| `--radius-lg`      | 12   | card、popover                              |
| `--radius-xl`      | 16   | modal、drawer                              |
| `--radius-2xl`     | 24   | 特殊 hero                                  |
| `--radius-full`    | 9999 | avatar、pill、toast 的圓角                 |

> Modal 與 Drawer 在 **手機全螢幕** 模式時，`--radius-xl`→`0`，與螢幕接縫。

---

## 6. 陰影（Elevation / Shadow）

```css
--shadow-sm: 0 1px 2px 0 rgb(15 23 42 / 0.05);
--shadow-md: 0 4px 6px -1px rgb(15 23 42 / 0.10),
             0 2px 4px -2px rgb(15 23 42 / 0.06);
--shadow-lg: 0 10px 15px -3px rgb(15 23 42 / 0.12),
             0 4px 6px -4px rgb(15 23 42 / 0.08);
--shadow-xl: 0 20px 25px -5px rgb(15 23 42 / 0.16),
             0 8px 10px -6px rgb(15 23 42 / 0.08);
--shadow-focus: 0 0 0 3px rgb(59 130 246 / 0.35);  /* focus ring halo */
```

使用規則：
- `shadow-sm`：default card、表格
- `shadow-md`：hover lift card
- `shadow-lg`：modal、drawer、popover
- `shadow-focus`：永遠疊在 focus outline 上方，避免與 focus ring 衝突

深色模式陰影需更深且增加透明度 → 用 `data-theme="dark"` 覆寫：
```css
[data-theme="dark"] {
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.3);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5), 0 4px 6px -4px rgb(0 0 0 / 0.3);
}
```

---

## 7. 動效（Motion）

```css
--duration-fast:      150ms;   /* hover、focus、checkbox toggle */
--duration-normal:    250ms;   /* modal open、drawer slide、tab switch */
--duration-slow:      350ms;   /* page transition、chart redraw */
--easing-standard:    cubic-bezier(0.4, 0, 0.2, 1);    /* default */
--easing-emphasized:  cubic-bezier(0.2, 0, 0, 1);      /* 主題 */
--easing-decel:       cubic-bezier(0, 0, 0.2, 1);      /* 出現 */
--easing-accel:       cubic-bezier(0.4, 0, 1, 1);      /* 消失 */
```

> **a11y 強制**：必須支援 `prefers-reduced-motion: reduce`，
> 自動把所有 duration 改為 `0.01ms`，easing 設為 `linear`。
> Phase 3 開發提醒，在 `tokens.css` 加上：
> ```css
> @media (prefers-reduced-motion: reduce) {
>   *, *::before, *::after {
>     animation-duration: 0.01ms !important;
>     transition-duration: 0.01ms !important;
>   }
> }
> ```

---

## 8. 斷點（Breakpoints）

| token        | px   | 對應          |
| ------------ | ---- | ------------- |
| `bp-sm`      | 640  | 手機橫 / 小平板 |
| `bp-md`      | 768  | 平板          |
| `bp-lg`      | 1024 | 桌機（sidebar 出現） |
| `bp-xl`      | 1280 | 桌機寬        |
| `bp-2xl`     | 1536 | 大桌面        |

CSS 變數不可直接用於 `@media`，故下面只有 media query 寫法：
```css
/* Tailwind 對照：sm:640 / md:768 / lg:1024 / xl:1280 / 2xl:1536 */
```

---

## 9. Z-index 尺度

| token             | value | 用途                  |
| ----------------- | ----- | --------------------- |
| `--z-base`        | 0     | 預設                  |
| `--z-sticky`      | 10    | sticky header、tab bar |
| `--z-dropdown`    | 20    | select、popover        |
| `--z-drawer`      | 30    | side sheet             |
| `--z-modal-back`  | 40    | modal 背景            |
| `--z-modal`       | 50    | modal 內容            |
| `--z-toast`       | 60    | 訊息通知              |
| `--z-tooltip`     | 70    | tooltip（最上層）      |

---

## 10. 元件風格（Component Patterns）

### 10.1 Button
```css
.btn {
  display: inline-flex; align-items: center; gap: var(--space-2);
  height: 40px; padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  font: var(--font-weight-medium) var(--text-sm) / 1 var(--font-family-sans);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--duration-fast) var(--easing-standard),
              transform var(--duration-fast) var(--easing-standard);
}
.btn:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
.btn:disabled { opacity: .5; cursor: not-allowed; }

.btn--primary { background: var(--color-primary-500); color: white; }
.btn--primary:hover:not(:disabled) { background: var(--color-primary-600); }
.btn--primary:active:not(:disabled) { background: var(--color-primary-700); transform: translateY(1px); }

.btn--secondary { background: transparent; color: var(--color-text); border-color: var(--color-border); }
.btn--secondary:hover:not(:disabled) { background: var(--color-bg-subtle); }

.btn--ghost { background: transparent; color: var(--color-text); }
.btn--ghost:hover:not(:disabled) { background: var(--color-bg-subtle); }

.btn--danger { background: var(--color-danger-500); color: white; }
.btn--danger:hover:not(:disabled) { background: var(--color-danger-700); }

/* 尺寸變體 */
.btn--sm { height: 32px; padding: 0 var(--space-3); font-size: var(--text-xs); }
.btn--lg { height: 48px; padding: 0 var(--space-6); font-size: var(--text-base); }
```

### 10.2 Form Input
```css
.input {
  display: block; width: 100%;
  height: 40px; padding: 0 var(--space-3);
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font: var(--text-base) / 1.5 var(--font-family-sans);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}
.input::placeholder { color: var(--color-text-muted); }
.input:focus-visible {
  outline: none;
  border-color: var(--color-focus-ring);
  box-shadow: var(--shadow-focus);
}
.input[aria-invalid="true"] {
  border-color: var(--color-negative);
}
.input--number { font-family: var(--font-family-number); font-variant-numeric: tabular-nums; text-align: right; }
.input--currency { padding-right: 56px; } /* 預留貨幣後綴空間 */
```

### 10.3 Table
```css
.table {
  width: 100%; border-collapse: separate; border-spacing: 0;
  font: var(--text-sm) / 1.5 var(--font-family-sans);
}
.table th, .table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}
.table th {
  background: var(--color-bg-subtle);
  color: var(--color-heading);
  font-weight: var(--font-weight-semibold);
  position: sticky; top: 0; z-index: var(--z-sticky);
  user-select: none;
}
.table td.num { text-align: right; font-family: var(--font-family-number); font-variant-numeric: tabular-nums; }
.table td.positive { color: var(--color-positive); }
.table td.negative { color: var(--color-negative); }
.table tbody tr:hover { background: var(--color-bg-elevated); }
.table tbody tr:focus-within { outline: 2px solid var(--color-focus-ring); outline-offset: -2px; }
.table tbody tr:nth-child(even) { background: var(--color-bg-elevated); }
.table tbody tr:nth-child(even):hover { background: var(--color-primary-50); }
[data-theme="dark"] .table tbody tr:nth-child(even) { background: var(--color-neutral-800); }
```

### 10.4 Card
```css
.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  padding: var(--space-6);
  transition: box-shadow var(--duration-normal);
}
.card--clickable { cursor: pointer; }
.card--clickable:hover { box-shadow: var(--shadow-md); }
.card--clickable:focus-visible { outline: none; box-shadow: var(--shadow-focus); }

.card__title { font-size: var(--text-lg); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-4); color: var(--color-heading); }
```

### 10.5 Modal
```css
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgb(15 23 42 / 0.5);
  z-index: var(--z-modal-back);
  display: flex; align-items: center; justify-content: center;
  animation: fade-in var(--duration-normal) var(--easing-standard);
}
.modal {
  background: var(--color-bg);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  width: min(560px, calc(100vw - var(--space-8)));
  max-height: calc(100vh - var(--space-8));
  overflow: auto;
  z-index: var(--z-modal);
  animation: scale-in var(--duration-normal) var(--easing-emphasized);
}
.modal--fullscreen-mobile {
  width: 100vw; height: 100vh; max-height: 100vh;
  border-radius: 0;  /* 全螢幕手機 */
}
@media (min-width: 768px) {
  .modal--fullscreen-mobile { width: min(720px, calc(100vw - var(--space-16))); height: auto; border-radius: var(--radius-xl); }
}
```

---

## 11. CSS Custom Properties 完整檔案（給 Phase 3 直接貼到 `assets/tokens.css`）

> Phase 3 複製以下整段到 `frontend/assets/tokens.css`，
> 在 `index.html` 或主入口 `<link rel="stylesheet">` 最早位置引入。

```css
:root {
  /* ============ COLOR ============ */
  --color-primary-50:  #EFF6FF; --color-primary-100: #DBEAFE;
  --color-primary-200: #BFDBFE; --color-primary-300: #93C5FD;
  --color-primary-400: #60A5FA; --color-primary-500: #3B82F6;
  --color-primary-600: #2563EB; --color-primary-700: #1D4ED8;
  --color-primary-800: #1E40AF; --color-primary-900: #1E3A8A;

  --color-success-50:  #ECFDF5; --color-success-100: #D1FAE5;
  --color-success-300: #6EE7B7; --color-success-500: #10B981;
  --color-success-700: #047857; --color-success-900: #064E3B;

  --color-danger-50:   #FEF2F2; --color-danger-100: #FEE2E2;
  --color-danger-300:  #FCA5A5; --color-danger-500: #EF4444;
  --color-danger-700:  #B91C1C; --color-danger-900: #7F1D1D;

  --color-warning-50:  #FFFBEB; --color-warning-100: #FEF3C7;
  --color-warning-300: #FCD34D; --color-warning-500: #F59E0B;
  --color-warning-700: #B45309; --color-warning-900: #78350F;

  --color-neutral-0:   #FFFFFF; --color-neutral-50:  #F8FAFC;
  --color-neutral-100: #F1F5F9; --color-neutral-200: #E2E8F0;
  --color-neutral-300: #CBD5E1; --color-neutral-400: #94A3B8;
  --color-neutral-500: #64748B; --color-neutral-600: #475569;
  --color-neutral-700: #334155; --color-neutral-800: #1E293B;
  --color-neutral-900: #0F172A; --color-neutral-950: #020617;

  --color-text:           var(--color-neutral-700);
  --color-text-muted:     var(--color-neutral-500);
  --color-text-inverse:   var(--color-neutral-0);
  --color-heading:        var(--color-neutral-800);
  --color-bg:             var(--color-neutral-0);
  --color-bg-elevated:    var(--color-neutral-50);
  --color-bg-subtle:      var(--color-neutral-100);
  --color-border:         var(--color-neutral-200);
  --color-border-strong:  var(--color-neutral-300);
  --color-link:           var(--color-primary-700);
  --color-positive:       var(--color-success-500);
  --color-negative:       var(--color-danger-500);
  --color-warning:        var(--color-warning-500);
  --color-focus-ring:     var(--color-primary-500);

  --chart-1: var(--color-primary-500);
  --chart-2: var(--color-success-500);
  --chart-3: var(--color-warning-500);
  --chart-4: var(--color-danger-500);
  --chart-5: #8B5CF6;
  --chart-6: #14B8A6;

  /* ============ TYPOGRAPHY ============ */
  --font-family-sans: "Inter", "Noto Sans TC", -apple-system, BlinkMacSystemFont,
                      "Segoe UI", "Microsoft JhengHei", "PingFang TC",
                      "Helvetica Neue", Arial, system-ui, sans-serif;
  --font-family-mono: "JetBrains Mono", "SF Mono", "Menlo", "Consolas",
                      "Source Han Mono TC", monospace;
  --font-family-number: var(--font-family-mono);

  --text-xs:      0.75rem;
  --text-sm:      0.875rem;
  --text-base:    1rem;
  --text-lg:      1.125rem;
  --text-xl:      1.25rem;
  --text-2xl:     1.5rem;
  --text-3xl:     1.875rem;
  --text-4xl:     2.25rem;
  --text-display: 3rem;

  --font-weight-regular: 400;
  --font-weight-medium:  500;
  --font-weight-semibold: 600;
  --font-weight-bold:    700;

  /* ============ SPACING ============ */
  --space-0: 0;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-24: 6rem;

  /* ============ RADIUS ============ */
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-2xl:  24px;
  --radius-full: 9999px;

  /* ============ SHADOW ============ */
  --shadow-sm:    0 1px 2px 0 rgb(15 23 42 / 0.05);
  --shadow-md:    0 4px 6px -1px rgb(15 23 42 / 0.10),
                  0 2px 4px -2px rgb(15 23 42 / 0.06);
  --shadow-lg:    0 10px 15px -3px rgb(15 23 42 / 0.12),
                  0 4px 6px -4px rgb(15 23 42 / 0.08);
  --shadow-xl:    0 20px 25px -5px rgb(15 23 42 / 0.16),
                  0 8px 10px -6px rgb(15 23 42 / 0.08);
  --shadow-focus: 0 0 0 3px rgb(59 130 246 / 0.35);

  /* ============ MOTION ============ */
  --duration-fast:   150ms;
  --duration-normal: 250ms;
  --duration-slow:   350ms;
  --easing-standard:   cubic-bezier(0.4, 0, 0.2, 1);
  --easing-emphasized: cubic-bezier(0.2, 0, 0, 1);
  --easing-decel:      cubic-bezier(0, 0, 0.2, 1);
  --easing-accel:      cubic-bezier(0.4, 0, 1, 1);

  /* ============ Z-INDEX ============ */
  --z-base:       0;
  --z-sticky:    10;
  --z-dropdown:  20;
  --z-drawer:    30;
  --z-modal-back: 40;
  --z-modal:     50;
  --z-toast:     60;
  --z-tooltip:   70;
}

[data-theme="dark"] {
  --color-primary-500: #60A5FA;
  --color-primary-600: #3B82F6;
  --color-primary-700: #2563EB;

  --color-text:          var(--color-neutral-200);
  --color-text-muted:    var(--color-neutral-400);
  --color-heading:       var(--color-neutral-50);
  --color-bg:            var(--color-neutral-900);
  --color-bg-elevated:   var(--color-neutral-800);
  --color-bg-subtle:     var(--color-neutral-700);
  --color-border:        var(--color-neutral-700);
  --color-border-strong: var(--color-neutral-600);
  --color-link:          #93C5FD;
  --color-positive:      #34D399;
  --color-negative:      #F87171;
  --color-warning:       #FBBF24;

  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4),
               0 2px 4px -2px rgb(0 0 0 / 0.3);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5),
               0 4px 6px -4px rgb(0 0 0 / 0.3);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 12. Tailwind Config 對照（可選）

> 給 Phase 3 一份現成 `tailwind.config.ts` 的 theme.extend 區段，所有值必須與 §11 完全一致。
> Phase 3 若不用 Tailwind，可忽略本節。

```ts
// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  "#EFF6FF", 100: "#DBEAFE", 200: "#BFDBFE", 300: "#93C5FD",
          400: "#60A5FA", 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8",
          800: "#1E40AF", 900: "#1E3A8A",
        },
        success: { 50: "#ECFDF5", 100: "#D1FAE5", 300: "#6EE7B7", 500: "#10B981", 700: "#047857", 900: "#064E3B" },
        danger:  { 50: "#FEF2F2", 100: "#FEE2E2", 300: "#FCA5A5", 500: "#EF4444", 700: "#B91C1C", 900: "#7F1D1D" },
        warning: { 50: "#FFFBEB", 100: "#FEF3C7", 300: "#FCD34D", 500: "#F59E0B", 700: "#B45309", 900: "#78350F" },
        neutral: {
          0: "#FFFFFF", 50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0",
          300: "#CBD5E1", 400: "#94A3B8", 500: "#64748B", 600: "#475569",
          700: "#334155", 800: "#1E293B", 900: "#0F172A", 950: "#020617",
        },
        positive: "var(--color-positive)",
        negative: "var(--color-negative)",
        focus:    "var(--color-focus-ring)",
      },
      fontFamily: {
        sans:   ["Inter", "Noto Sans TC", "system-ui", "sans-serif"],
        mono:   ["JetBrains Mono", "SF Mono", "Menlo", "monospace"],
        number: ["JetBrains Mono", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        xs:      ["0.75rem",  { lineHeight: "1.5" }],
        sm:      ["0.875rem", { lineHeight: "1.5" }],
        base:    ["1rem",     { lineHeight: "1.5" }],
        lg:      ["1.125rem", { lineHeight: "1.5" }],
        xl:      ["1.25rem",  { lineHeight: "1.4" }],
        "2xl":   ["1.5rem",   { lineHeight: "1.3" }],
        "3xl":   ["1.875rem", { lineHeight: "1.25" }],
        "4xl":   ["2.25rem",  { lineHeight: "1.2" }],
        display: ["3rem",     { lineHeight: "1.1" }],
      },
      spacing: {
        1: "0.25rem", 2: "0.5rem", 3: "0.75rem", 4: "1rem",
        6: "1.5rem", 8: "2rem", 12: "3rem", 16: "4rem", 24: "6rem",
      },
      borderRadius: {
        sm: "4px", md: "8px", lg: "12px", xl: "16px", "2xl": "24px", full: "9999px",
      },
      boxShadow: {
        sm:    "0 1px 2px 0 rgb(15 23 42 / 0.05)",
        md:    "0 4px 6px -1px rgb(15 23 42 / 0.10), 0 2px 4px -2px rgb(15 23 42 / 0.06)",
        lg:    "0 10px 15px -3px rgb(15 23 42 / 0.12), 0 4px 6px -4px rgb(15 23 42 / 0.08)",
        xl:    "0 20px 25px -5px rgb(15 23 42 / 0.16), 0 8px 10px -6px rgb(15 23 42 / 0.08)",
        focus: "0 0 0 3px rgb(59 130 246 / 0.35)",
      },
      transitionDuration: { fast: "150ms", normal: "250ms", slow: "350ms" },
      transitionTimingFunction: {
        standard:   "cubic-bezier(0.4, 0, 0.2, 1)",
        emphasized: "cubic-bezier(0.2, 0, 0, 1)",
      },
      zIndex: { sticky: 10, dropdown: 20, drawer: 30, "modal-back": 40, modal: 50, toast: 60, tooltip: 70 },
    },
  },
} satisfies Config;
```

---

## 13. i18n 字串預先定義（給 Phase 3 key）

> 全部 UI 字串採 **`t("key")`** 形式，不寫死中文。
> Phase 3 啟動時先建 `i18n/zh-TW.ts` 與 `i18n/en.ts`（預設 zh-TW）。

| key                          | zh-TW                            | en                              |
| ---------------------------- | -------------------------------- | ------------------------------- |
| `app.title`                  | 股票與資產記帳                   | Stock Hold                      |
| `nav.dashboard`              | 總覽                             | Dashboard                       |
| `nav.transactions`           | 交易                             | Transactions                    |
| `nav.holdings`               | 持倉                             | Holdings                        |
| `nav.reports`                | 報表                             | Reports                         |
| `nav.settings`               | 設定                             | Settings                        |
| `action.refresh`             | 更新市價                         | Refresh Prices                  |
| `action.add`                 | 新增                             | Add                             |
| `action.delete`              | 刪除                             | Delete                          |
| `action.save`                | 儲存                             | Save                            |
| `action.cancel`              | 取消                             | Cancel                          |
| `metric.totalAssets`         | 總資產                           | Total Assets                    |
| `metric.todayPnl`            | 今日損益                         | Today's P/L                     |
| `metric.mtdPnl`              | 月初至今                         | Month-to-Date P/L               |
| `metric.unrealizedPnl`       | 未實現損益                       | Unrealized P/L                  |
| `metric.realizedPnl`         | 已實現損益                       | Realized P/L                    |
| `metric.dividendYield`       | 殖利率                           | Dividend Yield                  |
| `filter.range.thisWeek`      | 本週                             | This Week                       |
| `filter.range.thisMonth`     | 本月                             | This Month                      |
| `filter.range.thisQuarter`   | 本季                             | This Quarter                    |
| `filter.range.thisYear`      | 今年                             | This Year                       |
| `filter.range.custom`        | 自訂                             | Custom                          |
| `empty.noHoldings`          | 目前沒有持倉，先到「交易」新增第一筆 BUY 吧 | No holdings yet |
| `error.unauthorized`        | 請重新設定 API token             | Please reconfigure API token    |
| `error.server`              | 資料載入失敗，稍後重試           | Failed to load, please retry    |

Phase 3 自行匯入並擴充；不要 hard-code。
