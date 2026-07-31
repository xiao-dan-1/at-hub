export function formatBeijingTime(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return null;
  }

  const shifted = new Date(seconds * 1000 + 8 * 60 * 60 * 1000);
  if (Number.isNaN(shifted.getTime())) {
    return null;
  }

  return `${shifted.toISOString().slice(0, 19).replace("T", " ")} +08:00`;
}

export function parseNumericDate(payload, key) {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    return { key, present: false, valid: false, raw: undefined };
  }

  const raw = payload[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { key, present: true, valid: false, raw };
  }

  const milliseconds = raw * 1000;
  const beijing = formatBeijingTime(raw);
  if (!Number.isFinite(milliseconds) || beijing === null) {
    return { key, present: true, valid: false, raw };
  }

  return { key, present: true, valid: true, raw, milliseconds, beijing };
}

export function evaluateTimeStatus(payload, nowMilliseconds = Date.now()) {
  const claims = {
    iat: parseNumericDate(payload, "iat"),
    nbf: parseNumericDate(payload, "nbf"),
    exp: parseNumericDate(payload, "exp"),
  };
  const invalidClaims = Object.values(claims)
    .filter(claim => claim.present && !claim.valid)
    .map(claim => claim.key);

  if (claims.nbf.valid && nowMilliseconds < claims.nbf.milliseconds) {
    return { code: "not_yet_valid", label: "尚未生效", claims, invalidClaims };
  }
  if (claims.exp.valid && nowMilliseconds >= claims.exp.milliseconds) {
    return { code: "expired", label: "已过期", claims, invalidClaims };
  }
  if (claims.nbf.valid || claims.exp.valid) {
    return { code: "within_window", label: "在声明时间窗口内", claims, invalidClaims };
  }
  return { code: "missing_time", label: "缺少时间声明", claims, invalidClaims };
}

function formatDisplayValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function formatTimeClaimValue(key, value) {
  const original = formatDisplayValue(value);
  if (!["iat", "nbf", "exp"].includes(String(key).toLowerCase())) {
    return original;
  }
  const beijing = formatBeijingTime(value);
  return beijing === null ? original : `${original}\n北京时间：${beijing}`;
}

export function formatKnownTime(key, value) {
  if (key !== "pwd_auth_time" || typeof value !== "number" || !Number.isFinite(value)) {
    return formatTimeClaimValue(key, value);
  }
  const seconds = Math.abs(value) >= 100_000_000_000 ? value / 1000 : value;
  const beijing = formatBeijingTime(seconds);
  return beijing === null ? formatDisplayValue(value) : `${value}\n北京时间：${beijing}`;
}
