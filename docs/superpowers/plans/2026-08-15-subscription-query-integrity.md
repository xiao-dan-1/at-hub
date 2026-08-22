# Subscription Query Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/subscription` return or visibly account for every recognized AT without silently accepting truncated tokens, incomplete streams, or partial subscription details.

**Architecture:** Keep upstream querying in `server/subscription-service.mjs`, move stream-completeness and retryable-result decisions into small pure helpers under `src/core`, and let `src/subscription.js` orchestrate rendering and cancellation. Preserve the existing SSE protocol while enforcing a client-side completeness invariant.

**Tech Stack:** Node.js 24, browser Fetch/ReadableStream, Server-Sent Events, Vite, Node test runner.

---

### Task 1: Preserve complete Base64URL JWTs and report input statistics

**Files:**
- Modify: `src/core/token-extract.js`
- Test: `tests/token-extract.test.mjs`

- [x] **Step 1: Write failing tests** for a plain JWT whose signature ends in `-`, repeated AT lines, and an unrecognized non-empty line. Assert exact token equality and `{ input_line_count, duplicate_count, unrecognized_line_count }`.
- [x] **Step 2: Run** `node --test tests/token-extract.test.mjs` and confirm failure from token truncation and missing metadata.
- [x] **Step 3: Replace** `\b` boundaries with `(?<![A-Za-z0-9_-])` and `(?![A-Za-z0-9_-])`; track recognized source ranges per line and count duplicates/unrecognized lines without retaining sensitive line contents.
- [x] **Step 4: Re-run** `node --test tests/token-extract.test.mjs` and confirm all extractor tests pass.

### Task 2: Add pure batch-integrity helpers

**Files:**
- Create: `src/core/subscription-batch.js`
- Test: `tests/subscription-batch.test.mjs`

- [x] **Step 1: Write failing tests** for `isSubscriptionResultComplete`, `missingSubscriptionIndexes`, and `subscriptionResultNeedsRetry` covering early EOF, mismatched `done.count`, missing indexes, hard failures, and `offers_status: "unknown"`.
- [x] **Step 2: Run** `node --test tests/subscription-batch.test.mjs` and confirm module-not-found failure.
- [x] **Step 3: Implement** the three pure helpers plus `createIncompleteSubscriptionResult(index, tokenHint)` returning a redacted `stream-incomplete` failure row.
- [x] **Step 4: Re-run** the new test file and confirm it passes.

### Task 3: Enforce stream completeness and retry missing items once

**Files:**
- Modify: `src/subscription.js`
- Test: `tests/subscription-page.test.mjs`
- Test: `tests/subscription-batch.test.mjs`

- [x] **Step 1: Add failing source-contract tests** requiring `AbortController`, active request IDs, `receivedDone`, missing-index detection, and one missing-item retry.
- [x] **Step 2: Run** `node --test tests/subscription-page.test.mjs tests/subscription-batch.test.mjs` and confirm the new assertions fail.
- [x] **Step 3: Update** `streamBatchSubscriptions(tokens, signal)` and `runSubscriptionBatchStream` to track `receivedDone`, expected count, and indexes; retry missing tokens once with an index map; synthesize explicit rows for any remaining gaps.
- [x] **Step 4: Guard** all rendering with the active request ID; starting a new query or clearing aborts the previous request.
- [x] **Step 5: Keep** textarea content unchanged and render extractor statistics rather than replacing it with normalized tokens.
- [x] **Step 6: Re-run** the focused page and helper tests.

### Task 4: Count and retry partial subscription details

**Files:**
- Modify: `src/subscription.js`
- Test: `tests/subscription-page.test.mjs`
- Test: `tests/subscription-batch.test.mjs`

- [x] **Step 1: Add failing tests** proving `ok: true` with `subscription_detail_status: "failed"` or `offers_status: "unknown"` is retryable and not counted as fully successful.
- [x] **Step 2: Run** the focused tests and confirm failure.
- [x] **Step 3: Use** `subscriptionResultNeedsRetry` in summary counts and retry collection; rename the button copy to “重试未完成项”.
- [x] **Step 4: Re-run** focused tests and confirm success.

### Task 5: Full verification

**Files:**
- Verify: all modified files and generated artifacts

- [x] **Step 1: Run** `npm test`; expect all tests to pass with zero failures.
- [x] **Step 2: Run** a deterministic extractor fuzz check and assert every generated token is returned byte-for-byte.
- [x] **Step 3: Run** `npm run release` and verify generated `index.html`, `subscription.html`, and `live.html` are current.
- [x] **Step 4: Inspect** `git diff --check` and `git status --short` for clean formatting and expected files only.
