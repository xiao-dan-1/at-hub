import { copyFile, readFile } from "node:fs/promises";

const source = new URL("../dist/index.html", import.meta.url);
const target = new URL("../index.html", import.meta.url);
const html = await readFile(source, "utf8");

if (/<script[^>]+src=|<link[^>]+rel=["']stylesheet["']/iu.test(html)) {
  throw new Error("Refusing to publish an HTML file with external runtime assets");
}
if (!html.includes("connect-src 'none'")) {
  throw new Error("Refusing to publish without the offline CSP");
}

await copyFile(source, target);
