import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from "undici";

function getProxyProtocol(proxyUrl) {
  try {
    return new URL(proxyUrl).protocol;
  } catch {
    return "";
  }
}

export function createProxyFetch(proxyUrl, {
  undiciFetch: compatibleFetch = undiciFetch,
  baseFetch = compatibleFetch,
  ProxyAgentCtor = ProxyAgent,
  Socks5ProxyAgentCtor = Socks5ProxyAgent,
} = {}) {
  const protocol = getProxyProtocol(proxyUrl);
  const AgentCtor = protocol === "socks5:" || protocol === "socks:" ? Socks5ProxyAgentCtor : ProxyAgentCtor;
  const dispatcher = new AgentCtor(proxyUrl);
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
