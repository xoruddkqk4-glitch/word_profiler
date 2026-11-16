# AntWordProfiler Web — Agent Guidelines & Execution Rules

## 1. Project Architecture & Ownership

`AntWordProfiler Web` is a 100% browser-local (Local-First) vocabulary coverage & corpus profiler built with **Vite 6, React 19, TypeScript 5 (strict), Zustand 5, Dedicated Web Worker, Tailwind CSS v4 (OKLCH), and Vitest**.

Preserve strict layer ownership when inspecting or modifying code:
- **`src/core/`**: Pure, deterministic lexical engine — lossless Unicode regex tokenizer (`tokenizer.ts`), Row / Paul Nation Tree / Master Family compiler (`wordlistParser.ts`), single-document profiler (`profiler.ts`), 6-table corpus statistics calculator (`statsCalculator.ts`), cross-list duplicate validator (`listValidator.ts`), and WCAG highlight palette (`colorPalette.ts`). Keep DOM, React, and network calls out of `src/core/`.
- **`src/workers/`**: Dedicated Web Worker pipeline (`profiler.worker.ts`) and typed client (`workerClient.ts`).
- **`src/ai/`**: Client-only OpenRouter integration (`openRouterClient.ts`), deterministic local lexicon verifier (`lexiconVerifier.ts`), and AI lexical assistant (`lexicalAssistantService.ts`). Never trust LLM self-reports for wordlist membership — always verify locally via `lexiconVerifier`. Never include API keys in exported `.ini`/`.json` settings files.
- **`src/io/`**: Local file readers (`.txt` UTF-8/EUC-KR fallback, `.docx` via `mammoth`, `.pdf` via `pdfjs-dist`) and exporters (`.docx`, `.html`, `.txt`, `.tsv`, `.xlsx`, `.ini`/`.json`).
- **`src/store/` & `src/components/` & `src/styles/`**: Zustand store (`useProfilerStore.ts`), 3-pane workbench UI + modals, and OKLCH design tokens (`tokens.css`, `workspace.css` — maintain >= 13px font floor and `tabular-nums` on numeric readouts).
- **`public/wordlists/`**: Static bundled wordlists (`GSL/AWL`, `2015 개정 교육과정`, `2022 개정 교육과정`, `builtin_master_families.txt`) and `manifest.json`. Always resolve asset URLs via `resolvePublicAssetUrl` so GitHub Pages subpath deployments (`base: './'`) work without 404s.

---

## 2. Browser & Scratchpad Policy (브라우저 및 시각 검증 정책)

- **STRICT REQUIREMENT**: Do NOT launch Chrome, Scratchpad, or any browser subagent for visual verification during standard code editing tasks.
- **NO AUTOMATIC SCREENSHOTS**: Never take screenshots or perform visual browser inspection automatically after editing code; rely on HMR in the user's open browser.
- **EXPLICIT EXCEPTION**: Only launch Scratchpad / browser visual verification when the user explicitly enters `/scratchpad`, `/action scratchpad`, or directly asks `"scratchpad로 검증해줘"`.

---

## 3. Terminal-Based Fast Verification (터미널 전용 고속 정적 검증)

- After code changes, verify strictly via fast terminal checks instead of launching browsers or dev servers:
  1. **TypeScript static check (Required)**: `npm run type-check` (`npx tsc --noEmit`)
  2. **Unit & regression tests (When core/AI/store/IO logic or tests change)**: `npm test` (`npx vitest run`)
- Do NOT start long-running dev servers (`npm run dev`) or run full production builds (`npm run build`) unless explicitly requested by the user.
- If non-critical warnings appear, report them concisely rather than entering an endless fix loop.

---

## 4. Workflow Modes (`/ask`, `/apply`, `/git-commit`)

### `/ask` — 질의응답 및 계획 전용 모드 (No Code Modification & No Auto-Execution)
- When triggered by `/ask` or `/action ask`, **NEVER modify, create, or delete project source/config/data files**.
- Answer questions directly, or write an implementation plan to `.plan/YYYY-MM-DD_HHMM_<slug>.md` (or `implementation_plan.md` artifact) and **STOP**.
- Even if system auto-approval occurs, never auto-execute a `/ask` plan; wait for explicit user instruction (`/apply`).

### `/apply` — 계획서 즉시 적용 모드 (Plan Execution Mode)
- When triggered by `/apply` or `/action apply`, locate the latest plan in `.plan/*.md` (or `implementation_plan.md` / recent conversation agreement) and apply the planned changes step-by-step immediately without needing extra confirmation phrases like `"반영해줘"`.
- Run `npm run type-check` and `npm test` after applying changes, report results concisely, and **wait without committing**.

### `/git-commit` — README 누적 이력 기록 및 Git 커밋·푸시 정책 (Strict Trigger Only)
- **NEVER run `git commit` or `git push` automatically** after normal feature, bugfix, or `/apply` tasks.
- Execute ONLY when the user explicitly sends `/git-commit`, `/action git-commit`, or `"README 업데이트 후 푸시"`:
  1. Update `README.md` body if needed, and append a cumulative entry at the **very bottom** of `README.md` using Seoul time (`YYYY-MM-DD HH:mm` KST), **Commit ID**, **수정 내용**, and **검증 결과**.
  2. Ensure local-only paths (`.plan/`, `.agents/`, `.reference/`, `dist/`, `node_modules/`) remain gitignored.
  3. Commit with Korean detailed message (`docs: update README.md and detailed commit results`) and push to `origin`.
