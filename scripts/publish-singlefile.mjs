import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../dist/index.html", import.meta.url);
const target = new URL("../index.html", import.meta.url);
const html = await readFile(source, "utf8");

// Only the zero-upload parser is published to the root double-click entry.
// The subscription query page intentionally remains behind the local service.
if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["']/iu.test(html)) {
  throw new Error("Refusing to publish an HTML file with external runtime assets");
}
if (!html.includes("connect-src 'none'")) {
  throw new Error("Refusing to publish without the offline CSP");
}
if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/u.test(html)) {
  throw new Error("Refusing to publish an artifact containing network APIs");
}

await writeFile(target, html, "utf8");
