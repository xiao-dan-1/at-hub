# Subscription Batch Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extend `/subscription` from single AT lookup to graceful batch lookup while preserving the current one-card experience for one token.

**Architecture:** Reuse the existing token extraction and single-token subscription handler. Add a bounded batch handler on the local server that runs multiple token lookups with low concurrency and returns per-token results in input order. Update the subscription page to choose `/api/subscription` for one token and `/api/subscriptions/batch` for multiple tokens, then render a quiet summary plus one card per result.

**Tech Stack:** Node.js HTTP local server, Undici fetch/proxy path, vanilla browser JS, existing CSS visual system, Node test runner.

---

### Task 1: Backend batch API

**Files:**
- Modify: `server/subscription-service.mjs`
- Modify: `server/local-server.mjs`
- Test: `tests/subscription-service.test.mjs`

- [x] Write failing tests for `createSubscriptionBatchHandler`: preserves order, caps max count at 20, queries successful and failed tokens independently, never echoes raw AT in failed results.
- [x] Write failing local server test for `POST /api/subscriptions/batch` routing to the batch handler.
- [x] Implement `createSubscriptionBatchHandler` by reusing `createSubscriptionHandler` with concurrency 2 and per-item error isolation.
- [x] Add local server route for `/api/subscriptions/batch`.
- [x] Run targeted backend tests and confirm pass.

### Task 2: Frontend batch behavior

**Files:**
- Modify: `src/subscription.js`
- Modify: `src/subscription.html`
- Modify: `src/styles.css`
- Test: `tests/subscription-page.test.mjs`

- [x] Write failing tests that page copy mentions multiple ATs, JS calls `/api/subscriptions/batch`, renders batch summary, and keeps `/api/subscription` for single AT.
- [x] Implement query selection: one token uses single endpoint; more than one uses batch endpoint.
- [x] Add `renderSubscriptionBatchResult` using the existing card layout for successful items and compact error cards for failed items.
- [x] Adjust copy and styles for batch summary/list without making the single result visually heavier.
- [x] Run targeted frontend tests and confirm pass.

### Task 3: Docs and verification

**Files:**
- Modify: `README.md`
- Test: existing README and build tests

- [x] Document batch input: multiple lines / multiple session JSON snippets, max 20, no persistence.
- [x] Run `npm test`.
- [x] Run `docker compose config --quiet`.
- [x] Run `git diff --check`.
- [x] Commit and push to `master`.
