import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { loadCore, makeJwt, toPlain } from "./helpers/load-core.mjs";

const core = loadCore();
const { normalizeInput, parseJwt } = core;

test("normalizeInput trims whitespace and an optional Bearer prefix", () => {
  assert.equal(normalizeInput("  Bearer abc.def.sig  "), "abc.def.sig");
  assert.equal(normalizeInput("bearer    abc.def.sig"), "abc.def.sig");
});

test("parseJwt decodes UTF-8 JSON objects", () => {
  const token = makeJwt(
    { alg: "RS256", typ: "JWT" },
    { name: "虚构用户", plan: "free" },
  );
  const result = parseJwt(token, 2_000_000_000_000);

  assert.deepEqual(toPlain(result.header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(toPlain(result.payload), { name: "虚构用户", plan: "free" });
  assert.deepEqual(toPlain(result.signature), { present: true, verified: false });
});

test("parseJwt rejects empty or malformed segment counts", () => {
  assert.throws(() => parseJwt(""), (error) => error.code === "EMPTY_INPUT");
  assert.throws(() => parseJwt("one.two"), (error) => error.code === "JWT_STRUCTURE");
  assert.throws(() => parseJwt("one..three"), (error) => error.code === "JWT_STRUCTURE");
});

test("parseJwt rejects non-object Header and Payload values", () => {
  const arrayHeader = makeJwt(["RS256"], { value: true });
  const arrayPayload = makeJwt({ alg: "RS256" }, ["value"]);

  assert.throws(() => parseJwt(arrayHeader), (error) => error.code === "HEADER_NOT_OBJECT");
  assert.throws(() => parseJwt(arrayPayload), (error) => error.code === "PAYLOAD_NOT_OBJECT");
});

test("parseJwt distinguishes Base64URL, UTF-8, and JSON failures", () => {
  const emptyObject = Buffer.from("{}", "utf8").toString("base64url");
  const invalidUtf8 = Buffer.from([0xff]).toString("base64url");
  const invalidJson = Buffer.from("not-json", "utf8").toString("base64url");

  assert.throws(
    () => parseJwt(`%%%.${emptyObject}.signature`),
    (error) => error.code === "HEADER_BASE64URL",
  );
  assert.throws(
    () => parseJwt(`${invalidUtf8}.${emptyObject}.signature`),
    (error) => error.code === "HEADER_UTF8",
  );
  assert.throws(
    () => parseJwt(`${invalidJson}.${emptyObject}.signature`),
    (error) => error.code === "HEADER_JSON",
  );
});
