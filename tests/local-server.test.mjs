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
  ]);

  assert.equal(options.host, "0.0.0.0");
  assert.equal(options.port, 5183);
});

test("parseCliOptions keeps safe local defaults", () => {
  const options = parseCliOptions(["node", "server/local-server.mjs"]);

  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 5173);
});
