import test from "node:test";
import assert from "node:assert/strict";
import { parseCliOptions } from "../server/local-server.mjs";

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

test("parseCliOptions ignores empty proxy env values when falling back", () => {
  const options = parseCliOptions(["node", "server/local-server.mjs"], {
    AT_INSPECTOR_PROXY: "",
    HTTPS_PROXY: "http://127.0.0.1:7890",
  });

  assert.equal(options.proxy, "http://127.0.0.1:7890");
});
