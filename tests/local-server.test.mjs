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
