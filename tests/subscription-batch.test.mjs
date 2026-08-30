import test from "node:test";
import assert from "node:assert/strict";
import {
  createIncompleteSubscriptionResult,
  isSubscriptionBatchComplete,
  missingSubscriptionIndexes,
  subscriptionResultNeedsRetry,
} from "../src/core/subscription-batch.js";

test("missingSubscriptionIndexes reports every absent input index", () => {
  assert.deepEqual(missingSubscriptionIndexes(4, [
    { index: 1 },
    { index: 3 },
    { index: 3 },
  ]), [2, 4]);
});

test("isSubscriptionBatchComplete requires done, matching count, and all indexes", () => {
  const completeItems = [{ index: 1 }, { index: 2 }, { index: 3 }];

  assert.equal(isSubscriptionBatchComplete({
    expectedCount: 3,
    receivedDone: true,
    doneCount: 3,
    items: completeItems,
  }), true);
  assert.equal(isSubscriptionBatchComplete({
    expectedCount: 3,
    receivedDone: false,
    doneCount: null,
    items: completeItems,
  }), false);
  assert.equal(isSubscriptionBatchComplete({
    expectedCount: 3,
    receivedDone: true,
    doneCount: 2,
    items: completeItems,
  }), false);
  assert.equal(isSubscriptionBatchComplete({
    expectedCount: 3,
    receivedDone: true,
    doneCount: 3,
    items: [{ index: 1 }, { index: 3 }],
  }), false);
});

test("subscriptionResultNeedsRetry includes hard failures and partial subscription details", () => {
  assert.equal(subscriptionResultNeedsRetry({ ok: false }), true);
  assert.equal(subscriptionResultNeedsRetry({ ok: true, subscription_detail_status: "failed" }), true);
  assert.equal(subscriptionResultNeedsRetry({ ok: true, offers_status: "unknown" }), true);
  assert.equal(subscriptionResultNeedsRetry({
    ok: true,
    offers_status: "not_returned",
    eligibility_unconfirmed_due_to_egress: true,
  }), true);
  assert.equal(subscriptionResultNeedsRetry({
    ok: true,
    subscription_detail_status: "ok",
    offers_status: "confirmed",
  }), false);
});

test("createIncompleteSubscriptionResult produces a visible redacted failure row", () => {
  assert.deepEqual(createIncompleteSubscriptionResult(2, "eyJhbGciOiJS…abc123"), {
    ok: false,
    index: 2,
    token_hint: "eyJhbGciOiJS…abc123",
    reason: "stream-incomplete",
    message: "流式查询提前结束，该 AT 未返回结果。",
    status: 502,
    subscription_detail_status: "failed",
    offers_status: "unknown",
  });
});
