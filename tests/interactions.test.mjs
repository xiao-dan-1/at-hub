import test from "node:test";
import assert from "node:assert/strict";
import { filterInspectorEntries } from "../src/ui/app.js";
import { copyText, selectTextContent } from "../src/ui/dom.js";
import { createRevealRegistry } from "../src/ui/reveal.js";

test("reveal registry counts down from ten and conceals on expiry", () => {
  let intervalCallback = null;
  let timeoutCallback = null;
  const ticks = [];
  const hidden = [];
  const registry = createRevealRegistry({
    setIntervalFn(callback, delay) {
      assert.equal(delay, 1000);
      intervalCallback = callback;
      return 11;
    },
    clearIntervalFn() {},
    setTimeoutFn(callback, delay) {
      assert.equal(delay, 10_000);
      timeoutCallback = callback;
      return 12;
    },
    clearTimeoutFn() {},
  });

  registry.show("payload.email", {
    onTick: seconds => ticks.push(seconds),
    onHide: () => hidden.push("payload.email"),
  });
  intervalCallback();
  intervalCallback();
  timeoutCallback();

  assert.deepEqual(ticks, [10, 9, 8]);
  assert.deepEqual(hidden, ["payload.email"]);
});

test("reveal registry clears every active field and timer", () => {
  const clearedIntervals = [];
  const clearedTimeouts = [];
  const hidden = [];
  let nextId = 0;
  const registry = createRevealRegistry({
    setIntervalFn() { nextId += 1; return nextId; },
    clearIntervalFn(id) { clearedIntervals.push(id); },
    setTimeoutFn() { nextId += 1; return nextId; },
    clearTimeoutFn(id) { clearedTimeouts.push(id); },
  });

  registry.show("one", { onTick() {}, onHide: () => hidden.push("one") });
  registry.show("two", { onTick() {}, onHide: () => hidden.push("two") });
  registry.clear();

  assert.deepEqual(clearedIntervals, [1, 3]);
  assert.deepEqual(clearedTimeouts, [2, 4]);
  assert.deepEqual(hidden, ["one", "two"]);
});

test("inspector search matches semantics and paths without indexing sensitive values", () => {
  const entries = [
    { path: "payload.plan", key: "chatgpt_plan_type", label: "JWT 声明的套餐", category: "account", searchPreview: "plus", sensitive: false },
    { path: "payload.profile.email", key: "email", label: "邮箱", category: "account", searchPreview: "", sensitive: true },
    { path: "payload.scp", key: "scp", label: "权限范围", category: "permissions", searchPreview: "openid", sensitive: false },
  ];

  assert.deepEqual(filterInspectorEntries(entries, { query: "套餐", category: "all" }).map(entry => entry.key), ["chatgpt_plan_type"]);
  assert.deepEqual(filterInspectorEntries(entries, { query: "payload.scp", category: "all" }).map(entry => entry.key), ["scp"]);
  assert.deepEqual(filterInspectorEntries(entries, { query: "person@example.test", category: "all" }), []);
  assert.deepEqual(filterInspectorEntries(entries, { query: "", category: "permissions" }).map(entry => entry.key), ["scp"]);
});

test("copyText prefers the Clipboard API", async () => {
  const written = [];
  await copyText("safe redacted text", {
    navigatorRef: { clipboard: { async writeText(value) { written.push(value); } } },
    documentRef: null,
  });
  assert.deepEqual(written, ["safe redacted text"]);
});

test("copyText falls back to a temporary local textarea", async () => {
  let appended = null;
  let selected = false;
  let removed = false;
  let command = "";
  const textarea = {
    style: {},
    value: "",
    setAttribute() {},
    select() { selected = true; },
    remove() { removed = true; },
  };
  const documentRef = {
    body: { appendChild(element) { appended = element; } },
    createElement() { return textarea; },
    execCommand(value) { command = value; return true; },
  };

  const mode = await copyText("safe redacted text", { navigatorRef: null, documentRef });
  assert.equal(mode, "fallback");
  assert.equal(appended, textarea);
  assert.equal(textarea.value, "safe redacted text");
  assert.equal(selected, true);
  assert.equal(command, "copy");
  assert.equal(removed, true);
});

test("copyText falls back when the Clipboard API rejects", async () => {
  let command = "";
  const textarea = {
    style: {},
    value: "",
    setAttribute() {},
    select() {},
    remove() {},
  };
  const mode = await copyText("safe redacted text", {
    navigatorRef: { clipboard: { async writeText() { throw new Error("denied"); } } },
    documentRef: {
      body: { appendChild() {} },
      createElement() { return textarea; },
      execCommand(value) { command = value; return true; },
    },
  });

  assert.equal(mode, "fallback");
  assert.equal(command, "copy");
});

test("selectTextContent focuses and selects the complete redacted output", () => {
  const calls = [];
  const range = { selectNodeContents(node) { calls.push(["range", node]); } };
  const selection = {
    removeAllRanges() { calls.push(["clear"]); },
    addRange(value) { calls.push(["add", value]); },
  };
  const node = { focus() { calls.push(["focus"]); } };
  selectTextContent(node, {
    createRange() { return range; },
    defaultView: { getSelection() { return selection; } },
  });

  assert.deepEqual(calls, [
    ["focus"],
    ["range", node],
    ["clear"],
    ["add", range],
  ]);
});
