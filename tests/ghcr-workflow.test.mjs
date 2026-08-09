import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("GHCR workflow builds and publishes the Docker image", () => {
  const workflowUrl = new URL("../.github/workflows/docker-ghcr.yml", import.meta.url);
  assert.equal(existsSync(workflowUrl), true);

  const workflow = readText("../.github/workflows/docker-ghcr.yml");
  assert.match(workflow, /name:\s*Docker GHCR/u);
  assert.match(workflow, /push:\s+branches:\s+\["master"\]/u);
  assert.match(workflow, /tags:\s+\["v\*\.\*\.\*"\]/u);
  assert.match(workflow, /pull_request:\s+branches:\s+\["master"\]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /contents:\s*read/u);
  assert.match(workflow, /packages:\s*write/u);
  assert.match(workflow, /docker\/setup-buildx-action@v3/u);
  assert.match(workflow, /docker\/login-action@v3/u);
  assert.match(workflow, /registry:\s*ghcr\.io/u);
  assert.match(workflow, /username:\s*\$\{\{ github\.actor \}\}/u);
  assert.match(workflow, /password:\s*\$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
  assert.match(workflow, /docker\/metadata-action@v5/u);
  assert.match(workflow, /images:\s*ghcr\.io\/\$\{\{ github\.repository \}\}/u);
  assert.match(workflow, /docker\/build-push-action@v6/u);
  assert.match(workflow, /push:\s*\$\{\{ github\.event_name != 'pull_request' \}\}/u);
  assert.match(workflow, /tags:\s*\$\{\{ steps\.meta\.outputs\.tags \}\}/u);
  assert.match(workflow, /labels:\s*\$\{\{ steps\.meta\.outputs\.labels \}\}/u);
});

test("README documents GHCR image triggers and pull command", () => {
  const readme = readText("../README.md");

  assert.match(readme, /GitHub 自动镜像/u);
  assert.match(readme, /ghcr\.io\/xiao-dan-1\/at-hub/u);
  assert.match(readme, /push 到 `master`/u);
  assert.match(readme, /`v\*\.\*\.\*`/u);
  assert.match(readme, /workflow_dispatch/u);
  assert.match(readme, /docker pull ghcr\.io\/xiao-dan-1\/at-hub:latest/u);
});

test("git attributes keep GitHub workflow line endings stable", () => {
  const attributes = readText("../.gitattributes");

  assert.match(attributes, /\*\.yml text eol=lf/u);
});
