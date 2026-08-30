import test from "node:test";
import assert from "node:assert/strict";
import { buildEligibilityDisplay, describeEligibilityPromo } from "../src/core/subscription-eligibility.js";

test("describeEligibilityPromo turns promotion ids into readable plan benefits", () => {
  assert.deepEqual(describeEligibilityPromo({ id: "plus-1-month-free" }), {
    plan: "Plus",
    benefit: "免费 1 个月",
    rawLabel: "plus-1-month-free",
  });
  assert.deepEqual(describeEligibilityPromo({ id: "go-3-months-50-pct-off" }), {
    plan: "Go",
    benefit: "3 个月 · 50% 优惠",
    rawLabel: "go-3-months-50-pct-off",
  });
});

test("buildEligibilityDisplay distinguishes trial, purchase-only, and drifting results", () => {
  assert.deepEqual(buildEligibilityDisplay({
    eligible_promos: [{ id: "plus-1-month-free" }],
  }), {
    primary: "Plus",
    secondary: "免费 1 个月",
    title: "Plus：免费 1 个月（plus-1-month-free）",
    state: "trial",
  });

  assert.deepEqual(buildEligibilityDisplay({ eligible_offers: ["chatgptplusplan"] }), {
    primary: "无试用",
    secondary: "可购买 Plus",
    title: "未返回试用活动；可购买套餐：Plus",
    state: "purchase",
  });

  assert.deepEqual(buildEligibilityDisplay({
    eligibility_unconfirmed_due_to_egress: true,
    egress_consistency_status: "drifted",
    egress_before_country: "PH",
    egress_after_country: "JP",
  }), {
    primary: "需复测",
    secondary: "PH→JP",
    title: "出口不稳定，未命中的试用资格不作否定判断",
    state: "uncertain",
  });
});
