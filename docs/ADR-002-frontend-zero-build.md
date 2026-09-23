# ADR-002: Frontend Bundling 改為 Zero-build

## Status
**Accepted**（supersedes ADR-001 §5）

## Date
2026-09-23

## Context

ADR-001 §5 原本決定 frontend bundling 採用 **Vite + OpenAPI codegen**，理由是「UI 會有資產表格、損益圖、現金流時間軸，純 CDN zero-build 會在多版本 library 漂移與 TS 型別保護上失守」。

Phase 2（ui-designer）在完成 wireframe 後回報：實際 UI 表面積遠低於 ADR-001 的假設，只有 5 個主要頁面（Dashboard / Transactions / Holdings / Reports / Settings），全部是 CRUD + 圖表，沒有複雜 stateful wizard 或大型 client-side 狀態機。**Vite 的成本（~600 MB node_modules、CI build step、Apache 改服務 `/dist/`、額外 failure mode）對這個專案來說不划算**。

## Decision

**將 ADR-001 §5 從「Vite + OpenAPI codegen」改為「Zero-build」**：

- **ES modules** + 原生 `<script type="module">`，無 bundler
- **CDN libs**：Chart.js 4.x UMD via `cdn.jsdelivr.net`；sparklines 用純 SVG
- **TS 安全**：手寫 `types/api.ts` 對齊 SPEC §3.1 envelope；`tsc --noEmit` 做型別檢查（不上 bundler）
- **Routing**：5 個頁面用 30 行 hash router 或 Apache rewrite，不需要 client-side framework
- **Lint**：ESLint flat config；無 bundler 在 CI

### 觸發重新評估的條件（escape hatch）
當出現以下任一情況，應重新評估 bundler 需求：
1. client-side routes 超過 ~10 個
2. 出現複雜 stateful wizard 或 optimistic-flow
3. WASM / Worker assets 進入專案

## Consequences

**+ Positive**
- 移除 `npm install` 600MB node_modules
- CI 移除 build step、artifact hash 比對
- Apache 直接服務 `frontend/`（目前已 serve），無需改 config
- 部署更簡單：`cp frontend/ /var/www/...` 即上線
- 開發 HMR 由瀏覽器原生 module reload 取代

**- Negative**
- TS 型別保護強度下降（手寫 types 可能 drift）；須以 CI 強制 `tsc --noEmit` 維持紀律
- 多 library 同時載入會增加 HTTP request 數（CDN 緩解部分問題）
- 大型依賴（如 React + 生態）若未來要加，會比 Vite 時代困難

**Risks**
- 若 SPEC 後續 v1.1+ 增加報表匯出（PDF/Excel）等需要 client-side 大量運算的功能，可能觸發 escape hatch 條件
- 後端 OpenAPI schema 若大幅變動，手寫 types.ts 維護成本會上升

## Notes for Phase 3

- **frontend-developer**：依此決策實作，不要裝 Vite
- **backend-architect**：OpenAPI 仍自動產生 `/openapi.json`，作為契約來源；frontend 只需手寫對應的 types.ts
- 兩者整合時，後端先提供 schema，frontend 從 schema 一次生成（或手寫對齊）types.ts
