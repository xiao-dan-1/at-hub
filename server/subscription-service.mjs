import { normalizeInput } from "../src/core/jwt.js";
import { normalizeSubscriptionStatus, selectDefaultAccountRecord } from "../src/core/subscription-model.js";

const DEFAULT_ORIGIN = "https://chatgpt.com";
const ACCOUNTS_CHECK_PATH = "/backend-api/accounts/check/v4-2023-04-27";
const SUBSCRIPTIONS_PATH = "/backend-api/subscriptions";

class SubscriptionQueryError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "SubscriptionQueryError";
    this.code = code;
    this.status = status;
  }
}

export function redactToken(token) {
  const normalized = normalizeInput(token);
  if (!normalized) return "";
  if (normalized.length <= 18) return `${normalized.slice(0, 4)}…`;
  return `${normalized.slice(0, 12)}…${normalized.slice(-6)}`;
}

function buildUrl(origin, path, params = {}) {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SubscriptionQueryError("upstream-invalid-json", "上游返回的订阅数据不是有效 JSON。", 502);
  }
}

export async function queryJson(url, token, fetchFn) {
  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "upstream-auth-failed"
      : "upstream-http-error";
    throw new SubscriptionQueryError(code, `上游查询失败（HTTP ${response.status}）。`, response.status);
  }

  return readJsonResponse(response);
}

function readAccountId(accountsResponse) {
  const record = selectDefaultAccountRecord(accountsResponse);
  return record?.account?.account_id ?? record?.account?.id ?? record?.account_id ?? null;
}

export function createSubscriptionHandler({
  fetchFn = globalThis.fetch,
  nowMilliseconds = Date.now(),
  origin = DEFAULT_ORIGIN,
} = {}) {
  return async function handleSubscriptionQuery({ token } = {}) {
    const normalized = normalizeInput(token);
    if (!normalized) {
      return { ok: false, reason: "empty-token", message: "请提供 AT。", status: 400 };
    }
    if (typeof fetchFn !== "function") {
      return { ok: false, reason: "fetch-unavailable", message: "当前 Node 运行时不可用 fetch。" };
    }

    try {
      const accountsResponse = await queryJson(
        buildUrl(origin, ACCOUNTS_CHECK_PATH),
        normalized,
        fetchFn,
      );
      const accountId = readAccountId(accountsResponse);
      const subscriptionResponse = accountId
        ? await queryJson(buildUrl(origin, SUBSCRIPTIONS_PATH, { account_id: accountId }), normalized, fetchFn)
        : {};

      return normalizeSubscriptionStatus({
        token: normalized,
        accountsResponse,
        subscriptionResponse,
        nowMilliseconds,
      });
    } catch (error) {
      return {
        ok: false,
        reason: error?.code ?? "subscription-query-failed",
        message: error instanceof Error ? error.message : "订阅查询失败。",
        status: error?.status ?? 500,
      };
    }
  };
}
