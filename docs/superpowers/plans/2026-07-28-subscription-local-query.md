# Local Subscription Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an elegant `/subscription` MVP that queries one ChatGPT AT through a local-only JS service, renders normalized subscription status, and keeps the existing offline `index.html` parser safe.

**Architecture:** Keep the current offline parser as the trusted zero-upload entry. Add a second Vite page, `subscription.html`, that only runs under the local service and calls `POST /api/subscription` on `127.0.0.1`. Add a dependency-free Node HTTP service that serves the built pages, proxies only the subscription query to ChatGPT web backend endpoints, normalizes the response, and never logs or persists the raw AT.

**Tech Stack:** Vite multi-page static build, vanilla JavaScript modules, Node.js built-in `http/fs/path/url` modules, existing Node test runner.

---

### File Structure

- Create `src/core/token-extract.js`: shared extraction for pure JWT strings and `api/auth/session` JSON containing `accessToken`.
- Create `src/core/subscription-model.js`: normalize JWT, accounts/check, and subscriptions responses into a stable `SubscriptionStatus` model.
- Create `src/subscription.html`: local-service-only subscription query page.
- Create `src/subscription.js`: browser controller for `/subscription`, local API fetch, rendering, copy/clear behavior.
- Create `server/subscription-service.mjs`: upstream ChatGPT web queries, error mapping, response normalization.
- Create `server/local-server.mjs`: local static server plus `POST /api/subscription`.
- Modify `vite.config.js`: build `index.html` and `subscription.html`.
- Modify `package.json`: add `start` and local service scripts.
- Modify `scripts/publish-singlefile.mjs`: keep publishing only root offline `index.html`.
- Modify `README.md`: document offline mode versus local-service subscription mode.
- Add tests:
  - `tests/token-extract.test.mjs`
  - `tests/subscription-model.test.mjs`
  - `tests/subscription-service.test.mjs`
  - `tests/subscription-page.test.mjs`
  - update `tests/build-v2.test.mjs` and `tests/readme.test.mjs`

### Task 1: Token extraction shared unit

**Files:**
- Create: `src/core/token-extract.js`
- Test: `tests/token-extract.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { extractAccessTokens } from "../src/core/token-extract.js";
import { makeJwt } from "./helpers/make-jwt.mjs";

test("extractAccessTokens accepts pure JWT, Bearer JWT, and session JSON", () => {
  const first = makeJwt({ alg: "RS256" }, { email: "first@example.test" });
  const second = makeJwt({ alg: "RS256" }, { email: "second@example.test" });

  const result = extractAccessTokens([
    `Bearer ${first}`,
    JSON.stringify({ accessToken: second }),
    first,
  ].join("\n"));

  assert.deepEqual(result.tokens, [first, second]);
  assert.deepEqual(result.sources, ["jwt", "json"]);
});

test("extractAccessTokens reports a safe empty result without echoing input", () => {
  const result = extractAccessTokens("not a token");

  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.sources, []);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/token-extract.test.mjs`

Expected: FAIL because `src/core/token-extract.js` does not exist.

- [ ] **Step 3: Implement minimal extraction**

Create `extractAccessTokens(input)` that:
- scans balanced JSON objects and recursively finds `accessToken`, `access_token`, or `token`;
- matches `Bearer <jwt>` and raw three-segment JWT values;
- de-duplicates tokens;
- returns `{ tokens, sources }`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/token-extract.test.mjs`

Expected: all tests pass.

### Task 2: Subscription normalization model

**Files:**
- Create: `src/core/subscription-model.js`
- Test: `tests/subscription-model.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSubscriptionStatus } from "../src/core/subscription-model.js";
import { makeJwt } from "./helpers/make-jwt.mjs";

const token = makeJwt(
  { alg: "RS256" },
  {
    exp: Math.floor(Date.UTC(2033, 4, 27) / 1000),
    "https://api.openai.com/profile": { email: "plan@example.test" },
    "https://api.openai.com/auth": { chatgpt_plan_type: "free" },
  },
);

