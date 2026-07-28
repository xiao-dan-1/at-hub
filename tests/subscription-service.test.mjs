import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionHandler, redactToken } from "../server/subscription-service.mjs";
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
