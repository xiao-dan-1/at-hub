const SECTION_DEFINITIONS = [
  { id: "identity", title: "账号与身份" },
  { id: "authentication", title: "认证信息" },
  { id: "permissions", title: "权限" },
  { id: "time", title: "时间" },
  { id: "security", title: "安全信息" },
  { id: "other", title: "其他字段" },
];

export function isSensitiveKey(key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
  if (["email", "name", "sub", "jti", "sid", "session_id"].includes(normalized)) {
    return true;
  }
  if (normalized.includes("verified_identity")) {
    return true;
  }
  const identitySubject = ["user", "account", "organization", "org", "workspace"]
    .some(fragment => normalized.includes(fragment));
  if (identitySubject && (normalized.includes("uuid") || normalized.includes("identity"))) {
    return true;
  }
  return /(?:^|_)(?:id|ids|uuid|uuids)$/u.test(normalized);
}

export function redactDeep(value, key = "") {
  if (isSensitiveKey(key)) {
    return Array.isArray(value) ? value.map(() => "[REDACTED]") : "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map(item => redactDeep(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactDeep(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function flattenEntries(value, path = [], output = []) {
  const key = path.at(-1) ?? "";
  const sensitive = isSensitiveKey(key);
  const isObject = value !== null && typeof value === "object";
  const isPrimitiveArray = Array.isArray(value)
    && value.every(item => item === null || typeof item !== "object");

  if (!isObject || sensitive || isPrimitiveArray || Object.keys(value).length === 0) {
    output.push({ key, path: path.join("."), sensitive, value });
    return output;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    flattenEntries(childValue, [...path, childKey], output);
  }
  return output;
}

export function categorizeEntry(entry) {
  const key = entry.key.toLowerCase();
  const path = entry.path.toLowerCase();
  if (["iat", "nbf", "exp"].includes(key)) return "time";
  if (key === "scp" || key.includes("scope") || key.includes("permission")) return "permissions";
  if (path.startsWith("header.") || ["iss", "aud", "client_id"].includes(key)) return "security";
  if (["amr", "email_verified", "is_signup", "pwd_auth_time", "sl"].includes(key)
    || path.includes(".auth.")) return "authentication";
  if (entry.sensitive
    || path.includes("profile")
    || key.includes("plan")
    || key.includes("residency")
    || key.includes("user")
    || key.includes("account")
    || key.includes("organization")
    || key.includes("workspace")) return "identity";
  return "other";
}

export function buildSections(header, payload) {
  const entries = [
    ...flattenEntries(header, ["header"]),
    ...flattenEntries(payload, ["payload"]),
  ];
  return SECTION_DEFINITIONS.map(definition => ({
    ...definition,
    entries: entries.filter(entry => categorizeEntry(entry) === definition.id),
  }));
}
