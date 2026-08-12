import test from "node:test";
import assert from "node:assert/strict";
import { createAtLiveBatchHandler, createAtLiveHandler } from "../server/at-live-service.mjs";

test("createAtLiveHandler calls ChatGPT backend-api me and returns compact alive details", async () => {
  const calls = [];
  const handler = createAtLiveHandler({
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        id: "user_live",
        email: "live@example.test",
        name: "Live User",
        image: "https://example.test/avatar.png",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await handler({ token: "ey.header.payload" });

  assert.equal(result.ok, true);
  assert.equal(result.alive, true);
  assert.equal(result.email, "live@example.test");
  assert.equal(result.user_id, "user_live");
  assert.equal(result.name, "Live User");
  assert.equal(result.avatar_present, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://chatgpt.com/backend-api/me");
  assert.equal(calls[0].init.headers.authorization, "Bearer ey.header.payload");
});

test("createAtLiveHandler treats auth failures as a measured inactive AT result", async () => {
  const handler = createAtLiveHandler({
    fetchFn: async () => new Response(JSON.stringify({ detail: "invalid" }), { status: 401 }),
  });

  const result = await handler({ token: "ey.header.payload" });

  assert.equal(result.ok, true);
  assert.equal(result.alive, false);
  assert.equal(result.reason, "at-inactive");
  assert.equal(result.upstream_status, 401);
  assert.match(result.message, /不可用|失效/u);
});

test("createAtLiveBatchHandler preserves order and redacts token hints", async () => {
  const tokens = ["first-live-token", "second-dead-token"];
  const handler = createAtLiveBatchHandler({
    fetchFn: async (url, init) => {
      const token = init.headers.authorization.replace(/^Bearer /u, "");
      return token === tokens[0]
        ? new Response(JSON.stringify({ id: "user_1", email: "first@example.test" }), { status: 200 })
        : new Response(JSON.stringify({ detail: "invalid" }), { status: 403 });
    },
  });

  const result = await handler({ tokens });

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.alive_count, 1);
  assert.equal(result.inactive_count, 1);
  assert.equal(result.results[0].index, 1);
  assert.equal(result.results[0].alive, true);
  assert.equal(result.results[1].index, 2);
  assert.equal(result.results[1].alive, false);
  assert.notEqual(result.results[0].token_hint, tokens[0]);
});

test("createAtLiveBatchHandler uses CPA live-check default concurrency", async () => {
  let activeRequests = 0;
  let peakRequests = 0;
  const tokens = Array.from({ length: 12 }, (_, index) => `live-token-${index + 1}`);
  const handler = createAtLiveBatchHandler({
    fetchFn: async () => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 20));
      activeRequests -= 1;
      return new Response(JSON.stringify({ id: "user_live" }), { status: 200 });
    },
  });

  await handler({ tokens });

  assert.equal(peakRequests, 10);
});

test("createAtLiveBatchHandler allows up to 100 ATs by default", async () => {
  const tokens = Array.from({ length: 100 }, (_, index) => `live-token-${index + 1}`);
  const handler = createAtLiveBatchHandler({
    fetchFn: async () => new Response(JSON.stringify({ id: "user_live" }), { status: 200 }),
  });

  const result = await handler({ tokens });

  assert.equal(result.ok, true);
  assert.equal(result.count, 100);
});

test("createAtLiveBatchHandler rejects the 101st AT by default", async () => {
  const tokens = Array.from({ length: 101 }, (_, index) => `live-token-${index + 1}`);
  const handler = createAtLiveBatchHandler({
    fetchFn: async () => {
      throw new Error("batch validation should run before upstream calls");
    },
  });

  const result = await handler({ tokens });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "batch-too-large");
  assert.equal(result.max, 100);
});
