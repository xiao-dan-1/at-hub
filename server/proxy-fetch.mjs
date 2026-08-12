import { randomBytes } from "node:crypto";
import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from "undici";

function getProxyProtocol(proxyUrl) {
  try {
    return new URL(proxyUrl).protocol;
  } catch {
    return "";
  }
}

export function createProxySessionId() {
  return randomBytes(6).toString("hex");
}

export function rotateProxySessionId(proxyUrl, sessionId = createProxySessionId()) {
  if (!proxyUrl) return proxyUrl;
  try {
    const url = new URL(proxyUrl);
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9]/gu, "");
    if (!safeSessionId) return proxyUrl;
    const rotatedUsername = url.username.replace(/(-sid-)(.*?)(-t-)/u, `$1${safeSessionId}$3`);
    if (rotatedUsername === url.username) return proxyUrl;
    url.username = rotatedUsername;
    return url.toString();
  } catch {
    return proxyUrl;
  }
}

function createDispatcher(proxyUrl, ProxyAgentCtor, Socks5ProxyAgentCtor) {
  const protocol = getProxyProtocol(proxyUrl);
  const AgentCtor = protocol === "socks5:" || protocol === "socks:" ? Socks5ProxyAgentCtor : ProxyAgentCtor;
  return new AgentCtor(proxyUrl);
}

export function createProxyFetch(proxyUrl, {
  undiciFetch: compatibleFetch = undiciFetch,
  baseFetch = compatibleFetch,
  ProxyAgentCtor = ProxyAgent,
  Socks5ProxyAgentCtor = Socks5ProxyAgent,
  mode = "fixed",
  sessionIdFactory = createProxySessionId,
} = {}) {
  const shouldRotate = mode === "rotate";
  const fixedDispatcher = shouldRotate ? null : createDispatcher(proxyUrl, ProxyAgentCtor, Socks5ProxyAgentCtor);
  const rotatedDispatchers = new Map();

  function getRotatedDispatcher(sessionId) {
    const rotatedProxyUrl = rotateProxySessionId(proxyUrl, sessionId);
    const cachedDispatcher = rotatedDispatchers.get(rotatedProxyUrl);
    if (cachedDispatcher) return cachedDispatcher;
    const dispatcher = createDispatcher(rotatedProxyUrl, ProxyAgentCtor, Socks5ProxyAgentCtor);
    rotatedDispatchers.set(rotatedProxyUrl, dispatcher);
    return dispatcher;
  }

  return function proxyFetch(url, init = {}) {
    const { proxySessionId, ...fetchInit } = init ?? {};
    const dispatcher = shouldRotate
      ? getRotatedDispatcher(proxySessionId || sessionIdFactory())
      : fixedDispatcher;
    return baseFetch(url, {
      ...fetchInit,
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
