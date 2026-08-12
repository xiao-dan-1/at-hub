import test from "node:test";
import assert from "node:assert/strict";
import { readLocalServiceJson } from "../src/core/local-response.js";

test("readLocalServiceJson reports stale or missing local API routes without raw JSON parser noise", async () => {
  const response = new Response("Not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

  await assert.rejects(
    () => readLocalServiceJson(response, { serviceName: "IP 信息接口" }),
    error => {
      assert.match(error.message, /IP 信息接口/u);
      assert.match(error.message, /HTTP 404/u);
      assert.match(error.message, /Not found\./u);
      assert.match(error.message, /重启/u);
      assert.doesNotMatch(error.message, /Unexpected token/u);
      return true;
    },
  );
});
