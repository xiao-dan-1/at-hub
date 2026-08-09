import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createProxyFetch, redactProxyUrl } from "./proxy-fetch.mjs";
import { createSubscriptionBatchHandler, createSubscriptionHandler } from "./subscription-service.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultDistDir = join(projectRoot, "dist");
const BODY_LIMIT_BYTES = 64 * 1024;

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
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

function routeToFile(pathname, distDir) {
  const cleanedPath = pathname === "/" ? "/index.html" : pathname;
  const mappedPath = cleanedPath === "/subscription" ? "/subscription.html" : cleanedPath;
  const decodedPath = decodeURIComponent(mappedPath);
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
} = {}) {
  const handleSubscription = createSubscriptionHandler({ fetchFn, nowMilliseconds, origin });
  const handleSubscriptionBatch = createSubscriptionBatchHandler({ fetchFn, nowMilliseconds, origin });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);

    if (request.method === "POST" && url.pathname === "/api/subscriptions/batch") {
      try {
        const body = await readRequestJson(request);
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
        const body = await readRequestJson(request);
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
    }
  }

  return options;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const { host, port, proxy } = parseCliOptions();
  const server = await startLocalServer({
    host,
    port,
    fetchFn: proxy ? createProxyFetch(proxy) : undefined,
  });
  const address = server.address();
  const displayPort = typeof address === "object" && address ? address.port : port;
  const proxyNote = proxy ? ` via proxy ${redactProxyUrl(proxy)}` : "";
  console.log(`AT Hub local service: http://${host}:${displayPort}/subscription${proxyNote}`);
}
