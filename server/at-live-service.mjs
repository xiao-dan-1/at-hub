import { normalizeInput } from "../src/core/jwt.js";
import { queryJson, redactToken } from "./subscription-service.mjs";

const DEFAULT_ORIGIN = "https://chatgpt.com";
const ME_PATH = "/backend-api/me";
const DEFAULT_BATCH_LIMIT = 100;
const DEFAULT_BATCH_CONCURRENCY = 10;

function buildUrl(origin, path) {
  return new URL(path, origin);
}

function readObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function extractMeProfile(data) {
  const root = readObject(data);
  const user = readObject(root.user);
  const account = readObject(root.account);
  const profile = Object.keys(user).length > 0 ? user : root;
  const avatar = root.image
    ?? root.picture
    ?? root.avatar
    ?? user.image
    ?? user.picture
    ?? user.avatar
    ?? null;

  return {
    email: root.email ?? user.email ?? account.email ?? null,
    user_id: root.user_id ?? root.id ?? user.user_id ?? user.id ?? null,
    name: root.name ?? user.name ?? root.display_name ?? user.display_name ?? null,
    avatar_present: Boolean(avatar),
    profile,
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
  if (normalizedTokens.length > batchLimit) {
    return {
      ok: false,
      reason: "batch-too-large",
      message: `最多一次测活 ${batchLimit} 个 AT。`,
      status: 400,
      count: normalizedTokens.length,
      max: batchLimit,
    };
  }
  return null;
}

export function createAtLiveHandler({
  fetchFn = globalThis.fetch,
  origin = DEFAULT_ORIGIN,
  upstreamTimeoutMilliseconds,
} = {}) {
  return async function handleAtLiveQuery({ token } = {}) {
    const normalized = normalizeInput(token);
    if (!normalized) {
      return { ok: false, alive: null, reason: "empty-token", message: "请提供 AT。", status: 400 };
    }
    if (typeof fetchFn !== "function") {
      return { ok: false, alive: null, reason: "fetch-unavailable", message: "当前 Node 运行时不可用 fetch。", status: 500 };
    }

    try {
      const data = await queryJson(buildUrl(origin, ME_PATH), normalized, fetchFn, { timeoutMilliseconds: upstreamTimeoutMilliseconds });
      const profile = extractMeProfile(data);
      return {
        ok: true,
        alive: true,
        reason: "ok",
        status: 200,
        upstream_status: 200,
        source: "backend-api/me",
        message: "AT 可用，/me 返回账号信息。",
        email: profile.email,
        user_id: profile.user_id,
        name: profile.name,
        avatar_present: profile.avatar_present,
        raw: data,
      };
    } catch (error) {
      if (error?.code === "upstream-auth-failed" && (error.status === 401 || error.status === 403)) {
        return {
          ok: true,
          alive: false,
          reason: "at-inactive",
          status: 200,
          upstream_status: error.status,
          source: "backend-api/me",
          message: `/me 返回 HTTP ${error.status}，AT 不可用或已失效。`,
        };
      }

      return {
        ok: false,
        alive: null,
        reason: error?.code ?? "at-live-query-failed",
        message: error instanceof Error ? error.message : "AT 测活失败。",
        status: error?.status ?? 500,
      };
    }
  };
}

export function createAtLiveBatchHandler({
  fetchFn = globalThis.fetch,
  origin = DEFAULT_ORIGIN,
  batchLimit = DEFAULT_BATCH_LIMIT,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
  upstreamTimeoutMilliseconds,
} = {}) {
  const handleSingle = createAtLiveHandler({ fetchFn, origin, upstreamTimeoutMilliseconds });
  const workerCount = Math.max(1, Number(concurrency) || DEFAULT_BATCH_CONCURRENCY);

  return async function handleAtLiveBatchQuery({ tokens } = {}) {
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
        const result = await handleSingle({ token });
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

    const aliveCount = results.filter(result => result?.ok === true && result?.alive === true).length;
    const inactiveCount = results.filter(result => result?.ok === true && result?.alive === false).length;
    const failureCount = results.length - aliveCount - inactiveCount;

    return {
      ok: true,
      status: 200,
      count: results.length,
      alive_count: aliveCount,
      inactive_count: inactiveCount,
      failure_count: failureCount,
      results,
    };
  };
}
