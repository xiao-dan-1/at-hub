export const PERMISSION_HEURISTIC_NOTICE = "风险级别仅用于本地阅读提示，不是 OpenAI 官方权限评级，也不证明服务器会授予该权限。";

const PERMISSION_DEFINITIONS = {
  "organization.write": {
    label: "组织写入",
    description: "声明可执行组织范围的写入操作。",
    risk: "high",
    group: "write",
  },
  "organization.read": {
    label: "组织读取",
    description: "声明可读取组织范围的信息。",
    risk: "medium",
    group: "read",
  },
  "model.request": {
    label: "模型调用",
    description: "声明可向模型发起请求。",
    risk: "medium",
    group: "model",
  },
  "model.read": {
    label: "模型读取",
    description: "声明可读取模型相关信息。",
    risk: "low",
    group: "read",
  },
  offline_access: {
    label: "离线访问",
    description: "声明可在用户不活跃时继续访问授权资源。",
    risk: "medium",
    group: "identity",
  },
  openid: {
    label: "OpenID 身份",
    description: "声明可读取 OpenID 身份。",
    risk: "low",
    group: "identity",
  },
  email: {
    label: "邮箱信息",
    description: "声明可读取账号邮箱。",
    risk: "low",
    group: "identity",
  },
  profile: {
    label: "个人资料",
    description: "声明可读取基础个人资料。",
    risk: "low",
    group: "identity",
  },
};

const UNKNOWN_PERMISSION = {
  label: "未解释权限",
  description: "本工具尚未提供该 scope 的语义解释。",
  risk: "unknown",
  group: "unknown",
};

const RISK_LABELS = {
  high: "高风险",
  medium: "需留意",
  low: "较低关注",
  unknown: "未解释",
};

function displayGroupForScope(scope) {
  if (scope.startsWith("organization.")) return "组织";
  if (scope.startsWith("model.")) return "模型";
  if (["openid", "email", "profile", "offline_access"].includes(scope)) return "身份与会话";
  return "其他";
}

export function interpretScopes(value) {
  if (!Array.isArray(value)) return [];
  const unique = [...new Set(value.filter(scope => typeof scope === "string" && scope.trim()).map(scope => scope.trim()))];
  return unique.map(scope => {
    const definition = PERMISSION_DEFINITIONS[scope] ?? UNKNOWN_PERMISSION;
    return {
      scope,
      ...definition,
      displayGroup: displayGroupForScope(scope),
      riskLabel: RISK_LABELS[definition.risk] ?? RISK_LABELS.unknown,
    };
  });
}

export function filterPermissions(items, filter) {
  if (filter === "high") return items.filter(item => item.risk === "high");
  if (filter === "write") return items.filter(item => item.group === "write");
  if (filter === "identity") return items.filter(item => item.group === "identity");
  return items;
}
