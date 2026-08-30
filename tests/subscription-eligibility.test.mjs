import test from "node:test";
import assert from "node:assert/strict";
import { buildEligibilityDisplay } from "../src/core/subscription-eligibility.js";

test("buildEligibilityDisplay preserves raw eligibility fields without translating promotion ids", () => {
  assert.deepEqual(buildEligibilityDisplay({
    eligible_promos: [{ id: "plus-1-month-free" }],
  }), {
    primary: "eligible_promos: plus-1-month-free",
    secondary: "—",
    title: "eligible_promos: plus-1-month-free",
    state: "trial",
  });

  assert.deepEqual(buildEligibilityDisplay({ eligible_offers: ["chatgptplusplan"] }), {
    primary: "eligible_offers: chatgptplusplan",
    secondary: "—",
    title: "eligible_offers: chatgptplusplan",
    state: "available",
  });
});
