---
name: csforge
description: CSForge（CS2 饰品炼金 / 预上架 / 打包汰换 / 合炉）Agent 操作技能；当用户要求分析炼金配方、卡磨损找炉、筛选库存、创建或查看预上架、打包汰换、合炉、检查 EcoSteam 账号连接，或要使用任何 csforge_* MCP 工具时加载。包含工具选择、需求确认门禁、预上架/合炉流程、材料与磨损规则、安全红线和错误重试规范；本部署相关的昵称映射、示例价格与实测快照见 references/deployment-notes.md（使用前复核，可能过期）。适用于任何已接入 CSForge Streamable HTTP MCP 的 Agent 客户端，不绑定特定插件。
metadata:
  version: "0.4.11"
  date: "2026-11-19"
---

# CSForge Agent Skill

> 本 Skill 面向“帮用户操作 CSForge 网站”的 Agent；站点部署、服务器运维、数据库维护不属于本 Skill 范围。
> 用户要求安装/连接 MCP 时先读 [安装指南](../../docs/INSTALL.md)，完成配置、私密认证和只读验证；只要求安装时不进入创建或发布流程。
> 工具名以当前客户端注册的 `csforge_*` 为准，本文不绑定特定插件/客户端；站点端说明可用 `csforge_help` 复核。
> **通用性约定**：本文件只放跨账号、跨客户端稳定的规则与流程；昵称映射、具体库存/价格、实测金额等**本部署快照**统一放在 `references/deployment-notes.md`，使用前先用 `find_skins` / `inventory` 复核，不要把快照当事实。

## 何时使用

- 任何 `csforge_*` 工具调用前；
- 用户提到：CSForge、EcoSteam、预上架、打包汰换、合炉、炼金、汰换合同、卡磨损、找炉、库存筛选、Agent 接入、平台连接；
- 需要判断“这个操作 Agent 能不能做、该走哪条流程”时。

## 0. 开场：先读身份，再完成需求确认

> 顺序不能颠倒：先 `csforge_whoami`（只读）→ 再 §0.2 需求确认 → 才允许分析/选材/创建。

### 0.1 身份与账号（只读，一次调用）

