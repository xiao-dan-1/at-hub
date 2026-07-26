# AT 本地解析器

一个只在浏览器本地解码单个 JWT 形式 AT 的静态工具。它展示 Header、Payload、时间状态、权限和脱敏 JSON。

## 使用

1. 双击 `index.html`。
2. 粘贴一个三段式 JWT，或带有 `Bearer ` 前缀的值。
3. 点击“本地解析”。
4. 查看分类结果；敏感字段默认遮盖，可临时显示 10 秒。
5. 点击“清空全部”或按 `Esc` 移除当前结果。

最终用户不需要安装 Node.js，也不需要启动服务器。

## 安全边界

- 页面不发起网络请求，不使用 Cookie 或浏览器持久化存储。
- 工具只解码 JWT，不验证签名、撤销状态或服务器可用性。
- 时间状态只依据 JWT 声明和本机时钟。
- JavaScript 不能保证立即擦除浏览器引擎底层内存，只会清除页面内容和可访问引用。
- 不要把真实 token 粘贴到聊天、Issue、截图、日志或测试代码中。

## 开发验证

需要 Node.js 20 或更高版本。项目不依赖第三方 npm 包。

```powershell
node --test tests/parser.test.mjs tests/redaction.test.mjs tests/page.test.mjs tests/interactions.test.mjs tests/readme.test.mjs tests/repo-safety.test.mjs
```

所有测试数据均由代码生成，不包含真实账号或 token。
