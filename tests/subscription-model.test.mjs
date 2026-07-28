import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSubscriptionStatus } from "../src/core/subscription-model.js";
import { makeJwt } from "./helpers/make-jwt.mjs";

const token = makeJwt(
  { alg: "RS256" },
  {
    exp: Math.floor(Date.UTC(2033, 4, 27) / 1000),
    "https://api.openai.com/profile": { email: "plan@example.test" },
    "https://api.openai.com/auth": { chatgpt_plan_type: "free" },
  },
);

test("normalizeSubscriptionStatus prefers realtime subscription fields over JWT claims", () => {
  const model = normalizeSubscriptionStatus({
    token,
    accountsResponse: {
      accounts: {
        default: {
          account: {
            account_id: "acc_123",
            plan_type: "plus",
            has_previously_paid_subscription: true,
          },
          entitlement: {
            has_active_subscription: true,
            subscription_plan: "chatgptplusplan",
            expires_at: "2033-05-27T00:00:00Z",
            billing_period: "monthly",
            billing_currency: "USD",
          },
          last_active_subscription: {
            will_renew: true,
            purchase_origin_platform: "chatgpt_web",
          },
        },
      },
    },
    subscriptionResponse: {
      plan_type: "plus",
      id: "sub_123",
      active_start: "2033-04-27T00:00:00Z",
      active_until: "2033-05-27T00:00:00Z",
      is_processor_stripe: true,
      applied_discounts: [{ promo_campaign_id: "promo_a", amount: 100 }],
      eligible_offers: ["chatgptplusplan"],
    },
    nowMilliseconds: Date.UTC(2033, 4, 17),
  });

  assert.equal(model.ok, true);
  assert.equal(model.email, "plan@example.test");
  assert.equal(model.plan_type, "plus");
  assert.equal(model.plan_type_jwt, "free");
  assert.equal(model.account_id, "acc_123");
  assert.equal(model.subscription_plan, "chatgptplusplan");
  assert.equal(model.has_active_subscription, true);
  assert.equal(model.will_renew, true);
  assert.equal(model.purchase_origin_platform, "chatgpt_web");
  assert.equal(model.days_left, 10);
  assert.equal(model.applied_discounts.length, 1);
  assert.equal(model.eligible_offers.length, 1);
  assert.ok(model.raw.accounts);
  assert.ok(model.raw.subscription);
  assert.doesNotMatch(JSON.stringify(model), /Bearer/u);
});
