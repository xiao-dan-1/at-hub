import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function loadCore() {
  const htmlUrl = new URL("../../index.html", import.meta.url);
  const html = readFileSync(htmlUrl, "utf8");
  const match = html.match(/<script id="app-script">([\s\S]*?)<\/script>/u);

  if (!match) {
    throw new Error("index.html is missing <script id=\"app-script\">");
  }

  const context = {
    Date,
    Intl,
    TextDecoder,
    TextEncoder,
    URLSearchParams,
    clearTimeout,
    console,
    setTimeout,
    atob(value) {
      return Buffer.from(value, "base64").toString("binary");
    },
  };

  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(match[1], context, { filename: "index.html#app-script" });

  if (!context.ATParserCore) {
    throw new Error("app script did not expose globalThis.ATParserCore");
  }

  return context.ATParserCore;
}

export function makeJwt(header, payload, signature = "synthetic-signature") {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [encode(header), encode(payload), signature].join(".");
}

export function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}
