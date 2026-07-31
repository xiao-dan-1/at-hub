import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("tracked project files contain no token-shaped JWT secrets", () => {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  const files = output.split("\0").filter(Boolean);
  const tokenPattern = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu;
  const findings = [];

  for (const file of files) {
    if (!/\.(?:html|mjs|js|json|md|txt)$/iu.test(file)) {
      continue;
    }
    const content = readFileSync(file, "utf8");
    if (tokenPattern.test(content)) {
      findings.push(file);
    }
    tokenPattern.lastIndex = 0;
  }

  assert.deepEqual(findings, []);
});
