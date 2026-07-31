import { evaluateTimeStatus } from "./time.js";
import { buildSections } from "./redaction.js";

export class ParserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ParserError";
    this.code = code;
  }
}

export function normalizeInput(input) {
  return String(input ?? "").trim().replace(/^Bearer\s+/iu, "").trim();
}

export function decodeJsonObject(segment, label) {
  const codePrefix = label.toUpperCase();
  if (!/^[A-Za-z0-9_-]+={0,2}$/u.test(segment)) {
    throw new ParserError(`${codePrefix}_BASE64URL`, `${label} 不是合法的 Base64URL。`);
  }

  const unpadded = segment.replace(/=+$/u, "");
  if (unpadded.length % 4 === 1) {
    throw new ParserError(`${codePrefix}_BASE64URL`, `${label} 不是合法的 Base64URL。`);
  }

  const padded = unpadded
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new ParserError(`${codePrefix}_BASE64URL`, `${label} 不是合法的 Base64URL。`);
  }

  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ParserError(`${codePrefix}_UTF8`, `${label} 不是合法的 UTF-8 文本。`);
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ParserError(`${codePrefix}_JSON`, `${label} 不是合法的 JSON。`);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ParserError(`${codePrefix}_NOT_OBJECT`, `${label} 顶层必须是 JSON 对象。`);
  }
  return value;
}

export function decodeJwt(input) {
  const normalized = normalizeInput(input);
  if (!normalized) {
    throw new ParserError("EMPTY_INPUT", "请输入一个 AT。数据只会在当前页面内解析。");
  }
  const parts = normalized.split(".");
  if (parts.length !== 3 || parts.some(part => part.length === 0)) {
    throw new ParserError("JWT_STRUCTURE", "AT 必须是由两个点分隔的三段式 JWT。");
  }
  return {
    header: decodeJsonObject(parts[0], "Header"),
    payload: decodeJsonObject(parts[1], "Payload"),
    signature: { present: true, verified: false },
  };
}

const COMMON_SIGNING_ALGORITHMS = new Set([
  "RS256", "RS384", "RS512", "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512", "EdDSA", "HS256", "HS384", "HS512",
]);

function buildWarnings(header, time) {
  const warnings = [{
    code: "SIGNATURE_UNVERIFIED",
    message: "只完成了本地解码，未验证签名、撤销状态或服务器可用性。",
  }];
  const algorithm = typeof header.alg === "string" ? header.alg : "";
  if (!algorithm) warnings.push({ code: "MISSING_ALG", message: "Header 缺少 alg 字段。" });
  else if (algorithm.toLowerCase() === "none") warnings.push({ code: "ALG_NONE", message: "alg=none 不提供签名保护。" });
  else if (!COMMON_SIGNING_ALGORITHMS.has(algorithm)) warnings.push({ code: "UNKNOWN_ALG", message: `算法 ${algorithm} 不在常见签名算法列表中。` });

  for (const key of time.invalidClaims) {
    warnings.push({ code: "INVALID_TIME_CLAIM", message: `${key} 不是有效的 JWT NumericDate 数字。` });
  }
  if (time.code === "expired") warnings.push({ code: "TOKEN_EXPIRED", message: "根据本机时间，该 token 已经过期。" });
  else if (time.code === "not_yet_valid") warnings.push({ code: "TOKEN_NOT_YET_VALID", message: "根据本机时间，该 token 尚未生效。" });
  else if (time.code === "missing_time") warnings.push({ code: "MISSING_TIME", message: "Payload 缺少有效的 nbf 和 exp 时间声明。" });
  return warnings;
}

export function parseJwt(input, nowMilliseconds = Date.now()) {
  const decoded = decodeJwt(input);
  const time = evaluateTimeStatus(decoded.payload, nowMilliseconds);
  const warnings = buildWarnings(decoded.header, time);
  const other = buildSections(decoded.header, decoded.payload).find(section => section.id === "other");
  if (other.entries.length > 0) {
    warnings.push({
      code: "UNKNOWN_CLAIMS",
      message: `发现 ${other.entries.length} 个未分类声明，已保留在“其他字段”中。`,
    });
  }
  return { ...decoded, time, warnings };
}
