---
name: csforge
description: CSForge（CS2 饰品炼金 / 预上架 / 打包汰换 / 合炉）Agent 操作技能；当用户要求分析炼金配方、卡磨损找炉、筛选库存、创建或查看预上架、打包汰换、合炉、检查 EcoSteam 账号连接，或要使用任何 csforge_* MCP 工具时加载。包含工具选择、预上架草稿流程、材料与磨损规则、安全红线和错误重试规范。适用于任何已接入 CSForge Streamable HTTP MCP 的 Agent 客户端，不绑定特定插件。
metadata:
  version: "0.3.3"
  date: "2026-11-09"
---

# CSForge Agent Skill

> 本 Skill 面向“帮用户操作 CSForge 网站”的 Agent；站点部署、服务器运维、数据库维护不属于本 Skill 范围。
> 工具名以当前客户端注册的 `csforge_*` 为准，本文不绑定特定插件/客户端；站点端说明可用 `csforge_help` 复核。

## 何时使用

- 任何 `csforge_*` 工具调用前；
- 用户提到：CSForge、EcoSteam、预上架、打包汰换、合炉、炼金、汰换合同、卡磨损、找炉、库存筛选、Agent 接入、平台连接；
- 需要判断“这个操作 Agent 能不能做、该走哪条流程”时。

## 0. 开场：先读身份，再完成需求确认

> 顺序不能颠倒：先 `csforge_whoami`（只读）→ 再 §0.2 需求确认 → 才允许分析/选材/创建。

### 0.1 身份与账号（只读，一次调用）

先调用 `csforge_whoami`，不要一上来就拉库存/开始分析。

返回字段与判断：

| 字段 | 含义 | 处理 |
|---|---|---|
| `authorized` / `configured` | 网站已授权、EcoSteam 连接已配置 | 任一为 false：停止，请用户在网站“平台连接”完成连接 |
| `steamId` | 当前绑定执行账号 | 后续预上架/预览的真实材料都属于该账号 |
| `accounts[].accountStatus` | EcoSteam 账号状态，正常为 1 | 非 1 时平台可能拒绝，仍可尝试但需提示用户 |
| `accounts[].guardStatus` | ECO 令牌绑定状态，`102` = 已绑定 | 合炉与打包汰换都要求 102；未绑定需用户在 EcoSteam 官方渠道绑定 |
| `accounts[].tradeReady` / `available` | 交易就绪 / 账号可用 | false 时先解决账号问题 |
| `accountsError` | 账号列表读取失败 | 把错误如实转告，不要假装已连接 |

未连接/无绑定：直接结束流程并说明需要用户完成什么，不要猜测账号或材料。

### 0.2 需求确认（所有写操作的硬门禁）

> **本节优先级高于“用户已经说了创建”的直觉，也高于任何历史习惯。** 凡下一次调用属于写操作（`csforge_prelist_create` / `configure` / `arm` / `cancel`、`csforge_save_recipe`，或 `csforge_request` 的任何 POST），必须先把下面的清单逐项确认完，才允许调用。

#### 0.2.1 三条硬性规则

1. **先问再做**：确认完成前，只允许 ① `csforge_whoami` ② 名称/目录查询 `csforge_find_skins` ③ 现有预上架状态 `csforge_prelist_list`。**不得**先跑 `csforge_analyze_recipe`、`csforge_inventory` 选材、`csforge_preview_assets` 组炉，更不得写脚本/读站点源码“顺便把方案做出来”。
2. **一句话不算确认**：“创建多个红色轮胎的预上架”“帮我上架”“按上次的来”“随便”都不是参数确认。数量、目标磨损、材料组成、交付步骤必须落成具体值，并由用户在当前会话明确回复。
3. **历史只是建议**：历史预上架/配方只能作为推荐选项呈现，**不得**当默认参数执行。用户说“按上次的来”时，把上次每项参数列出来请其确认。

#### 0.2.2 必须确认的六项（N1–N6）

