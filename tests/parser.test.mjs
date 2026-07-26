import { Buffer } from "node:buffer";
import test from "node:test";
import assert from "node:assert/strict";
import { loadCore, makeJwt, toPlain } from "./helpers/load-core.mjs";

const core = loadCore();
const {
  evaluateTimeStatus,
  formatBeijingTime,
  formatTimeClaimValue,
  normalizeInput,
  parseJwt,
} = core;

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

test("evaluateTimeStatus reports each supported time state", () => {
  const nowSeconds = 2_000_000_000;
  const nowMilliseconds = nowSeconds * 1000;

  assert.equal(
    evaluateTimeStatus({ nbf: nowSeconds - 10, exp: nowSeconds + 10 }, nowMilliseconds).code,
    "within_window",
  );
  assert.equal(
    evaluateTimeStatus({ exp: nowSeconds }, nowMilliseconds).code,
    "expired",
  );
  assert.equal(
    evaluateTimeStatus({ nbf: nowSeconds + 1 }, nowMilliseconds).code,
    "not_yet_valid",
  );
  assert.equal(evaluateTimeStatus({}, nowMilliseconds).code, "missing_time");
});

test("formatBeijingTime is deterministic and uses UTC+08:00", () => {
  assert.equal(formatBeijingTime(0), "1970-01-01 08:00:00 +08:00");
});

test("time claim display includes the NumericDate and Beijing time", () => {
  for (const key of ["iat", "nbf", "exp"]) {
    assert.equal(
      formatTimeClaimValue(key, 0),
      "0\n北京时间：1970-01-01 08:00:00 +08:00",
    );
  }
  assert.equal(formatTimeClaimValue("nbf", "invalid"), "invalid");
});

test("parseJwt warns that signatures are not verified", () => {
  const token = makeJwt(
    { alg: "RS256", typ: "JWT" },
    { nbf: 1_999_999_990, exp: 2_000_000_010 },
  );
  const result = parseJwt(token, 2_000_000_000_000);
  const codes = result.warnings.map((warning) => warning.code);

  assert.equal(result.time.code, "within_window");
  assert.ok(codes.includes("SIGNATURE_UNVERIFIED"));
});

test("parseJwt warns about unsafe algorithms and invalid time claims", () => {
  const token = makeJwt(
    { alg: "none" },
    { exp: "not-a-number" },
  );
  const result = parseJwt(token, 2_000_000_000_000);
  const codes = result.warnings.map((warning) => warning.code);

  assert.ok(codes.includes("ALG_NONE"));
  assert.ok(codes.includes("INVALID_TIME_CLAIM"));

  const outOfRange = parseJwt(
    makeJwt({ alg: "RS256" }, { exp: Number.MAX_VALUE }),
    2_000_000_000_000,
  );
  assert.ok(outOfRange.warnings.some((warning) => warning.code === "INVALID_TIME_CLAIM"));
});

test("parseJwt warns when alg is missing or unfamiliar", () => {
  const missing = parseJwt(makeJwt({}, { exp: 2_000_000_010 }), 2_000_000_000_000);
  const unfamiliar = parseJwt(
    makeJwt({ alg: "SYNTHETIC-ALG" }, { exp: 2_000_000_010 }),
    2_000_000_000_000,
  );

  assert.ok(missing.warnings.some((warning) => warning.code === "MISSING_ALG"));
  assert.ok(unfamiliar.warnings.some((warning) => warning.code === "UNKNOWN_ALG"));
});
