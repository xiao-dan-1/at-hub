import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { analyzeToken } from "../src/core/analyze.js";
import { normalizeInput } from "../src/core/jwt.js";
import { normalizeSubscriptionStatus, selectDefaultAccountRecord } from "../src/core/subscription-model.js";

const DEFAULT_ORIGIN = "https://chatgpt.com";
const ACCOUNTS_CHECK_PATH = "/backend-api/accounts/check/v4-2023-04-27";
const SUBSCRIPTIONS_PATH = "/backend-api/subscriptions";
const IP_INFO_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const DEFAULT_BATCH_LIMIT = Number.POSITIVE_INFINITY;
const DEFAULT_BATCH_CONCURRENCY = 10;
const MAX_BATCH_CONCURRENCY = 20;
const MAX_UPSTREAM_DIAGNOSTIC_CHARS = 600;
const TOKEN_SHAPED_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const ACCOUNT_DISABLED_PATTERN = /account[_\s-]*(?:deactivat|disabled|suspend|ban|block|closed|terminated)|(?:deactivat|disabled|suspend|banned|blocked|terminated)|账号.*(?:封|停用|禁用|冻结)/iu;
const TOKEN_INVALIDATED_PATTERN = /token[_\s-]*invalidated|authentication token has been invalidated|try signing in again/iu;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 12_000;
const DEFAULT_IP_INFO_TIMEOUT_MS = 4_000;
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


function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function parseTraceText(text) {
  return Object.fromEntries(
    String(text ?? "")
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex < 1) return null;
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      })
      .filter(Boolean),
  );
}

async function readIpInfoResponse(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (/json/iu.test(contentType) || text.trimStart().startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      throw new SubscriptionQueryError("ip-info-invalid-json", "IP 信息接口返回的数据不是有效 JSON。", 502);
    }
  }
  return parseTraceText(text);
}

function selectIpInfoValue(data, keys) {
  for (const key of keys) {
    if (data?.[key] !== undefined && data[key] !== null && data[key] !== "") return data[key];
  }
  return null;
}

function createUpstreamSessionId() {
  return randomBytes(6).toString("hex");
}

function defaultTimingNow() {
  return performance.now();
}

function elapsedMilliseconds(start, timingNow) {
  return Math.max(0, Math.round(timingNow() - start));
}

function normalizeWorkerCount(concurrency) {
  return Math.min(
    MAX_BATCH_CONCURRENCY,
    Math.max(1, normalizePositiveInteger(concurrency, DEFAULT_BATCH_CONCURRENCY)),
  );
}

function isRetryableUpstreamError(error) {
  const status = Number(error?.status);
  if (error?.code === "upstream-timeout" || error?.code === "upstream-cloudflare-challenge") return true;
  if (status === 429 || (status >= 500 && status <= 599)) return true;
  return error instanceof Error && !Number.isFinite(status);
}

function readErrorCode(error) {
  return error?.code ?? "subscription-query-failed";
}

function readErrorMessage(error) {
  return error instanceof Error ? error.message : "订阅查询失败。";
}

function readErrorStatus(error) {
  return error?.status ?? 500;
}

function readUpstreamErrorDiagnostics(error) {
  return {
    ...(error?.upstream_path ? { upstream_path: error.upstream_path } : {}),
    ...(error?.upstream_error_code ? { upstream_error_code: error.upstream_error_code } : {}),
    ...(error?.upstream_error_message ? { upstream_error_message: error.upstream_error_message } : {}),
    ...(error?.upstream_error_body ? { upstream_error_body: error.upstream_error_body } : {}),
    ...(error?.upstream_error_body_excerpt ? { upstream_error_body_excerpt: error.upstream_error_body_excerpt } : {}),
  };
}

