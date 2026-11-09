# 可选：DeepSeek Harness 适配器（dsh-csforge-mcp）

本文件只描述可选的 DeepSeek Harness 适配器；通用 MCP 接入与 Agent Skill 见仓库根目录 `README.md` 和 `skills/csforge/SKILL.md`。其他 MCP 客户端不需要本适配器。

## 包与配置

适配器包名 `dsh-csforge-mcp`，通过 `cordis.patch.yml` 插入加载项。机器相关配置放在用户的 DSH profile patch 中：

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

如果本机不能直连 CSForge，将 `socksProxy` 指向本机 SOCKS5 监听器。适配器也可按需启动私有隧道进程：

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

## 保存令牌

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

## 启停工具桥

适配器只包含一个 Loader 行：`csforge-mcp`（模块 `dsh-csforge-mcp`，入口 `lib/bridge.js`）。插件页里显示名称为 `csforge-mcp`。它不注册侧栏入口，也没有浏览器控制页，因此不会在左侧列表或插件页里多出额外的可视组件。

启停全部 `csforge_*` 工具请使用内置的「插件」页面：

1. 打开侧栏的「插件」页；
2. 找到 `csforge-mcp` 组合包（包名仍为 `dsh-csforge-mcp`）；
3. 切换 `csforge-mcp` 行（或整个组合包）。

该行由 profile `cordis.patch.yml` 中同 id（`csforge-mcp`）的配置覆盖；停用/启用会写入 profile 并即时生效（需要重启的 profile 会提示 `restart-required`）。

## 限制

- 令牌解密依赖 Windows DPAPI 和当前用户配置。
- 网络代理仅支持 SOCKS5；HTTPS MCP 端点保持 TLS 证书校验。
- 适配器不提供账户、管理员或令牌管理界面。
- 通用 MCP 客户端不需要本适配器，也不需要这些本地配置。
