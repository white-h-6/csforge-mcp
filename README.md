# csforge-mcp

> 仓库：<https://github.com/white-h-6/csforge-mcp>
>
> CSForge Streamable HTTP MCP 的通用接入资料：中文 Agent Skill、29 个 `csforge_*` 工具约定（含批量/精简工具）、两个只读计算脚本（候选搜索 + 预算式配炉求解器），以及一个可选的本地工具桥适配器（说明见 `docs/local-adapter.md`）。核心内容不绑定任何客户端，任何支持 Streamable HTTP MCP 的 Agent 都可以直接接入。

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

接入后先调用 `csforge_help` / `csforge_whoami`。工具名统一为 `csforge_*`，共 29 个（22 个业务工具 + 7 个批量/精简工具）：

- `csforge_help`（读取接口说明、流程与确认规则）
- `csforge_whoami`（当前 Agent 身份、网页所选 steamId、EcoSteam 账号状态）
- `csforge_find_skins`（按中英文名搜索饰品目录）
- `csforge_analyze_recipe`（分析目标饰品十件合约配方/概率/磨损/收益）
- `csforge_inventory`（精简库存，默认只返回 ready 且未锁定的可用资产）
- `csforge_prelist_create`（用十件材料创建预上架草稿，kind=pack 或 furnace）
- `csforge_furnace_create`（创建合炉，`prices` 支持逐件售价或 `{basis:"cost"|"floor",multiplier:1.2}`；敏感确认重试使用返回的固定售价数组）
- `csforge_furnace_status`（查询合炉创建/押金进度）
- `csforge_prelist_list`（查看预上架/自动上架任务，支持 phase/view 过滤）
- `csforge_prelist_simulate`（按当前市场价刷新草稿产物估值）
- `csforge_prelist_configure`（填写预上架标题/售价/可见性/押金方式）
- `csforge_prelist_arm`（发起开启自动上架/发布，需网站确认）
- `csforge_alipay_qr`（只读取回支付宝押金二维码 PNG）
- `csforge_prelist_cancel`（取消预上架/自动上架并释放材料锁）
- `csforge_pack_list`（只读查看我的打包汰换；默认只列上架中 status=100）
- `csforge_pack_price`（修改已上架打包汰换售价，敏感写；需用户给价）
- `csforge_pack_relist_preview`（只读核对原配置和重新上架进度）
- `csforge_pack_relist`（按原十件材料、原标题、当前售价、公开设置和付款方式重新上架；敏感写，需网站确认）
- `csforge_preview_assets`（一次预览 1–5 组候选十件材料的产物/概率/磨损/价格）
- `csforge_save_recipe`（保存 EcoSteam 平台十件配方）
- `csforge_request`（兜底调用其他已开放 `/api/` 业务接口）
- `csforge_open_page`（让在线 CSForge 网页切换页面，含预上架深链）
- `csforge_prelist_create_many`（批量建草稿，内部并发 + 瞬时错误退避重试）
- `csforge_prelist_configure_many`（批量填发布信息）
- `csforge_prelist_create_configure_many`（一步“建草稿 + 填发布信息”）
- `csforge_prelist_cancel_many`（批量取消并释放材料锁）
- `csforge_preview_many`（1–100 组批量预览，自动分片，可只回目标产物）
- `csforge_prelist_brief`（预上架精简状态，无 10 件材料明细）
- `csforge_inventory_summary`（全量库存按 skinId 聚合：件数/可用性/float 分布）

> 批量/精简工具由本地桥实现，适合“一次配置几十炉”的场景；批量写仍必须先完成 Agent Skill §0.2 的参数确认，且批量模式不处理网站 202 确认。性能取舍与站点侧建议见 `docs/performance-optimizations.md`。

## 库存成本（0.3.7）

`csforge_inventory` 逐件默认返回 `costCents`（平台库存成本，单位分）及 `costSource:"inventory"`。例如 `costCents:399` 表示 ¥3.99；缺失时两个字段均为 `null`。无需新增请求参数，`includePrices` 仍只控制参考行情价 `price`（单位元）。旧库存快照会补入已保存的同用户、同账号、同资产成本，无需额外扫描购买历史。