| 编号 | 字段 | 确认到可执行的值 | 明确禁止 |
|---|---|---|---|
| N1 | 目标饰品/收藏品 | 正式名 + skinId（昵称先查目录） | 用昵称猜皮肤 |
| N2 | 目标磨损档位 + 是否卡极限 | FN/MW/FT/WW/BS；卡极限时给出边界（如严格 <0.07） | 自行假定 FN 或“越极限越好” |
| N3 | 数量 | 具体数字（1、2、3…） | 把“多个”自行解释成上限或下限（如“最多 6 份就建 6 份”） |
| N4 | 材料组成 | 主材料件数 + 其余材料来源（例：“1 件幻光构架 + 9 件冻雨”）或明确“由 Agent 从可用库存选” | 把历史配方当默认 |
| N5 | 交付步骤 | ①只读方案 ②只建草稿 ③草稿+填发布信息 ④ Agent 发起 arm（需网站人工批准）⑤ 创建合炉（需逐件给价） | 先建草稿/先建炉再补问 |
| N6 | 发布信息（N5≥③ 或 N5=⑤ 时必填） | 打包：标题（≤10 字符）、总售价、公开/私密、押金方式；合炉：标题、公开/私密、押金方式（余额/支付宝）、开炉费设置，以及**用户逐件给出的材料售价** | 替用户定价、定可见性、选押金 |

#### 0.2.3 一次问清（推荐做法）

- 用**一次** `ask_user_question` 或一条编号清单把 N1–N6 问完，给推荐项和真实约束，避免多轮拉锯。
- 问之前可先给 2–3 行“只读事实”（例如：可上架冻雨 58 件、幻光构架 22 件可用（冷却中）、1+9 配方下红轮胎概率 2.5%、FN 价 77.69）。
- 数量与贴边冲突时给两种真实选项：例如“3 份可控 float≈0.0699；6 份为材料上限、float≈0.0679”。
- 用户回复“就按推荐/用这个”也视为确认，但必须**回显最终参数**再执行。
- 用户未回答的项：不要用默认值继续；要么请其确认推荐值，要么停止。

#### 0.2.4 模糊表达处理

| 用户说法 | 必须的处理 |
|---|---|
| “多个 / 一些 / 几个 / 一批” | 追成具体数字，并说明材料上限 |
| “随便 / 你定 / 看着办” | 给 2–3 个带具体参数的方案（含推荐），请用户选一个 |
| “卡到 0.07 / 刚刚崭新 / 极限磨损” | 确认档位与边界（严格 <0.07），并说明可达精度与差距 |
| “按上次的来” | 列出上次参数逐项，请用户确认后再执行 |
| “快点 / 别问那么多” | 仍然只发**一次**最小确认（一组选项/一张表），不跳过确认 |
| 用户已给全 N1–N6 | 回显参数后直接执行，不再反问 |

#### 0.2.5 分场景补充

- **打包汰换**：N6 的总售价必须严格低于最高产物价值；押金由用户在网站支付，Agent 不计算、不承诺、不付款。
- **合炉**：没有 Agent 创建入口；确认目标与磨损后只输出 10 件材料表（序号/名称/float/备注），由用户自己填每件出售价，Agent 不替用户定价。
- **发布/arm**：必须单独确认用户接受“Agent 发起 arm，但必须在网站 Agent 接入页面人工批准，且 Agent 不代付押金”；若敏感确认开关关闭，提示“发布将直接生效”。

#### 0.2.6 反模式（本 Skill 明确禁止）

- 用户说“创建多个”就直接按最大可行数开建；
- 用历史预上架参数当默认模板；
- 先 analyze/inventory/preview 再问，或用“再查一步更稳”把提问一拖再拖；
- 把“多个/随便/按上次”自行解释成具体值；
- 未确认就先建草稿，事后再补问售价/可见性/押金。

确认完成后，才允许调用 `csforge_analyze_recipe` / `csforge_inventory` / `csforge_preview_assets` 进入分析与选材。

## 1. 工具速查

详细参数与返回见 `references/tools.md`。选择顺序：

1. 身份：`csforge_whoami`
2. 目录/配方：`csforge_find_skins` → `csforge_analyze_recipe`
3. 库存：`csforge_inventory`（**永远不要**用 `csforge_request` 拉原始 `GET /api/execution/inventory`，体积大且字段冗余）
4. 候选炉验证：`csforge_preview_assets`（一次 1–5 组）
5. 预上架：`csforge_prelist_create` → `csforge_prelist_list` / `csforge_prelist_simulate` → `csforge_prelist_configure` →（用户人工发布）
6. 合炉（Agent 可创建）：`csforge_furnace_create`（10 件材料 + 用户逐件售价 + 押金方式）→ `csforge_furnace_status`（只读轮询）→ 支付宝押金用 `csforge_alipay_qr(kind=furnace)`
7. 页面导航：`csforge_open_page`（支持 `prelist` 深链）
8. 兜底：`csforge_request` 只用于上述专用工具未覆盖的业务接口；账户、管理员、令牌管理接口不可用

