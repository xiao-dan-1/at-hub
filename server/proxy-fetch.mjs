import { ProxyAgent, fetch as undiciFetch } from "undici";

export function createProxyFetch(proxyUrl, {
  undiciFetch: compatibleFetch = undiciFetch,
  baseFetch = compatibleFetch,
  ProxyAgentCtor = ProxyAgent,
} = {}) {
  const dispatcher = new ProxyAgentCtor(proxyUrl);
  return function proxyFetch(url, init = {}) {
    return baseFetch(url, {
      ...init,
      dispatcher,
    });
  };
}

export function redactProxyUrl(proxyUrl) {
  if (!proxyUrl) return "";
  try {
    const url = new URL(proxyUrl);
    if (url.username) url.username = "user";
    if (url.password) url.password = "pass";
    return url.toString();
  } catch {
    return "[invalid proxy url]";
  }
}
