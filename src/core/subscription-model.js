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

function toEpochMilliseconds(iso) {
  if (!iso) return null;
  const milliseconds = new Date(iso).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
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
    user_id: firstDefined(
      readPath(payload, ["https://api.openai.com/auth", "chatgpt_user_id"]),
      readPath(payload, ["https://api.openai.com/auth", "user_id"]),
      payload.chatgpt_user_id,
      payload.user_id,
    ) ?? null,
    account_id: firstDefined(
      readPath(payload, ["https://api.openai.com/auth", "chatgpt_account_id"]),
      payload.chatgpt_account_id,
      payload.account_id,
    ) ?? null,
    expires_at_jwt: toIsoDate(payload.exp),
  };
  } catch {
    return { email: null, plan_type_jwt: null, user_id: null, expires_at_jwt: null };
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

function normalizeOfferIds(value) {
  const ids = [];
  const seen = new Set();

  function add(id) {
    if (typeof id !== "string" || !id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  }

  function visit(candidate, depth = 0) {
    if (depth > 4 || candidate === undefined || candidate === null) return;
    if (typeof candidate === "string") {
      add(candidate);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(item => visit(item, depth + 1));
      return;
    }
    if (!isPlainObject(candidate)) return;
    if (typeof candidate.id === "string") {
      add(candidate.id);
      return;
    }
    const nested = [
      candidate.offers,
      candidate.items,
      candidate.eligible_offers,
      candidate.available_offers,
      candidate.plans,
    ].filter(item => item !== undefined);
    if (nested.length > 0) {
      nested.forEach(item => visit(item, depth + 1));
      return;
    }
    Object.values(candidate).forEach(item => visit(item, depth + 1));
  }

  visit(value);
  return ids;
}

function mergeUnique(values) {
  return [...new Set(values.flat())];
}

function normalizeEligiblePromos(...values) {
  const promos = [];
  const seen = new Set();

  function add(candidate) {
    if (!isPlainObject(candidate)) return;
    const promo = {
      id: candidate.id ?? candidate.promo_campaign_id ?? null,
      plan_name: candidate.metadata?.plan_name ?? candidate.plan_name ?? null,
      title: candidate.metadata?.title ?? candidate.title ?? null,
      discount: candidate.metadata?.discount ?? candidate.discount ?? null,
    };
    if (!promo.id && !promo.plan_name && !promo.title) return;
    const key = [promo.id, promo.plan_name, promo.title].filter(Boolean).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    promos.push(promo);
  }

  function visit(candidate, depth = 0) {
    if (depth > 4 || candidate === undefined || candidate === null) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(item => visit(item, depth + 1));
      return;
    }
    if (!isPlainObject(candidate)) return;
    if (candidate.id || candidate.promo_campaign_id || candidate.metadata?.plan_name || candidate.plan_name || candidate.metadata?.title || candidate.title) {
      add(candidate);
      return;
    }
    Object.values(candidate).forEach(item => visit(item, depth + 1));
  }

  values.forEach(value => visit(value));
  return promos;
}

function normalizeBooleanOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  return Boolean(value);
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
  const eligibleOffers = mergeUnique([
    subscriptionEligibleOffers,
    normalizeOfferIds(subscriptionResponse.available_offers),
    normalizeOfferIds(subscriptionResponse.offers),
    normalizeOfferIds(accountRecord.eligible_offers),
    normalizeOfferIds(account.eligible_offers),
    normalizeOfferIds(entitlement.eligible_offers),
  ]);
  const eligiblePromos = normalizeEligiblePromos(
    subscriptionResponse.eligible_promo_campaigns,
    subscriptionResponse.eligible_promos,
    subscriptionResponse.eligible_promotions,
    accountRecord.eligible_promo_campaigns,
    accountRecord.eligible_promos,
    accountRecord.eligible_promotions,
    account.eligible_promo_campaigns,
    account.eligible_promos,
    entitlement.eligible_promo_campaigns,
    entitlement.eligible_promos,
  );
  const cancelsAt = toIsoDate(firstDefined(subscriptionResponse.cancels_at, entitlement.cancels_at));

  return {
    ok: true,
    reason: "ok",
    email: firstDefined(jwt.email, account.email, accountsResponse.email) ?? null,
    account_id: firstDefined(account.account_id, account.id, accountRecord.account_id, jwt.account_id) ?? null,
    user_id: firstDefined(jwt.user_id, account.account_owner_id, account.user_id, accountRecord.user_id) ?? null,
    plan_type: firstDefined(subscriptionResponse.plan_type, account.plan_type, jwt.plan_type_jwt) ?? null,
    plan_type_jwt: jwt.plan_type_jwt,
    subscription_plan: firstDefined(entitlement.subscription_plan, subscriptionResponse.subscription_plan, subscriptionResponse.plan) ?? null,
    subscription_id: firstDefined(entitlement.subscription_id, subscriptionResponse.subscription_id, subscriptionResponse.id) ?? null,
    has_active_subscription: Boolean(firstDefined(
      entitlement.has_active_subscription,
      subscriptionResponse.has_active_subscription,
      subscriptionResponse.is_active,
      false,
    )),
    billing_period: firstDefined(entitlement.billing_period, subscriptionResponse.billing_period) ?? null,
    billing_currency: firstDefined(entitlement.billing_currency, subscriptionResponse.billing_currency) ?? null,
    active_start: activeStart,
    active_start_ms: toEpochMilliseconds(activeStart),
    expires_at: expiresAt,
    expires_at_ms: toEpochMilliseconds(expiresAt),
    renews_at: renewsAt,
    renews_at_ms: toEpochMilliseconds(renewsAt),
    cancels_at: cancelsAt,
    cancels_at_ms: toEpochMilliseconds(cancelsAt),
    ...remaining,
    token_expires_at: tokenExpiresAt,
    token_days_left: tokenRemaining.days_left,
    token_hours_left: tokenRemaining.hours_left,
    will_renew: Boolean(firstDefined(lastActiveSubscription.will_renew, subscriptionResponse.will_renew, false)),
    cancellation_outcome: firstDefined(lastActiveSubscription.cancellation_outcome, subscriptionResponse.cancellation_outcome) ?? null,
    is_delinquent: Boolean(firstDefined(subscriptionResponse.is_delinquent, entitlement.is_delinquent, false)),
    became_delinquent_timestamp: firstDefined(subscriptionResponse.became_delinquent_timestamp, entitlement.became_delinquent_timestamp) ?? null,
    grace_period_end_timestamp: firstDefined(subscriptionResponse.grace_period_end_timestamp, entitlement.grace_period_end_timestamp) ?? null,
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
    is_processor_stripe: normalizeBooleanOrNull(subscriptionResponse.is_processor_stripe),
    seats_entitled: firstDefined(subscriptionResponse.seats_entitled, entitlement.seats_entitled, accountRecord.seats_entitled) ?? null,
    seats_in_use: firstDefined(subscriptionResponse.seats_in_use, entitlement.seats_in_use, accountRecord.seats_in_use) ?? null,
    is_eligible_for_yearly_plus_subscription: normalizeBooleanOrNull(firstDefined(
      accountRecord.is_eligible_for_yearly_plus_subscription,
      account.is_eligible_for_yearly_plus_subscription,
      entitlement.is_eligible_for_yearly_plus_subscription,
      subscriptionResponse.is_eligible_for_yearly_plus_subscription,
    )),
    is_eligible_for_free_trial: normalizeBooleanOrNull(firstDefined(
      accountRecord.is_eligible_for_free_trial,
      account.is_eligible_for_free_trial,
      entitlement.is_eligible_for_free_trial,
      subscriptionResponse.is_eligible_for_free_trial,
    )),
    applied_discounts: mergeUnique([
      normalizeArray(subscriptionResponse.applied_discounts),
      normalizeArray(entitlement.applied_discounts),
      normalizeArray(accountRecord.applied_discounts),
    ]),
    eligible_offers: eligibleOffers,
    eligible_promos: eligiblePromos,
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