调用 `csforge_whoami` 核对授权与当前执行账号；字段、账号选择优先级及状态含义见该工具说明和 [工具参考](references/tools.md#csforge_whoami)。

连接或账号读取失败时说明原因；账号切换后重读身份与库存。选材、预览与创建始终保持同一账号，已有任务及审批重试保留原账号，不混用材料。

### 0.2 需求确认（所有写操作的硬门禁）

指定某个已上架打包“按原配置重新上架”时，先用 `csforge_pack_relist_preview` 核对该单的现有配置，按 [原配置重新上架流程](references/tools.md#csforge_pack_relist) 执行；用户已明确授权保留这些设置时，复用现有材料、磨损和售价，不重新设计配方。重新上架仍走敏感写确认。

> **本节优先级高于“用户已经说了创建”的直觉，也高于任何历史习惯。** 凡下一次调用属于写操作（`csforge_prelist_create_many` / `csforge_prelist_configure_many` / `arm` / `cancel`、`csforge_furnace_create`、`csforge_save_recipe`，或 `csforge_request` 的任何 POST），必须先把下面的清单逐项确认完，才允许调用。

#### 0.2.1 硬性规则

1. **先问再做**：确认完成前只允许只读动作——① `csforge_whoami` ② 名称/目录查询 `csforge_find_skins` ③ 现有预上架状态 `csforge_prelist_brief` ④ **一次有界的库存计数查询**（仅用于把问询选项写成真实数字，例如“可上架某材料 N 件”）。**不得**在确认前跑完整 `csforge_analyze_recipe` 配方搜索、`csforge_preview_many` 组炉，更不得写脚本/读站点源码“顺便把方案做出来”。
2. **一句话不算确认**：“创建多个”“帮我上架”“按上次的来”“随便”都不是参数确认。数量、目标磨损、材料组成、交付步骤必须落成具体值，并由用户在当前会话明确回复。
3. **历史只是建议**：历史预上架/配方只能作为推荐选项呈现，**不得**当默认参数执行。用户说“按上次的来”时，把上次每项参数列出来请其确认。

#### 0.2.2 必须确认的六项（N1–N6）

| 编号 | 字段 | 确认到可执行的值 | 明确禁止 |
|---|---|---|---|
| N1 | 目标饰品/收藏品 | 正式名 + skinId（昵称先查目录） | 用昵称猜皮肤 |
| N2 | 目标磨损档位 + 方向 | 先确认档位（FN/MW/FT/WW/BS）；档位区间按所选档位的标准阈值与目标皮肤 minFloat/maxFloat 动态求交，不使用固定边界；必须确认三选一：A 只要入档（档位内高低不限）；B 入档后尽量偏高（在所选档位内尽量接近该档上限，用于优先消耗高 float 材料并保留低 float 库存）；C 入档后尽量偏低（磨损低，尽量接近该档下限） | 自行假定档位；把某个固定阈值当通用边界；自行假定越极限越好；把极限磨损默认理解成偏高或偏低；忽略用户是想节省低磨损库存还是保留高磨损库存 |
| N3 | 数量 | 具体数字（1、2、3…） | 把“多个”自行解释成上限或下限（如“最多能做 N 份就建 N 份”） |
| N4 | 材料组成 | 主材料件数 + 其余材料来源（例：“1 件 A 收藏材料 + 9 件 B 收藏材料”，或明确“由 Agent 从可用库存选”）；同时确认**辅料范围**（是否只限一种辅料、是否允许任意同稀有度消费级饰品） | 把历史配方当默认 |
| N5 | 交付步骤 | ①只读方案 ②只建草稿 ③草稿+填发布信息 ④ Agent 发起 arm（需网站人工批准）⑤ 创建合炉（需指定售价或定价规则） | 先建草稿/先建炉再补问 |
| N6 | 发布信息（N5≥③ 或 N5=⑤ 时必填） | 打包：标题（≤10 字符）、总售价、公开/私密、押金方式；合炉：标题、公开/私密、押金方式（余额/支付宝）、开炉费设置，以及**用户指定的材料售价或定价规则** | 替用户定价、定可见性、选押金 |

#### 0.2.3 一次问清（推荐做法）

- 用**一次** `ask_user_question` 或一条编号清单把 N1–N6 问完，给推荐项和真实约束，避免多轮拉锯。
- **材料池一次问全**：主料件数、辅料是否限品种（例如“是否只能用冻雨，还是任意同稀有度消费级饰品都行”）、是否允许冷却中材料、产物 float 精度。辅料池问窄了会导致建完再重建——这是最贵的返工来源。
- 需要真实数字时，用 §0.2.1 允许的**有界只读查询**获取，并注明来源与时间；不要把历史快照或记忆里的数字当当前事实。只读查询可用 `csforge_inventory_summary`（一次拿到“某皮肤 N 件 + 磨损分布”）代替逐件大响应。
- 数量与贴边冲突时给两种真实选项（例如“N 份可贴近边界；M 份为材料上限、边界余量更大”），让用户在数量与贴边之间选择。
- 用户回复“就按推荐/用这个”也视为确认，但必须**回显最终参数**再执行。
- 用户未回答的项：不要用默认值继续；要么请其确认推荐值，要么停止。

#### 0.2.4 模糊表达处理

| 用户说法 | 必须的处理 |
|---|---|
| “多个 / 一些 / 几个 / 一批” | 追成具体数字，并说明材料上限 |
| “随便 / 你定 / 看着办” | 给 2–3 个带具体参数的方案（含推荐），请用户选一个 |
| 卡到某档边界 / 刚好某档 / 极限磨损 | 先确认目标档位（FN/MW/FT/WW/BS）和方向：B 入档后尽量偏高（在档位内接近该档上限，优先高 float 材料保留低 float 库存），还是 C 入档后尽量偏低；不要只凭极限二字猜方向 |
| “按上次的来” | 列出上次参数逐项，请用户确认后再执行 |
| “快点 / 别问那么多” | 仍然只发**一次**最小确认（一组选项/一张表），不跳过确认 |
| 用户已给全 N1–N6 | 回显参数后直接执行，不再反问 |

#### 0.2.5 分场景补充

- **打包汰换**：N6 的总售价必须严格低于最高产物价值；押金由用户在网站支付，Agent 不计算、不承诺、不付款。
- **合炉（N5=⑤）**：Agent 可创建合炉，但 `prices` 接受用户指定售价或定价规则或指定的 `{basis:"cost"\|"floor",multiplier:1.2}`（默认 1 倍）。Agent 不得擅自选择基准或倍率；缺价时请用户补价。
- **发布/arm**：必须单独确认用户接受“Agent 发起 arm，但必须在网站 Agent 接入页面人工批准，且 Agent 不代付押金”；若敏感确认开关关闭，提示“发布将直接生效”。

#### 0.2.6 反模式（本 Skill 明确禁止）

- 用户说“创建多个”就直接按最大可行数开建；
- 用历史预上架参数当默认模板；
- 先 analyze/inventory 选材/preview 组炉再问，或用“再查一步更稳”把提问一拖再拖；
- 把“多个/随便/按上次”自行解释成具体值；
- 未确认就先建草稿/先建炉，事后再补问售价、可见性或押金。

#### 0.2.7 写操作前自检清单（逐项打勾）

1. N1–N6 是否都有明确值？2. 数量是否与用户说的一致（不是自行取上限）？3. 材料售价/公开私密/押金方式是否用户给值？4. 交付步骤（草稿 / 配置 / arm / 合炉）是否用户明确？5. 是否已回显参数并得到“就按这个”？6. 是否准备好 202 审批的重试参数（idempotencyKey、approvalId、estimatedDepositCents）？

确认完成后，才允许调用 `csforge_analyze_recipe` / `csforge_inventory` 选材 / `csforge_preview_many` 进入分析与选材。

## 1. 工具速查

详细参数与返回见 `references/tools.md`；工具数量与名称一律以当前 `tools/list` 为准（不要写死版本号/数量）。选择顺序：

1. 身份：`csforge_whoami`
2. 目录/配方：`csforge_find_skins` → `csforge_analyze_recipe`
3. 库存：`csforge_inventory`（逐件细查）/ `csforge_inventory_summary`（**一次聚合全量库存**：每种皮肤件数、ready/available/locked/prelisted 计数、float 最小/最大/平均；可选 `skinIds`/`includeIds`）
4. 候选炉验证：`csforge_preview_many`（一次 1–100 组，自动按 5 组分片并发；传 `targetSkinId` 只回目标产物行，响应小很多）
5. 预上架：`csforge_prelist_create_many`（单炉也传 1 项）→ `csforge_prelist_brief`（默认精简）/ `csforge_prelist_brief(detail="full")`（含材料与 simulation 明细）→ `csforge_prelist_configure_many` →（用户人工发布）；打包快捷流程可用 `csforge_prelist_create_configure_many`（一次完成建草稿+填发布信息），批量取消用 `csforge_prelist_cancel_many`
6. 合炉（Agent 可创建）：`csforge_furnace_create`（10 件材料 + 用户指定售价或定价规则 + 押金方式）→ `csforge_furnace_status`（只读轮询）→ 支付宝押金用 `csforge_alipay_qr(kind=furnace)`
7. 我的打包汰换（只读/改价）：`csforge_pack_list`（默认只列上架中 status=100；listedOnly=false 看全部）→ 用户明确要求改价时才用 `csforge_pack_price`（price 必须用户给出，expectedPrice/幂等键/网站批准规则同敏感写）
8. 页面导航：`csforge_open_page`（支持 `prelist` 深链）
9. 兜底：`csforge_request` 只用于上述专用工具未覆盖的业务接口；账户、管理员、令牌管理接口不可用

> 批量工具内部已做并发（默认 5，可调 1–8）与“库存状态已变化/分页重复”等瞬时错误的指数退避重试；只读工具（含 `preview_many`、`prelist_brief`、`inventory_summary`）标记为可并发。批量写仍受 §0.2 参数确认门禁约束，且批量模式不处理网站 202 确认，遇到 `approvalRequired` 的条目需人工逐条处理。

## 2. 安全红线（不可协商）

- **只读优先**：查询、预览、模拟先做；写操作必须来自用户明确指令。
- **写操作前置 = §0.2 需求确认**：`csforge_prelist_create_many` / `csforge_prelist_configure_many` / `arm` / `cancel` / `csforge_furnace_create` / `csforge_save_recipe` 以及任何 `csforge_request` POST 之前，必须先完成 §0.2 的 N1–N6 确认；**“用户已要求创建”不等于“参数已确认”**，不得自行补默认值。
- **合炉创建 = 敏感操作**：`csforge_furnace_create` 会发布十件材料并授权押金扣款，按敏感写操作处理（网站敏感确认开启时返回 202+approvalId），重试必须回传首次的 `estimatedDepositCents` 与 `idempotencyKey`。材料售价由用户逐件给出或指定基准与倍率，Agent 不得擅自选价；确认重试使用首次返回的固定 `prices` 数组；押金由平台按授权从用户 EcoSteam 余额扣除或生成支付宝付款码，Agent 不代付、不确认支付。
- **发布/arm**：Agent 可以调用 `csforge_prelist_arm` 发起发布/开启自动上架。网站“操作确认”里普通/敏感操作各有一个开关：敏感操作开启时，arm 首次返回 202+approvalId，必须经用户在网站批准后重试才生效；敏感操作关闭时 arm 会直接执行，Agent 必须先得到用户明确要求，并提示“敏感确认已关闭、发布将直接生效”。发布后的 CD、押金、提交仍按平台流程，结果以回执为准。
- **Agent 不得**：替用户决定售价/押金/公开私密；替用户支付/扣款；开启自动上架后绕过用户审批；替用户确认支付结果。
- **改价**：`csforge_pack_price` 只修改用户已上架的自有打包，新售价必须由用户明确给出；首次可能返回 202+approvalId，批准后必须用相同 id/price/expectedPrice/idempotencyKey 重试。不要改他人/非上架中/有待处理改价或下架的打包。
- **押金/付款不用 Agent 管**：合炉押金 = 最高产物估价 × 1.05，打包汰换押金 = 最高产物估价 × 1.4，默认余额；实际金额以平台报价为准，Agent 不计算、不承诺、不付款，用户自己支付。
- **预上架草稿支持打包汰换（pack）和合炉（furnace）两种**：`csforge_prelist_create_many` 的 items 传 `kind` 区分；`csforge_prelist_brief` 的每条任务都带 `kind`，`phase=prelist` 是两种草稿的合并视图，核对时务必按 `kind` 区分。直接发布合炉也可用 `csforge_furnace_create`，不要绕道 `plans/:id/create` 或把合炉伪装成打包草稿。
- **写操作 202**：返回 `approvalRequired=true` + `approvalId` 时，告诉用户去网站“Agent 接入”批准；重试必须使用**完全相同**的方法/路径/JSON 参数与 `approvalId`，`idempotencyKey` 不变。
- **结果不明**（超时、网络中断、响应异常）：先查 `csforge_prelist_brief` / `csforge_furnace_status`，**禁止换幂等键重试**，避免重复创建、重复付款。
- 不要输出/记录令牌（`csf_...`）、平台票据或账号隐私字段到聊天、文件或仓库。
- 创建草稿会立即锁定并隐藏材料；创建前必须得到用户确认，取消会释放材料但可能影响用户其他操作。

## 3. 业务对象与术语

| 术语 | 含义 | Agent 可做 |
|---|---|---|
| 合炉（furnace） | 用户自己投入 10 件材料开炉，产出 1 件更高稀有度饰品 | 分析/选材/预览；可创建（需用户指定售价或定价规则）；押金由用户支付，开炉由平台流程执行 |
| 打包汰换（pack） | 把 10 件材料作为“炉”上架出售（买家购买后自行汰换） | 可创建预上架草稿、填发布信息（用户给值）、模拟、取消；发布/开启自动上架必须人工 |
| 预上架（prelist） | 打包汰换的草稿态：材料锁定、`prelist=true, armed=false, configured=false`，不付款不提交 | 创建/查看/模拟/填发布信息/取消 |
| 可上架资产 | `ready && !locked && !prelisted`（`ready` 已包含 Status=1、Tradable、CanPublish） | `csforge_inventory` 的 `available` 直接使用 |
| 材料/炉 | 十件同稀有度材料组成的汰换合同 | 分析、预览、选材 |

昵称映射等本部署快照见 `references/deployment-notes.md`（使用前用 `find_skins` 复核，不要把昵称当正式名）。

产物概率规则（CS2 汰换）：产物收藏品按投入材料数量占比分权；同一收藏内按该稀有度产物数量均分。例：1 件 A 收藏 + 9 件 B 收藏 → A 收藏占 10%，若 A 有 4 个产物则每个 2.5%。**不要暗示必出某个产物**。

### 平台规则

- **售价**：打包汰换的总售价必须严格低于最高产物价值，达到或超过会被平台拒绝。
- **押金**：合炉 = 最高产物估价 × 1.05；打包汰换 = 最高产物估价 × 1.4；默认余额；由用户在网站支付，Agent 不计算/不承诺/不付款，实际金额以平台报价为准。Agent 创建合炉时只提交用户选择的押金方式与平台估算；余额由平台按一次性授权扣款，支付宝付款码只能发给用户本人。
- **账号门槛**：`guardStatus=102`（ECO 令牌已绑定）是**打包发布/arm**的硬性要求；打包草稿创建与合炉创建不单独拦截 102，但要求 EcoSteam 交易链接实时验证通过，付款/上架结果以平台回执为准。不满足时先告知用户去 EcoSteam 官方渠道处理，不要绕过。
- **纪念品**：Souvenir 纪念品可以作为汰换材料。
- **冷却材料**：冷却中的材料可以先进预上架草稿；发布后到期会自动上架并自动从余额扣押金。
- **合炉入口**：Agent 可用 `csforge_furnace_create` 创建合炉（十件材料 + 用户指定售价或定价规则 + 押金方式），该直接发布入口**不提供** automatic/CD 定时合炉；合炉预上架使用 `csforge_prelist_create_many`（items 内 kind=furnace，单炉传 1 项）；开炉、付款与平台提交按原有平台流程执行，结果以回执为准。

## 4. 工作流 A：库存与选材（只读）

1. 逐件选材用 `csforge_inventory`；仅需数量或磨损分布时优先 `csforge_inventory_summary`。按目标缩小查询范围，避免重复拉取完整库存。
2. 参数、可用标记和成本/行情字段语义见 [库存工具参考](references/tools.md#csforge_inventory)。用户要求只用可上架材料时，按实际可用状态筛选，锁定材料不重复使用。
3. 展示方案时依据数据来源说明实际成本和模拟估值；缺失成本保持未知，不能自行补零或改用行情价。

## 5. 工作流 B：找炉 / 卡磨损（只读优先）

1. 开始前必须先完成 §0.2 需求确认；确认后明确四要素：目标饰品（skinId/名称）、目标磨损（FN/MW/FT/WW/BS）、材料组成、硬约束（只用可上架材料、只要入档或贴边、成本上限等）。
2. 用 `csforge_preview_many`（1–100 组，传 `targetSkinId` 只回目标产物）验证候选，以站点返回的 `outcomes[].float/wear/probability/price` 为准。
3. 磨损规则（站点 `normalized-2025-10`）：先对每件材料按自身区间归一化 `(float-min)/(max-min)`，取平均后映射到目标区间 `目标float = 目标min + 平均 × (目标max - 目标min)`。
4. 磨损档位边界：按目标档位取区间：FN <0.07；MW 0.07–<0.15；FT 0.15–<0.38；WW 0.38–<0.45；BS 0.45–1.00；再与目标皮肤 maxFloat 求交。B 方向要求产物尽量接近所选档位上限但仍属于该档（如 MW 接近但严格小于 0.15，FN 接近但严格小于 0.07）；C 方向接近该档下限。
5. 需要精确搜索时：先算候选组合的平均归一化磨损，再逐组用 `csforge_preview_many` 复核；不要只靠本地公式就创建草稿。
6. **磨损目标策略必须服从 N2**：
   - **A 只要入档**：达到目标档位即可，档位内高低不限，按成本/库存优化。
   - **B 入档后尽量偏高**：在所选档位内尽量接近该档上限；例如 FN 约 0.0699、MW 约 0.1499、FT 约 0.3799、WW 约 0.4499，BS 接近该皮肤可达上限。优先消耗高 float 材料、保留低 float 库存。不是产物越低越好。
   - **C 入档后尽量偏低**：在所选档位内尽量接近该档下限；适合追求低磨产物，通常会消耗低 float 材料。
   - 档位边界属于下一档的起点，不能取等号；例如 0.07 属于 MW，0.15 属于 FT，0.38 属于 WW，0.45 属于 BS。

**求解器（多炉批量必用）**：先按 §10 的 `scripts/plan-packs.mjs` 做预算式分配——它一次输出“N 炉各用哪 10 件材料 + 每炉预测 float + 是否能贴到目标 + 若不能则可达上限是多少”，100ms 级完成。然后把 `plan.packs` 转成 `csforge_preview_many` 的 `sets`（main + 9 件 fillers）批量复核，全部通过后再进入 §6 创建。**不要**再靠“排序 + 逐炉试错”手工组炉；也不要先建一部分草稿再发现后面材料不够。
7. 展示多个炉时给出：方案、10 件材料（名称+float）、目标产物 float/概率、材料成本、期望值/收益、风险提示。排序必须服从 N2 方向：A 按成本/库存；B 按预测 float 从高到低，但必须仍在目标档位内；C 按预测 float 从低到高。用户要几个方案就给几个方案，方案是只读展示，不创建。
8. 等用户选定方案后再进入创建流程；**不要**自动创建预上架或替用户下单。创建份数以 §0.2 N3 用户确认的数字为准（允许批量，但不得自行取材料上限）。

## 6. 工作流 C：按用户要求创建与发布

前置：完成 §0.2 的需求确认，并核对本人账号、材料归属及可用性。数量与价格遵从用户已确认的要求，不自行采用库存上限或历史参数。

1. 要先保存草稿时，使用 `csforge_prelist_create_many`（单炉也传 1 项），再用 `csforge_prelist_brief(detail="full")` 核对材料与草稿状态。批量创建参数见 [创建工具](references/tools.md#csforge_prelist_create_many)。
2. 用户给出发布信息后使用 `csforge_prelist_configure_many`（单炉也传 1 项）。按 [配置工具](references/tools.md#csforge_prelist_configure_many) 填写对应类型字段；保存配置成功不表示已发布。
3. 用户明确要求发布时使用 `csforge_prelist_arm`，按 [发布工具](references/tools.md#csforge_prelist_arm) 处理网站确认、冷却和付款状态。等待确认期间不改用其他接口绕过；超时先核对原任务。
4. 用户明确要直接创建并发布合炉时，使用 `csforge_furnace_create`；字段及确认重试规则见 [合炉创建工具](references/tools.md#csforge_furnace_create)，尤其保留首次返回的固定价格与押金估算。
5. 批量需求使用相应批量工具；可用范围见 [工具参考](references/tools.md#批量与精简工具)。逐项核对结果，部分失败不重建已成功的任务。
6. 交付前区分草稿、已配置、待确认、排期、待付款、平台已上架和结果未知。提供任务编号、实际状态与下一步；二维码交付按 §11，不能只发图片或把报价当实际扣款。
7. 取消或其他变更使用对应专用工具，先核对原任务状态；付款和平台结果不明时只查询，不换幂等键重复提交。

## 7. 工作流 D：用户发布后核对

- 用 `csforge_prelist_brief`（view=active/history, phase=all）核对状态；勿把草稿当作已发布。
- 消息提醒可能因瞬时网络失败显示“暂时无法更新”，网站会自动重试；如需排查可看 API 日志（`消息提醒核对完成/较慢/失败：Xms`）。
- 结果未知时只查询、不重试写操作。

## 8. 常见错误与处理

| 现象 | 处理 |
|---|---|
| `analyze_recipe` 超时 | 传 `timeoutMs`（≤180000）重试；或减少 `mainMaterialCount`、`sortBy=probability`；仍失败则说明服务繁忙，别反复轰炸 |
| 标题报错 | 平台标题 ≤10 个字符；改为简短中文名 |
| 材料被占用/不可用 | 重新 `csforge_inventory`；`locked`/`prelisted` 的资产不可再用 |
| 预上架不存在/已处理 | 重新 `csforge_prelist_brief`，不要重复创建 |
| Agent arm 返回 403 | 按实际回执核对权限、密钥有效性和原审批请求；需要批准时等待本人批准，不更换接口绕过 |
| 支付宝二维码未就绪 | 冷却中或后台生成中；用 `csforge_alipay_qr` 稍后再查，或让用户等待；已过期则重新获取/续期 |
| 用户拒绝/关闭 Agent 审批 | 停止发布流程，转为用户在网站人工发布；不要反复提交 |
| ECO 平台拒绝（如 ResultCode 1/2001） | 读 `message`，常见为令牌未绑定/参数/价格规则；不要盲目重试 |
| 响应过大/超时 | 用专用工具；`csforge_request` 只作兜底，禁止拉原始库存 |
| 创建后 202 | 等用户批准，再用相同参数+approvalId+同 idempotencyKey 重试 |
| `guardStatus` 非 102 | 打包**发布/arm** 不可用，提示用户去 EcoSteam 绑定 ECO 令牌；草稿创建/合炉创建可先尝试，最终以平台回执为准，不要绕过 |
| 打包售价被拒 | 总售价必须严格低于最高产物价值；让用户下调售价后再试 |
| 冷却材料发布 | 草稿可包含冷却材料；发布后会到期自动上架并自动从余额扣押金，如实告知时间 |
| 要求卡极限磨损但做不到 | 如实报告可达 float 与目标差距；无法满足档位时明确说不可行 |
| 合炉创建返回 202 | 敏感操作待确认：用户在网站批准后，用**相同参数（含 estimatedDepositCents）** + 同 idempotencyKey + approvalId 重试 |
| 合炉押金估值不可用 | float-band 产物区间底价不完整；稍后重试或让用户在网站创建，不要拿旧价格猜 |
| 合炉余额不足/平台拒绝 | 如实转告，用户可充值或改用支付宝；不要重复提交同一请求 |
| 合炉被平台拒绝（CreateFurnace 状态码 1） | 常见原因是材料售价低于材料参考价或材料状态变化；不要原样重试，先让用户提高每件售价（总价仍须低于最高产物估值）或换材料；仍失败则转网页创建 |
| 合炉支付宝二维码未就绪 | 用 `csforge_alipay_qr(kind=furnace, id=平台合炉编号)` 稍后再查；过期需重新获取；Agent 不代付 |
| 报价与实付不一致 | `csforge_alipay_qr` 的 `amount` 是二维码订单报价，实际扣款以平台/支付宝账单为准；不要用报价冒充实付 |

## 9. 站点导航

`csforge_open_page` 支持：`forge`、`inventory`、`catalog`、`procurement`、`publish-pack`、`prelist`（预上架）、`revenue`。没有在线网页时返回 `no_active_browser`，直接告诉用户，不要拼链接。

## 10. 本地只读计算脚本：候选组合搜索

路径：`scripts/find-extreme-float.mjs`（随插件/Skill 分发；Node 运行，**无网络、无令牌、无第三方依赖**）。

用途：给定目标区间、磨损边界、材料配比和候选资产清单，搜索十件组合中“目标产物 float 尽量贴近边界”的方案，避免 Agent 临场做组合/子集搜索时算错。

```bash
node scripts/find-extreme-float.mjs --input plan.json
```

输入示例（数值仅示意，需替换为本次真实目标与资产）：

```json
{
  "target": { "name": "<目标饰品名>", "minFloat": 0, "maxFloat": 0.55, "boundary": 0.07, "mode": "below" },
  "composition": [
    { "skinId": "skin-A", "count": 1, "minFloat": 0, "maxFloat": 0.8 },
    { "skinId": "skin-B", "count": 9, "minFloat": 0, "maxFloat": 0.7 }
  ],
  "assets": [
    { "assetId": "...", "skinId": "skin-A", "float": 0.34, "available": true },
    { "assetId": "...", "skinId": "skin-B", "float": 0.06, "available": true }
  ],
  "options": { "top": 3 }
}
```

- `mode`：`below`（严格 < 边界，默认）、`atMost`（≤）、`above`（>）、`atLeast`（≥）。
- 输出：`status`（`feasible`/`infeasible`）、`search.method`（`exhaustive`/`local-search`）、`results[]`（`predictedFloat`、`wear`、`marginToBoundary`、`meetsBoundary`、`assets[]`）、`warnings`。
- 候选来自 `csforge_inventory` 的 available 资产或用户提供；`available:false` 会被忽略；产出超过 10 件按 `top` 返回多组候选。

使用规则：

1. 脚本只生成候选，**不得**直接创建预上架草稿/合炉；创建前必须用 `csforge_preview_many` 复核选中的 1–5 组。
2. 脚本不读价格、不计算概率/期望收益、不联网，也不能代替平台回执；这些仍用 preview/simulate。
3. 无法满足边界时脚本返回 `infeasible` 和最接近结果，需向用户报告差距，不要硬做或改口径。
4. 极端贴边属于目标而非保证：报告预测 float 与边界的实际余量，最终以站点 preview 与平台结果为准。

### 10.1 plan-packs.mjs（预算式配炉求解器，批量组炉首选）

路径：`scripts/plan-packs.mjs`（随插件/Skill 分发；Node 运行，**无网络、无令牌、无第三方依赖**）。

用途：给定目标区间、边界、目标产物 float、主料列表和辅料池（每件含 `minFloat/maxFloat/float`），**一次算出所有炉的材料分配**，并对不可行目标直接给出“可达上限”。相比 §10 的逐组搜索，它解决的是“先建一部分草稿、才发现材料池撑不到目标”的返工问题。

```bash
node scripts/plan-packs.mjs --input plan.json            # 文本结果
node scripts/plan-packs.mjs --input plan.json --json     # JSON，便于拼 preview/create 批次
node scripts/plan-packs.mjs --input plan.json --target 0.0699
```

输入示例：

```json
{
  "target": { "name": "<目标饰品>", "minFloat": 0, "maxFloat": 0.55, "boundary": 0.07 },
  "targetFloat": 0.0699,
  "slotsPerPack": 9,
  "mains":   [{ "assetId": "...", "minFloat": 0, "maxFloat": 0.8, "float": 0.373 }],
  "fillers": [{ "assetId": "...", "minFloat": 0, "maxFloat": 0.7, "float": 0.058 }]
}
```

- `status`：`feasible`（目标可达）/ `reduced`（不可行，已自动降到可达上限并在 `warnings` 说明）/ `partial`（部分炉材料不够）/ `infeasible`（主料本身已越过边界，任何辅料都救不回来）。
- `packs[]`：`mainAssetId`、`fillerAssetIds`（9 件）、`predictedFloat`、`gap`、`wear`；`summary` 给 min/max/avg 与 `allBelowBoundary`。
- 算法：归一化 → 每炉预算 `demand = 10 × allowedAverage − 主料归一化值` → 可行性预检（单炉最大 9 件和 + 总供给）→ 定向选材（k 件高磨损辅料 + 剩余槽位最优窗口）→ 未用材料 1-swap + 跨炉交换把每炉顶到预算上限。
- 实测（25 炉 / 295 件备选池）：全部排到 **0.069895–0.069900**（gap≈0.0001），运行约 **100ms**。
- 规则：求解器只产出候选，**创建前必须用 `csforge_preview_many`（传 `targetSkinId`）复核**；不可行时如实报告可达上限，不要硬做或改口径。

## 11. 交付格式

- 写操作前先回显“已确认参数”（数量、材料组成、目标磨损/float 目标、标题、交付步骤），再执行；创建完成后逐份列出 id + 材料 + 模拟结果。
- 合炉交付必须包含**用户填写的每件材料售价**，并把“押金估算/报价”和“实际扣款”分开表述；不要把 Agent 的估算或二维码报价当作已扣款。
- 押金二维码交付**必须同时给出金额（元，两位小数）、过期时间、任务/合炉编号和当前状态**；只发图片视为未完成交付，用户无法判断要付多少、何时过期。
- 表格优先；金额两位小数；float 至少 6 位小数（对齐站点显示）。
- 明确区分：只读分析结果 / 已创建草稿 / 已发布（人工）/ 结果未知。
- 概率、成本、期望值必须注明来源（站点预览快照 vs 库存参考价）。
- 不确定的业务规则先问用户，不要凭空假设；确认后更新本 Skill。

## 12. No-CD freshness rule

- A pack is "no-CD" only when every one of its 10 selected assets has `ready=true`, `locked=false`, and `prelisted=false` at the moment of preview/creation.
- Before saying no-CD is feasible or impossible, refresh current inventory. Prefer `csforge_inventory` with `availableOnly=true`; for multi-skin search, parse the latest full inventory snapshot. Verify every selected main and filler individually.
- Never reuse an old inventory JSON snapshot, an old prelist material list, cached `readyAt`/`tradableAfter`, or chat memory as proof of current readiness. Cooldowns expire and `ready` can become true.
- `ready=false` alone does not prove cooldown: it may mean locked, prelisted, or Status/Tradable/CanPublish is not satisfied. Conversely, an earlier `ready=false` may already be stale.
- For a specific target, also verify that at least one main from the target collection is currently ready and available. Plenty of low-P fillers does not remove the target-collection main requirement.
- If currently infeasible, recompute against the fresh available set and state the minimum reachable wear and the actual missing constraint. A `preview_many` error such as inventory changed means refresh and retry analysis, not "no-CD impossible".
- If a prelist/listing is already armed or submitted, do not suggest cancelling it to free materials unless its current state says cancellation is allowed; platform-locked materials cannot be released through `prelist_cancel`.

## 参考

- `references/tools.md` — 工具参数、返回结构与调用示例。
- `references/deployment-notes.md` — 本部署快照：昵称映射、示例库存/价格、实测金额与平台拒绝记录（**可能过期，使用前复核**）。
- `scripts/find-extreme-float.mjs` — 只读候选组合搜索脚本。
