import test from "node:test";
import assert from "node:assert/strict";
import { createIpInfoHandler, createSubscriptionBatchHandler, createSubscriptionHandler, queryJson, redactToken } from "../server/subscription-service.mjs";
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
      if (String(url).includes("/cdn-cgi/trace")) {
        return new Response("ip=78.180.242.194\nloc=TR\n", { status: 200 });
      }
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
  assert.equal(result.egress_ip, "78.180.242.194");
  assert.equal(result.egress_country, "TR");
  const upstreamCalls = calls.filter(call => call.url.includes("chatgpt.com/backend-api/"));
  assert.equal(upstreamCalls.length, 2);
  assert.equal(calls.filter(call => call.url.includes("/cdn-cgi/trace")).length, 1);
  assert.ok(upstreamCalls.every(call => call.headers.authorization === `Bearer ${token}`));
  assert.ok(upstreamCalls.every(call => /Mozilla\/5\.0/u.test(call.headers["user-agent"])));
  assert.ok(upstreamCalls.every(call => call.headers.origin === "https://chatgpt.com"));
  assert.ok(upstreamCalls.every(call => call.headers.referer === "https://chatgpt.com/"));
  assert.ok(upstreamCalls.every(call => call.headers["accept-language"]));
  assert.ok(upstreamCalls.every(call => !("cookie" in call.headers)));
  assert.ok(upstreamCalls.every(call => !call.url.includes("timezone_offset_min")));
});

test("createSubscriptionHandler reports accounts, subscription, and total timing", async () => {
  const token = makeJwt({ alg: "RS256" }, { exp: Math.floor(Date.UTC(2033, 4, 27) / 1000) });
  const ticks = [0, 120, 150, 530, 560];
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    timingNow: () => ticks.shift() ?? 560,
    fetchFn: async url => {
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_timed", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ eligible_offers: ["chatgptplusplan"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.accounts_ms, 120);
  assert.equal(result.subscription_ms, 380);
  assert.equal(result.total_ms, 560);
});

test("createSubscriptionHandler reuses one rotate proxy session for both upstream calls of an AT", async () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "session-one" });
  const calls = [];
  const handler = createSubscriptionHandler({
    proxySessionIdFactory: () => "perAtSession42",
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), proxySessionId: init.proxySessionId });
      if (String(url).includes("/cdn-cgi/trace")) {
        return new Response("ip=203.0.113.15\nloc=JP\n", { status: 200 });
      }
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_session", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ eligible_offers: ["chatgptplusplan"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.egress_ip, "203.0.113.15");
  assert.equal(result.egress_country, "JP");
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.proxySessionId === "perAtSession42"));
});

test("createSubscriptionHandler retries transient account lookup once with a fresh proxy session", async () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "retry-account" });
  const sessions = ["firstSid", "retrySid"];
  const calls = [];
  const handler = createSubscriptionHandler({
    proxySessionIdFactory: () => sessions.shift(),
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), proxySessionId: init.proxySessionId });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
      }
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_retry", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ eligible_offers: ["chatgptplusplan"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.account_id, "acc_retry");
  assert.equal(result.retry_count, 1);
  assert.equal(result.accounts_attempts, 2);
  assert.equal(result.subscription_attempts, 1);
  assert.deepEqual(calls.map(call => call.proxySessionId), ["firstSid", "retrySid", "retrySid", "retrySid"]);
});

test("createSubscriptionHandler does not retry auth failures", async () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "auth-no-retry" });
  const calls = [];
  const handler = createSubscriptionHandler({
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), proxySessionId: init.proxySessionId });
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-auth-failed");
  assert.equal(result.accounts_attempts, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(calls.length, 2);
});

test("createSubscriptionHandler keeps local JWT identity and diagnosis on upstream 401", async () => {
  const token = makeJwt(
    { alg: "RS256" },
    {
      exp: Math.floor(Date.UTC(2033, 4, 27) / 1000),
      "https://api.openai.com/profile": { email: "diagnose@example.test" },
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "plus",
        chatgpt_account_id: "acc_jwt_only",
        chatgpt_user_id: "user_jwt_only",
      },
    },
  );
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-auth-failed");
  assert.equal(result.status, 401);
  assert.equal(result.email, "diagnose@example.test");
  assert.equal(result.plan_type_jwt, "plus");
  assert.equal(result.plan_type, "plus");
  assert.equal(result.account_id, "acc_jwt_only");
  assert.equal(result.user_id, "user_jwt_only");
  assert.equal(result.local_token_status, "within_window");
  assert.equal(result.auth_failure_kind, "server_rejected_token");
  assert.match(result.auth_failure_hint, /上游拒绝/u);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token, "u"));
});

