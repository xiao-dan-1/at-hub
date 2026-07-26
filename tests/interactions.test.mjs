import test from "node:test";
import assert from "node:assert/strict";
import { loadCore } from "./helpers/load-core.mjs";

const core = loadCore();
const { copyText, createRevealRegistry } = core;

test("reveal registry hides a value after exactly ten seconds", () => {
  let scheduled = null;
  const hidden = [];
  const registry = createRevealRegistry({
    setTimeoutFn(callback, delay) {
      scheduled = { callback, delay };
      return 7;
    },
    clearTimeoutFn() {},
  });

  registry.show("payload.email", () => hidden.push("payload.email"));
  assert.equal(scheduled.delay, 10_000);
  scheduled.callback();
  assert.deepEqual(hidden, ["payload.email"]);
});

test("reveal registry clears every outstanding timer", () => {
  const cleared = [];
  let nextId = 0;
  const registry = createRevealRegistry({
    setTimeoutFn() {
      nextId += 1;
      return nextId;
    },
    clearTimeoutFn(id) {
      cleared.push(id);
    },
  });

  registry.show("one", () => {});
  registry.show("two", () => {});
  registry.clear();
  assert.deepEqual(cleared, [1, 2]);
});

test("copyText prefers the Clipboard API", async () => {
  const written = [];
  await copyText("safe redacted text", {
    navigatorRef: {
      clipboard: {
        async writeText(value) {
          written.push(value);
        },
      },
    },
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
    select() {
      selected = true;
    },
    remove() {
      removed = true;
    },
  };
  const documentRef = {
    body: {
      appendChild(element) {
        appended = element;
      },
    },
    createElement() {
      return textarea;
    },
    execCommand(value) {
      command = value;
      return true;
    },
  };

  const mode = await copyText("safe redacted text", { navigatorRef: null, documentRef });

  assert.equal(mode, "fallback");
  assert.equal(appended, textarea);
  assert.equal(textarea.value, "safe redacted text");
  assert.equal(selected, true);
  assert.equal(command, "copy");
  assert.equal(removed, true);
});