## 2. 安全红线（不可协商）

- **只读优先**：查询、预览、模拟先做；写操作必须来自用户明确指令。
- **写操作前置 = §0.2 需求确认**：`csforge_prelist_create` / `configure` / `arm` / `cancel` / `csforge_furnace_create` / `csforge_save_recipe` 以及任何 `csforge_request` POST 之前，必须先完成 §0.2 的 N1–N6 确认；**“用户已要求创建”不等于“参数已确认”**，不得自行补默认值。
- **合炉创建 = 敏感操作**：`csforge_furnace_create` 会发布十件材料并授权押金扣款，按敏感写操作处理（网站敏感确认开启时返回 202+approvalId），重试必须回传首次的 `estimatedDepositCents` 与 `idempotencyKey`。材料售价必须由用户逐件给出，Agent 不得定价；押金由平台按授权从用户 EcoSteam 余额扣除或生成支付宝付款码，Agent 不代付、不确认支付。
- **发布/arm**：Agent 可以调用 `csforge_prelist_arm` 发起发布/开启自动上架。网站“操作确认”里普通/敏感操作各有一个开关：敏感操作开启时，arm 首次返回 202+approvalId，必须经用户在网站批准后重试才生效；敏感操作关闭时 arm 会直接执行，Agent 必须先得到用户明确要求，并提示“敏感确认已关闭、发布将直接生效”。发布后的 CD、押金、提交仍按平台流程，结果以回执为准。
- **Agent 不得**：替用户决定售价/押金/公开私密；替用户支付/扣款；开启自动上架后绕过用户审批；替用户确认支付结果。
- **押金/付款不用 Agent 管**：合炉押金 = 最高产物估价 × 1.05，打包汰换押金 = 最高产物估价 × 1.4，默认余额；实际金额以平台报价为准，Agent 不计算、不承诺、不付款，用户自己支付。
- **预上架只支持打包汰换（pack）**；合炉没有 Agent 预上架入口，不要绕道 `plans/:id/create`。
- **写操作 202**：返回 `approvalRequired=true` + `approvalId` 时，告诉用户去网站“Agent 接入”批准；重试必须使用**完全相同**的方法/路径/JSON 参数与 `approvalId`，`idempotencyKey` 不变。
- **结果不明**（超时、网络中断、响应异常）：先查 `csforge_prelist_list` / 任务状态，**禁止换幂等键重试**，避免重复创建、重复付款。
- 不要输出/记录令牌（`csf_...`）、平台票据或账号隐私字段到聊天、文件或仓库。
- 创建草稿会立即锁定并隐藏材料；创建前必须得到用户确认，取消会释放材料但可能影响用户其他操作。

## 3. 业务对象与术语

| 术语 | 含义 | Agent 可做 |
|---|---|---|
| 合炉（furnace） | 用户自己投入 10 件材料开炉，产出 1 件更高稀有度饰品 | 只读分析/配方保存；创建与付款由网站人工完成 |
| 打包汰换（pack） | 把 10 件材料作为“炉”上架出售（买家购买后自行汰换） | 可创建预上架草稿、填发布信息（用户给值）、模拟、取消；发布/开启自动上架必须人工 |
| 预上架（prelist） | 打包汰换的草稿态：材料锁定、`prelist=true, armed=false, configured=false`，不付款不提交 | 创建/查看/模拟/填发布信息/取消 |
| 可上架资产 | `ready && !locked && !prelisted`（`ready` 已包含 Status=1、Tradable、CanPublish） | `csforge_inventory` 的 `available` 直接使用 |
| 材料/炉 | 十件同稀有度材料组成的汰换合同 | 分析、预览、选材 |

常见昵称 → 正式名（用于搜索）：红色轮胎 = Glock-18 | Red Tire；幻光构架 = CZ75-Auto | Framework；冻雨 = M249 / P250 | Sleet；“可上架/可用”= 上述 available。

产物概率规则（CS2 汰换）：产物收藏品按投入材料数量占比分权；同一收藏内按该稀有度产物数量均分。例：1 件 A 收藏 + 9 件 B 收藏 → A 收藏占 10%，若 A 有 4 个产物则每个 2.5%。**不要暗示必出某个产物**。

### 平台规则（2026-11-09 用户确认）

