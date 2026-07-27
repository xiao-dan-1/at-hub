import test from "node:test";
import assert from "node:assert/strict";
import { makeJwt } from "./helpers/make-jwt.mjs";
import { parseJwt } from "../src/core/jwt.js";
import {
  buildSections,
  isSensitiveKey,
  redactDeep,
} from "../src/core/redaction.js";

test("isSensitiveKey identifies personal and identifier fields", () => {
  assert.equal(isSensitiveKey("email"), true);
  assert.equal(isSensitiveKey("session_id"), true);
  assert.equal(isSensitiveKey("verified_org_ids"), true);
  assert.equal(isSensitiveKey("user_uuid"), true);
  assert.equal(isSensitiveKey("account_uuid"), true);
  assert.equal(isSensitiveKey("organization_uuid"), true);
  assert.equal(isSensitiveKey("workspace_uuid"), true);
  assert.equal(isSensitiveKey("session_uuid"), true);
  assert.equal(isSensitiveKey("userId"), true);
  assert.equal(isSensitiveKey("workspace-id"), true);
  assert.equal(isSensitiveKey("sid"), true);
  assert.equal(isSensitiveKey("verified_identity"), true);
  assert.equal(isSensitiveKey("chatgpt_plan_type"), false);
  assert.equal(isSensitiveKey("email_verified"), false);
});

test("redactDeep masks nested sensitive values without changing public values", () => {
  const source = {
    profile: { email: "person@example.test", email_verified: true, name: "Example" },
    auth: {
      user_id: "user-synthetic",
      user_uuid: "uuid-user-synthetic",
      account_uuid: "uuid-account-synthetic",
      organization_uuid: "uuid-organization-synthetic",
      workspace_uuid: "uuid-workspace-synthetic",
      session_uuid: "uuid-session-synthetic",
      userId: "camel-user-synthetic",
      verified_identity: "identity-synthetic",
      verified_org_ids: ["org-synthetic"],
    },
    chatgpt_plan_type: "free",
    scp: ["openid", "profile"],
  };

  assert.deepEqual(redactDeep(source), {
    profile: { email: "[REDACTED]", email_verified: true, name: "[REDACTED]" },
    auth: {
      user_id: "[REDACTED]",
      user_uuid: "[REDACTED]",
      account_uuid: "[REDACTED]",
      organization_uuid: "[REDACTED]",
      workspace_uuid: "[REDACTED]",
      session_uuid: "[REDACTED]",
      userId: "[REDACTED]",
      verified_identity: "[REDACTED]",
      verified_org_ids: ["[REDACTED]"],
    },
    chatgpt_plan_type: "free",
    scp: ["openid", "profile"],
  });
});

test("buildSections assigns known and unknown fields to stable categories", () => {
  const sections = buildSections(
    { alg: "RS256", typ: "JWT" },
    {
      user_id: "user-synthetic",
      amr: ["otp"],
      scp: ["openid"],
      exp: 2_000_000_000,
      unexpected_claim: "visible",
    },
  );
  const byId = Object.fromEntries(sections.map((section) => [section.id, section.entries]));

  assert.ok(byId.identity.some((entry) => entry.path === "payload.user_id"));
  assert.ok(byId.authentication.some((entry) => entry.path === "payload.amr"));
  assert.ok(byId.permissions.some((entry) => entry.path === "payload.scp"));
  assert.ok(byId.time.some((entry) => entry.path === "payload.exp"));
  assert.ok(byId.security.some((entry) => entry.path === "header.alg"));
  assert.ok(byId.other.some((entry) => entry.path === "payload.unexpected_claim"));
});

test("parseJwt warns when a payload contains unknown claims", () => {
  const result = parseJwt(makeJwt(
    { alg: "RS256", typ: "JWT" },
    { exp: 2_000_000_010, unexpected_claim: "visible" },
  ), 2_000_000_000_000);

  assert.ok(result.warnings.some((warning) => warning.code === "UNKNOWN_CLAIMS"));
});
