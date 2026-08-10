import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { parseCliOptions } from "./local-server.mjs";
import { createProxyFetch, redactProxyUrl } from "./proxy-fetch.mjs";
import { createSubscriptionBatchHandler, createSubscriptionHandler } from "./subscription-service.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const viteConfigFile = resolve(projectRoot, "vite.config.js");
const BODY_LIMIT_BYTES = 64 * 1024;
const devPages = new Map([
  ["/", "src/index.html"],
  ["/index.html", "src/index.html"],
  ["/subscription", "src/subscription.html"],
  ["/subscription.html", "src/subscription.html"],
]);

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

async function readRequestJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      throw Object.assign(new Error("请求体超过 64 KiB。"), { status: 413 });
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error("请求体必须是 JSON。"), { status: 400 });
  }
}

async function serveDevHtml(vite, request, response, pathname) {
  const page = devPages.get(pathname);
  if (!page) return false;

  const sourcePath = resolve(projectRoot, page);
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
  const effectiveFetch = fetchFn ?? (proxy ? createProxyFetch(proxy) : undefined);
  const handleSubscription = createSubscriptionHandler({ fetchFn: effectiveFetch, nowMilliseconds, origin });
  const handleSubscriptionBatch = createSubscriptionBatchHandler({ fetchFn: effectiveFetch, nowMilliseconds, origin });

  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    try {
      if (request.method === "POST" && url.pathname === "/api/subscriptions/batch") {
        const body = await readRequestJson(request);
        const result = await handleSubscriptionBatch({ tokens: body.tokens });
        sendJson(response, result.ok ? 200 : result.status ?? 502, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/subscription") {
        const body = await readRequestJson(request);
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
  const { host, port, proxy } = parseCliOptions();
  const { server } = await startDevServer({ host, port, proxy });
  const address = server.address();
  const displayPort = typeof address === "object" && address ? address.port : port;
  const proxyNote = proxy ? ` via proxy ${redactProxyUrl(proxy)}` : "";
  console.log(`AT Hub dev service: http://${host}:${displayPort}/subscription${proxyNote}`);
}
