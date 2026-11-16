# csforge-mcp

> 仓库：<https://github.com/white-h-6/csforge-mcp>
>
> CSForge 远程 MCP 的安装与操作资料。支持 Streamable HTTP 的 Agent 可连接网站，使用库存、配方、预上架、合炉和打包汰换工具。

## 让 Agent 安装

把下面两行发给 Agent 即可，安装与操作说明由仓库维护：

```text
帮我安装并配置这个 MCP，按仓库中的安装说明操作：
https://github.com/white-h-6/csforge-mcp
```

**Agent 请先读取 [安装指南](docs/INSTALL.md)。** 按当前客户端配置连接。需要认证时，由用户从网站“Agent 接入”单独复制密钥，放入客户端私密配置；上面的安装请求不包含令牌。

安装指南负责客户端配置、授权与只读验收；[操作 Skill](skills/csforge/SKILL.md) 和 [工具参考](skills/csforge/references/tools.md) 负责站内操作。连接后先调用 `csforge_help`、`csforge_whoami`，只要求安装时不执行业务写入。

## 功能概览

- 查看本人账号、库存和材料可用状态。
- 查询饰品目录，分析并预览炼金方案。
- 创建与配置预上架，按用户指令发布合炉或打包汰换。
- 查看任务进度，核对付款状态、取消或调整已有任务。

连接后先调用 `csforge_help`、`csforge_whoami`。工具列表提供各工具描述与参数说明，实际可用工具以当前客户端为准。

## 文档入口

| 文档 | 用途 |
|---|---|
| [安装指南](docs/INSTALL.md) | 客户端配置、私密认证和连接验证 |
| [操作 Skill](skills/csforge/SKILL.md) | 需求确认、跨工具操作原则和结果核对 |
| [工具参考](skills/csforge/references/tools.md) | 各工具参数、返回字段与执行规则 |
| [版本记录](https://github.com/white-h-6/csforge-mcp/releases) | 历史改动与更新内容 |

DeepSeek Harness / Cordis 的专用配置见 [客户端说明](docs/local-adapter.md)。
