import test from "node:test";
import assert from "node:assert/strict";
import { analyzeToken } from "../src/core/analyze.js";
import { makeJwt } from "./helpers/make-jwt.mjs";

const nowSeconds = 2_000_000_000;
const nowMilliseconds = nowSeconds * 1000;

function makeSemanticToken(overrides = {}) {
  return makeJwt(
    { alg: "RS256", typ: "JWT", kid: "synthetic-key" },
    {
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "plus",
        chatgpt_account_user_id: "user-synthetic",
        amr: ["otp"],
      },
      "https://api.openai.com/profile": {
        email: "person@example.test",
        email_verified: true,
      },
      scp: ["openid", "model.request", "organization.write"],
      iat: nowSeconds - 60,
      nbf: nowSeconds - 60,
      exp: nowSeconds + 3600,
      unknown_claim: "visible",
      ...overrides,
    },
  );
}

test("analyzeToken composes semantic account, permission, and time models", () => {
  const analysis = analyzeToken(makeSemanticToken(), nowMilliseconds);

  assert.equal(analysis.status.code, "within_window");
  assert.equal(analysis.account.plan.value, "plus");
  assert.deepEqual(analysis.permissions.map(item => item.scope), [
    "openid",
    "model.request",
    "organization.write",
  ]);
  assert.equal(analysis.entries.some(entry => entry.key === "unknown_claim"), true);
  assert.deepEqual(analysis.decoded.signature, { present: true, verified: false });
  assert.equal(Object.hasOwn(analysis.decoded.signature, "raw"), false);
});

test("unknown claims stay inspectable without becoming risk warnings", () => {
  const analysis = analyzeToken(makeSemanticToken(), nowMilliseconds);
  const codes = analysis.warnings.map(warning => warning.code);

  assert.ok(codes.includes("SIGNATURE_UNVERIFIED"));
  assert.ok(codes.includes("HIGH_RISK_PERMISSIONS"));
  assert.equal(codes.includes("UNKNOWN_CLAIMS"), false);
  assert.equal(analysis.warnings.find(warning => warning.code === "HIGH_RISK_PERMISSIONS").level, "danger");
});

test("redacted analysis never includes identity values", () => {
  const analysis = analyzeToken(makeSemanticToken(), nowMilliseconds);
  const serialized = JSON.stringify(analysis.redacted);

  assert.match(serialized, /\[REDACTED\]/u);
  assert.doesNotMatch(serialized, /person@example\.test|user-synthetic/u);
});

test("analysis reports unsafe algorithms and invalid time claims", () => {
  const token = makeJwt({ alg: "none" }, { exp: "invalid" });
  const codes = analyzeToken(token, nowMilliseconds).warnings.map(warning => warning.code);

  assert.ok(codes.includes("ALG_NONE"));
  assert.ok(codes.includes("INVALID_TIME_CLAIM"));
  assert.ok(codes.includes("MISSING_TIME"));
});
