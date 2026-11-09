# dsh-csforge-mcp

> 仓库（私有）：<https://github.com/white-h-6/dsh-csforge-mcp>
>
> 本仓库包含 CSForge Streamable HTTP MCP 桥接插件、14 个 `csforge_*` 工具，以及内置的中文 Agent Skill（`skills/csforge/SKILL.md`，含只读候选组合搜索脚本）。

本机独立插件：将 CSForge 的 Streamable HTTP MCP 接入 DeepSeek Harness，直接注册以下工具：

- `csforge_help`
- `csforge_whoami`
- `csforge_find_skins`
- `csforge_analyze_recipe`
- `csforge_inventory`
- `csforge_prelist_create`
- `csforge_prelist_list`
- `csforge_prelist_simulate`
- `csforge_prelist_configure`
- `csforge_prelist_cancel`
- `csforge_preview_assets`
- `csforge_save_recipe`
- `csforge_request`
- `csforge_open_page`

包内还内置一份 Agent Skill：`skills/csforge/SKILL.md`（含 `references/tools.md` 与只读候选搜索脚本 `scripts/find-extreme-float.mjs`）。它由插件在加载时通过 `ctx.skills.register(...)` 注册为嵌入式 runtime skill，因此**不写入全局 `~/.agents/skills` 目录**，启用/停用插件即同时启用/停用工具与 Skill。Skill 内容包括：何时使用、工具选择、预上架/合炉/打包汰换业务流程、材料与磨损规则、安全红线和错误重试规范。

插件不复制站内业务校验，不自动批准写操作，也不开放账户、管理员或令牌管理接口。

## 安全边界

- Bearer 令牌不写入源码、仓库、工具结果或普通日志。
- 令牌从 Windows DPAPI 文件按需解密，只缓存在当前进程内存。
- 配置只保存私密文件路径，不保存令牌。
- 网络隧道配置也只保存路径，上游凭据不进入本仓库。
- `csforge_save_recipe` 不生成或替换 `idempotencyKey`；`csforge_prelist_create` 未提供 `idempotencyKey` 时由远端生成并返回，确认重试必须复用。
- MCP 调用失败不自动重试，避免重复支付、求购或上架。

## 配置

插件包的 `cordis.patch.yml` 只插入通用加载项。机器相关配置放在用户的 DSH profile patch 中：

```yaml
- id: csforge-mcp
  config:
    endpoint: https://csforge.hkui.ccwu.cc/api/agent/mcp
    tokenFile: C:\Users\<you>\AppData\Local\CSForgeAgent\token.dpapi
    socksProxy: 127.0.0.1:10999
    timeoutMs: 90000
    tunnel:
      enabled: false
      executable: ''
      configPath: ''
      socksHost: 127.0.0.1
      socksPort: 10999
      startupTimeoutMs: 10000
```

如果本机不能直连 CSForge，将 `socksProxy` 指向本机 SOCKS5 监听器。插件也可按需启动私有隧道进程：

```yaml
    tunnel:
      enabled: true
      executable: D:\private-tools\xray.exe
      configPath: C:\Users\<you>\AppData\Local\CSForgeAgent\net\tunnel.json
      socksHost: 127.0.0.1
      socksPort: 10999
      startupTimeoutMs: 10000
```

隧道配置和上游凭据必须放在仓库之外，并限制为当前 Windows 用户可读。

### 保存令牌

用当前 Windows 用户的 DPAPI 保存，文件放在仓库之外：

```powershell
$dir = Join-Path $env:LOCALAPPDATA 'CSForgeAgent'
New-Item -ItemType Directory -Force $dir | Out-Null
icacls $dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"
$secure = Read-Host 'CSForge bearer token' -AsSecureString
$secure | ConvertFrom-SecureString | Set-Content -Encoding ascii -NoNewline (Join-Path $dir 'token.dpapi')
```

不要把令牌写入 YAML、`.env`、README、提交记录或聊天。

## 安装到本地 profile

```powershell
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
pnpm --dir $profileDir add link:E:\dsh\csforge-mcp-plugin
```

把 `dsh-csforge-mcp` 加入该 profile `package.json` 的 `dsh.profile.bundles` 数组。这样加载器会先应用插件包的 `cordis.patch.yml`，注册 `csforge-mcp` 这一加载项；随后 profile 的 `cordis.patch.yml` 才能用同一 id 覆盖本机配置。

如果 profile 的 `cordis.patch.yml` 仍是占位内容 `[]`，追加 `- id: ...` 前必须删掉 `[]`，否则 YAML 文档结构无效。重新加载插件或重启 Harness 后，工具会出现在模型工具列表中。

## 确认流程

1. 写请求返回 `approvalRequired: true` 和 `approvalId`。
2. 在 CSForge 网站 Agent 接入页面确认原请求。
3. 使用完全相同的方法、路径、JSON 参数、名称、材料和 `idempotencyKey` 重试，并携带原 `approvalId`。
4. 可调用 `GET /api/agent/approvals/:id/status` 查询状态。
5. 支付、求购、上架等结果不明时先查询原操作状态，不换幂等键重复提交。

## 限制

- 令牌解密依赖 Windows DPAPI 和当前用户配置。
- 网络代理仅支持 SOCKS5；HTTPS MCP 端点保持 TLS 证书校验。
- 本插件不提供账户、管理员或令牌管理界面。


## 启停工具桥

插件只包含一个 Loader 行：`csforge-mcp`（模块 `dsh-csforge-mcp`，入口 `lib/bridge.js`）。插件页里显示名称为 `csforge-mcp`。它不注册侧栏入口，也没有浏览器控制页，因此不会在左侧列表或插件页里多出额外的可视组件。

启停全部 `csforge_*` 工具请使用内置的「插件」页面：

1. 打开侧栏的「插件」页；
2. 找到 `csforge-mcp` 组合包（包名仍为 `dsh-csforge-mcp`）；
3. 切换 `csforge-mcp` 行（或整个组合包）。

该行由 profile `cordis.patch.yml` 中同 id（`csforge-mcp`）的配置覆盖；停用/启用会写入 profile 并即时生效（需要重启的 profile 会提示 `restart-required`）。
