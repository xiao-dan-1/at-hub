import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const navigationModule = new URL("../src/ui/tool-navigation.js", import.meta.url);

function createFakeLink() {
  const attributes = new Map([
    ["href", "/subscription"],
  ]);
  const listeners = new Map();

  return {
    dataset: {
      localServiceLabel: "订阅查询",
      offlineLabel: "订阅查询 · 需本地服务",
      serviceHref: "/subscription",
    },
    textContent: "订阅查询",
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    dispatchClick() {
      let prevented = false;
      listeners.get("click")?.({
        preventDefault() {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

test("tool navigation marks service-only links as unavailable in file mode", async () => {
  assert.equal(existsSync(navigationModule), true, "missing shared tool navigation controller");
  const { configureToolNavigation } = await import(`${navigationModule.href}?file-mode`);
  const link = createFakeLink();

  configureToolNavigation({
    documentRef: { querySelectorAll: () => [link] },
    locationRef: { protocol: "file:" },
  });

  assert.equal(link.textContent, "订阅查询 · 需本地服务");
  assert.equal(link.getAttribute("href"), null);
  assert.equal(link.getAttribute("aria-disabled"), "true");
  assert.equal(link.getAttribute("title"), "订阅查询需要通过 npm start 打开本地服务");
  assert.equal(link.dataset.unavailable, "true");
  assert.equal(link.dispatchClick(), true);
});

test("tool navigation keeps service links active on the local service", async () => {
  assert.equal(existsSync(navigationModule), true, "missing shared tool navigation controller");
  const { configureToolNavigation } = await import(`${navigationModule.href}?local-mode`);
  const link = createFakeLink();

  configureToolNavigation({
    documentRef: { querySelectorAll: () => [link] },
    locationRef: { protocol: "http:" },
  });

  assert.equal(link.textContent, "订阅查询");
  assert.equal(link.getAttribute("href"), "/subscription");
  assert.equal(link.getAttribute("aria-disabled"), null);
  assert.equal(link.dataset.unavailable, undefined);
});
