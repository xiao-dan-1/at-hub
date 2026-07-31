import test from "node:test";
import assert from "node:assert/strict";
import { createProxyFetch, redactProxyUrl } from "../server/proxy-fetch.mjs";

test("createProxyFetch attaches a proxy dispatcher to fetch calls", async () => {
  const calls = [];
  class FakeProxyAgent {
    constructor(uri) {
      this.uri = uri;
    }
  }
  const fetchFn = createProxyFetch("http://127.0.0.1:7890", {
    ProxyAgentCtor: FakeProxyAgent,
    baseFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    },
  });

  await fetchFn("https://example.test/path", { headers: { accept: "application/json" } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.dispatcher.uri, "http://127.0.0.1:7890");
  assert.equal(calls[0].init.headers.accept, "application/json");
});

test("createProxyFetch defaults to an undici-compatible fetch implementation", async () => {
  const calls = [];
  class FakeProxyAgent {
    constructor(uri) {
      this.uri = uri;
    }
  }
  const fetchFn = createProxyFetch("http://127.0.0.1:7890", {
    ProxyAgentCtor: FakeProxyAgent,
    undiciFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    },
  });

  await fetchFn("https://example.test/path");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.dispatcher.uri, "http://127.0.0.1:7890");
});

test("redactProxyUrl hides proxy credentials in startup output", () => {
  assert.equal(
    redactProxyUrl("http://real-user:real-password@127.0.0.1:7890"),
    "http://user:pass@127.0.0.1:7890/",
  );
});
