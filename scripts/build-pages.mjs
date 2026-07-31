import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";

async function normalizeBuiltHtml(page) {
  const artifact = new URL(`../dist/${page}.html`, import.meta.url);
  const html = await readFile(artifact, "utf8");
  const normalized = html.replace(/\r\n?/gu, "\n");
  if (normalized !== html) {
    await writeFile(artifact, normalized, "utf8");
  }
}

for (const page of ["index", "subscription"]) {
  process.env.AT_INSPECTOR_PAGE = page;
  await build();
  await normalizeBuiltHtml(page);
}