- **售价**：打包汰换的总售价必须严格低于最高产物价值，达到或超过会被平台拒绝。
- **押金**：合炉 = 最高产物估价 × 1.05；打包汰换 = 最高产物估价 × 1.4；默认余额；由用户在网站支付，Agent 不计算/不承诺/不付款，实际金额以平台报价为准。Agent 创建合炉时只提交用户选择的押金方式与平台估算；余额由平台按一次性授权扣款，支付宝付款码只能发给用户本人。
- **账号门槛**：`guardStatus=102`（ECO 令牌已绑定）是打包汰换的硬性要求；合炉创建要求 EcoSteam 交易链接实时验证通过，创建流程本身不再单独拦截 102，付款/上架结果以平台回执为准。不满足时先告知用户去 EcoSteam 官方渠道处理，不要绕过。
- **纪念品**：Souvenir 纪念品可以作为汰换材料。
- **冷却材料**：冷却中的材料可以先进预上架草稿；发布后到期会自动上架并自动从余额扣押金。
- **合炉入口**：Agent 可用 `csforge_furnace_create` 创建合炉（十件材料 + 用户逐件售价 + 押金方式），但**不提供** automatic/CD 定时合炉；开炉、付款与平台提交按原有平台流程执行，结果以回执为准。

## 4. 工作流 A：库存与选材（只读）

1. `csforge_inventory`：默认 `availableOnly=true`，`limit` 50（最大 200），`includePrices=false`；
2. 用 `query`/`skinId` 缩小范围；需要完整池子时按 200 上限分页（记录 total）；
3. 关注 `ready`（冷却/交易/上架状态）、`locked`、`prelisted`、`canUse`（结构可用的粗判，不代表稀有度/收藏合格）；
4. 冷却中的材料：可以讨论，但用户要求“只用可上架材料”时不要选；
5. 价格口径提醒：`csforge_inventory` 的 price 是库存参考价，和 `csforge_preview_assets`/预上架模拟里的 cost 可能来自不同快照，**不要混用**，需注明来源。

## 5. 工作流 B：找炉 / 卡磨损（只读优先）

1. 开始前必须先完成 §0.2 需求确认；确认后明确四要素：目标饰品（skinId/名称）、目标磨损（FN/MW/FT/WW/BS）、材料组成（例如“1 件幻光构架 + 9 件冻雨”）、硬约束（只用可上架材料、尽量卡 0.07、成本上限等）。
2. 用 `csforge_preview_assets` 验证候选（1–5 组，每组 10 个不同 assetId），以站点返回的 `outcomes[].float/wear/probability/price` 为准。
3. 磨损规则（站点 `normalized-2025-10`）：先对每件材料按自身区间归一化 `(float-min)/(max-min)`，取平均后映射到目标区间 `目标float = 目标min + 平均 × (目标max - 目标min)`。
4. 磨损边界：`float < 0.07` 为崭新出厂（FN），**恰好 0.07 属于略有磨损**。“卡到 0.07 以内/刚刚崭新”应贴近但严格小于 0.07（例如 ≤0.06999），不要取 0.07。
5. 需要精确搜索时：先算候选组合的平均归一化磨损，再逐组用 `csforge_preview_assets` 复核；不要只靠本地公式就创建草稿。
6. **磨损目标策略**：用户说“卡到 X 以内/刚刚崭新”时，默认按“越极限越好”处理，即在满足档位的前提下尽量贴近边界（例如目标 0.07 以内就尽量做到 ≤0.06999）。
   - 能做到但达不到极限时也要如实报告差距：例如用户要求 0.0699，实际只能做到 0.068，应明确报告“达到档位但未达到极限 0.0699”；
   - 无法满足目标档位/边界时，明确说明不可行，不要硬做或改口径。
7. 展示多个炉时给出：方案、10 件材料（名称+float）、目标产物 float/概率、材料成本、期望值/收益、风险提示（概率低、混合收藏稀释等）。默认按“目标产物最贴边优先，其次成本/期望”排序；**用户要几个炉就给几个方案**。
8. 等用户选定方案后再进入创建流程；**不要**自动创建预上架或替用户下单。批量创建时按用户指定的数量逐个建立草稿。

## 6. 工作流 C：创建预上架（打包汰换）草稿

前置：**§0.2 需求确认已完成（N1–N6 逐项有值）**；`csforge_whoami` 正常；`guardStatus=102`；10 件材料来自当前账号。数量以用户确认的具体数字为准，**不得自行取材料上限**；冷却中的材料可以进草稿。

