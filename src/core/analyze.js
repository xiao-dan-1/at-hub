import { buildAccountSummary, buildClaimEntries, selectPreferredClaim } from "./claims.js";
import { decodeJwt } from "./jwt.js";
import { interpretScopes } from "./permissions.js";
import { redactDeep } from "./redaction.js";
import { evaluateTimeStatus } from "./time.js";

const COMMON_SIGNING_ALGORITHMS = new Set([
  "RS256", "RS384", "RS512", "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512", "EdDSA", "HS256", "HS384", "HS512",
]);

function buildWarnings(header, status, permissions) {
  const warnings = [{
    code: "SIGNATURE_UNVERIFIED",
    level: "warning",
    message: "只完成了本地解码，未验证签名、撤销状态或服务器可用性。",
  }];
  const algorithm = typeof header.alg === "string" ? header.alg : "";

  if (!algorithm) {
    warnings.push({ code: "MISSING_ALG", level: "warning", message: "Header 缺少 alg 字段。" });
  } else if (algorithm.toLowerCase() === "none") {
    warnings.push({ code: "ALG_NONE", level: "danger", message: "alg=none 不提供签名保护。" });
  } else if (!COMMON_SIGNING_ALGORITHMS.has(algorithm)) {
    warnings.push({ code: "UNKNOWN_ALG", level: "info", message: `算法 ${algorithm} 不在常见签名算法列表中。` });
  }

  for (const key of status.invalidClaims) {
    warnings.push({
      code: "INVALID_TIME_CLAIM",
      level: "warning",
      message: `${key} 不是有效的 JWT NumericDate 数字。`,
    });
  }
  if (status.code === "expired") {
    warnings.push({ code: "TOKEN_EXPIRED", level: "danger", message: "根据本机时间，该 token 已经过期。" });
  } else if (status.code === "not_yet_valid") {
    warnings.push({ code: "TOKEN_NOT_YET_VALID", level: "warning", message: "根据本机时间，该 token 尚未生效。" });
  } else if (status.code === "missing_time") {
    warnings.push({ code: "MISSING_TIME", level: "warning", message: "Payload 缺少有效的 nbf 和 exp 时间声明。" });
  }

  const highRiskCount = permissions.filter(permission => permission.risk === "high").length;
  if (highRiskCount > 0) {
    warnings.push({
      code: "HIGH_RISK_PERMISSIONS",
      level: "danger",
      message: `发现 ${highRiskCount} 个本地规则标记的高风险写权限。`,
    });
  }
  return warnings;
}

export function analyzeToken(input, nowMilliseconds = Date.now()) {
  const decoded = decodeJwt(input);
  const status = evaluateTimeStatus(decoded.payload, nowMilliseconds);
  const entries = buildClaimEntries(decoded.header, decoded.payload);
  const account = buildAccountSummary(entries);
  const scopeEntry = selectPreferredClaim(entries, "scp");
  const permissions = interpretScopes(scopeEntry?.value);
  const warnings = buildWarnings(decoded.header, status, permissions);
  const redacted = {
    header: redactDeep(decoded.header),
    payload: redactDeep(decoded.payload),
    signature: decoded.signature,
  };

  return {
    decoded,
    status,
    warnings,
    account,
    permissions,
    entries,
    redacted,
  };
}
