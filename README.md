# AT Hub

围绕 ChatGPT Access Token（AT）的本地检查、测活、订阅查询与状态理解工具。它把原始声明整理成可读的账号、认证、时间与权限信息，并在需要时通过本机服务查询实时状态。

## 使用：离线解析

1. 双击 `index.html`（位于根目录）。
2. 粘贴三段式 JWT，也可以包含 `Bearer ` 前缀。
3. 点击“本地解析”。解析成功后，输入内容会立即从页面清除。
4. 在“概览”查看时间、安全提示和账号摘要；在“权限”查看 scope 的本地解释；在“高级检查器”搜索或按类别检查完整声明路径。
5. 敏感字段默认遮罩，只能临时显示 10 秒；复制操作始终输出脱敏 JSON。
6. 点击“重新解析”“清空全部”，或按 `Esc` 清除当前结果。

只做 JWT 声明解析时，最终用户不需要安装 Node.js，也不需要启动服务器。

## 使用：订阅查询

订阅查询需要本地 JS 服务，因为它要实时询问 ChatGPT 订阅状态。

```powershell
npm install
npm start
```

然后打开 `http://127.0.0.1:5173/subscription`。粘贴一个或多个 AT，也可以粘贴一个或多个 `api/auth/session` 返回的 JSON；页面会提取并去重 `accessToken`。也兼容每行 `email----pwd----2fa----at` 的记录格式，只取最后一段 AT。单个 AT 保持一张订阅卡片；批量查询会显示汇总和一组同风格结果卡。资格会合并账户检查与订阅响应中的优惠、可购套餐和试用标记；每项会显示本次同一代理会话的出口国家，并可单独复测。结果按输入顺序返回，单个失败不会影响其它 AT 的结果；默认并发 10，每个上游请求默认 12 秒超时，慢代理不会无限拖住整批。

AT 只发送到本机 `/api/subscription` 或 `/api/subscriptions/batch`，再由本机服务请求 ChatGPT 订阅相关接口；本项目不保存、不记录原始 AT，也不会把它写进测试、日志或版本库。批量接口返回时只附带脱敏 token 片段用于定位失败项。

如需临时用本机局域网 IPv4 访问，可运行 `npm start -- --host 0.0.0.0`，再打开形如 `http://10.100.9.181:5173/subscription` 的地址；验证后建议切回默认 `127.0.0.1`。

如果你的网络访问 ChatGPT 必须走代理，可以显式指定代理地址；支持 HTTP/HTTPS 与 SOCKS5，例如：

```powershell
npm start -- --proxy http://127.0.0.1:7890
npm start -- --proxy socks5://proxy-user:proxy-password@proxy.example.com:3000
npm start -- --proxy socks5://proxy-region-JP-sid-fixed-t-5:proxy-password@proxy.example.com:3000 --proxy-mode rotate
```

也可以组合局域网监听与代理：

```powershell
npm start -- --host 0.0.0.0 --proxy http://127.0.0.1:7890
```

`--proxy` 只影响本地服务访问 ChatGPT 及出口检测接口的上游请求；浏览器访问 `127.0.0.1` 或本机 IPv4 的这段仍是本机连接。`--proxy-mode rotate` 会为每个 AT 分配一个代理 sid，并让该 AT 的 accounts/check、subscriptions 与出口检测复用同一个 sid，适合 1024proxy 这类按 session id 分配出口的动态代理；不写时默认 `fixed`，保持同一个代理会话。

查询速度可以按代理质量调节：`--subscription-concurrency 10` 提高订阅批量并发（最高按 20 执行），`--live-concurrency 16` 提高测活批量并发，`--upstream-timeout-ms 9000` 缩短单次上游等待，`--ip-timeout-ms 2500` 缩短出口 IP 检测等待，`--body-limit-bytes 8388608` 调整本地服务接收批量 AT 的请求体上限。并发越高越快，但代理质量一般时也更容易触发限速或防护。

代理用户名或密码里如果包含 `@`、`:`、`/`、`?`、`#`、`%` 等特殊字符，先做 URL 编码后再写入代理地址。

如果已经开启 TUN 模式，优先使用默认 `npm start`。某些 HTTP 代理端口会让 Node 请求触发 Cloudflare challenge，此时显式 `--proxy` 反而会失败。

### `/subscription` v1 收口

`subscription-v1` 保持输入框常驻：单个 AT 以一张轻卡片展示当前账号订阅状态，多个 AT 以批量摘要和结果卡片列表展示；更多字段收进原始 JSON。后续新功能应继续复用“AT 输入 → 本地服务 → 按需展示 → 原始 JSON 兜底”的节奏，而不是在这个页面继续堆数据。

