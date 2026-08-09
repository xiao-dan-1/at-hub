import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionBatchHandler, createSubscriptionHandler, redactToken } from "../server/subscription-service.mjs";
import { makeJwt } from "./helpers/make-jwt.mjs";

test("redactToken never exposes the full token", () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "auth0|safe" });
  const redacted = redactToken(token);

  assert.notEqual(redacted, token);
  assert.match(redacted, /^eyJ/u);
  assert.match(redacted, /…/u);
});

test("createSubscriptionHandler calls accounts/check then subscriptions without logging AT", async () => {
  const token = makeJwt({ alg: "RS256" }, { exp: Math.floor(Date.UTC(2033, 4, 27) / 1000) });
  const calls = [];
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
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
  assert.equal(result.status, 200);
  assert.equal(result.account_id, "acc_123");
  assert.equal(result.subscription_plan, "chatgptfreeplan");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.headers.authorization === `Bearer ${token}`));
  assert.ok(calls.every(call => /Mozilla\/5\.0/u.test(call.headers["user-agent"])));
  assert.ok(calls.every(call => call.headers.origin === "https://chatgpt.com"));
  assert.ok(calls.every(call => call.headers.referer === "https://chatgpt.com/"));
  assert.ok(calls.every(call => call.headers["accept-language"]));
  assert.ok(calls.every(call => !("cookie" in call.headers)));
  assert.ok(calls.every(call => !call.url.includes("timezone_offset_min")));
});

test("createSubscriptionHandler maps upstream failures without returning the AT", async () => {
  const token = makeJwt({ alg: "RS256" }, { exp: Math.floor(Date.UTC(2033, 4, 27) / 1000) });
  const handler = createSubscriptionHandler({
    fetchFn: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-auth-failed");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token, "u"));
});

test("createSubscriptionHandler treats missing subscription detail as a free account result", async () => {
  const token = makeJwt(
    { alg: "RS256" },
    {
      exp: Math.floor(Date.UTC(2033, 4, 27) / 1000),
      "https://api.openai.com/profile": { email: "free@example.test" },
    },
  );
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async url => {
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_free", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
              last_active_subscription: { will_renew: false, purchase_origin_platform: "chatgpt_not_purchased" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ detail: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.email, "free@example.test");
  assert.equal(result.account_id, "acc_free");
  assert.equal(result.plan_type, "free");
  assert.equal(result.subscription_plan, "chatgptfreeplan");
  assert.equal(result.has_active_subscription, false);
  assert.equal(result.subscription_lookup_status, 404);
});

test("createSubscriptionHandler identifies Cloudflare challenge responses separately", async () => {
  const token = makeJwt({ alg: "RS256" }, { exp: Math.floor(Date.UTC(2033, 4, 27) / 1000) });
  const handler = createSubscriptionHandler({
    fetchFn: async () => new Response("<html>challenge</html>", {
      status: 403,
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cf-mitigated": "challenge",
      },
    }),
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-cloudflare-challenge");
  assert.equal(result.status, 403);
});

test("createSubscriptionBatchHandler preserves order and isolates item failures", async () => {
  const first = makeJwt({ alg: "RS256" }, { "https://api.openai.com/profile": { email: "first@example.test" } });
  const broken = makeJwt({ alg: "RS256" }, { "https://api.openai.com/profile": { email: "broken@example.test" } });
  const third = makeJwt({ alg: "RS256" }, { "https://api.openai.com/profile": { email: "third@example.test" } });
  const accountIds = new Map([
    [first, "acc_first"],
    [third, "acc_third"],
  ]);
  const handler = createSubscriptionBatchHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async (_url, init) => {
      const token = init.headers.authorization.replace(/^Bearer /u, "");
      if (token === broken) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
      const accountId = accountIds.get(token);
      if (String(_url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: accountId, plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
              last_active_subscription: { will_renew: false, purchase_origin_platform: "chatgpt_not_purchased" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ eligible_offers: ["chatgptplusplan"] }), { status: 200 });
    },
  });

  const result = await handler({ tokens: [first, broken, third] });

  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(result.success_count, 2);
  assert.equal(result.failure_count, 1);
  assert.deepEqual(result.results.map(item => item.index), [1, 2, 3]);
  assert.equal(result.results[0].account_id, "acc_first");
  assert.equal(result.results[1].ok, false);
  assert.equal(result.results[1].reason, "upstream-auth-failed");
  assert.equal(result.results[2].account_id, "acc_third");
  assert.doesNotMatch(JSON.stringify(result.results[1]), new RegExp(broken, "u"));
});

test("createSubscriptionBatchHandler rejects batches above the configured limit without querying", async () => {
  let calls = 0;
  const handler = createSubscriptionBatchHandler({
    batchLimit: 2,
    fetchFn: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const tokens = [
    makeJwt({ alg: "RS256" }, { sub: "one" }),
    makeJwt({ alg: "RS256" }, { sub: "two" }),
    makeJwt({ alg: "RS256" }, { sub: "three" }),
  ];

  const result = await handler({ tokens });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "batch-too-large");
  assert.equal(result.status, 400);
  assert.equal(result.max, 2);
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(tokens[0], "u"));
});

test("createSubscriptionBatchHandler limits concurrent token workers", async () => {
  const tokens = Array.from({ length: 5 }, (_, index) => makeJwt({ alg: "RS256" }, { sub: `user-${index}` }));
  let active = 0;
  let maxActive = 0;
  const handler = createSubscriptionBatchHandler({
    concurrency: 2,
    fetchFn: async (_url, init) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      const token = init.headers.authorization.replace(/^Bearer /u, "");
      const accountId = tokens.indexOf(token);
      if (String(_url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: `acc_${accountId}`, plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  });

  const result = await handler({ tokens });

  assert.equal(result.ok, true);
  assert.equal(result.count, 5);
  assert.equal(maxActive, 2);
});
