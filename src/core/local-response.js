function previewText(text) {
  const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return "空响应";
  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized;
}

export async function readLocalServiceJson(response, { serviceName = "本机服务" } = {}) {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    const status = Number.isFinite(response?.status) ? response.status : "未知";
    throw new Error(`${serviceName} 返回的不是 JSON（HTTP ${status}）：${previewText(text)}。请确认本地服务已更新并重启。`);
  }
}
