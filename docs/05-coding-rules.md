# 05. Coding Rules

Follow these on every change.

## Hard rules
1. No AI inside the app. No AI SDKs, no AI keys, no calls to any AI service.
2. Do not change the stack or architecture. If something seems wrong, stop and ask the user.
3. Build one phase at a time, in the order of `04-implementation-plan.md`.
4. Do not add features, libraries, or files that are not in the plan.
5. Do not rewrite code that already works. Make the smallest change that fixes the problem.

## Code style
- Plain JavaScript with ES modules. No TypeScript, no framework, no build step.
- Small files, under about 250 lines. Small functions with one job.
- Clear names. `createDocument`, not `doStuff`.
- Short comments only where the reason is not obvious.
- No unused code, no dead files, no leftover console logs (except one startup line).
- Use `const` by default. Use async and await, not nested callbacks.

## Server rules
- Validate every input with zod (MCP) or manual checks (REST).
- Use prepared SQL statements only.
- Clean all HTML with `clean.js` before saving.
- Return clear error messages in plain words. MCP tool errors must tell Claude what to do next.
- Never log workspace keys or document content.
- Do not store secrets in the repo.

## Frontend rules
- One small script per page.
- No inline event handlers in HTML. Attach events in the script.
- Handle loading, empty, and error states on every page. The user must never see a blank screen.
- Works on a phone screen (signature drawing especially).
- Use plain, short text on buttons and messages. No jargon.

## Git rules
- Small commits, one per task, with a clear message.
- Do not commit `node_modules`, `data/`, or `.env`.

## When unsure
Stop and ask the user. Do not guess the architecture. Do not invent new tools, tables, or routes.

## Before saying a phase is done
- Run the "Done when" checks for that phase.
- Run the matching section of `06-test-checklist.md`.
- Tell the user what works and what does not, in plain words.
