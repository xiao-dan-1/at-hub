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

function createFakeNav(currentPage = "index") {
  return {
    dataset: { currentPage },
    children: [],
    replaceChildren(...children) {
      this.children = children;
    },
  };
}

function createFakeDocument({ navs = [], links = [] } = {}) {
  const createdLinks = [];
  return {
    createdLinks,
    createElement(tagName) {
      assert.equal(tagName, "a");
      const attributes = new Map();
      const link = {
        dataset: {},
        className: "",
        textContent: "",
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
        getAttribute(name) {
          return attributes.get(name) ?? null;
        },
        removeAttribute(name) {
          attributes.delete(name);
        },
        addEventListener() {},
      };
      createdLinks.push(link);
      return link;
    },
    querySelectorAll(selector) {
      if (selector === "[data-tool-navigation]") return navs;
      if (selector === "[data-requires-local-service]") {
        return [
          ...links,
          ...createdLinks.filter(link => Object.hasOwn(link.dataset, "requiresLocalService")),
        ];
      }
      return [];
    },
  };
}

test("tool navigation renders registered pages from the shared registry", async () => {
  assert.equal(existsSync(navigationModule), true, "missing shared tool navigation controller");
  const { configureToolNavigation } = await import(`${navigationModule.href}?registry-render`);
  const nav = createFakeNav("subscription");
  const documentRef = createFakeDocument({ navs: [nav] });

  configureToolNavigation({
    documentRef,
    locationRef: { protocol: "http:", pathname: "/subscription" },
  });

  assert.equal(nav.children.length, 3);
  assert.equal(nav.children[0].textContent, "本地解析");
  assert.equal(nav.children[0].getAttribute("href"), "/");
  assert.equal(nav.children[0].getAttribute("aria-current"), null);
  assert.equal(nav.children[1].textContent, "AT 测活");
  assert.equal(nav.children[1].getAttribute("href"), "/live");
  assert.equal(nav.children[1].getAttribute("aria-current"), null);
  assert.equal(nav.children[1].dataset.requiresLocalService, "true");
  assert.equal(nav.children[2].textContent, "订阅查询");
  assert.equal(nav.children[2].getAttribute("href"), "/subscription");
  assert.equal(nav.children[2].getAttribute("aria-current"), "page");
  assert.equal(nav.children[2].dataset.requiresLocalService, "true");
});

test("tool navigation marks service-only links as unavailable in file mode", async () => {
  assert.equal(existsSync(navigationModule), true, "missing shared tool navigation controller");
  const { configureToolNavigation } = await import(`${navigationModule.href}?file-mode`);
  const link = createFakeLink();

  configureToolNavigation({
    documentRef: createFakeDocument({ links: [link] }),
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
    documentRef: createFakeDocument({ links: [link] }),
    locationRef: { protocol: "http:" },
  });

  assert.equal(link.textContent, "订阅查询");
  assert.equal(link.getAttribute("href"), "/subscription");
  assert.equal(link.getAttribute("aria-disabled"), null);
  assert.equal(link.dataset.unavailable, undefined);
});
