import test from "node:test";
import assert from "node:assert/strict";
import { extractAccessTokens } from "../src/core/token-extract.js";
import { makeJwt } from "./helpers/make-jwt.mjs";

test("extractAccessTokens accepts pure JWT, Bearer JWT, and session JSON", () => {
  const first = makeJwt({ alg: "RS256" }, { email: "first@example.test" });
  const second = makeJwt({ alg: "RS256" }, { email: "second@example.test" });

  const result = extractAccessTokens([
    `Bearer ${first}`,
    JSON.stringify({ accessToken: second }),
    first,
  ].join("\n"));

  assert.deepEqual(result.tokens, [first, second]);
  assert.deepEqual(result.sources, ["jwt", "json"]);
});

test("extractAccessTokens accepts credential lines while retaining only AT values", () => {
  const first = makeJwt({ alg: "RS256" }, { email: "first@example.test" });
  const second = makeJwt({ alg: "RS256" }, { email: "second@example.test" });

  const result = extractAccessTokens([
    `first@example.test----secret-password----123456----${first}`,
    `second@example.test----secret-password--------Bearer ${second}`,
  ].join("\n"));

  assert.deepEqual(result.tokens, [first, second]);
  assert.deepEqual(result.sources, ["credential-line"]);
  assert.doesNotMatch(JSON.stringify(result), /first@example\.test|second@example\.test|secret-password|123456/u);
});

test("extractAccessTokens reports a safe empty result without echoing input", () => {
  const result = extractAccessTokens("not a token");

  assert.deepEqual(result.tokens, []);
  assert.deepEqual(result.sources, []);
});
