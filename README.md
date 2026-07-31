# AT Hub

围绕单个 ChatGPT Access Token（AT）的本地检查、订阅查询与状态理解工具。它把原始声明整理成可读的账号、认证、时间与权限信息，并在需要时通过本机服务查询订阅状态。

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

然后打开 `http://127.0.0.1:5173/subscription`。粘贴一个 AT 或 `api/auth/session` 返回的 JSON，页面会提取单个 `accessToken` 并展示一张订阅卡片：账号邮箱、plan、剩余时间、续费状态、套餐 ID、渠道、优惠和可购买套餐。

AT 只发送到本机 `/api/subscription`，再由本机服务请求 ChatGPT 订阅相关接口；本项目不保存、不记录原始 AT，也不会把它写进测试、日志或版本库。

如需临时用本机局域网 IPv4 访问，可运行 `npm start -- --host 0.0.0.0`，再打开形如 `http://10.100.9.181:5173/subscription` 的地址；验证后建议切回默认 `127.0.0.1`。

如果你的网络访问 ChatGPT 必须走本机 HTTP 代理，可以显式指定代理端口，例如：

```powershell
npm start -- --proxy http://127.0.0.1:7890
```

也可以组合局域网监听与代理：

```powershell
npm start -- --host 0.0.0.0 --proxy http://127.0.0.1:7890
```

`--proxy` 只影响本地服务访问 ChatGPT 的上游请求；浏览器访问 `127.0.0.1` 或本机 IPv4 的这段仍是本机连接。

如果已经开启 TUN 模式，优先使用默认 `npm start`。某些 HTTP 代理端口会让 Node 请求触发 Cloudflare challenge，此时显式 `--proxy` 反而会失败。

### `/subscription` v1 收口

`subscription-v1` 保持单个 AT 查询：输入框常驻，结果以一张轻卡片展示当前账号订阅状态，更多字段收进原始 JSON。后续新功能应继续复用“AT 输入 → 本地服务 → 按需展示 → 原始 JSON 兜底”的节奏，而不是在这个页面继续堆数据。

## Docker 部署

适合把 `/subscription` 也一起部署为一个本地服务。镜像会在构建阶段生成 `dist/`，运行阶段只启动 Node 本地服务，不运行 Vite dev server。

```powershell
docker compose up -d --build
```

打开：

- `http://127.0.0.1:5173/`
- `http://127.0.0.1:5173/subscription`

查看日志与停止服务：

```powershell
docker compose logs -f at-hub
docker compose down
```

如果容器访问 ChatGPT 需要走宿主机代理，Docker Desktop 可使用 `host.docker.internal`：

```bash
AT_INSPECTOR_PROXY=http://host.docker.internal:7890 docker compose up -d --build
```

也可以改宿主机端口：

```bash
AT_HUB_PORT=8080 docker compose up -d --build
```

容器内默认监听 `0.0.0.0:5173`；AT 仍只先发到容器内的 `/api/subscription`，再由容器服务查询上游订阅状态。

## 安全边界

- 根目录 `index.html` 离线解析页面不发起网络请求，不使用 Cookie、`localStorage`、`sessionStorage` 或数据库；发布文件的 CSP 同样禁止外部连接与资源。
- `/subscription` 订阅查询页面只连接同源本地服务；本地服务会联网查询实时订阅状态，因此不要把它当成零上传页面。
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

Vite 开发服务器默认位于 `http://127.0.0.1:5173/`。订阅查询请使用 `npm start`，它会先构建，再启动提供 `/subscription` 所需 API 的本地服务。

```powershell
npm test
npm run build
npm run release
```

- `npm test` 先重新构建，再运行全部解析、脱敏、语义、交互、发布与仓库安全测试；若根目录发布文件尚未同步，测试会明确失败。
- `npm run build` 在 `dist/index.html` 生成无外部运行时资源的离线解析版本，并在 `dist/subscription.html` 生成本地服务订阅查询页。
- `npm run release` 只验证并发布离线解析页到根目录可双击使用的 `index.html`；订阅查询仍需 `npm start`。

源码位于 `src/`：`core/` 保存不依赖 DOM 的解析与解释逻辑，`ui/` 负责界面和交互。所有测试 token 都由代码生成，不包含真实账号或凭据。
