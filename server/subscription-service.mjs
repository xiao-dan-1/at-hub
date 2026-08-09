import { normalizeInput } from "../src/core/jwt.js";
import { normalizeSubscriptionStatus, selectDefaultAccountRecord } from "../src/core/subscription-model.js";

const DEFAULT_ORIGIN = "https://chatgpt.com";
const ACCOUNTS_CHECK_PATH = "/backend-api/accounts/check/v4-2023-04-27";
const SUBSCRIPTIONS_PATH = "/backend-api/subscriptions";
const DEFAULT_BATCH_LIMIT = 20;
const DEFAULT_BATCH_CONCURRENCY = 2;
const UPSTREAM_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  origin: DEFAULT_ORIGIN,
  referer: `${DEFAULT_ORIGIN}/`,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

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
      ...UPSTREAM_HEADERS,
      authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const isCloudflareChallenge = response.status === 403
      && response.headers.get("cf-mitigated") === "challenge";
    const code = isCloudflareChallenge
      ? "upstream-cloudflare-challenge"
      : response.status === 401 || response.status === 403
      ? "upstream-auth-failed"
      : "upstream-http-error";
    const message = isCloudflareChallenge
      ? "上游返回 Cloudflare challenge；请求已到达 ChatGPT，但被网页防护拦截。"
      : `上游查询失败（HTTP ${response.status}）。`;
    throw new SubscriptionQueryError(code, message, response.status);
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
      let subscriptionResponse = {};
      let subscriptionLookupStatus = accountId ? null : "skipped";
      if (accountId) {
        try {
          subscriptionResponse = await queryJson(buildUrl(origin, SUBSCRIPTIONS_PATH, { account_id: accountId }), normalized, fetchFn);
          subscriptionLookupStatus = 200;
        } catch (error) {
          if (error?.status !== 404) throw error;
          subscriptionLookupStatus = 404;
        }
      }

      const model = normalizeSubscriptionStatus({
        token: normalized,
        accountsResponse,
        subscriptionResponse,
        nowMilliseconds,
      });
      return {
        ...model,
        status: 200,
        subscription_lookup_status: subscriptionLookupStatus,
      };
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

function normalizeTokenList(tokens) {
  if (!Array.isArray(tokens)) return [];
  const normalizedTokens = [];
  const seen = new Set();
  for (const token of tokens) {
    const normalized = normalizeInput(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedTokens.push(normalized);
  }
  return normalizedTokens;
}

export function createSubscriptionBatchHandler({
  fetchFn = globalThis.fetch,
  nowMilliseconds = Date.now(),
  origin = DEFAULT_ORIGIN,
  batchLimit = DEFAULT_BATCH_LIMIT,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
} = {}) {
  const handleSingleSubscription = createSubscriptionHandler({ fetchFn, nowMilliseconds, origin });
  const workerCount = Math.max(1, Number(concurrency) || DEFAULT_BATCH_CONCURRENCY);

  return async function handleSubscriptionBatchQuery({ tokens } = {}) {
    const normalizedTokens = normalizeTokenList(tokens);
    if (normalizedTokens.length === 0) {
      return { ok: false, reason: "empty-tokens", message: "请提供至少一个 AT。", status: 400 };
    }
    if (normalizedTokens.length > batchLimit) {
      return {
        ok: false,
        reason: "batch-too-large",
        message: `最多一次查询 ${batchLimit} 个 AT。`,
        status: 400,
        count: normalizedTokens.length,
        max: batchLimit,
      };
    }

    const results = new Array(normalizedTokens.length);
    let cursor = 0;
    async function runWorker() {
      while (cursor < normalizedTokens.length) {
        const index = cursor;
        cursor += 1;
        const token = normalizedTokens[index];
        const result = await handleSingleSubscription({ token });
        results[index] = {
          ...result,
          index: index + 1,
          token_hint: redactToken(token),
        };
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(workerCount, normalizedTokens.length) }, () => runWorker()),
    );
    const successCount = results.filter(result => result?.ok === true).length;
    return {
      ok: true,
      status: 200,
      count: results.length,
      success_count: successCount,
      failure_count: results.length - successCount,
      results,
    };
  };
}
