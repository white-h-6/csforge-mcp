# csforge-mcp

> 仓库：<https://github.com/white-h-6/csforge-mcp>
>
> CSForge Streamable HTTP MCP 的通用接入资料：中文 Agent Skill、16 个 `csforge_*` 工具约定、只读候选组合搜索脚本，以及一个可选的本地工具桥适配器（说明见 `docs/local-adapter.md`）。核心内容不绑定任何客户端，任何支持 Streamable HTTP MCP 的 Agent 都可以直接接入。

## 通用 MCP 接入

| 项 | 值 |
|---|---|
| MCP 地址 | `https://csforge.hkui.ccwu.cc/api/agent/mcp` |
| 传输协议 | Streamable HTTP |
| 认证 | `Authorization: Bearer csf_...`（在 CSForge 网站“Agent 接入”生成） |

通用 MCP 客户端配置示例（字段名按客户端调整）：

```json
{
  "mcpServers": {
    "csforge": {
      "type": "streamable-http",
      "url": "https://csforge.hkui.ccwu.cc/api/agent/mcp",
      "headers": { "Authorization": "Bearer csf_..." }
    }
  }
}
```

接入后先调用 `csforge_help` / `csforge_whoami`。工具名统一为 `csforge_*`，共 16 个：

- `csforge_help`
- `csforge_whoami`
- `csforge_find_skins`
- `csforge_analyze_recipe`
- `csforge_inventory`
- `csforge_prelist_create`
- `csforge_prelist_list`
- `csforge_prelist_simulate`
- `csforge_prelist_configure`
- `csforge_prelist_arm`
- `csforge_alipay_qr`
- `csforge_prelist_cancel`
- `csforge_preview_assets`
- `csforge_save_recipe`
- `csforge_request`
- `csforge_open_page`

## Agent Skill

`skills/csforge/SKILL.md` 是纯 Markdown 操作手册（含 `references/tools.md` 与只读候选搜索脚本 `scripts/find-extreme-float.mjs`），可被任何能读取文件的 Agent 加载。内容包括：何时使用、工具选择、预上架/合炉/打包汰换流程、材料与磨损规则、安全红线和错误重试规范。

## 使用约定

- Bearer 令牌只保存在 Agent/客户端的私密配置中，不写入聊天、代码仓库或日志。
- 写请求可能返回 `202 approvalRequired=true + approvalId`；CSForge 网站“Agent 接入”页面分别控制普通操作和敏感操作是否需要批准。批准后必须用完全相同的方法、路径和 JSON 参数重试。
- 结果不明（超时、网络中断）时先查询原操作状态，不要换幂等键重复提交。
- 押金/支付由用户完成；Agent 不代付、不替用户确认支付；支付宝二维码只发给用户本人。
- Agent 只能访问 CSForge 开放的业务接口，不能访问账户、管理员或令牌管理界面。
- `csforge_save_recipe` 不生成或替换 `idempotencyKey`；`csforge_prelist_create` 未提供时由远端生成并返回，确认重试必须复用。

## 可选：本地工具桥适配器

本仓库还包含一个可选的本地工具桥，用于在支持 Cordis 加载器的本地 Harness 中注册同样的 16 个工具并加载内置 Skill。安装、profile 配置、令牌保存和启停方式见 [docs/local-adapter.md](docs/local-adapter.md)。

普通 MCP 客户端无需安装这个适配器。