1. **创建**：`csforge_prelist_create`，`name` 即平台标题（≤10 个字符），`assetIds` 恰好 10 个不同资产；`idempotencyKey` 可省略（结果会返回，重试必须复用）。成功后材料立即锁定并隐藏，不付款、不提交。
2. **核对**：`csforge_prelist_list`（`view=active, phase=prelist`）确认 `prelist=true, armed=false, configured=false`、10 件材料匹配；需要刷新估值用 `csforge_prelist_simulate`（只更新缓存）。
3. **发布信息**：只有用户明确给出标题/售价/公开私密后才调用 `csforge_prelist_configure`；不要替用户定价。**总售价必须严格低于最高产物价值**；`title` ≤10、`sellPrice` 两位小数、`visibility=private|public`；押金选择支付宝时传 `paymentMethod=alipay`。
4. **发布/arm**：用户明确要 Agent 发布时，调用 `csforge_prelist_arm`（首次返回 202+approvalId）；告知用户在网站“Agent 接入”页面批准，然后用相同 id+approvalId 重试。用户未批准或关闭 Agent 确认时不得发布，也不要改用其他接口绕过。发布后按 CD、押金和平台提交流程执行。
5. **支付宝押金二维码**：配置 `paymentMethod=alipay` 并且 arm 成功后，调用只读工具 `csforge_alipay_qr`（可用 `maxWaitMs` 轮询等待）取二维码；返回结果含 `imagePath`、金额和过期时间。把二维码图片发给用户本人（可 `present` 图片文件），并提示“仅限本人扫码、过期需重新获取”；**Agent 不代付、不确认支付、不发到群聊**。二维码未就绪（冷却中/后台生成中）时如实告知，稍后再查。
6. **取消**：`csforge_prelist_cancel`（写操作，可能需要确认），释放材料锁。
7. 交付时给出：预上架 id、名称、10 件材料清单、模拟目标产物 float/概率、成本/期望值、当前状态、押金方式、下一步（用户批准发布/扫码付款）。

### 6.1 合炉（Agent 可创建，敏感操作）

前置：§0.2 已确认 N1–N6，尤其是材料组成与 **N6 的每件材料售价（用户给）**、公开/私密、押金方式（余额/支付宝）、开炉费设置。

1. **报价（只读）**：先用 `csforge_preview_assets` 或站点预览给出十件材料的产物/概率/磨损；把 10 件材料表（序号/名称/float/参考价）交给用户，**让用户自己填写每件出售价格**，Agent 不替用户定价、不承诺押金金额。
2. **创建**：`csforge_furnace_create({ name, assetIds, prices, visibility, depositMethod, openFeeRate?, freeOpenFee?, selfOpen? })`。
   字段用途（每一项都要向用户解释，不许自行填值）：

   | 字段 | 用途 |
   |---|---|
   | `name` | 平台标题，1–10 字符（用户指定，不是材料名） |
   | `assetIds` | 十件合炉材料 assetId，互不相同、属于当前绑定账号 |
   | `prices` | **用户逐件给出的材料售价**（元，最多两位小数），assetId 与 assetIds 一一对应 |
   | `visibility` | `private` 私密 / `public` 公开（用户选择） |
   | `depositMethod` | `balance`=从用户 EcoSteam 余额扣款；`official`=生成支付宝付款码由用户扫码 |
   | `openFeeRate` | 开炉费百分比 0–10，默认 0（用户决定） |
   | `freeOpenFee` | 是否免开炉费，默认 true（用户决定） |
   | `selfOpen` | 是否允许自己开炉，默认 true（用户决定） |
   | `estimatedDepositCents` | 押金估算（分）：首次省略、工具计算并返回；带 approvalId 重试时**原样回传** |
   | `idempotencyKey` | 幂等键：省略由工具生成并返回，确认重试必须复用 |
   | `approvalId` | 网站“Agent 接入”批准后回填；未批准不要传 |

   工具会先按 `priceMode=float-band` 读取产物区间估值并计算押金估算 `estimatedDepositCents`，再提交创建（服务端 oneStep 押金授权）。
   - 该写操作按**敏感操作**处理：若网站敏感确认开启，首次返回 202+approvalId → 让用户在网站“Agent 接入”批准 → **用完全相同参数（含 `estimatedDepositCents`）与 `idempotencyKey` 重试**。
   - **售价下限（实测）**：平台会拒绝明显低于材料参考价的售价。2026-11-09 实测同组合：`0.01/件`（合计 ¥0.10）被拒（“EcoSteam 拒绝请求（CreateFurnace，状态码 1）”），`0.05/件`（合计 ¥0.50，最高产物 float-band 估值 ¥0.61）成功。让用户按材料参考价/买入成本填写每件售价，且总价严格低于最高产物估值；被拒时不要原样重试，先提高售价或换材料。
   - 若返回押金估值不可用（float-band 不完整）、材料不可用或平台明确拒绝，如实转告，不要换参数硬试。
