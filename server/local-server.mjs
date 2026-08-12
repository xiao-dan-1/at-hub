import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getPageByRoute } from "../src/core/pages.js";
import { createAtLiveBatchHandler, createAtLiveHandler } from "./at-live-service.mjs";
import { createProxyFetch, redactProxyUrl } from "./proxy-fetch.mjs";
import { DEFAULT_BODY_LIMIT_BYTES, formatByteLimit, parseBodyLimitBytes, readRequestJson } from "./request-body.mjs";
import { createIpInfoHandler, createSubscriptionBatchHandler, createSubscriptionBatchStream, createSubscriptionHandler } from "./subscription-service.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultDistDir = join(projectRoot, "dist");
const DEFAULT_SUBSCRIPTION_CONCURRENCY = 10;
const MAX_SUBSCRIPTION_CONCURRENCY = 20;
const DEFAULT_LIVE_CONCURRENCY = 10;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 12_000;
const DEFAULT_IP_INFO_TIMEOUT_MS = 4_000;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

function normalizeProxyMode(value) {
  return String(value ?? "fixed").trim().toLowerCase() === "rotate" ? "rotate" : "fixed";
}

function parsePositiveInteger(value, fallback, { max } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  const integer = Math.floor(number);
  return Number.isFinite(max) ? Math.min(integer, max) : integer;
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function sendText(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(value);
}

function sendEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function routeToFile(pathname, distDir) {
  const page = getPageByRoute(pathname);
  if (page) {
    const absolutePath = resolve(join(distDir, page.output));
    const absoluteDistDir = resolve(distDir);
    if (absolutePath !== absoluteDistDir && !absolutePath.startsWith(`${absoluteDistDir}${sep}`)) return null;
    return absolutePath;
  }

  const cleanedPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(cleanedPath);
  const absolutePath = resolve(join(distDir, decodedPath));
  const absoluteDistDir = resolve(distDir);
  if (absolutePath !== absoluteDistDir && !absolutePath.startsWith(`${absoluteDistDir}${sep}`)) return null;
  return absolutePath;
}

async function serveStatic(request, response, distDir) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const filePath = routeToFile(url.pathname, distDir);
  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  } catch {
    sendText(response, 404, "Not found. 请先运行 npm run build。");
  }
}

