import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAccountSummary,
  buildClaimEntries,
  describeClaim,
  selectPreferredClaim,
} from "../src/core/claims.js";

const header = { alg: "RS256", typ: "JWT", kid: "synthetic-key" };
const payload = {
  "https://api.openai.com/auth": {
    chatgpt_plan_type: "plus",
    chatgpt_account_user_id: "user-synthetic",
    pwd_auth_time: 2_000_000_000_000,
  },
  "https://api.openai.com/profile": {
    email: "person@example.test",
    email_verified: true,
  },
  chatgpt_plan_type: "free",
  unknown_claim: "visible",
};

test("buildClaimEntries groups OpenAI namespaces and preserves full paths", () => {
  const entries = buildClaimEntries(header, payload);
  const plan = entries.find(entry => entry.key === "chatgpt_plan_type" && entry.namespace === "OpenAI Auth");
  const email = entries.find(entry => entry.key === "email");

  assert.equal(plan.label, "JWT 声明的套餐");
  assert.equal(plan.path, "payload.https://api.openai.com/auth.chatgpt_plan_type");
  assert.equal(email.namespace, "OpenAI Profile");
  assert.equal(email.key, "email");
  assert.equal(entries.some(entry => entry.key.includes("https://")), false);
});

test("nested auth claims take precedence over top-level fallbacks", () => {
  const entries = buildClaimEntries(header, payload);
  assert.equal(selectPreferredClaim(entries, "chatgpt_plan_type").value, "plus");
  assert.equal(buildAccountSummary(entries).plan.value, "plus");
});

test("known claims have Chinese semantics and unknown claims remain visible", () => {
  assert.deepEqual(describeClaim("pwd_auth_time"), {
    label: "密码认证时间",
    description: "密码认证发生的时间声明。",
    category: "authentication",
    known: true,
    format: "known-time",
  });

  const unknown = buildClaimEntries(header, payload).find(entry => entry.key === "unknown_claim");
  assert.equal(unknown.known, false);
  assert.equal(unknown.label, "unknown_claim");
  assert.equal(unknown.value, "visible");
});

test("sensitive entries never expose raw values in searchable previews", () => {
  const entries = buildClaimEntries(header, payload);
  const sensitive = entries.filter(entry => entry.sensitive);

  assert.ok(sensitive.some(entry => entry.key === "chatgpt_account_user_id"));
  assert.ok(sensitive.some(entry => entry.key === "email"));
  assert.ok(sensitive.every(entry => entry.searchPreview === ""));
  assert.ok(entries.find(entry => entry.key === "unknown_claim").searchPreview.includes("visible"));
});

test("children of an object-valued sensitive claim inherit sensitivity", () => {
  const entries = buildClaimEntries(header, {
    verified_identity: {
      provider: "synthetic-provider",
      subject: "synthetic-subject",
    },
  });
  const children = entries.filter(entry => entry.path.startsWith("payload.verified_identity."));

  assert.equal(children.length, 2);
  assert.ok(children.every(entry => entry.sensitive));
  assert.ok(children.every(entry => entry.searchPreview === ""));
});
