import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getBuildPages,
  getNavigationPages,
  getPageById,
  getPageByRoute,
  pages,
} from "../src/core/pages.js";

const readText = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("page registry defines build, route, and navigation metadata in one place", () => {
  assert.deepEqual(pages.map(page => page.id), ["index", "live", "subscription"]);

  assert.deepEqual(getPageById("index"), {
    id: "index",
    route: "/",
    aliases: ["/index.html"],
    source: "src/index.html",
    output: "index.html",
    navLabel: "本地解析",
    serviceOnly: false,
  });
  assert.deepEqual(getPageById("subscription"), {
    id: "subscription",
    route: "/subscription",
    aliases: ["/subscription.html"],
    source: "src/subscription.html",
    output: "subscription.html",
    navLabel: "订阅查询",
    serviceOnly: true,
    offlineLabel: "订阅查询 · 需本地服务",
    serviceTitle: "订阅查询需要通过 npm start 打开本地服务",
  });
  assert.deepEqual(getPageById("live"), {
    id: "live",
    route: "/live",
    aliases: ["/live.html"],
    source: "src/live.html",
    output: "live.html",
    navLabel: "AT 测活",
    serviceOnly: true,
    offlineLabel: "AT 测活 · 需本地服务",
    serviceTitle: "AT 测活需要通过 npm start 打开本地服务",
  });
});

test("page registry resolves clean routes and html aliases", () => {
  assert.equal(getPageByRoute("/")?.id, "index");
  assert.equal(getPageByRoute("/index.html")?.id, "index");
  assert.equal(getPageByRoute("/subscription")?.id, "subscription");
  assert.equal(getPageByRoute("/subscription.html")?.id, "subscription");
  assert.equal(getPageByRoute("/live")?.id, "live");
  assert.equal(getPageByRoute("/live.html")?.id, "live");
  assert.equal(getPageByRoute("/missing"), null);
});

test("build and server entry points import the shared page registry", () => {
  assert.match(readText("../vite.config.js"), /from "\.\/src\/core\/pages\.js"/u);
  assert.match(readText("../scripts/build-pages.mjs"), /from "\.\.\/src\/core\/pages\.js"/u);
  assert.match(readText("../server/local-server.mjs"), /from "\.\.\/src\/core\/pages\.js"/u);
  assert.match(readText("../server/dev-server.mjs"), /from "\.\.\/src\/core\/pages\.js"/u);

  assert.deepEqual(getBuildPages().map(page => page.output), ["index.html", "live.html", "subscription.html"]);
  assert.deepEqual(getNavigationPages().map(page => page.navLabel), ["本地解析", "AT 测活", "订阅查询"]);
});