## 使用：AT 测活

AT 测活同样需要本地 JS 服务：

```powershell
npm install
npm start
```

然后打开 `http://127.0.0.1:5173/live`。页面支持单个或批量粘贴 AT、`api/auth/session` JSON，以及每行 `email----pwd----2fa----at` 的记录格式；测活数量不再设置 100 个上限，实际受本地请求体上限、并发数和上游响应能力影响，默认并发 10（参考 CPA 测活配置）。

本地服务会请求 `backend-api/me`：上游 HTTP 200 会显示“AT 可用”并展示邮箱、用户 ID、名称与原始 JSON；上游 HTTP 401/403 会显示“AT 不可用”。其它网络、代理或网页防护问题会显示为查询失败，不会把原始 AT 回显到结果里。

## Docker 部署

适合把 `/live` 和 `/subscription` 作为长期运行的本地服务。当前仓库的 `compose.yaml` 默认使用 GHCR 镜像，不再从服务器源码构建；这样服务器上可以直接 `docker compose pull` 更新镜像。

生产 `compose.yaml` 使用宿主网络模式运行容器。这样在部分 Linux 服务器上，容器访问 SOCKS5 动态代理会复用宿主机已经验证可用的出站路径，不会被受限的 Docker bridge 网络拦截。服务默认监听 `0.0.0.0:5173`，浏览器访问本机 `5173`；AT 只先发送到本机服务的 `/api/at-live`、`/api/at-live/batch`、`/api/subscription` 或 `/api/subscriptions/batch`，再由服务查询上游实时状态。生产模式不使用 `ports` 映射；需要换端口时设置 `AT_HUB_PORT`，它会同时成为服务监听端口。

### Docker 开发调试

频繁改代码时使用 `compose.dev.yaml`。它不构建生产镜像，而是把当前源码目录挂载进 Node 容器；改代码不用重建镜像，刷新页面即可看到前端变化，`server/` 以及后端依赖的 `src/core/` 变化会由 `node --watch` 重启开发服务。

```bash
AT_HUB_DEV_PORT=5175 docker compose -f compose.dev.yaml up
```

打开：

- `http://127.0.0.1:5175/`
- `http://127.0.0.1:5175/live`
- `http://127.0.0.1:5175/subscription`

停止开发容器：

```bash
docker compose -f compose.dev.yaml down
```

如需代理，继续使用同一个环境变量：

```bash
AT_INSPECTOR_PROXY=http://host.docker.internal:7890 docker compose -f compose.dev.yaml up
```

不使用 Docker 时，本地也可以运行同一个开发服务：

```powershell
npm run dev:service
```

### 方式 A：使用 compose.yaml 部署 GHCR 镜像

默认镜像为 `ghcr.io/xiao-dan-1/at-hub:latest`，会直接跟随最新发布；如需固定到某个版本，再用 `AT_HUB_IMAGE_TAG` 指定标签。

```bash
docker compose pull
docker compose up -d
```

打开：

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/live`
- `http://127.0.0.1:5173/subscription`

查看状态、日志与停止服务：

```bash
docker compose ps
docker compose logs -f at-hub
docker compose down
```

开发容器仍使用 bridge 网络。Docker Desktop 中如果代理运行在宿主机，可使用 `host.docker.internal`：

```bash
AT_INSPECTOR_PROXY=http://host.docker.internal:7890 docker compose up -d
```

服务器部署时建议把配置写到 `/opt/at-hub/.env`，避免每次命令行重复输入。`compose.yaml` 会读取 `AT_INSPECTOR_PROXY`，支持 HTTP/HTTPS 与 SOCKS5：

```bash
cd /opt/at-hub
cat > .env <<'EOF'
AT_HUB_PORT=5173
AT_INSPECTOR_PROXY=socks5://proxy-user:proxy-password@proxy.example.com:3000
AT_INSPECTOR_PROXY_MODE=rotate
AT_INSPECTOR_SUBSCRIPTION_CONCURRENCY=10
AT_INSPECTOR_LIVE_CONCURRENCY=10
AT_INSPECTOR_UPSTREAM_TIMEOUT_MS=12000
AT_INSPECTOR_IP_TIMEOUT_MS=4000
AT_INSPECTOR_BODY_LIMIT_BYTES=8388608
EOF

docker compose pull
docker compose up -d --force-recreate
docker compose logs --tail 80 at-hub
```

