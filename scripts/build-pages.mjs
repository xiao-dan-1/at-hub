import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { getBuildPages } from "../src/core/pages.js";

async function normalizeBuiltHtml(output) {
  const artifact = new URL(`../dist/${output}`, import.meta.url);
  const html = await readFile(artifact, "utf8");
  const normalized = html.replace(/\r\n?/gu, "\n");
  if (normalized !== html) {
    await writeFile(artifact, normalized, "utf8");
  }
}

for (const page of getBuildPages()) {
  process.env.AT_INSPECTOR_PAGE = page.id;
  await build();
  await normalizeBuiltHtml(page.output);
}
