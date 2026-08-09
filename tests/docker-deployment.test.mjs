import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const readText = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Dockerfile builds a production local-service image", () => {
  const dockerfileUrl = new URL("../Dockerfile", import.meta.url);
  assert.equal(existsSync(dockerfileUrl), true);

  const dockerfile = readText("../Dockerfile");
  assert.match(dockerfile, /ARG NODE_IMAGE=node:24-bookworm-slim/u);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS builder/u);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS runtime/u);
  assert.match(dockerfile, /RUN npm ci\b/u);
  assert.match(dockerfile, /RUN npm run build/u);
  assert.match(dockerfile, /RUN npm ci --omit=dev/u);
  assert.match(dockerfile, /COPY --from=builder --chown=node:node \/app\/dist \.\/dist/u);
  assert.match(dockerfile, /COPY --chown=node:node src \.\/src/u);
  assert.match(dockerfile, /COPY --chown=node:node server \.\/server/u);
  assert.match(dockerfile, /ENV AT_INSPECTOR_HOST=0\.0\.0\.0/u);
  assert.match(dockerfile, /ENV AT_INSPECTOR_PORT=5173/u);
  assert.match(dockerfile, /EXPOSE 5173/u);
  assert.match(dockerfile, /HEALTHCHECK/u);
  assert.match(dockerfile, /CMD \["node", "server\/local-server\.mjs"\]/u);
  assert.doesNotMatch(dockerfile, /\bnpm run dev\b/u);
});

test("Dockerfile avoids optional BuildKit frontend pulls", () => {
  const dockerfile = readText("../Dockerfile");

  assert.doesNotMatch(dockerfile, /^# syntax=/mu);
});

test("compose file exposes AT Hub with optional proxy configuration", () => {
  const composeUrl = new URL("../compose.yaml", import.meta.url);
  assert.equal(existsSync(composeUrl), true);

  const compose = readText("../compose.yaml");
  assert.match(compose, /services:\s+at-hub:/u);
  assert.match(compose, /image:\s*ghcr\.io\/xiao-dan-1\/at-hub:\$\{AT_HUB_IMAGE_TAG:-0\.0\.2\}/u);
  assert.doesNotMatch(compose, /^\s*build:/mu);
  assert.match(compose, /"\$\{AT_HUB_PORT:-5173\}:5173"/u);
  assert.match(compose, /AT_INSPECTOR_HOST:\s*0\.0\.0\.0/u);
  assert.match(compose, /AT_INSPECTOR_PORT:\s*5173/u);
  assert.match(compose, /AT_INSPECTOR_PROXY:\s*\$\{AT_INSPECTOR_PROXY:-\}/u);
  assert.doesNotMatch(compose, /HTTP_PROXY/u);
  assert.doesNotMatch(compose, /HTTPS_PROXY/u);
  assert.match(compose, /restart:\s*unless-stopped/u);
});

test("docker ignore keeps local artifacts out of the build context", () => {
  const dockerignoreUrl = new URL("../.dockerignore", import.meta.url);
  assert.equal(existsSync(dockerignoreUrl), true);

  const dockerignore = readText("../.dockerignore");
  for (const ignored of ["node_modules", "dist", ".git", ".worktrees", ".tmp", "audit", ".env"]) {
    assert.match(dockerignore, new RegExp(`(^|\\n)${ignored.replace(".", "\\.")}(\\n|$)`, "u"));
  }
});

test("README documents docker deployment and proxy usage", () => {
  const readme = readText("../README.md");

  assert.match(readme, /## Docker 部署/u);
  assert.match(readme, /方式 A：使用 compose\.yaml 部署 GHCR 镜像/u);
  assert.match(readme, /docker compose pull/u);
  assert.match(readme, /docker compose up -d/u);
  assert.match(readme, /AT_HUB_IMAGE_TAG=0\.0\.2/u);
  assert.match(readme, /方式 B：本地构建镜像/u);
  assert.match(readme, /docker build -t at-hub:local \./u);
  assert.match(readme, /docker run -d --name at-hub/u);
  assert.match(readme, /ghcr\.io\/xiao-dan-1\/at-hub:0\.0\.2/u);
  assert.match(readme, /http:\/\/127\.0\.0\.1:5173\/subscription/u);
  assert.match(readme, /AT_INSPECTOR_PROXY=http:\/\/host\.docker\.internal:7890/u);
  assert.match(readme, /\/opt\/at-hub\/\.env/u);
  assert.match(readme, /AT_INSPECTOR_PROXY=socks5:\/\/proxy-user:proxy-password@proxy\.example\.com:3000/u);
  assert.match(readme, /docker compose up -d --force-recreate/u);
  assert.match(readme, /URL 编码/u);
  assert.match(readme, /docker compose down/u);
});

test("README documents how to update Docker deployments", () => {
  const readme = readText("../README.md");

  assert.match(readme, /### 更新 Docker 部署/u);
  assert.match(readme, /更新 compose GHCR 部署/u);
  assert.match(readme, /docker compose pull/u);
  assert.match(readme, /docker compose up -d/u);
  assert.match(readme, /更新本地构建镜像/u);
  assert.match(readme, /git pull/u);
  assert.match(readme, /docker build -t at-hub:local \./u);
  assert.match(readme, /docker rm -f at-hub/u);
});

test("git attributes keep docker deployment files line-ending stable", () => {
  const attributes = readText("../.gitattributes");

  for (const pattern of ["Dockerfile", ".dockerignore", "*.yaml"]) {
    assert.match(attributes, new RegExp(`${pattern.replace(".", "\\.").replace("*", "\\*")} text eol=lf`, "u"));
  }
});