把 `proxy-user`、`proxy-password` 和代理主机替换为服务商提供的值；如果你的代理用户名包含 `-sid-固定值-t-`，可把 `AT_INSPECTOR_PROXY_MODE` 设为 `rotate` 自动轮转 sid。密码里有特殊字符时同样先做 URL 编码。

也可以固定镜像版本或指定宿主机监听端口：

```bash
AT_HUB_IMAGE_TAG=0.0.3 docker compose up -d
AT_HUB_PORT=8080 docker compose up -d
```

### 方式 B：本地构建镜像

适合在开发机上临时验证当前源码。镜像会在构建阶段生成 `dist/`，运行阶段只启动 Node 本地服务，不运行 Vite dev server。

```bash
docker build -t at-hub:local .
docker run -d --name at-hub \
  --restart unless-stopped \
  -p 5173:5173 \
  at-hub:local
```

如需代理：

```bash
docker run -d --name at-hub \
  --restart unless-stopped \
  -p 5173:5173 \
  -e AT_INSPECTOR_PROXY=http://host.docker.internal:7890 \
  at-hub:local
```

### 更新 Docker 部署

更新 compose GHCR 部署：

```bash
docker compose pull
docker compose up -d
```

更新本地构建镜像：

```bash
git pull
docker build -t at-hub:local .
docker rm -f at-hub
docker run -d --name at-hub \
  --restart unless-stopped \
  -p 5173:5173 \
  at-hub:local
```

更新后验证：

```bash
docker compose ps
docker compose logs --tail 80 at-hub
```

### GitHub 自动镜像

仓库已配置 GitHub Actions 自动构建 Docker 镜像并推送到 GHCR：`ghcr.io/xiao-dan-1/at-hub`。

触发方式：推送 `v*.*.*` tag 才会触发，例如 `v0.0.3`。普通 push 到 `master` 不会构建或推送镜像。

```bash
git tag v0.0.3
git push origin v0.0.3
```

发布后可拉取指定版本：

```bash
docker pull ghcr.io/xiao-dan-1/at-hub:0.0.3
```

## 安全边界

- 根目录 `index.html` 离线解析页面不发起网络请求，不使用 Cookie、`localStorage`、`sessionStorage` 或数据库；发布文件的 CSP 同样禁止外部连接与资源。
- `/live` AT 测活页面只连接同源本地服务；本地服务会联网请求 `backend-api/me`，因此不要把它当成零上传页面。
- `/subscription` 订阅查询页面只连接同源本地服务；本地服务会联网查询实时订阅状态，并通过 Cloudflare Trace 确认每项查询的出口国家，因此不要把它当成零上传页面。
- 本地服务上游请求只显式携带 `Authorization: Bearer <AT>` 与 JSON `Accept`，不主动携带浏览器 Cookie 或本机时区参数。
- 工具只解码 JWT，不验证签名、撤销状态或服务器可用性。页面显示“在声明时间窗口内”也不等于 token 可用。
- 权限风险来自本项目维护的本地规则和启发式提示，不是 OpenAI 官方权限评级，也不证明服务器一定接受相应 scope。
- ChatGPT/OpenAI 的非标准 claim 可能随签发流程变化或过时；未知字段会保留在高级检查器中，不会被擅自解释成风险。
- 时间判断只依据 JWT 声明和本机时钟，界面以北京时间显示。
- JavaScript 无法保证立即擦除浏览器引擎底层内存；工具会清除页面内容、计时器和可访问引用。
- 不要把真实 token 粘贴到聊天、Issue、截图、日志、测试代码或版本库中。AT 泄露后应立即注销相关会话并更新凭据。

## 开发

需要 Node.js `^20.19.0` 或 `>=22.12.0`。

```powershell
npm install
npm run dev
npm start
```

Vite 开发服务器默认位于 `http://127.0.0.1:5173/`。测活与订阅查询请使用 `npm start` 或 `npm run dev:service`，它会启动提供 `/live`、`/subscription` 所需 API 的本地服务。

```powershell
npm test
npm run build
npm run release
```

- `npm test` 先重新构建，再运行全部解析、脱敏、语义、交互、发布与仓库安全测试；若根目录发布文件尚未同步，测试会明确失败。
- `npm run build` 在 `dist/index.html` 生成无外部运行时资源的离线解析版本，并在 `dist/live.html`、`dist/subscription.html` 生成本地服务页面。
- `npm run release` 只验证并发布离线解析页到根目录可双击使用的 `index.html`；订阅查询仍需 `npm start`。

源码位于 `src/`：`core/` 保存不依赖 DOM 的解析与解释逻辑，`ui/` 负责界面和交互。所有测试 token 都由代码生成，不包含真实账号或凭据。
