import { analyzeToken } from "./analyze.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function readPath(source, path) {
  return path.reduce((current, key) => (isPlainObject(current) ? current[key] : undefined), source);
}

function toIsoDate(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function remainingFromIso(iso, nowMilliseconds) {
  if (!iso) return { days_left: null, hours_left: null };
  const difference = new Date(iso).getTime() - nowMilliseconds;
  if (!Number.isFinite(difference)) return { days_left: null, hours_left: null };
  if (difference <= 0) return { days_left: 0, hours_left: 0 };
  return {
    days_left: Math.ceil(difference / 86_400_000),
    hours_left: Math.ceil(difference / 3_600_000),
  };
}

function readJwtSummary(token, nowMilliseconds) {
  if (!token) {
    return { email: null, plan_type_jwt: null, expires_at_jwt: null };
  }

  try {
    const analysis = analyzeToken(token, nowMilliseconds);
    const payload = analysis.decoded.payload;
    return {
      email: firstDefined(
        readPath(payload, ["https://api.openai.com/profile", "email"]),
        payload.email,
      ) ?? null,
      plan_type_jwt: firstDefined(
        readPath(payload, ["https://api.openai.com/auth", "chatgpt_plan_type"]),
        payload.chatgpt_plan_type,
      ) ?? null,
      expires_at_jwt: toIsoDate(payload.exp),
    };
  } catch {
    return { email: null, plan_type_jwt: null, expires_at_jwt: null };
  }
}

export function selectDefaultAccountRecord(accountsResponse = {}) {
  const accounts = accountsResponse?.accounts;
  if (!isPlainObject(accounts)) return {};
  if (isPlainObject(accounts.default)) return accounts.default;

  const firstAccount = Object.values(accounts).find(isPlainObject);
  return firstAccount ?? {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstNonEmptyArray(...values) {
  return values.find(value => Array.isArray(value) && value.length > 0) ?? [];
}

function normalizeOfferIds(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === "string" ? item : item?.id))
      .filter(Boolean);
  }
  if (Array.isArray(value?.offers)) {
    return value.offers
      .map(item => (typeof item === "string" ? item : item?.id))
      .filter(Boolean);
  }
  return [];
}

function normalizeEligiblePromos(value) {
  if (!isPlainObject(value)) return [];
  return Object.values(value)
    .filter(isPlainObject)
    .map(item => ({
      id: item.id ?? null,
      plan_name: item.metadata?.plan_name ?? null,
      title: item.metadata?.title ?? null,
      discount: item.metadata?.discount ?? null,
    }))
    .filter(item => item.id || item.plan_name || item.title);
}

export function normalizeSubscriptionStatus({
  token = "",
  accountsResponse = {},
  subscriptionResponse = {},
  nowMilliseconds = Date.now(),
} = {}) {
  const jwt = readJwtSummary(token, nowMilliseconds);
  const accountRecord = selectDefaultAccountRecord(accountsResponse);
  const account = accountRecord.account ?? {};
  const entitlement = accountRecord.entitlement ?? {};
  const lastActiveSubscription = accountRecord.last_active_subscription ?? {};

  const expiresAt = toIsoDate(firstDefined(
    subscriptionResponse.active_until,
    subscriptionResponse.expires_at,
    entitlement.expires_at,
  ));
  const tokenExpiresAt = jwt.expires_at_jwt;
  const activeStart = toIsoDate(firstDefined(subscriptionResponse.active_start, entitlement.active_start));
  const renewsAt = toIsoDate(firstDefined(subscriptionResponse.renews_at, subscriptionResponse.next_invoice_at));
  const remaining = remainingFromIso(expiresAt, nowMilliseconds);
  const tokenRemaining = remainingFromIso(tokenExpiresAt, nowMilliseconds);
  const subscriptionEligibleOffers = normalizeOfferIds(subscriptionResponse.eligible_offers);
  const accountEligibleOffers = normalizeOfferIds(accountRecord.eligible_offers);

  return {
    ok: true,
    reason: "ok",
    email: firstDefined(jwt.email, account.email, accountsResponse.email) ?? null,
    account_id: firstDefined(account.account_id, account.id, accountRecord.account_id) ?? null,
    plan_type: firstDefined(subscriptionResponse.plan_type, account.plan_type, jwt.plan_type_jwt) ?? null,
    plan_type_jwt: jwt.plan_type_jwt,
    subscription_plan: firstDefined(entitlement.subscription_plan, subscriptionResponse.subscription_plan, subscriptionResponse.plan) ?? null,
    has_active_subscription: Boolean(firstDefined(
      entitlement.has_active_subscription,
      subscriptionResponse.has_active_subscription,
      subscriptionResponse.is_active,
      false,
    )),
    billing_period: firstDefined(entitlement.billing_period, subscriptionResponse.billing_period) ?? null,
    billing_currency: firstDefined(entitlement.billing_currency, subscriptionResponse.billing_currency) ?? null,
    active_start: activeStart,
    expires_at: expiresAt,
    renews_at: renewsAt,
    ...remaining,
    token_expires_at: tokenExpiresAt,
    token_days_left: tokenRemaining.days_left,
    token_hours_left: tokenRemaining.hours_left,
    will_renew: Boolean(firstDefined(lastActiveSubscription.will_renew, subscriptionResponse.will_renew, false)),
    is_delinquent: Boolean(firstDefined(subscriptionResponse.is_delinquent, entitlement.is_delinquent, false)),
    is_gratis: Boolean(firstDefined(subscriptionResponse.is_gratis, entitlement.is_gratis, false)),
    purchase_origin_platform: firstDefined(
      subscriptionResponse.purchase_origin_platform,
      lastActiveSubscription.purchase_origin_platform,
    ) ?? null,
    has_previously_paid_subscription: Boolean(firstDefined(
      account.has_previously_paid_subscription,
      accountRecord.has_previously_paid_subscription,
      false,
    )),
    is_processor_stripe: Boolean(firstDefined(subscriptionResponse.is_processor_stripe, false)),
    applied_discounts: firstNonEmptyArray(
      normalizeArray(subscriptionResponse.applied_discounts),
      normalizeArray(entitlement.applied_discounts),
    ),
    eligible_offers: firstNonEmptyArray(subscriptionEligibleOffers, accountEligibleOffers),
    eligible_promos: normalizeEligiblePromos(accountRecord.eligible_promo_campaigns),
    default_offer_id: firstDefined(
      subscriptionResponse.default_offer_id,
      entitlement.default_offer_id,
      accountRecord.eligible_offers?.default_offer_id,
    ) ?? null,
    raw: {
      accounts: accountsResponse,
      subscription: subscriptionResponse,
    },
  };
}