3. **进度**：`csforge_furnace_status({ operationId })` 只读轮询（`state`/`externalId`/`depositState`/`depositMessage`）；拿到平台合炉编号后也可用 `csforge_furnace_status({ furnaceId })` 核对押金。
4. **押金**：
   - 余额（`depositMethod=balance`）：平台按一次性授权从用户 EcoSteam 余额扣款；Agent 不计算、不承诺、不确认支付。
   - 支付宝（`depositMethod=official`）：付款码生成后，用 `csforge_alipay_qr({ kind: 'furnace', id: 平台合炉编号 })` 取二维码图片，**交付给用户时必须同时说明金额（元，两位小数）、过期时间、合炉编号与当前状态，不能只发一张图**；只能发给用户本人，并提示“仅限本人扫码、过期需重新获取”。
5. **结果不明**（超时/网络中断）：只查 `csforge_furnace_status`，**禁止换幂等键重复创建**。
6. 交付时给出：operationId、平台合炉编号（若有）、10 件材料+用户售价、押金方式/估算、当前状态（creating/paying/paid/alipay/failed/unknown）、下一步。
7. 限制：Agent 入口**不创建** automatic/CD 定时合炉；合炉不会由 Agent 开炉；`csforge_save_recipe` 只保存平台配方，与合炉创建无关。

## 7. 工作流 D：用户发布后核对

- 用 `csforge_prelist_list`（view=active/history, phase=all）核对状态；勿把草稿当作已发布。
- 消息提醒可能因瞬时网络失败显示“暂时无法更新”，网站会自动重试；如需排查可看 API 日志（`消息提醒核对完成/较慢/失败：Xms`）。
- 结果未知时只查询、不重试写操作。

## 8. 常见错误与处理

| 现象 | 处理 |
|---|---|
| `analyze_recipe` 超时 | 传 `timeoutMs`（≤180000）重试；或减少 `mainMaterialCount`、`sortBy=probability`；仍失败则说明服务繁忙，别反复轰炸 |
| 标题报错 | 平台标题 ≤10 个字符；改为简短中文名 |
| 材料被占用/不可用 | 重新 `csforge_inventory`；`locked`/`prelisted` 的资产不可再用 |
| 预上架不存在/已处理 | 重新 `csforge_prelist_list`，不要重复创建 |
| Agent arm 返回 403 | 通常表示网站未开启 Agent 确认，或请求未经审批；提示用户到网站开启确认并批准后重试，不要绕过 |
| 支付宝二维码未就绪 | 冷却中或后台生成中；用 `csforge_alipay_qr` 稍后再查，或让用户等待；已过期则重新获取/续期 |
| 用户拒绝/关闭 Agent 审批 | 停止发布流程，转为用户在网站人工发布；不要反复提交 |
| ECO 平台拒绝（如 ResultCode 1/2001） | 读 `message`，常见为令牌未绑定/参数/价格规则；不要盲目重试 |
| 响应过大/超时 | 用专用工具；`csforge_request` 只作兜底，禁止拉原始库存 |
| 创建后 202 | 等用户批准，再用相同参数+approvalId+同 idempotencyKey 重试 |
| `guardStatus` 非 102 | 合炉/打包都不可操作；告知用户去 EcoSteam 绑定 ECO 令牌，不要尝试绕过 |
| 打包售价被拒 | 总售价必须严格低于最高产物价值；让用户下调售价后再试 |
| 冷却材料发布 | 草稿可包含冷却材料；发布后会到期自动上架并自动从余额扣押金，如实告知时间 |
| 要求卡极限磨损但做不到 | 如实报告可达 float 与目标差距；无法满足档位时明确说不可行 |
| 合炉创建返回 202 | 敏感操作待确认：用户在网站批准后，用**相同参数（含 estimatedDepositCents）** + 同 idempotencyKey + approvalId 重试 |
| 合炉押金估值不可用 | float-band 产物区间底价不完整；稍后重试或让用户在网站创建，不要拿旧价格猜 |
| 合炉余额不足/平台拒绝 | 如实转告，用户可充值或改用支付宝；不要重复提交同一请求 |
| 合炉被平台拒绝（CreateFurnace 状态码 1） | 实测常见原因是材料售价低于材料参考价或材料状态变化；不要原样重试，先让用户提高每件售价（总价仍须低于最高产物估值）或换材料；仍失败则转网页创建 |
| 合炉支付宝二维码未就绪 | 用 `csforge_alipay_qr(kind=furnace, id=平台合炉编号)` 稍后再查；过期需重新获取；Agent 不代付 |