async function queryJsonWithRetry(url, token, fetchFn, {
  timeoutMilliseconds = DEFAULT_UPSTREAM_TIMEOUT_MS,
  proxySessionId,
  refreshProxySessionId,
  maxAttempts = 2,
} = {}) {
  const attemptLimit = Math.max(1, normalizePositiveInteger(maxAttempts, 2));
  let activeProxySessionId = proxySessionId;
  let lastError;

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    try {
      const data = await queryJson(url, token, fetchFn, {
        timeoutMilliseconds,
        proxySessionId: activeProxySessionId,
      });
      return {
        data,
        attempts: attempt,
        retry_count: attempt - 1,
        proxySessionId: activeProxySessionId,
      };
    } catch (error) {
      lastError = error;
      if (error && typeof error === "object") {
        error.attempts = attempt;
        error.retry_count = attempt - 1;
        error.proxySessionId = activeProxySessionId;
      }
      if (attempt >= attemptLimit || !isRetryableUpstreamError(error)) throw error;
      if (typeof refreshProxySessionId === "function") {
        activeProxySessionId = refreshProxySessionId();
      }
    }
  }

  throw lastError;
}

function buildOffersStatus(model, subscriptionDetailStatus) {
  if (subscriptionDetailStatus === "failed") return "unknown";
  if (Array.isArray(model?.eligible_offers) && model.eligible_offers.length > 0) return "confirmed";
  if (Array.isArray(model?.eligible_promos) && model.eligible_promos.length > 0) return "confirmed";
  return "not_returned";
}

function buildAuthFailureDiagnosis(error, localTokenStatus) {
  if (readErrorCode(error) !== "upstream-auth-failed") return {};
  const upstreamDetail = [
    error?.upstream_error_code,
    error?.upstream_error_message,
    error?.upstream_error_body ? JSON.stringify(error.upstream_error_body) : "",
    error?.upstream_error_body_excerpt,
  ].filter(Boolean).join(" ");
  if (ACCOUNT_DISABLED_PATTERN.test(upstreamDetail)) {
    return {
      auth_failure_kind: "account_disabled",
      auth_failure_hint: "accounts/check 明确返回账号停用或封禁信号；优先按账号不可用处理。",
    };
  }
  if (TOKEN_INVALIDATED_PATTERN.test(upstreamDetail)) {
    return {
      auth_failure_kind: "token_invalidated",
      auth_failure_hint: "accounts/check 返回 token_invalidated：该 AT 已被服务端作废，需要重新登录或重新获取 AT；这不是账号封禁的直接证据。",
    };
  }
  if (localTokenStatus === "expired") {
    return {
      auth_failure_kind: "jwt_expired",
      auth_failure_hint: "JWT 声明已过期；这类 401 可以直接归为 AT 过期或已失效。",
    };
  }
  if (localTokenStatus === "not_yet_valid") {
    return {
      auth_failure_kind: "jwt_not_yet_valid",
      auth_failure_hint: "JWT 声明尚未生效；请检查 AT 来源或本机时间。",
    };
  }
  if (localTokenStatus === "parse_failed") {
    return {
      auth_failure_kind: "jwt_parse_failed",
      auth_failure_hint: "AT 本地 JWT 解析失败；优先检查复制内容是否完整。",
    };
  }
  if (localTokenStatus === "missing_time") {
    return {
      auth_failure_kind: "server_rejected_token",
      auth_failure_hint: "JWT 缺少有效期声明且上游拒绝该 AT（HTTP 401）；通常是 AT 不是当前接口接受的凭据。",
    };
  }
  return {
    auth_failure_kind: "server_rejected_token",
    auth_failure_hint: "JWT 本地仍在声明时间窗口内，但上游拒绝该 AT（HTTP 401）；通常是服务器端会话已撤销、刷新，或 AT 不是当前账号可用凭据。",
  };
}

function readLocalTokenDiagnostics(token, nowMilliseconds, error) {
  const model = normalizeSubscriptionStatus({ token, nowMilliseconds });
  const diagnostics = {
    email: model.email,
    account_id: model.account_id,
    user_id: model.user_id,
    plan_type: model.plan_type,
    plan_type_jwt: model.plan_type_jwt,
    token_expires_at: model.token_expires_at,
    token_days_left: model.token_days_left,
    token_hours_left: model.token_hours_left,
    local_token_status: "unknown",
    local_token_status_label: null,
  };

  try {
    const analysis = analyzeToken(token, nowMilliseconds);
    diagnostics.local_token_status = analysis.status.code;
    diagnostics.local_token_status_label = analysis.status.label;
  } catch (parseError) {
    diagnostics.local_token_status = "parse_failed";
    diagnostics.local_token_status_label = "本地解析失败";
    diagnostics.local_parse_error = parseError?.code ?? "parse_failed";
  }

  return {
    ...diagnostics,
    ...buildAuthFailureDiagnosis(error, diagnostics.local_token_status),
  };
}

