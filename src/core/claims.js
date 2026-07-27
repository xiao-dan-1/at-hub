import { isSensitiveKey } from "./redaction.js";

export const NAMESPACE_LABELS = new Map([
  ["https://api.openai.com/auth", "OpenAI Auth"],
  ["https://api.openai.com/profile", "OpenAI Profile"],
]);

const CLAIM_DEFINITIONS = {
  alg: { label: "签名算法", description: "Header 声明的签名算法；本工具不会验证签名。", category: "security" },
  typ: { label: "Token 类型", description: "Header 声明的 token 类型。", category: "security" },
  kid: { label: "密钥标识", description: "签发方用于选择验证公钥的标识。", category: "security" },
  iss: { label: "签发方", description: "声明签发 token 的主体。", category: "security" },
  aud: { label: "目标受众", description: "声明 token 预期提供给哪些服务。", category: "security" },
  client_id: { label: "客户端标识", description: "申请该 token 的 OAuth 客户端标识。", category: "security" },
  iat: { label: "签发时间", description: "JWT 的签发时间声明。", category: "time", format: "numeric-date" },
  nbf: { label: "生效时间", description: "JWT 在此时间之前不应生效。", category: "time", format: "numeric-date" },
  exp: { label: "到期时间", description: "JWT 的到期时间声明。", category: "time", format: "numeric-date" },
  pwd_auth_time: { label: "密码认证时间", description: "密码认证发生的时间声明。", category: "authentication", format: "known-time" },
  amr: { label: "认证方式", description: "签发方记录的认证方法。", category: "authentication" },
  email: { label: "邮箱", description: "账号邮箱。", category: "account" },
  email_verified: { label: "邮箱已验证", description: "签发方声明邮箱是否完成验证。", category: "authentication" },
  name: { label: "账号名称", description: "账号显示名称。", category: "account" },
  is_signup: { label: "注册流程", description: "该会话是否来自注册流程。", category: "authentication" },
  sl: { label: "安全级别标记", description: "OpenAI 认证流程携带的安全级别布尔标记。", category: "authentication" },
  chatgpt_plan_type: { label: "JWT 声明的套餐", description: "Token 签发时记录的 ChatGPT 套餐，可能不是当前服务器状态。", category: "account" },
  chatgpt_compute_residency: { label: "计算驻留策略", description: "账号声明的计算数据驻留策略。", category: "account" },
  scp: { label: "权限范围", description: "Token 声明的 OAuth 权限范围。", category: "permissions" },
  sub: { label: "主体标识", description: "JWT 的主体标识。", category: "account" },
  jti: { label: "Token 标识", description: "JWT 的唯一标识。", category: "security" },
  session_id: { label: "会话标识", description: "认证会话标识。", category: "authentication" },
  user_id: { label: "用户标识", description: "账号用户标识。", category: "account" },
  chatgpt_user_id: { label: "ChatGPT 用户标识", description: "ChatGPT 用户标识。", category: "account" },
  chatgpt_account_id: { label: "ChatGPT 账号标识", description: "ChatGPT 账号或工作区标识。", category: "account" },
  chatgpt_account_user_id: { label: "账号成员标识", description: "ChatGPT 账号中的成员标识。", category: "account" },
  verified_org_ids: { label: "已验证组织标识", description: "账号已验证的组织标识列表。", category: "account" },
  verified_ws_ids: { label: "已验证工作区标识", description: "账号已验证的工作区标识列表。", category: "account" },
};

function namespaceLabel(key, fallback) {
  if (NAMESPACE_LABELS.has(key)) return NAMESPACE_LABELS.get(key);
  if (!/^https?:\/\//iu.test(key)) return fallback;
  try {
    const url = new URL(key);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return fallback;
  }
}

function genericIdentifierDefinition(key) {
  if (!isSensitiveKey(key)) return null;
  if (key.includes("workspace") || key.includes("ws_")) {
    return { label: "工作区标识", description: "工作区相关标识。", category: "account" };
  }
  if (key.includes("organization") || key.includes("org")) {
    return { label: "组织标识", description: "组织相关标识。", category: "account" };
  }
  if (key.includes("account")) {
    return { label: "账号标识", description: "账号相关标识。", category: "account" };
  }
  if (key.includes("user")) {
    return { label: "用户标识", description: "用户相关标识。", category: "account" };
  }
  return { label: "敏感标识", description: "默认遮罩的身份或会话标识。", category: "account" };
}

export function describeClaim(key) {
  const normalized = String(key).toLowerCase();
  const definition = CLAIM_DEFINITIONS[normalized] ?? genericIdentifierDefinition(normalized);
  if (!definition) {
    return {
      label: key,
      description: "尚未提供语义解释，已保留原始声明。",
      category: "other",
      known: false,
    };
  }
  return { ...definition, known: true };
}

function formatSearchPreview(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildClaimEntries(header, payload) {
  const output = [];

  function visit(value, context) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        const nextNamespace = context.source === "payload"
          ? namespaceLabel(childKey, context.namespace)
          : context.namespace;
        visit(childValue, {
          source: context.source,
          namespace: nextNamespace,
          path: [...context.path, childKey],
          key: childKey,
        });
      }
      return;
    }

    const definition = describeClaim(context.key);
    const sensitive = isSensitiveKey(context.key);
    output.push({
      source: context.source,
      namespace: context.namespace,
      key: context.key,
      path: context.path.join("."),
      label: definition.label,
      description: definition.description,
      category: definition.category,
      format: definition.format ?? "default",
      sensitive,
      known: definition.known,
      value,
      searchPreview: sensitive ? "" : formatSearchPreview(value),
    });
  }

  visit(header, { source: "header", namespace: "JWT Header", path: ["header"], key: "header" });
  visit(payload, { source: "payload", namespace: "JWT Payload", path: ["payload"], key: "payload" });
  return output;
}

export function selectPreferredClaim(entries, key) {
  return entries.find(entry => entry.key === key && entry.namespace === "OpenAI Auth")
    ?? entries.find(entry => entry.key === key && entry.source === "payload" && entry.namespace === "JWT Payload")
    ?? entries.find(entry => entry.key === key && entry.source === "payload")
    ?? null;
}

export function buildAccountSummary(entries) {
  return {
    plan: selectPreferredClaim(entries, "chatgpt_plan_type"),
    residency: selectPreferredClaim(entries, "chatgpt_compute_residency"),
    authentication: entries.filter(entry => [
      "amr",
      "email_verified",
      "is_signup",
      "pwd_auth_time",
      "sl",
    ].includes(entry.key)),
  };
}