test("createSubscriptionHandler classifies token_invalidated separately from account disabled", async () => {
  const token = makeJwt(
    { alg: "RS256" },
    {
      exp: Math.floor(Date.UTC(2033, 4, 27) / 1000),
      "https://api.openai.com/profile": { email: "invalidated@example.test" },
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "free",
        chatgpt_account_id: "acc_invalidated",
      },
    },
  );
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async () => new Response(JSON.stringify({
      error: {
        code: "token_invalidated",
        message: "Your authentication token has been invalidated. Please try signing in again.",
      },
    }), { status: 401, headers: { "content-type": "application/json" } }),
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-auth-failed");
  assert.equal(result.status, 401);
  assert.equal(result.email, "invalidated@example.test");
  assert.equal(result.account_id, "acc_invalidated");
  assert.equal(result.local_token_status, "within_window");
  assert.equal(result.upstream_error_code, "token_invalidated");
  assert.equal(result.upstream_error_body_excerpt, undefined);
  assert.deepEqual(result.upstream_error_body, {
    error: {
      code: "token_invalidated",
      message: "Your authentication token has been invalidated. Please try signing in again.",
    },
  });
  assert.equal(result.auth_failure_kind, "token_invalidated");
  assert.match(result.auth_failure_hint, /服务端已作废|重新登录/u);
});

test("createSubscriptionHandler surfaces accounts check 401 body as account disabled diagnosis", async () => {
  const token = makeJwt(
    { alg: "RS256" },
    {
      exp: Math.floor(Date.UTC(2033, 4, 27) / 1000),
      "https://api.openai.com/profile": { email: "disabled@example.test" },
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "free",
        chatgpt_account_id: "acc_disabled",
      },
    },
  );
  const calls = [];
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async (url, init) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        error: {
          code: "account_deactivated",
          message: `Account has been deactivated for token ${token}`,
        },
      }), { status: 401, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-auth-failed");
  assert.equal(result.status, 401);
  assert.equal(result.email, "disabled@example.test");
  assert.equal(result.account_id, "acc_disabled");
  assert.equal(result.auth_failure_kind, "account_disabled");
  assert.match(result.auth_failure_hint, /账号.*停用|封禁/u);
  assert.equal(result.upstream_error_code, "account_deactivated");
  assert.match(result.upstream_error_message, /Account has been deactivated/u);
  assert.equal(result.upstream_path, "/backend-api/accounts/check/v4-2023-04-27");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token, "u"));
  assert.equal(calls.length, 2);
});

test("createSubscriptionHandler diagnoses expired local JWT when upstream returns 401", async () => {
  const token = makeJwt(
    { alg: "RS256" },
    {
      exp: Math.floor(Date.UTC(2033, 4, 7) / 1000),
      "https://api.openai.com/profile": { email: "expired@example.test" },
    },
  );
  const handler = createSubscriptionHandler({
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  });

  const result = await handler({ token });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "upstream-auth-failed");
  assert.equal(result.email, "expired@example.test");
  assert.equal(result.local_token_status, "expired");
  assert.equal(result.auth_failure_kind, "jwt_expired");
  assert.match(result.auth_failure_hint, /JWT 声明已过期/u);
});

test("createSubscriptionHandler keeps account success when subscription details fail after retry", async () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "partial-subscription" });
  const calls = [];
  const handler = createSubscriptionHandler({
    fetchFn: async url => {
      calls.push(String(url));
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_partial", plan_type: "free" },
              entitlement: {
                has_active_subscription: false,
                subscription_plan: "chatgptfreeplan",
              },
              eligible_offers: ["account-fallback-offer"],
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "gateway" }), { status: 502 });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.account_id, "acc_partial");
  assert.equal(result.subscription_detail_status, "failed");
  assert.equal(result.subscription_detail_reason, "upstream-http-error");
  assert.equal(result.offers_status, "unknown");
  assert.equal(result.subscription_attempts, 2);
  assert.equal(result.retry_count, 1);
  assert.deepEqual(result.eligible_offers, ["account-fallback-offer"]);
  assert.equal(calls.length, 4);
});

