import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { getPageByRoute } from "../src/core/pages.js";
import { parseCliOptions } from "./local-server.mjs";
import { createAtLiveBatchHandler, createAtLiveHandler } from "./at-live-service.mjs";
import { createProxyFetch, redactProxyUrl } from "./proxy-fetch.mjs";
import { DEFAULT_BODY_LIMIT_BYTES, formatByteLimit, readRequestJson } from "./request-body.mjs";
import { createIpInfoHandler, createSubscriptionBatchHandler, createSubscriptionBatchStream, createSubscriptionHandler } from "./subscription-service.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const viteConfigFile = resolve(projectRoot, "vite.config.js");

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

async function serveDevHtml(vite, request, response, pathname) {
  const page = getPageByRoute(pathname);
  if (!page) return false;

  const sourcePath = resolve(projectRoot, page.source);
  const html = await readFile(sourcePath, "utf8");
  const transformed = await vite.transformIndexHtml(request.url ?? pathname, html);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(transformed);
  return true;
}

async function passToVite(vite, request, response) {
  await new Promise((resolveMiddleware, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      response.off("finish", finish);
      if (error) reject(error);
      else resolveMiddleware();
    };
    response.on("finish", finish);
    vite.middlewares(request, response, finish);
  });
}

export async function startDevServer({
  host = "127.0.0.1",
  port = 5173,
  proxy = "",
  proxyMode = "fixed",
  subscriptionConcurrency,
  liveConcurrency,
  upstreamTimeoutMilliseconds,
  ipInfoTimeoutMilliseconds,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
  fetchFn,
  nowMilliseconds,
  origin,
  createViteServerFn = createViteServer,
} = {}) {
  const vite = await createViteServerFn({
    configFile: viteConfigFile,
    appType: "custom",
    server: {
      host,
      middlewareMode: true,
      watch: {
        usePolling: process.env.CHOKIDAR_USEPOLLING === "true",
      },
    },
  });
  const effectiveFetch = fetchFn ?? (proxy ? createProxyFetch(proxy, { mode: proxyMode }) : undefined);
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

  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    try {
      if (request.method === "GET" && url.pathname === "/api/ip-info") {
        const result = await handleIpInfo();
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/at-live/batch") {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleAtLiveBatch({ tokens: body.tokens });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/at-live") {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleAtLive({ token: body.token });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/subscriptions/stream") {
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
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/subscriptions/batch") {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleSubscriptionBatch({ tokens: body.tokens });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/subscription") {
        const body = await readRequestJson(request, { bodyLimitBytes });
        const result = await handleSubscription({ token: body.token });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        if (await serveDevHtml(vite, request, response, url.pathname)) return;
        await passToVite(vite, request, response);
        if (!response.writableEnded) sendText(response, 404, "Not found.");
        return;
      }

      sendText(response, 405, "Method not allowed");
    } catch (error) {
      vite.ssrFixStacktrace?.(error);
      if (!response.writableEnded) {
        sendJson(response, error?.status ?? 500, {
          ok: false,
          reason: "dev-server-error",
          message: error instanceof Error ? error.message : "开发服务处理失败。",
        });
      }
    }
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveServer({ server, vite });
    });
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const { host, port, proxy, proxyMode, subscriptionConcurrency, liveConcurrency, upstreamTimeoutMilliseconds, ipInfoTimeoutMilliseconds, bodyLimitBytes } = parseCliOptions();
  const { server } = await startDevServer({
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
  console.log(`AT Hub dev service: http://${host}:${displayPort}/subscription${proxyNote}${speedNote}`);
}
