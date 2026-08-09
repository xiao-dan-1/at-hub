import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("GHCR workflow is triggered only by release tag pushes", () => {
  const workflowUrl = new URL("../.github/workflows/docker-ghcr.yml", import.meta.url);
  assert.equal(existsSync(workflowUrl), true);

  const workflow = readText("../.github/workflows/docker-ghcr.yml");
  assert.match(workflow, /name:\s*Docker GHCR/u);
  assert.match(workflow, /on:\s+push:\s+tags:\s+\["v\*\.\*\.\*"\]/u);
  assert.doesNotMatch(workflow, /branches:\s+\["master"\]/u);
  assert.doesNotMatch(workflow, /pull_request:/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
});

test("GHCR workflow publishes semver, latest, and sha image tags", () => {
  const workflow = readText("../.github/workflows/docker-ghcr.yml");

  assert.match(workflow, /contents:\s*read/u);
  assert.match(workflow, /packages:\s*write/u);
  assert.match(workflow, /docker\/setup-buildx-action@v3/u);
  assert.match(workflow, /docker\/login-action@v3/u);
  assert.match(workflow, /registry:\s*ghcr\.io/u);
  assert.match(workflow, /username:\s*\$\{\{ github\.actor \}\}/u);
  assert.match(workflow, /password:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
  assert.match(workflow, /docker\/metadata-action@v5/u);
  assert.match(workflow, /images:\s*ghcr\.io\/\$\{\{ github\.repository \}\}/u);
  assert.match(workflow, /type=raw,value=latest/u);
  assert.match(workflow, /type=semver,pattern=\{\{version\}\}/u);
  assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/u);
  assert.match(workflow, /type=sha,prefix=sha-/u);
  assert.match(workflow, /docker\/build-push-action@v6/u);
  assert.match(workflow, /push:\s*true/u);
  assert.match(workflow, /tags:\s*\$\{\{ steps\.meta\.outputs\.tags \}\}/u);
  assert.match(workflow, /labels:\s*\$\{\{ steps\.meta\.outputs\.labels \}\}/u);
});

test("README documents tag-only GHCR publishing and pull commands", () => {
  const readme = readText("../README.md");

  assert.match(readme, /GitHub 自动镜像/u);
  assert.match(readme, /ghcr\.io\/xiao-dan-1\/at-hub/u);
  assert.match(readme, /推送 `v\*\.\*\.\*` tag 才会触发/u);
  assert.doesNotMatch(readme, /push 到 `master`：构建并推送/u);
  assert.doesNotMatch(readme, /pull request 到 `master`：只构建校验/u);
  assert.doesNotMatch(readme, /workflow_dispatch/u);
  assert.match(readme, /git tag v0\.0\.3/u);
  assert.match(readme, /git push origin v0\.0\.3/u);
  assert.match(readme, /docker pull ghcr\.io\/xiao-dan-1\/at-hub:0\.0\.3/u);
});

test("git attributes keep GitHub workflow line endings stable", () => {
  const attributes = readText("../.gitattributes");

  assert.match(attributes, /\*\.yml text eol=lf/u);
});