## 9. 站点导航

`csforge_open_page` 支持：`forge`、`inventory`、`catalog`、`procurement`、`publish-pack`、`prelist`（预上架）、`revenue`。没有在线网页时返回 `no_active_browser`，直接告诉用户，不要拼链接。

## 10. 本地只读计算脚本：候选组合搜索

路径：`scripts/find-extreme-float.mjs`（随插件/Skill 分发；Node 运行，**无网络、无令牌、无第三方依赖**）。

用途：给定目标区间、磨损边界、材料配比和候选资产清单，搜索十件组合中“目标产物 float 尽量贴近边界”的方案，避免 Agent 临场做组合/子集搜索时算错。

```bash
node scripts/find-extreme-float.mjs --input plan.json
```

输入示例：

```json
{
  "target": { "name": "Glock-18 | Red Tire", "minFloat": 0, "maxFloat": 0.55, "boundary": 0.07, "mode": "below" },
  "composition": [
    { "skinId": "skin-A", "count": 1, "minFloat": 0, "maxFloat": 0.8 },
    { "skinId": "skin-B", "count": 9, "minFloat": 0, "maxFloat": 0.7 }
  ],
  "assets": [
    { "assetId": "...", "skinId": "skin-A", "float": 0.3435, "available": true },
    { "assetId": "...", "skinId": "skin-B", "float": 0.0695, "available": true }
  ],
  "options": { "top": 3 }
}
```

- `mode`：`below`（严格 < 边界，默认）、`atMost`（≤）、`above`（>）、`atLeast`（≥）。
- 输出：`status`（`feasible`/`infeasible`）、`search.method`（`exhaustive`/`local-search`）、`results[]`（`predictedFloat`、`wear`、`marginToBoundary`、`meetsBoundary`、`assets[]`）、`warnings`。
- 候选来自 `csforge_inventory` 的 available 资产或用户提供；`available:false` 会被忽略；产出超过 10 件按 `top` 返回多组候选。

使用规则：

1. 脚本只生成候选，**不得**直接创建预上架草稿；创建前必须用 `csforge_preview_assets` 复核选中的 1–5 组。
2. 脚本不读价格、不计算概率/期望收益、不联网，也不能代替平台回执；这些仍用 preview/simulate。
3. 无法满足边界时脚本返回 `infeasible` 和最接近结果，需向用户报告差距，不要硬做或改口径。
4. 极端贴边属于目标而非保证：报告预测 float 与边界的实际余量，最终以站点 preview 与平台结果为准。

## 11. 交付格式

- 写操作前先回显“已确认参数”（数量、材料组成、目标磨损/float 目标、标题、交付步骤），再执行；创建完成后逐份列出 id + 材料 + 模拟结果。
- 合炉交付必须包含**用户填写的每件材料售价**，并把“押金估算”和“实际扣款”分开表述；不要把 Agent 的估算当作已扣款。
- 押金二维码交付**必须同时给出金额（元，两位小数）、过期时间、任务/合炉编号和当前状态**；只发图片视为未完成交付，用户无法判断要付多少、何时过期。
- 表格优先；金额两位小数；float 至少 6 位小数（对齐站点显示）。
- 明确区分：只读分析结果 / 已创建草稿 / 已发布（人工）/ 结果未知。
- 概率、成本、期望值必须注明来源（站点预览快照 vs 库存参考价）。
- 不确定的业务规则先问用户，不要凭空假设；确认后更新本 Skill。

## 参考

- `references/tools.md` — 工具参数、返回结构与调用示例。
- `scripts/find-extreme-float.mjs` — 只读候选组合搜索脚本。
