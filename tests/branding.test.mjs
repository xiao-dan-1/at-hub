import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("project package identity uses at-hub", () => {
  assert.equal(packageJson.name, "at-hub");
  assert.equal(packageLock.name, "at-hub");
  assert.equal(packageLock.packages[""].name, "at-hub");
});

test("user-facing product brand is AT Hub", () => {
  for (const text of [
    readText("../README.md"),
    readText("../src/index.html"),
    readText("../src/subscription.html"),
    readText("../server/local-server.mjs"),
  ]) {
    assert.doesNotMatch(text, /AT Inspector/u);
  }

  assert.match(readText("../README.md"), /^# AT Hub/mu);
  assert.match(readText("../src/index.html"), /<title>AT Hub<\/title>/u);
  assert.match(readText("../src/subscription.html"), /<title>ChatGPT 订阅查询 · AT Hub<\/title>/u);
  assert.match(readText("../server/local-server.mjs"), /AT Hub local service/u);
});
