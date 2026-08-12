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

test("createProxyFetch uses the SOCKS5 dispatcher for socks proxy urls", async () => {
  const calls = [];
  class FakeHttpProxyAgent {
    constructor(uri) {
      this.type = "http";
      this.uri = uri;
    }
  }
  class FakeSocks5ProxyAgent {
    constructor(uri) {
      this.type = "socks5";
      this.uri = uri;
    }
  }
  const proxyUrl = "socks5://proxy-user:proxy-password@proxy.example.com:3000";
  const fetchFn = createProxyFetch(proxyUrl, {
    ProxyAgentCtor: FakeHttpProxyAgent,
    Socks5ProxyAgentCtor: FakeSocks5ProxyAgent,
    baseFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    },
  });

  await fetchFn("https://example.test/path");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.dispatcher.type, "socks5");
  assert.equal(calls[0].init.dispatcher.uri, proxyUrl);
});

test("createProxyFetch rotates 1024proxy sid values for each upstream request in rotate mode", async () => {
  const calls = [];
  const generatedSessionIds = ["sidA123", "sidB456"];
  class FakeSocks5ProxyAgent {
    constructor(uri) {
      this.type = "socks5";
      this.uri = uri;
    }
  }
  const fetchFn = createProxyFetch("socks5://proxy-region-JP-sid-fixed-t-5:secret@us.1024proxy.io:3000", {
    mode: "rotate",
    Socks5ProxyAgentCtor: FakeSocks5ProxyAgent,
    sessionIdFactory: () => generatedSessionIds.shift(),
    baseFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    },
  });

  await fetchFn("https://example.test/first");
  await fetchFn("https://example.test/second");

  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].init.dispatcher.uri,
    "socks5://proxy-region-JP-sid-sidA123-t-5:secret@us.1024proxy.io:3000",
  );
  assert.equal(
    calls[1].init.dispatcher.uri,
    "socks5://proxy-region-JP-sid-sidB456-t-5:secret@us.1024proxy.io:3000",
  );
  assert.notEqual(calls[0].init.dispatcher.uri, calls[1].init.dispatcher.uri);
});

test("createProxyFetch reuses an explicit rotate session id across related upstream calls", async () => {
  const calls = [];
  class FakeSocks5ProxyAgent {
    constructor(uri) {
      this.type = "socks5";
      this.uri = uri;
    }
  }
  const fetchFn = createProxyFetch("socks5://proxy-region-JP-sid-fixed-t-5:secret@us.1024proxy.io:3000", {
    mode: "rotate",
    Socks5ProxyAgentCtor: FakeSocks5ProxyAgent,
    sessionIdFactory: () => "unusedFallback",
    baseFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    },
  });

  await fetchFn("https://example.test/accounts", { proxySessionId: "sameAT42" });
  await fetchFn("https://example.test/subscriptions", { proxySessionId: "sameAT42" });

  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].init.dispatcher.uri,
    "socks5://proxy-region-JP-sid-sameAT42-t-5:secret@us.1024proxy.io:3000",
  );
  assert.equal(calls[1].init.dispatcher.uri, calls[0].init.dispatcher.uri);
  assert.equal(calls[1].init.dispatcher, calls[0].init.dispatcher);
  assert.equal("proxySessionId" in calls[0].init, false);
});

test("createProxyFetch keeps HTTP proxy urls on the HTTP dispatcher", async () => {
  const calls = [];
  class FakeHttpProxyAgent {
    constructor(uri) {
      this.type = "http";
      this.uri = uri;
    }
  }
  class FakeSocks5ProxyAgent {
    constructor(uri) {
      this.type = "socks5";
      this.uri = uri;
    }
  }
  const fetchFn = createProxyFetch("http://127.0.0.1:7890", {
    ProxyAgentCtor: FakeHttpProxyAgent,
    Socks5ProxyAgentCtor: FakeSocks5ProxyAgent,
    baseFetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}");
    },
  });

  await fetchFn("https://example.test/path");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.dispatcher.type, "http");
  assert.equal(calls[0].init.dispatcher.uri, "http://127.0.0.1:7890");
});

test("redactProxyUrl hides proxy credentials in startup output", () => {
  assert.equal(
    redactProxyUrl("http://real-user:real-password@127.0.0.1:7890"),
    "http://user:pass@127.0.0.1:7890/",
  );
});

test("redactProxyUrl hides SOCKS5 proxy credentials in startup output", () => {
  assert.equal(
    redactProxyUrl("socks5://proxy-user:proxy-password@proxy.example.com:3000"),
    "socks5://user:pass@proxy.example.com:3000",
  );
});