export function startLocalServer({
  host = "127.0.0.1",
  port = 5173,
  distDir = defaultDistDir,
  fetchFn,
  nowMilliseconds,
  origin,
  proxy = "",
  proxyMode = "fixed",
  subscriptionConcurrency = DEFAULT_SUBSCRIPTION_CONCURRENCY,
  liveConcurrency = DEFAULT_LIVE_CONCURRENCY,
  upstreamTimeoutMilliseconds = DEFAULT_UPSTREAM_TIMEOUT_MS,
  ipInfoTimeoutMilliseconds = DEFAULT_IP_INFO_TIMEOUT_MS,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
} = {}) {
  const normalizedProxyMode = normalizeProxyMode(proxyMode);
  const effectiveFetch = fetchFn ?? (proxy ? createProxyFetch(proxy, { mode: normalizedProxyMode }) : undefined);
  const handleIpInfo = createIpInfoHandler({ fetchFn: effectiveFetch, proxyUrl: proxy, ipInfoTimeoutMilliseconds });
  const handleAtLive = createAtLiveHandler({ fetchFn: effectiveFetch, origin, upstreamTimeoutMilliseconds });
  const handleAtLiveBatch = createAtLiveBatchHandler({
    fetchFn: effectiveFetch,
    origin,
    concurrency: liveConcurrency,
    upstreamTimeoutMilliseconds,
  });
  const handleSubscription = createSubscriptionHandler({ fetchFn: effectiveFetch, nowMilliseconds, origin, upstreamTimeoutMilliseconds });
  const handleSubscriptionBatch = createSubscriptionBatchHandler({
    fetchFn: effectiveFetch,
    nowMilliseconds,
    origin,
    concurrency: subscriptionConcurrency,
    upstreamTimeoutMilliseconds,
  });
  const streamSubscriptionBatch = createSubscriptionBatchStream({
    fetchFn: effectiveFetch,
    nowMilliseconds,
    origin,
    concurrency: subscriptionConcurrency,
    upstreamTimeoutMilliseconds,
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "GET" && url.pathname === "/api/ip-info") {
      const result = await handleIpInfo();
      sendJson(response, result.ok ? 200 : result.status ?? 502, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/at-live/batch") {
      try {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleAtLiveBatch({ tokens: body.tokens });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
      } catch (error) {
        sendJson(response, error?.status ?? 500, {
          ok: false,
          reason: "local-request-error",
          message: error instanceof Error ? error.message : "本机服务处理失败。",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/at-live") {
      try {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleAtLive({ token: body.token });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
      } catch (error) {
        sendJson(response, error?.status ?? 500, {
          ok: false,
          reason: "local-request-error",
          message: error instanceof Error ? error.message : "本机服务处理失败。",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/subscriptions/stream") {
      try {
        const body = await readRequestJson(request, { bodyLimitBytes });
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        for await (const message of streamSubscriptionBatch({ tokens: body.tokens })) {
          sendEvent(response, message.event, message.data);
        }
        response.end();
      } catch (error) {
        if (!response.headersSent) {
          sendJson(response, error?.status ?? 500, {
            ok: false,
            reason: "local-request-error",
            message: error instanceof Error ? error.message : "本机服务处理失败。",
          });
        } else {
          sendEvent(response, "error", {
            ok: false,
            reason: "local-request-error",
            message: error instanceof Error ? error.message : "本机服务处理失败。",
            status: error?.status ?? 500,
          });
          response.end();
        }
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/subscriptions/batch") {
      try {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleSubscriptionBatch({ tokens: body.tokens });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
      } catch (error) {
        sendJson(response, error?.status ?? 500, {
          ok: false,
          reason: "local-request-error",
          message: error instanceof Error ? error.message : "本机服务处理失败。",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/subscription") {
      try {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleSubscription({ token: body.token });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
      } catch (error) {
        sendJson(response, error?.status ?? 500, {
          ok: false,
          reason: "local-request-error",
          message: error instanceof Error ? error.message : "本机服务处理失败。",
        });
      }
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response, distDir);
      return;
    }

    sendText(response, 405, "Method not allowed");
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveServer(server);
    });
  });
}

export function parseCliOptions(argv = process.argv, env = process.env) {
  const options = {
    host: env.AT_INSPECTOR_HOST ?? "127.0.0.1",
    port: Number(env.AT_INSPECTOR_PORT ?? 5173),
    proxy: env.AT_INSPECTOR_PROXY || "",
    proxyMode: normalizeProxyMode(env.AT_INSPECTOR_PROXY_MODE),
    subscriptionConcurrency: parsePositiveInteger(
      env.AT_INSPECTOR_SUBSCRIPTION_CONCURRENCY,
      DEFAULT_SUBSCRIPTION_CONCURRENCY,
      { max: MAX_SUBSCRIPTION_CONCURRENCY },
    ),
    liveConcurrency: parsePositiveInteger(env.AT_INSPECTOR_LIVE_CONCURRENCY, DEFAULT_LIVE_CONCURRENCY),
    upstreamTimeoutMilliseconds: parsePositiveInteger(env.AT_INSPECTOR_UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS),
    ipInfoTimeoutMilliseconds: parsePositiveInteger(env.AT_INSPECTOR_IP_TIMEOUT_MS, DEFAULT_IP_INFO_TIMEOUT_MS),
    bodyLimitBytes: parseBodyLimitBytes(env.AT_INSPECTOR_BODY_LIMIT_BYTES),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--host" && next) {
      options.host = next;
      index += 1;
    } else if (argument === "--port" && next) {
      options.port = Number(next);
      index += 1;
    } else if (argument === "--proxy" && next) {
      options.proxy = next;
      index += 1;
    } else if (argument === "--proxy-mode" && next) {
      options.proxyMode = normalizeProxyMode(next);
      index += 1;
    } else if (argument === "--subscription-concurrency" && next) {
      options.subscriptionConcurrency = parsePositiveInteger(next, options.subscriptionConcurrency, { max: MAX_SUBSCRIPTION_CONCURRENCY });
      index += 1;
    } else if (argument === "--live-concurrency" && next) {
      options.liveConcurrency = parsePositiveInteger(next, options.liveConcurrency);
      index += 1;
    } else if (argument === "--upstream-timeout-ms" && next) {
      options.upstreamTimeoutMilliseconds = parsePositiveInteger(next, options.upstreamTimeoutMilliseconds);
      index += 1;
    } else if (argument === "--ip-timeout-ms" && next) {
      options.ipInfoTimeoutMilliseconds = parsePositiveInteger(next, options.ipInfoTimeoutMilliseconds);
      index += 1;
    } else if (argument === "--body-limit-bytes" && next) {
      options.bodyLimitBytes = parseBodyLimitBytes(next, options.bodyLimitBytes);
      index += 1;
    }
  }

  return options;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const { host, port, proxy, proxyMode, subscriptionConcurrency, liveConcurrency, upstreamTimeoutMilliseconds, ipInfoTimeoutMilliseconds, bodyLimitBytes } = parseCliOptions();
  const server = await startLocalServer({
    host,
    port,
    proxy,
    proxyMode,
    subscriptionConcurrency,
    liveConcurrency,
    upstreamTimeoutMilliseconds,
    ipInfoTimeoutMilliseconds,
    bodyLimitBytes,
  });
  const address = server.address();
  const displayPort = typeof address === "object" && address ? address.port : port;
  const proxyNote = proxy ? ` via proxy ${redactProxyUrl(proxy)} mode=${proxyMode}` : "";
  const speedNote = ` subscriptionConcurrency=${subscriptionConcurrency} liveConcurrency=${liveConcurrency} timeout=${upstreamTimeoutMilliseconds}ms ipTimeout=${ipInfoTimeoutMilliseconds}ms bodyLimit=${formatByteLimit(bodyLimitBytes)}`;
  console.log(`AT Hub local service: http://${host}:${displayPort}/subscription${proxyNote}${speedNote}`);
}
