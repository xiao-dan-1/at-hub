export const DEFAULT_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export function parseBodyLimitBytes(value, fallback = DEFAULT_BODY_LIMIT_BYTES) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

export function formatByteLimit(value) {
  const bytes = parseBodyLimitBytes(value);
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
  if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} bytes`;
}

export async function readRequestJson(request, {
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
} = {}) {
  const limit = parseBodyLimitBytes(bodyLimitBytes);
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw Object.assign(new Error(`请求体超过 ${formatByteLimit(limit)}。`), {
        status: 413,
        limit,
      });
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks, size).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error("请求体必须是 JSON。"), { status: 400 });
  }
}
