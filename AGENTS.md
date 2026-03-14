# Repository Guidelines

## Project Structure & Module Organization

- `src/` Vue 3 + TS app: `views/` pages, `components/` shared UI, `api/` & `services/` data calls, `stores/` Pinia state, `config/` presets (creators/API), `styles/` Tailwind/global CSS, `utils/` & `composables/` helpers, and `assets/` static.
- `server/` Koa proxy layer (see `server.js`, `server/routes`, `server/config`) used in dev/prod. Keep generated `dist/` untouched; static bits in `public/`. Ops helpers live in `scripts/` and `deploy.sh`.

## Build, Test, and Development Commands

- Install: `pnpm install` (Node ≥20) and keep `pnpm` in sync with the lockfile.
- Frontend dev: `pnpm dev` (Vite at `:5173`); full stack dev: `pnpm dev:full` (Koa + Vite) or backend only: `pnpm server:dev`.
- Checks: `pnpm lint` (ESLint + autofix), `pnpm format` (Prettier on `src/`), `pnpm type-check` (vue-tsc).
- Builds: `pnpm build` (type check + Vite build), `pnpm build-only` (skip vue-tsc), `pnpm preview` (serve built app), `pnpm start` (build then run production Koa). Probe `/api/xt/getFile` via `node test-frontend-request.js` while dev servers run.

## Coding Style & Naming Conventions

- Prettier 3 governs formatting (2-space indent, trailing commas); avoid manual tweaks. ESLint flags unused vars/components and enforces `prefer-const`; `console` is allowed for diagnostics.
- Vue SFCs use `<script setup>`; prefer `PascalCase` filenames for components/views, `useX` for composables, and `useXStore` for Pinia stores. Keep shared helpers in `src/utils` and type API shapes in `src/types`.
- Stick to TypeScript in new code with explicit return types on utilities; keep Tailwind utility classes in templates and shared styles in `src/styles`.

## Testing Guidelines

- No dedicated automated suite yet; minimum gate is `pnpm lint`, `pnpm type-check`, and `pnpm build`.
- Manual QA: Dashboard metrics, data tables with filters/pagination, order parsing, and Settings/Qianlong config persistence; watch console/network errors.
- For file retrieval, run `node test-frontend-request.js` to exercise `/api/xt/getFile`.

## Commit & Pull Request Guidelines

- Conventional Commits enforced by commitlint: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`, `chore`; header ≤100 chars. Example: `feat: add qianlong config persistence`.
- Use `pnpm commit` (cz-git) for prompts; stage only lint-clean code.
- PRs: summary, linked issue/requirement, validation steps, screenshots/GIFs for visible UI, and notes on env/setup changes (API endpoints, creator IDs). Confirm no secrets in diffs.
- After code changes, commit and push to the remote repository—avoid leaving local-only changes (run lint/type checks before committing).

## Security & Configuration Tips

- Keep real cookies/tokens/paths out of VCS; load via `.env` (autoloaded by `start-dev.js`) or local config, and sanitize `src/config/creators.ts`.
- When adjusting Koa middleware, validate paths/CORS and keep proxy/bucket targets in env-driven config.

## Communication

- 使用中文回复。

## Workflow

- **始终在 master 分支上进行代码修改**：所有代码变更必须直接在 master 分支上完成，不使用功能分支（除非用户明确要求）。
- **自动提交并推送**：每次修改代码后自动提交并推送到远程 master 分支；只有当用户明确说明需要 review 代码时，才不自动提交和推送。
- **工作流程**：
  1. 确认当前在 master 分支（`git branch --show-current`）
  2. 进行代码修改
  3. 运行 lint 和 type-check
  4. 提交代码到 master 分支
  5. 立即推送到远程：`git push origin master`
