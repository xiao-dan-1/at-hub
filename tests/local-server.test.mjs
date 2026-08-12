import test from "node:test";
import assert from "node:assert/strict";
import { parseCliOptions, startLocalServer } from "../server/local-server.mjs";
import { makeJwt } from "./helpers/make-jwt.mjs";

test("parseCliOptions honors explicit host and port arguments", () => {
  const options = parseCliOptions([
    "node",
    "server/local-server.mjs",
    "--host",
    "0.0.0.0",
    "--port",
    "5183",
    "--proxy",
    "http://127.0.0.1:7890",
  ]);

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 5183);
  assert.equal(options.proxy, "http://127.0.0.1:7890");
});

test("parseCliOptions keeps safe local defaults", () => {
  const options = parseCliOptions(["node", "server/local-server.mjs"]);

  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 5173);
  assert.equal(options.proxy, "");
  assert.equal(options.proxyMode, "fixed");
});

test("parseCliOptions only reads the explicit AT inspector proxy env", () => {
  const options = parseCliOptions(["node", "server/local-server.mjs"], {
    AT_INSPECTOR_PROXY: "",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    HTTP_PROXY: "http://127.0.0.1:7891",
  });

  assert.equal(options.proxy, "");
});

test("parseCliOptions uses AT_INSPECTOR_PROXY when provided", () => {
  const options = parseCliOptions(["node", "server/local-server.mjs"], {
    AT_INSPECTOR_PROXY: "http://127.0.0.1:7890",
    HTTPS_PROXY: "http://127.0.0.1:7891",
  });

  assert.equal(options.proxy, "http://127.0.0.1:7890");
});

test("parseCliOptions supports proxy rotation mode from env and command line", () => {
  const fromEnv = parseCliOptions(["node", "server/local-server.mjs"], {
    AT_INSPECTOR_PROXY_MODE: "rotate",
  });
  const fromCli = parseCliOptions([
    "node",
    "server/local-server.mjs",
    "--proxy-mode",
    "fixed",
  ], {
    AT_INSPECTOR_PROXY_MODE: "rotate",
  });

  assert.equal(fromEnv.proxyMode, "rotate");
  assert.equal(fromCli.proxyMode, "fixed");
});


test("parseCliOptions exposes speed tuning for batch concurrency and upstream timeout", () => {
  const fromEnv = parseCliOptions(["node", "server/local-server.mjs"], {
    AT_INSPECTOR_SUBSCRIPTION_CONCURRENCY: "27",
    AT_INSPECTOR_LIVE_CONCURRENCY: "12",
    AT_INSPECTOR_UPSTREAM_TIMEOUT_MS: "9000",
    AT_INSPECTOR_IP_TIMEOUT_MS: "2500",
  });
  const fromCli = parseCliOptions([
    "node",
    "server/local-server.mjs",
    "--subscription-concurrency",
    "8",
    "--live-concurrency",
    "16",
    "--upstream-timeout-ms",
    "7000",
    "--ip-timeout-ms",
    "1800",
  ], {
    AT_INSPECTOR_SUBSCRIPTION_CONCURRENCY: "27",
    AT_INSPECTOR_LIVE_CONCURRENCY: "12",
    AT_INSPECTOR_UPSTREAM_TIMEOUT_MS: "9000",
    AT_INSPECTOR_IP_TIMEOUT_MS: "2500",
  });

  assert.equal(fromEnv.subscriptionConcurrency, 20);
  assert.equal(fromEnv.liveConcurrency, 12);
  assert.equal(fromEnv.upstreamTimeoutMilliseconds, 9000);
  assert.equal(fromEnv.ipInfoTimeoutMilliseconds, 2500);
  assert.equal(fromCli.subscriptionConcurrency, 8);
  assert.equal(fromCli.liveConcurrency, 16);
  assert.equal(fromCli.upstreamTimeoutMilliseconds, 7000);
  assert.equal(fromCli.ipInfoTimeoutMilliseconds, 1800);
});

test("parseCliOptions exposes request body tuning for large AT batches", () => {
  const fromEnv = parseCliOptions(["node", "server/local-server.mjs"], {
    AT_INSPECTOR_BODY_LIMIT_BYTES: "2097152",
  });
  const fromCli = parseCliOptions([
    "node",
    "server/local-server.mjs",
    "--body-limit-bytes",
    "4194304",
  ], {
    AT_INSPECTOR_BODY_LIMIT_BYTES: "2097152",
  });

  assert.equal(fromEnv.bodyLimitBytes, 2 * 1024 * 1024);
  assert.equal(fromCli.bodyLimitBytes, 4 * 1024 * 1024);
});