class SubscriptionQueryError extends Error {
  constructor(code, message, status = 500, diagnostics = {}) {
    super(message);
    this.name = "SubscriptionQueryError";
    this.code = code;
    this.status = status;
    Object.assign(this, diagnostics);
  }
}

export function redactToken(token) {
  const normalized = normalizeInput(token);
  if (!normalized) return "";
  if (normalized.length <= 18) return `${normalized.slice(0, 4)}…`;
  return `${normalized.slice(0, 12)}…${normalized.slice(-6)}`;
}

export function createIpInfoHandler({
  fetchFn = globalThis.fetch,
  ipInfoUrl = IP_INFO_URL,
  proxyUrl = "",
  ipInfoTimeoutMilliseconds = DEFAULT_IP_INFO_TIMEOUT_MS,
} = {}) {
  return async function handleIpInfoQuery() {
    if (typeof fetchFn !== "function") {
      return { ok: false, reason: "fetch-unavailable", message: "当前 Node 运行时不可用 fetch。", status: 500 };
    }

    const timeout = normalizePositiveInteger(ipInfoTimeoutMilliseconds, DEFAULT_IP_INFO_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    timeoutId.unref?.();

    try {
      const response = await fetchFn(ipInfoUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "text/plain, application/json;q=0.8" },
      });
      if (!response.ok) {
        throw new SubscriptionQueryError(
          "ip-info-http-error",
          `IP 信息查询失败（HTTP ${response.status}）。`,
          response.status,
        );
      }
      const data = await readIpInfoResponse(response);
      return {
        ok: true,
        reason: "ok",
        status: 200,
        source: "cloudflare-trace",
        upstream_status: response.status,
        ip: selectIpInfoValue(data, ["ip", "query", "address"]),
        country: selectIpInfoValue(data, ["country", "countryCode", "country_code", "loc"]),
        raw: data,
      };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return {
          ok: false,
          reason: "ip-info-timeout",
          message: `IP 查询超时（${Math.round(timeout / 1000)} 秒）。`,
          status: 504,
        };
      }
      const hasPlaceholderProxy = typeof proxyUrl === "string" && /(?:xxxxxx|changeme|example|<.*>)/iu.test(proxyUrl);
      if (hasPlaceholderProxy) {
        return {
          ok: false,
          reason: "proxy-not-configured",
          message: "IP 信息查询失败：AT_INSPECTOR_PROXY 仍是占位符，请在 .env 里换成真实代理后重启本机服务。",
          status: 500,
        };
      }
      return {
        ok: false,
        reason: error?.code ?? "ip-info-query-failed",
        message: error instanceof Error ? error.message : "IP 信息查询失败。",
        status: error?.status ?? 500,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  };
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

function sanitizeDiagnosticText(value) {
  const text = String(value ?? "")
    .replaceAll(TOKEN_SHAPED_PATTERN, "[redacted-token]")
    .replace(/\s+/gu, " ")
    .trim();
  if (text.length <= MAX_UPSTREAM_DIAGNOSTIC_CHARS) return text;
  return `${text.slice(0, MAX_UPSTREAM_DIAGNOSTIC_CHARS)}…`;
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return sanitizeDiagnosticText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeDiagnosticValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).slice(0, 80).map(([key, item]) => [key, sanitizeDiagnosticValue(item, depth + 1)]),
    );
  }
  return String(value ?? "");
}

