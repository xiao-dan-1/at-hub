import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { formatByteLimit, parseBodyLimitBytes, readRequestJson } from "../server/request-body.mjs";

function requestFromText(text) {
  return Readable.from([Buffer.from(text)]);
}

test("readRequestJson accepts AT batches above the old 64 KiB request ceiling", async () => {
  const oversizedForOldLimit = "x".repeat(72 * 1024);
  const data = await readRequestJson(requestFromText(JSON.stringify({ token: oversizedForOldLimit })));

  assert.equal(data.token.length, oversizedForOldLimit.length);
});

test("readRequestJson reports the configured body limit in the error message", async () => {
  await assert.rejects(
    () => readRequestJson(requestFromText(JSON.stringify({ token: "x".repeat(2048) })), { bodyLimitBytes: 1024 }),
    error => {
      assert.equal(error.status, 413);
      assert.match(error.message, /请求体超过 1 KiB。/u);
      return true;
    },
  );
});

test("parseBodyLimitBytes and formatByteLimit expose readable local-service limits", () => {
  assert.equal(parseBodyLimitBytes("2097152"), 2 * 1024 * 1024);
  assert.equal(parseBodyLimitBytes("bad", 1234), 1234);
  assert.equal(formatByteLimit(8 * 1024 * 1024), "8 MiB");
  assert.equal(formatByteLimit(64 * 1024), "64 KiB");
});