通用 MCP 客户端重新读取库存即可；本地工具桥更新至 0.3.7 后重新加载说明和内置 Skill。

## 合炉预上架（0.3.6）

现有预上架工具支持合炉：

1. `csforge_prelist_create({kind:"furnace", name, assetIds, steamId?})`：仅锁定十件材料，保存未配置、未开启的草稿，不需要提前填售价或押金。
2. `csforge_prelist_configure({id, kind:"furnace", title, prices:[{assetId,price}, ...], visibility, paymentMethod, openFeeRate, freeOpenFee, selfOpen})`：保存逐件售价、开炉费、公开设置及余额/支付宝付款方式，不发布、不扣款。
3. `csforge_prelist_arm({id})`：按现有确认设置申请发布，校验冷却与付款条件；草稿创建不等于已上架。

批量合炉先用 `csforge_prelist_create_many`，再用 `csforge_prelist_configure_many` 逐炉填写十件售价。`csforge_furnace_create` 仍是直接发布入口。

## 账号选择（0.3.5）

API 连接时选择的 Steam 账号只作为默认值。同一 EcoSteam 连接下属于本人的账号可以在网页库存页切换，选择保存到服务端，刷新后保留，MCP 随之切换。

- `csforge_whoami.steamId` 返回网页当前选择；无选择时使用连接默认账号。切换后重新读取身份和库存。
- 库存、库存汇总、打包预上架创建和合炉创建支持可选 `steamId`；批量创建在每个 `items[]` 内指定。省略时使用上述当前选择。
- 同一笔创建及确认重试保留返回的 `steamId`、幂等键和固定售价；已有任务继续使用原接收账号。所有接口仍校验账号归属与材料身份。
- 通用 MCP 客户端使用服务端新能力；本地工具桥用户更新至 0.3.5 后重新加载工具和内置 Skill。

## Agent Skill

`skills/csforge/SKILL.md` 是纯 Markdown 操作手册（含 `references/tools.md`、`references/deployment-notes.md`（本部署快照：昵称/实测金额，使用前复核）与只读脚本 `scripts/find-extreme-float.mjs`、`scripts/plan-packs.mjs`），可被任何能读取文件的 Agent 加载。内容包括：何时使用、工具选择、预上架/合炉/打包汰换流程、材料与磨损规则、安全红线和错误重试规范。

`scripts/plan-packs.mjs` 是批量配炉求解器：输入目标区间/边界/目标产物 float/主料/辅料池，输出每炉材料分配、预测 float 与“目标不可达时的可达上限”，100ms 级完成 25 炉；创建前仍须用 `csforge_preview_many` 复核。

## 使用约定

- Bearer 令牌只保存在 Agent/客户端的私密配置中，不写入聊天、代码仓库或日志。
- 写请求可能返回 `202 approvalRequired=true + approvalId`；CSForge 网站“Agent 接入”页面分别控制普通操作和敏感操作是否需要批准。批准后必须用完全相同的方法、路径和 JSON 参数重试。
- 结果不明（超时、网络中断）时先查询原操作状态，不要换幂等键重复提交。
- 押金/支付由用户完成；Agent 不代付、不替用户确认支付；支付宝二维码只发给用户本人。
- Agent 只能访问 CSForge 开放的业务接口，不能访问账户、管理员或令牌管理界面。
- `csforge_save_recipe` 不生成或替换 `idempotencyKey`；`csforge_prelist_create` 未提供时由远端生成并返回，确认重试必须复用。

## 可选：本地工具桥适配器

本仓库还包含一个可选的本地工具桥，用于在支持 Cordis 加载器的本地 Harness 中注册同样的 29 个工具并加载内置 Skill。安装、profile 配置、令牌保存和启停方式见 [docs/local-adapter.md](docs/local-adapter.md)。

普通 MCP 客户端无需安装这个适配器。
