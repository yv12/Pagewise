# Pagewise: instructions for the coding agent

Pagewise is a small web app that runs on Claude through MCP. Claude writes documents. The app saves, edits, signs, and serves them. There is no AI inside the app.

## Read in this order before any work
1. `docs/01-problem.md`
2. `docs/02-context.md`
3. `docs/03-architecture.md` (source of truth)
4. `docs/04-implementation-plan.md`
5. `docs/05-coding-rules.md`
6. `docs/06-test-checklist.md`
7. `docs/07-edge-cases.md` (read the matching section before each phase)

## Five hard rules
1. No AI SDKs, AI keys, or AI calls anywhere in the app.
2. Do not change the stack or architecture. Ask the user first.
3. Build one phase at a time, in order. Test before moving on.
4. Do not add features, libraries, or files that are not in the plan.
5. Keep code small, plain, and clean. Do not rewrite working code.

## When unsure
Stop and ask the user in plain words. Do not guess.

## Current phase
Phase 6: built (local tasks complete, awaiting remote GitHub push and Railway deploy)