test("normalizeSubscriptionStatus prefers realtime subscription fields over JWT claims", () => {
  const model = normalizeSubscriptionStatus({
    token,
    accountsResponse: {
      accounts: {
        default: {
          account: {
            account_id: "acc_123",
            plan_type: "plus",
            has_previously_paid_subscription: true,
          },
          entitlement: {
            has_active_subscription: true,
            subscription_plan: "chatgptplusplan",
            expires_at: "2033-05-27T00:00:00Z",
            billing_period: "monthly",
            billing_currency: "USD",
          },
          last_active_subscription: {
            will_renew: true,
            purchase_origin_platform: "chatgpt_web",
          },
        },
      },
    },
    subscriptionResponse: {
      plan_type: "plus",
      id: "sub_123",
      active_start: "2033-04-27T00:00:00Z",
      active_until: "2033-05-27T00:00:00Z",
      is_processor_stripe: true,
      applied_discounts: [{ promo_campaign_id: "promo_a", amount: 100 }],
      eligible_offers: ["chatgptplusplan"],
    },
    nowMilliseconds: Date.UTC(2033, 4, 17),
  });

  assert.equal(model.ok, true);
  assert.equal(model.email, "plan@example.test");
  assert.equal(model.plan_type, "plus");
  assert.equal(model.plan_type_jwt, "free");
  assert.equal(model.account_id, "acc_123");
  assert.equal(model.subscription_plan, "chatgptplusplan");
  assert.equal(model.has_active_subscription, true);
  assert.equal(model.will_renew, true);
  assert.equal(model.purchase_origin_platform, "chatgpt_web");
  assert.equal(model.days_left, 10);
  assert.equal(model.applied_discounts.length, 1);
  assert.equal(model.eligible_offers.length, 1);
  assert.ok(model.raw.accounts);
  assert.ok(model.raw.subscription);
  assert.doesNotMatch(JSON.stringify(model), /Bearer/u);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/subscription-model.test.mjs`

Expected: FAIL because `src/core/subscription-model.js` does not exist.

- [ ] **Step 3: Implement normalization**

Create helpers to select the default account, derive plan, derive active state, compute remaining days/hours, and include `raw.accounts` / `raw.subscription` without adding token text.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/subscription-model.test.mjs`

Expected: all tests pass.

### Task 3: Local subscription API service

**Files:**
- Create: `server/subscription-service.mjs`
- Create: `server/local-server.mjs`
- Test: `tests/subscription-service.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionHandler, redactToken } from "../server/subscription-service.mjs";
import { makeJwt } from "./helpers/make-jwt.mjs";

test("redactToken never exposes the full token", () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "auth0|safe" });
  const redacted = redactToken(token);

  assert.notEqual(redacted, token);
  assert.match(redacted, /^eyJ/);
  assert.match(redacted, /…/u);
});

test("createSubscriptionHandler calls accounts/check then subscriptions without logging AT", async () => {
  const token = makeJwt({ alg: "RS256" }, { exp: Math.floor(Date.UTC(2033, 4, 27) / 1000) });
  const calls = [];
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), authorization: init.headers.authorization });
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_123", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
              last_active_subscription: { will_renew: false, purchase_origin_platform: "chatgpt_not_purchased" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ eligible_offers: ["chatgptplusplan"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.account_id, "acc_123");
  assert.equal(result.subscription_plan, "chatgptfreeplan");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.authorization === `Bearer ${token}`));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/subscription-service.test.mjs`

Expected: FAIL because service files do not exist.

- [ ] **Step 3: Implement local service**

Implement:
- `redactToken(token)`;
- `createSubscriptionHandler({ fetchFn, nowMilliseconds, origin })`;
- `queryJson(url, token, fetchFn)`;
- `startLocalServer({ port })` in `server/local-server.mjs`;
- `POST /api/subscription` only accepts JSON `{ token }`;
- body limit is 64 KiB;
- raw token is never printed.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/subscription-service.test.mjs`

Expected: all tests pass.

### Task 4: `/subscription` page

**Files:**
- Create: `src/subscription.html`
- Create: `src/subscription.js`
- Modify: `src/styles.css`
- Test: `tests/subscription-page.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/subscription.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../src/subscription.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("subscription page declares local-service network boundary", () => {
  assert.match(html, /ChatGPT 订阅查询/u);
  assert.match(html, /本地服务/u);
  assert.match(html, /会联网查询/u);
  assert.match(html, /connect-src 'self'/u);
  assert.match(html, /id="subscriptionInput"/u);
  assert.match(html, /id="subscriptionRunButton"/u);
});

test("subscription controller calls only the local subscription endpoint", () => {
  assert.match(js, /fetch\("\/api\/subscription"/u);
  assert.doesNotMatch(js, /chatgpt\.com|chat\.openai\.com/u);
  assert.match(js, /extractAccessTokens/u);
  assert.match(js, /renderSubscriptionResult/u);
});

test("subscription page has compact result cards matching current visual system", () => {
  assert.match(css, /\.subscription-card\s*\{/u);
  assert.match(css, /\.subscription-grid\s*\{/u);
  assert.match(css, /\.subscription-status-pill/u);
  assert.match(css, /\.network-boundary/u);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/subscription-page.test.mjs`

Expected: FAIL because page files/classes do not exist.

- [ ] **Step 3: Implement page**

Create the page using the existing brand/header visual system. Keep it one column, quiet, and focused: input panel, network boundary note, result card, raw JSON disclosure. Do not add marketing sections.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/subscription-page.test.mjs`

Expected: all tests pass.

### Task 5: Build, scripts, docs, browser verification

**Files:**
- Modify: `vite.config.js`
- Modify: `package.json`
- Modify: `scripts/publish-singlefile.mjs`
- Modify: `README.md`
- Modify tests as needed.

- [ ] **Step 1: Write failing build/docs tests**

Update tests to assert:
- `dist/subscription.html` exists after build;
- root `dist/index.html` remains offline and has no network APIs;
- `dist/subscription.html` allows local `connect-src 'self'`;
- README documents `npm start`, `/subscription`, and that subscription query sends AT only to local service and then ChatGPT.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/build-v2.test.mjs tests/readme.test.mjs`

Expected: FAIL because build config/docs do not yet include subscription mode.

- [ ] **Step 3: Implement build/scripts/docs**

Set Vite `rollupOptions.input` to both pages, add `npm start`, keep release publishing root `index.html` only, and update README.

- [ ] **Step 4: Verify GREEN**

Run:
- `npm run build`
- `node --test tests/build-v2.test.mjs tests/readme.test.mjs`

Expected: both pass.

- [ ] **Step 5: Full verification**

Run:
- `npm test`
- local server browser smoke check at `/subscription` with a mocked/fake API path where possible, or at minimum verify the page loads and handles local API error elegantly without exposing the fake token.
- `git diff --check`

- [ ] **Step 6: Commit**

Run:
- `git add .`
- `git commit -m "feat: add local subscription query"`

### Self-Review

- Spec coverage: plan covers local service, `/subscription` page, single AT only, zero persistence, no raw AT logging, build integration, docs, tests, and browser verification.
- Placeholder scan: no `TBD`, `TODO`, or unspecified "handle later" tasks remain.
- Type consistency: `SubscriptionStatus`, `extractAccessTokens`, `createSubscriptionHandler`, `/api/subscription`, and page element IDs are used consistently across tasks.
- Scope check: batch subscription, remote hosted service, auth tokens for a public API, billing pages, and checkout generation are intentionally out of scope for this MVP.
