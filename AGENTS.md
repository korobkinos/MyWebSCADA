# MyWebSCADA agent instructions

## Project memory

- At the start of every project task, read `.codex/history.md` and the latest relevant records in `.codex/history.jsonl` before asking the user to repeat prior context.
- Use the stored project map as the initial source of repository context. Do not rescan the whole repository when the recorded baseline commit still matches `git rev-parse --short HEAD`; inspect only files relevant to the current task.
- When HEAD has advanced beyond the recorded baseline, inspect only the intervening commits and affected areas, then refresh the snapshot and baseline in both history files.
- Treat the current repository state, tests, and user instructions as authoritative when they conflict with history.
- After every meaningful completed task, append a concise Russian entry to both history files. Record the user goal, decisions, changed files, checks and results, remaining limitations, and the recommended next step.
- Keep every JSONL record on one line and preserve valid JSON. Use ISO 8601 timestamps with a timezone.
- Do not store secrets, credentials, private tokens, chain-of-thought, full logs, or large diffs. Do not add routine greetings or status-only messages.
- Update existing project-summary sections only when the architecture or standard commands materially change; append task results instead of rewriting prior journal entries.

## Repository basics

- This is a private pnpm monorepo with `apps/client`, `apps/server`, and `packages/shared`.
- Use focused changes and preserve unrelated work in the working tree.
- Standard checks are `pnpm typecheck`, `pnpm test`, and `pnpm build`; run the smallest relevant checks first and broaden them according to risk.
- Note that root `pnpm test` covers only `@web-scada/shared`; use `pnpm -r test` for the full client/server/shared suite.
- For UI work, inspect the closest existing Workbench screen first. Tag-related UI follows the TAGS window; driver-related UI follows the DRIVERS window. Reuse existing Workbench window, table, form, toolbar, and dark-theme patterns.
- Keep final reports short and in Russian: changed files, completed work, checks, typecheck/build result, remaining limitations, and the next recommended step.