test("local server accepts request bodies above the previous 64 KiB cap", async () => {
  const oversizedForOldLimit = `ey.${"a".repeat(72 * 1024)}.sig`;
  const server = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    fetchFn: async () => new Response(JSON.stringify({
      id: "user_large",
      email: "large-body@example.test",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/at-live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: oversizedForOldLimit }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.email, "large-body@example.test");
    assert.equal(JSON.stringify(data).includes(oversizedForOldLimit), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("local server routes batch subscription queries to the batch handler", async () => {
  const token = makeJwt({ alg: "RS256" }, { "https://api.openai.com/profile": { email: "batch@example.test" } });
  const server = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async url => {
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: { account_id: "acc_batch", plan_type: "free" },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/subscriptions/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokens: [token] }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.count, 1);
    assert.equal(data.results[0].email, "batch@example.test");
    assert.equal(data.results[0].account_id, "acc_batch");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("local server streams batch subscription items as each lookup completes", async () => {
  const first = makeJwt({ alg: "RS256" }, { "https://api.openai.com/profile": { email: "stream-first@example.test" } });
  const second = makeJwt({ alg: "RS256" }, { "https://api.openai.com/profile": { email: "stream-second@example.test" } });
  const server = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    nowMilliseconds: Date.UTC(2033, 4, 17),
    fetchFn: async (url, init) => {
      const token = init.headers.authorization.replace(/^Bearer /u, "");
      if (token === first) await new Promise(resolve => setTimeout(resolve, 30));
      if (String(url).includes("/accounts/check/")) {
        return new Response(JSON.stringify({
          accounts: {
            default: {
              account: {
                account_id: token === first ? "acc_first" : "acc_second",
                plan_type: "free",
              },
              entitlement: { has_active_subscription: false, subscription_plan: "chatgptfreeplan" },
            },
          },
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/subscriptions/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokens: [first, second] }),
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/u);
    assert.match(body, /event: start\ndata: \{"count":2\}/u);
    assert.match(body, /event: item\ndata: .*"email":"stream-second@example\.test"/u);
    assert.match(body, /event: item\ndata: .*"email":"stream-first@example\.test"/u);
    assert.ok(body.indexOf("stream-second@example.test") < body.indexOf("stream-first@example.test"));
    assert.match(body, /event: done\ndata: \{"ok":true,"status":200,"count":2,"success_count":2,"failure_count":0\}/u);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("local server routes ip info queries to the shared proxy-backed handler", async () => {
  const calls = [];
  const server = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    fetchFn: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        ip: "78.180.242.194",
        country: "TR",
        region: "Istanbul",
        city: "Istanbul",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/ip-info`);
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.ip, "78.180.242.194");
    assert.equal(data.country, "TR");
    assert.equal(calls.length, 1);
    assert.equal(calls[0], "https://www.cloudflare.com/cdn-cgi/trace");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("local server routes AT live checks to backend-api me handler", async () => {
  const calls = [];
  const server = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), auth: init.headers.authorization });
      return new Response(JSON.stringify({
        id: "user_live",
        email: "live-route@example.test",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/at-live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "ey.live.token" }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.alive, true);
    assert.equal(data.email, "live-route@example.test");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://chatgpt.com/backend-api/me");
    assert.equal(calls[0].auth, "Bearer ey.live.token");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("local server routes batch AT live checks without echoing raw tokens", async () => {
  const server = await startLocalServer({
    host: "127.0.0.1",
    port: 0,
    fetchFn: async (_url, init) => {
      const token = init.headers.authorization.replace(/^Bearer /u, "");
      return token.includes("dead")
        ? new Response(JSON.stringify({ detail: "invalid" }), { status: 401 })
        : new Response(JSON.stringify({ id: "user_ok", email: "ok@example.test" }), { status: 200 });
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/at-live/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokens: ["alive-token-value", "dead-token-value"] }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.count, 2);
    assert.equal(data.alive_count, 1);
    assert.equal(data.inactive_count, 1);
    assert.equal(JSON.stringify(data).includes("alive-token-value"), false);
    assert.equal(JSON.stringify(data).includes("dead-token-value"), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
