import test from "node:test";
import assert from "node:assert/strict";
import { buildEligibilityDisplay } from "../src/core/subscription-eligibility.js";

test("buildEligibilityDisplay shows only raw available promotions", () => {
  assert.deepEqual(buildEligibilityDisplay({
    eligible_promos: [{ id: "plus-1-month-free" }],
    eligible_offers: ["chatgptplusplan"],
  }), {
    primary: "plus-1-month-free",
    secondary: "—",
    values: ["plus-1-month-free"],
    title: "eligible_promos: plus-1-month-free",
    state: "available",
  });

  assert.deepEqual(buildEligibilityDisplay({
    eligible_offers: ["chatgptplusplan"],
  }), {
    primary: "—",
    secondary: "未返回",
    values: [],
    title: "未返回 eligible_promos",
    state: "unknown",
  });
});
