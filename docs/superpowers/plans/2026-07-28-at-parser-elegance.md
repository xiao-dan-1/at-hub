# AT Inspector Elegance Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep AT Inspector's approved V2 architecture while making real-data overview, permission, and inspector states visually controlled and safer to scan.

**Architecture:** Add small pure presentation helpers to the existing core/UI modules, then render grouped permission bands and semantic overview summaries through the existing DOM controller. Keep reveal timing in `src/ui/reveal.js`, but make the registry globally single-active so every caller inherits the privacy rule.

**Tech Stack:** Vanilla JavaScript ES modules, semantic HTML, CSS custom properties, Node test runner, Vite single-file build, in-app browser verification.

---

## File Map

- Modify `src/ui/reveal.js`: enforce a single active sensitive value.
- Modify `src/ui/app.js`: semantic summaries, compact remaining time, grouped permission rendering, tab concealment.
- Modify `src/core/permissions.js`: stable display-group metadata and less absolute low-risk wording.
- Modify `src/styles.css`: stabilize sensitive rows, permission bands, typography, inspector density, and page rhythm.
- Modify `tests/interactions.test.mjs`: prove reveal handoff conceals the previous value.
- Modify `tests/ui-v2.test.mjs`: prove semantic summaries and compact remaining time.
- Modify `tests/permissions-v2.test.mjs`: prove permission display groups and user-facing risk language.
- Rebuild root `index.html`: publish the verified single-file artifact.

### Task 1: Lock Presentation Behaviors With Failing Tests

- [ ] Add a reveal-registry test that calls `show("one")`, then `show("two")`, and expects `one` to be concealed before `two` is registered.
- [ ] Add UI helper tests expecting authentication arrays to render as `OTP、邮箱验证码`, audience arrays to render as `OpenAI API`, and day-only remaining time to omit `0 小时`.
- [ ] Add permission tests expecting each known scope to expose a stable `displayGroup` and the visible low-risk label to be `较低关注`.
- [ ] Run `npm test` and confirm the new assertions fail for missing behavior rather than syntax or fixture errors.

### Task 2: Implement The Minimal Behavior Layer

- [ ] Update `createRevealRegistry.show()` to call `clear()` before registering a new key.
- [ ] Export focused formatters from `src/ui/app.js` for overview list summaries and compact remaining time.
- [ ] Add permission presentation metadata without changing existing filter semantics or unknown-scope preservation.
- [ ] Clear reveal state inside `activateTab()` before changing the visible panel.
- [ ] Run `npm test` and confirm all behavior tests pass.

### Task 3: Render The Refined Result Views

- [ ] Render semantic authentication and audience summaries in overview while keeping raw values in the inspector.
- [ ] Render permissions as ordered open sections with a group heading, row count, nearby risk label, original scope, and description.
- [ ] Keep empty-filter behavior and the local-heuristic notice intact.
- [ ] Add CSS for a stable sensitive-value region, grouped permission bands, restrained semantic typography, reduced inspector border density, and compact footer rhythm.
- [ ] Run `npm test` again after the markup and CSS changes.

### Task 4: Publish And Verify

- [ ] Run `npm run build` and `npm run publish` to regenerate the offline root `index.html`.
- [ ] Open the published `file://` page in the in-app browser and parse a synthetic JWT with long sensitive values and all permission groups.
- [ ] Verify overview, permissions, and inspector at desktop width; confirm reveal handoff and tab concealment.
- [ ] Verify the same workflow at a mobile-sized viewport and confirm no horizontal overflow or clipped controls.
- [ ] Inspect fresh screenshots against the supplied V2 screenshots and record any intentional deviation.