function readNestedValue(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = current[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : null;
}

function firstDiagnosticValue(data, paths) {
  for (const path of paths) {
    const value = readNestedValue(data, path);
    if (value) return sanitizeDiagnosticText(value);
  }
  return null;
}

async function readUpstreamFailureDiagnostics(response, url) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }

  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  const diagnostics = {
    upstream_path: new URL(String(url)).pathname,
  };
  if (data && typeof data === "object") {
    diagnostics.upstream_error_body = sanitizeDiagnosticValue(data);
    const code = firstDiagnosticValue(data, [
      ["error", "code"],
      ["code"],
      ["reason"],
      ["error", "type"],
      ["type"],
    ]);
    const message = firstDiagnosticValue(data, [
      ["error", "message"],
      ["message"],
      ["detail"],
      ["error", "detail"],
      ["error_description"],
    ]);
    if (code) diagnostics.upstream_error_code = code;
    if (message) diagnostics.upstream_error_message = message;
  }
  const excerpt = sanitizeDiagnosticText(text);
  if (excerpt && !diagnostics.upstream_error_body) diagnostics.upstream_error_body_excerpt = excerpt;
  return diagnostics;
}

export async function queryJson(url, token, fetchFn, {
  timeoutMilliseconds = DEFAULT_UPSTREAM_TIMEOUT_MS,
  proxySessionId,
} = {}) {
  const timeout = normalizePositiveInteger(timeoutMilliseconds, DEFAULT_UPSTREAM_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  timeoutId.unref?.();

  try {
    const requestInit = {
      method: "GET",
      signal: controller.signal,
      headers: {
        ...UPSTREAM_HEADERS,
        authorization: `Bearer ${token}`,
      },
    };
    if (proxySessionId) requestInit.proxySessionId = proxySessionId;
    const response = await fetchFn(url, requestInit);

    if (!response.ok) {
      const isCloudflareChallenge = response.status === 403
        && response.headers.get("cf-mitigated") === "challenge";
      const diagnostics = await readUpstreamFailureDiagnostics(response, url);
      const code = isCloudflareChallenge
        ? "upstream-cloudflare-challenge"
        : response.status === 401 || response.status === 403
        ? "upstream-auth-failed"
        : "upstream-http-error";
      const message = isCloudflareChallenge
        ? "上游返回 Cloudflare challenge；请求已到达 ChatGPT，但被网页防护拦截。"
        : `上游查询失败（HTTP ${response.status}）。`;
      throw new SubscriptionQueryError(code, message, response.status, diagnostics);
    }

    return await readJsonResponse(response);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new SubscriptionQueryError("upstream-timeout", `上游查询超时（${Math.round(timeout / 1000)} 秒）。`, 504);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readAccountId(accountsResponse) {
  const record = selectDefaultAccountRecord(accountsResponse);
  return record?.account?.account_id ?? record?.account?.id ?? record?.account_id ?? null;
}

export function createSubscriptionHandler({
  fetchFn = globalThis.fetch,
  nowMilliseconds = Date.now(),
  origin = DEFAULT_ORIGIN,
  upstreamTimeoutMilliseconds = DEFAULT_UPSTREAM_TIMEOUT_MS,
  proxySessionIdFactory = createUpstreamSessionId,
  timingNow = defaultTimingNow,
} = {}) {
  return async function handleSubscriptionQuery({ token } = {}) {
    const totalStart = timingNow();
    let accountsMilliseconds = 0;
    let subscriptionMilliseconds = 0;
    let accountsAttempts = 0;
    let subscriptionAttempts = 0;
    let retryCount = 0;
    const normalized = normalizeInput(token);
    if (!normalized) {
      return {
        ok: false,
        reason: "empty-token",
        message: "请提供 AT。",
        status: 400,
        accounts_ms: accountsMilliseconds,
        subscription_ms: subscriptionMilliseconds,
        total_ms: elapsedMilliseconds(totalStart, timingNow),
        accounts_attempts: accountsAttempts,
        subscription_attempts: subscriptionAttempts,
        retry_count: retryCount,
      };
    }
    if (typeof fetchFn !== "function") {
      return {
        ok: false,
        reason: "fetch-unavailable",
        message: "当前 Node 运行时不可用 fetch。",
        accounts_ms: accountsMilliseconds,
        subscription_ms: subscriptionMilliseconds,
        total_ms: elapsedMilliseconds(totalStart, timingNow),
        accounts_attempts: accountsAttempts,
        subscription_attempts: subscriptionAttempts,
        retry_count: retryCount,
      };
    }

    let proxySessionId = typeof proxySessionIdFactory === "function"
      ? proxySessionIdFactory(normalized)
      : undefined;
    const refreshProxySessionId = () => {
      proxySessionId = typeof proxySessionIdFactory === "function"
        ? proxySessionIdFactory(normalized)
        : undefined;
      return proxySessionId;
    };

    try {
      let accountsResponse;
      try {
        const accountsLookup = await queryJsonWithRetry(
          buildUrl(origin, ACCOUNTS_CHECK_PATH),
          normalized,
          fetchFn,
          {
            timeoutMilliseconds: upstreamTimeoutMilliseconds,
            proxySessionId,
            refreshProxySessionId,
          },
        );
        accountsResponse = accountsLookup.data;
        accountsAttempts = accountsLookup.attempts;
        retryCount += accountsLookup.retry_count;
        proxySessionId = accountsLookup.proxySessionId;
      } catch (error) {
        accountsAttempts = error?.attempts ?? Math.max(accountsAttempts, 1);
        retryCount += error?.retry_count ?? 0;
        throw error;
      } finally {
        accountsMilliseconds = elapsedMilliseconds(totalStart, timingNow);
      }
      const accountId = readAccountId(accountsResponse);
      let subscriptionResponse = {};
      let subscriptionLookupStatus = accountId ? null : "skipped";
      let subscriptionDetailStatus = accountId ? "pending" : "skipped";
      let subscriptionDetailReason = null;
      let subscriptionDetailMessage = null;
      if (accountId) {
        const subscriptionStart = timingNow();
        try {
          const subscriptionLookup = await queryJsonWithRetry(
            buildUrl(origin, SUBSCRIPTIONS_PATH, { account_id: accountId }),
            normalized,
            fetchFn,
            {
              timeoutMilliseconds: upstreamTimeoutMilliseconds,
              proxySessionId,
              refreshProxySessionId,
            },
          );
          subscriptionResponse = subscriptionLookup.data;
          subscriptionAttempts = subscriptionLookup.attempts;
          retryCount += subscriptionLookup.retry_count;
          proxySessionId = subscriptionLookup.proxySessionId;
          subscriptionLookupStatus = 200;
          subscriptionDetailStatus = "ok";
        } catch (error) {
          subscriptionAttempts = error?.attempts ?? Math.max(subscriptionAttempts, 1);
          retryCount += error?.retry_count ?? 0;
          if (error?.status === 404) {
            subscriptionLookupStatus = 404;
            subscriptionDetailStatus = "not_found";
          } else {
            subscriptionLookupStatus = readErrorStatus(error);
            subscriptionDetailStatus = "failed";
            subscriptionDetailReason = readErrorCode(error);
            subscriptionDetailMessage = readErrorMessage(error);
          }
        } finally {
          subscriptionMilliseconds = elapsedMilliseconds(subscriptionStart, timingNow);
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
        account_lookup_status: 200,
        subscription_lookup_status: subscriptionLookupStatus,
        subscription_detail_status: subscriptionDetailStatus,
        subscription_detail_reason: subscriptionDetailReason,
        subscription_detail_message: subscriptionDetailMessage,
        offers_status: buildOffersStatus(model, subscriptionDetailStatus),
        accounts_ms: accountsMilliseconds,
        subscription_ms: subscriptionMilliseconds,
        total_ms: elapsedMilliseconds(totalStart, timingNow),
        accounts_attempts: accountsAttempts,
        subscription_attempts: subscriptionAttempts,
        retry_count: retryCount,
      };
    } catch (error) {
      const localDiagnostics = readLocalTokenDiagnostics(normalized, nowMilliseconds, error);
      return {
        ok: false,
        ...localDiagnostics,
        ...readUpstreamErrorDiagnostics(error),
        reason: readErrorCode(error),
        message: readErrorMessage(error),
        status: readErrorStatus(error),
        accounts_ms: accountsMilliseconds,
        subscription_ms: subscriptionMilliseconds,
        total_ms: elapsedMilliseconds(totalStart, timingNow),
        accounts_attempts: accountsAttempts,
        subscription_attempts: subscriptionAttempts,
        retry_count: retryCount,
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

function createBatchValidationResult(normalizedTokens, batchLimit) {
  if (normalizedTokens.length === 0) {
    return { ok: false, reason: "empty-tokens", message: "请提供至少一个 AT。", status: 400 };
  }
  const finiteBatchLimit = Number.isFinite(batchLimit) && batchLimit > 0 ? Math.floor(batchLimit) : null;
  if (finiteBatchLimit !== null && normalizedTokens.length > finiteBatchLimit) {
    return {
      ok: false,
      reason: "batch-too-large",
      message: `最多一次查询 ${finiteBatchLimit} 个 AT。`,
      status: 400,
      count: normalizedTokens.length,
      max: finiteBatchLimit,
    };
  }
  return null;
}

export function createSubscriptionBatchHandler({
  fetchFn = globalThis.fetch,
  nowMilliseconds = Date.now(),
  origin = DEFAULT_ORIGIN,
  batchLimit = DEFAULT_BATCH_LIMIT,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
  upstreamTimeoutMilliseconds = DEFAULT_UPSTREAM_TIMEOUT_MS,
  proxySessionIdFactory = createUpstreamSessionId,
  timingNow = defaultTimingNow,
} = {}) {
  const handleSingleSubscription = createSubscriptionHandler({
    fetchFn,
    nowMilliseconds,
    origin,
    upstreamTimeoutMilliseconds,
    proxySessionIdFactory,
    timingNow,
  });
  const workerCount = normalizeWorkerCount(concurrency);

  return async function handleSubscriptionBatchQuery({ tokens } = {}) {
    const normalizedTokens = normalizeTokenList(tokens);
    const validationError = createBatchValidationResult(normalizedTokens, batchLimit);
    if (validationError) return validationError;

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

export function createSubscriptionBatchStream({
  fetchFn = globalThis.fetch,
  nowMilliseconds = Date.now(),
  origin = DEFAULT_ORIGIN,
  batchLimit = DEFAULT_BATCH_LIMIT,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
  upstreamTimeoutMilliseconds = DEFAULT_UPSTREAM_TIMEOUT_MS,
  proxySessionIdFactory = createUpstreamSessionId,
  timingNow = defaultTimingNow,
} = {}) {
  const handleSingleSubscription = createSubscriptionHandler({
    fetchFn,
    nowMilliseconds,
    origin,
    upstreamTimeoutMilliseconds,
    proxySessionIdFactory,
    timingNow,
  });
  const workerCount = normalizeWorkerCount(concurrency);

  return async function* streamSubscriptionBatchQuery({ tokens } = {}) {
    const normalizedTokens = normalizeTokenList(tokens);
    const validationError = createBatchValidationResult(normalizedTokens, batchLimit);
    if (validationError) {
      yield { event: "error", data: validationError };
      return;
    }

    yield { event: "start", data: { count: normalizedTokens.length } };

    const queue = [];
    const waiters = [];
    let cursor = 0;
    let activeWorkers = 0;
    let completedWorkers = 0;
    let successCount = 0;

    function push(event) {
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else queue.push(event);
    }

    function nextEvent() {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      return new Promise(resolve => waiters.push(resolve));
    }

    async function runWorker() {
      activeWorkers += 1;
      while (cursor < normalizedTokens.length) {
        const index = cursor;
        cursor += 1;
        const token = normalizedTokens[index];
        const result = await handleSingleSubscription({ token });
        if (result?.ok === true) successCount += 1;
        push({
          event: "item",
          data: {
            ...result,
            index: index + 1,
            token_hint: redactToken(token),
          },
        });
      }
      completedWorkers += 1;
      if (completedWorkers === activeWorkers) {
        push({
          event: "done",
          data: {
            ok: true,
            status: 200,
            count: normalizedTokens.length,
            success_count: successCount,
            failure_count: normalizedTokens.length - successCount,
          },
        });
      }
    }

    const workers = Array.from(
      { length: Math.min(workerCount, normalizedTokens.length) },
      () => runWorker(),
    );

    while (completedWorkers < workers.length || queue.length > 0) {
      const event = await nextEvent();
      yield event;
      if (event.event === "done") break;
    }

    await Promise.all(workers);
  };
}
