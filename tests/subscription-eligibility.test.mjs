import test from "node:test";
import assert from "node:assert/strict";
import { buildEligibilityDisplay } from "../src/core/subscription-eligibility.js";

test("buildEligibilityDisplay shows only raw available offers", () => {
  assert.deepEqual(buildEligibilityDisplay({ eligible_offers: ["chatgptplusplan"] }), {
    primary: "chatgptplusplan",
    secondary: "—",
    title: "eligible_offers: chatgptplusplan",
    state: "available",
  });

  assert.deepEqual(buildEligibilityDisplay({
    eligible_promos: [{ id: "plus-1-month-free" }],
    is_eligible_for_free_trial: true,
  }), {
    primary: "—",
    secondary: "未返回",
    title: "未返回 eligible_offers",
    state: "unknown",
  });
});