test("createSubscriptionHandler retries Cloudflare challenge subscription details once", async () => {
  const token = makeJwt({ alg: "RS256" }, { sub: "cf-retry" });
  let subscriptionCalls = 0;
  const handler = createSubscriptionHandler({
    fetchFn: async url => {
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_cf", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      subscriptionCalls += 1;
      if (subscriptionCalls === 1) {
        return new Response("<html>challenge</html>", { status: 403, headers: { "cf-mitigated": "challenge" } });
      }
      return new Response(JSON.stringify({ eligible_offers: ["chatgptplusplan"] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token });

  assert.equal(result.ok, true);
  assert.equal(result.subscription_detail_status, "ok");
  assert.equal(result.subscription_attempts, 2);
  assert.equal(result.retry_count, 1);
  assert.deepEqual(result.eligible_offers, ["chatgptplusplan"]);
});

test("createIpInfoHandler queries a lightweight current IP endpoint", async () => {
  const calls = [];
  const handler = createIpInfoHandler({
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("ip=78.180.242.194\nloc=TR\n", { status: 200, headers: { "content-type": "text/plain" } });
    },
  });

  const result = await handler();

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.ip, "78.180.242.194");
  assert.equal(result.country, "TR");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.cloudflare.com/cdn-cgi/trace");
  assert.ok(calls[0].init.signal);
  assert.equal(calls[0].init.headers.accept, "text/plain, application/json;q=0.8");
});

test("createIpInfoHandler surfaces a proxy configuration hint when fetch cannot reach ipinfo", async () => {
  const handler = createIpInfoHandler({
    proxyUrl: "socks5://proxy-user-region-TR-sid-demo-t-5:proxy-password@proxy.example.com:3000",
    fetchFn: async () => { throw new TypeError("fetch failed"); },
  });

  const result = await handler();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "proxy-not-configured");
  assert.match(result.message, /真实代理/u);
  assert.match(result.message, /AT_INSPECTOR_PROXY/u);
});


test("createIpInfoHandler aborts slow IP lookups quickly", async () => {
  const handler = createIpInfoHandler({
    ipInfoTimeoutMilliseconds: 5,
    fetchFn: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }),
  });

  const result = await handler();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "ip-info-timeout");
  assert.equal(result.status, 504);
  assert.match(result.message, /超时/u);
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
  assert.equal(result.results[1].email, "broken@example.test");
  assert.equal(result.results[1].local_token_status, "missing_time");
  assert.equal(result.results[1].auth_failure_kind, "server_rejected_token");
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

test("createSubscriptionBatchHandler does not impose a default twenty-token cap", async () => {
  const tokens = Array.from({ length: 25 }, (_, index) => makeJwt({ alg: "RS256" }, { sub: `uncapped-${index}` }));
  const handler = createSubscriptionBatchHandler({
    fetchFn: async url => {
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_uncapped", plan_type: "free" },
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
  assert.equal(result.count, 25);
  assert.equal(result.failure_count, 0);
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


test("createSubscriptionBatchHandler uses a faster default concurrency", async () => {
  const tokens = Array.from({ length: 12 }, (_, index) => makeJwt({ alg: "RS256" }, { sub: `default-fast-${index}` }));
  let active = 0;
  let peak = 0;
  const handler = createSubscriptionBatchHandler({
    fetchFn: async (_url, init) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 8));
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

  await handler({ tokens });

  assert.equal(peak, 10);
});

test("createSubscriptionBatchHandler caps subscription concurrency at twenty", async () => {
  const tokens = Array.from({ length: 20 }, (_, index) => makeJwt({ alg: "RS256" }, { sub: `cap-${index}` }));
  let active = 0;
  let peak = 0;
  const handler = createSubscriptionBatchHandler({
    concurrency: 99,
    fetchFn: async (_url, init) => {
      active += 1;
      peak = Math.max(peak, active);
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

  await handler({ tokens });

  assert.equal(peak, 20);
});

test("createSubscriptionBatchHandler gives each AT its own rotate proxy session", async () => {
  const tokens = [
    makeJwt({ alg: "RS256" }, { sub: "first-session" }),
    makeJwt({ alg: "RS256" }, { sub: "second-session" }),
  ];
  const sessions = ["sidForFirst", "sidForSecond"];
  const calls = [];
  const handler = createSubscriptionBatchHandler({
    concurrency: 1,
    proxySessionIdFactory: () => sessions.shift(),
    fetchFn: async (url, init) => {
      const token = init.headers.authorization.replace(/^Bearer /u, "");
      calls.push({ token, proxySessionId: init.proxySessionId, endpoint: String(url).includes("/accounts/check/") ? "accounts" : "subscription" });
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: token === tokens[0] ? "acc_first" : "acc_second", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  });

  await handler({ tokens });

  assert.deepEqual(calls.map(call => call.proxySessionId), ["sidForFirst", "sidForFirst", "sidForSecond", "sidForSecond"]);
  assert.deepEqual(calls.map(call => call.endpoint), ["accounts", "subscription", "accounts", "subscription"]);
});

test("queryJson aborts slow upstream requests with a timeout status", async () => {
  await assert.rejects(
    () => queryJson(new URL("https://chatgpt.com/backend-api/me"), "token", (_url, init) => {
      assert.ok(init.signal);
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }, { timeoutMilliseconds: 5 }),
    error => {
      assert.equal(error.code, "upstream-timeout");
      assert.equal(error.status, 504);
      assert.match(error.message, /超时/u);
      return true;
    },
  );
});
