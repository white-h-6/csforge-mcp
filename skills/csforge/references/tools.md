# CSForge MCP 工具参考（csforge_* 系列，任何 MCP 客户端通用）

> 本文件描述工具参数与返回语义，与部署无关；示例中的名称/数量/价格仅示意，可能过期。
> 本部署快照（昵称映射、实测价格/金额、工具数量）见 `references/deployment-notes.md`，使用前用工具复核。

## 业务规则速记（2026-11-09 用户确认）

- **写操作门禁**：任何 `create` / `configure` / `arm` / `cancel` / `save_recipe`（以及 `csforge_request` 的 POST）之前，必须先按 `SKILL.md` §0.2 完成需求确认（N1–N6：目标饰品、磨损档位、数量、材料组成、交付步骤、发布信息）。"创建多个/帮我上架/按上次的来"都不是确认；历史配方只能作建议，不能当默认参数。
- 打包汰换总售价必须**严格低于**最高产物价值。
- 押金：合炉 = 最高产物估价 × 1.05；打包汰换 = 最高产物估价 × 1.4；默认余额；由用户支付，Agent 不计算/不承诺/不付款。
- `guardStatus=102`（ECO 令牌绑定）是合炉与打包汰换的硬性要求。
- Souvenir 纪念品可以作材料；冷却中的材料可以进预上架草稿，发布后到期自动上架并自动余额扣押金。
- 预上架只支持打包汰换（pack）；合炉没有 Agent 创建入口。
- 允许批量：用户要几个炉就建几个草稿。
- 磨损目标是“越极限越好”；达不到极限但满足档位也要如实报告差距。

## 工具之外的只读辅助

候选组合搜索脚本：`scripts/find-extreme-float.mjs`（Node，无网络/无令牌/无依赖）。仅用于生成候选；创建草稿前必须用 `csforge_preview_assets` 复核。

## 工具总表

| 工具 | 读写 | 用途 |
|---|---|---|
| `csforge_help` | 只读 | 读取服务端最新接口说明（优先于本文件的部分旧描述） |
| `csforge_whoami` | 只读 | 身份与 EcoSteam 账号状态 |
| `csforge_find_skins` | 只读 | 按中英文名搜索饰品目录 |
| `csforge_analyze_recipe` | 只读 | 市场向的十件合约配方分析（成本/概率/磨损/收益） |
| `csforge_inventory` | 只读 | 精简库存，默认只返回可用资产 |
| `csforge_preview_assets` | 只读 | 一次预览 1–5 组候选十件材料 |
| `csforge_prelist_list` | 只读 | 预上架/自动上架任务列表（精简） |
| `csforge_prelist_simulate` | 只读 | 按当前市场价刷新预上架产物估值 |
| `csforge_prelist_create` | 写 | 创建打包预上架草稿（锁定材料，不付款不提交） |
| `csforge_furnace_create` | 写（敏感） | 创建合炉：10 件材料 + 用户售价/定价规则 + 押金方式；平台异步创建并扣/收押金 |
| `csforge_furnace_status` | 只读 | 查询合炉创建/押金进度（operationId 或平台合炉编号） |
| `csforge_prelist_configure` | 写 | 填写草稿标题/售价/可见性/押金方式 |
| `csforge_prelist_arm` | 写 | 发起发布/开启自动上架（必须网站人工批准） |
| `csforge_alipay_qr` | 只读 | 取回支付宝押金二维码 PNG（imagePath/金额/过期时间） |
| `csforge_prelist_cancel` | 写 | 取消预上架/自动上架任务并释放材料 |
| `csforge_pack_list` | 只读 | 查看我的打包汰换（默认只列上架中 status=100） |
| `csforge_pack_price` | 写（敏感） | 修改已上架打包售价；用户给价，需 expectedPrice/幂等键/网站批准 |
| `csforge_pack_relist_preview` | 只读 | 核对原配置与重新上架进度 |
| `csforge_pack_relist` | 写（敏感） | 保留原配置，确认下架后重新发布 |
| `csforge_save_recipe` | 写 | 保存 EcoSteam 平台配方（不占库存、不进预上架） |
| `csforge_open_page` | 只读（导航） | 让在线网页切换页面 |
| `csforge_request` | 视方法 | 兜底调用 `/api/` 业务接口；账户/管理员/令牌接口禁止 |

## 常用参数与返回

### csforge_pack_relist

用户指定某单按原配置重新上架时：

1. 用 `csforge_pack_relist_preview({id})` 读取原十件材料、原标题、当前售价、公开/私密、付款方式及已有请求进度。完成条件：原配置完整、属于当前账号；已有未知结果先核对进度。
2. 用 `csforge_pack_relist({id})` 发起一次重新上架。服务端复核原配置摘要，先保存原配置，再确认下架，最后复用现有发布流程。配置变化或原配置缺失时，原上架保持不变。
3. 返回 `202+approvalId` 时，把首次返回的 `idempotencyKey`、`configurationHash` 与原 `id` 一起保留。用户在网站批准后，原样回传这些参数及 `approvalId`。完成条件：回执已说明下架和新上架各自状态。
4. `stage=cancelling` 或 `state=unknown` 时用 preview 核对；原请求键用于继续核对，不能换键重复提交。`stage=published` 含新打包编号。支付宝按原方式重新生成付款码，由用户本人付款；`publishOperationId` 可用于 `csforge_alipay_qr` 取码。尚未付款或平台结果待核对时，如实报告当前状态。

此操作保留原材料、磨损、标题、当前售价、公开设置和付款方式，不进行新的配炉或替换材料。用户已明确授权按原配置重新上架时，按这些已核对的既有值执行；网站敏感写确认仍适用。

### csforge_whoami
参数：`{}`

返回（精简）：
```json
{
  "authorized": true, "configured": true, "steamId": "7656...",
  "accounts": [{"steamId":"...","name":"...","accountStatus":1,"guardStatus":102,"tradeReady":true,"available":true,"statusMessage":""}],
  "unavailableReason": "", "accountsError": ""
}
```
- `guardStatus=102`：ECO 令牌已绑定（打包汰换要求）。
- `accountStatus=1`：账号状态正常。
- `accountsError` 存在表示账号读取失败，不要据此继续交易操作。

### csforge_find_skins
参数：`{ "query": "红色轮胎" }`（中英文均可，最多 100 字符）

返回：`{ status, data: { skins: [{ id, name, nameZh, rarity, rarityName, weapon, collectionId, collectionName, minFloat, maxFloat, imageUrl }] } }`

### csforge_analyze_recipe
参数：
```json
{
  "targetSkinId": "skin-...",
  "targetWear": "FN",
  "mainMaterialCount": 1,
  "sortBy": "cost",
  "timeoutMs": 60000
}
```
- `targetWear`：`FN|MW|FT|WW|BS`
- `mainMaterialCount`：1–10，省略用站点默认
- `sortBy`：`cost|probability|profit`
- `timeoutMs`：5000–180000，默认 60000；超时会返回可读提示
- 该工具是市场采购向的候选搜索，不等于“从用户库存直接组炉”；库存方案用 `csforge_inventory` + `csforge_preview_assets`。

返回：`{ status, data: { recipes:[{ materials:[{skinId,float,unitPrice,goodsNumber,purchaseFloat,skin:{...}}], cost, expectedValue, expectedProfit, roi, targetProbability, targetFloat, targetWearMode, currency, ... }], request, warnings, live } }`

### csforge_inventory
参数：
```json
{
  "steamId": "7656...",       // 可省略，默认当前绑定
  "query": "冻雨",             // 名称包含过滤，≤100
  "skinId": "skin-...",       // 精确过滤
  "availableOnly": true,       // 默认 true
  "limit": 50,                 // 1–200
  "includePrices": false       // 默认 false
}
```
返回：
```json
{
  "steamId": "...", "total": 248, "returned": 50,
  "assets": [
    {"assetId":"...","skinId":"...","name":"M249 | 冻雨","float":0.0695,
     "ready":true,"locked":false,"prelisted":false,"available":true,"canUse":true,
     "price": 0.17}   // includePrices=true 时才有
  ]
}
```
- `available = ready && !locked && !prelisted`，创建预上架/预览优先用它。
- `canUse` 只是结构可用（有皮肤身份与磨损），稀有度/收藏合格仍由服务端复核。
- 原始 `GET /api/execution/inventory` 体积大，禁止用 `csforge_request` 拉取。

### csforge_preview_assets
参数：
```json
{
  "steamId": "7656...",
  "sets": [
    { "assetIds": ["10 个不同 assetId"] },
    { "assetIds": ["另一组 10 个"] }
  ]
}
```
- 1–5 组，每组恰好 10 个不同资产。
- 每组返回：`{ index, cost, expectedValue, pricingPending, outcomes:[{name,skinId,float,wear,probability,price}] }`
- 单组失败返回 `{ index, error }`；`failed` 为失败组数。
- 这是验证候选炉磨损/概率/价格的权威站点计算，创建草稿前必须用它复核。

### csforge_furnace_create

参数（字段含义必须原样传达给用户，Agent 不得自行决定 `prices`/`visibility`/`depositMethod`）：

| 字段 | 类型 | 必填 | 用途 |
|---|---|---|---|
| `name` | string | 是 | 平台标题，1–10 字符（用户指定，不是材料名） |
| `assetIds` | string[10] | 是 | 十件合炉材料 assetId，互不相同、属于当前绑定账号 |
| `prices` | 数组或规则对象 | 是 | 设置售价：用户逐件 `{assetId,price}[10]`，或指定 `{basis:"cost"\|"floor",multiplier:1.2}`；cost=本人该账号已核实成本，floor=磨损区间底价，倍率默认 1。从基准计算，逐件四舍五入到分；缺价或结果越界时停止创建 |
| `visibility` | `private \| public` | 是 | 合炉公开或私密（用户选择） |
| `depositMethod` | `balance \| official` | 是 | 押金方式：`balance`=从用户 EcoSteam 余额扣款；`official`=生成支付宝付款码由用户扫码 |
| `openFeeRate` | number 0–10 | 否 | 开炉费百分比，默认 0（用户决定） |
| `freeOpenFee` | boolean | 否 | 是否免开炉费，默认 true（用户决定） |
| `selfOpen` | boolean | 否 | 是否允许自己开炉，默认 true（用户决定） |
| `estimatedDepositCents` | int > 0 | 否 | 押金估算（分）。首次可省略，工具按 float-band 估值自动计算并返回；**带 approvalId 重试时必须原样回传** |
| `idempotencyKey` | UUID | 否 | 幂等键；省略时工具生成并返回，确认重试必须复用 |
| `approvalId` | UUID | 否 | 网站在“Agent 接入”批准后回填；未批准不要传 |

行为：先按 `priceMode=float-band` 读取产物区间估值并算押金估算，再调 `POST /api/execution/platform/create`（`kind=furnace`，oneStep 押金授权）。该请求按**敏感写操作**分类：敏感确认开启时首次返回 202+approvalId；工具返回已算好的 `prices` 数组供网站确认。批准后必须改用该数组，原样回传 `estimatedDepositCents`、其余参数、`idempotencyKey` 与 approvalId；不能再次按规则取价。服务端随后异步创建合炉并处理押金：余额方式按一次性授权扣款，支付宝方式生成付款码。
**售价下限（2026-11-09 实测）**：平台拒绝明显低于材料参考价的售价——`0.01/件`（合计 ¥0.10）被拒（CreateFurnace 状态码 1），`0.05/件`（合计 ¥0.50、最高产物估值 ¥0.61）成功。`prices` 应取用户按材料参考价/成本给的值，且总价严格低于最高产物估值。
返回：`{status, idempotencyKey, prices, estimatedDepositCents, depositMethod, operationId, state, externalId, platformStatePending, message}`；`prices` 为已计算并固定的逐件售价数组。

### csforge_furnace_status

| 字段 | 类型 | 必填 | 用途 |
|---|---|---|---|
| `operationId` | UUID | 否 | 合炉创建操作 id（create 返回的 operationId）；按本地操作进度查询 |
| `furnaceId` | string ≤160 | 否 | 平台合炉编号（create 返回的 externalId）；按平台押金预览查询 |

两者都不传时返回最近 10 条合炉操作。只读：不创建、不付款、不提交。
返回：`operation`（事务状态/押金状态）或 `operations` 列表，以及可选 `deposit`（金额、余额、支付方式、是否可付、是否已关闭）。

### csforge_prelist_list

参数：`{ "view": "active", "kind": "pack", "phase": "prelist" }`
- `view`: `active|history`（默认 active）
- `kind`: `pack|furnace`（默认 pack）
- `phase`: `all|prelist|automatic`（默认 all；合炉忽略 phase）
返回：`{ kind, view, phase, counts:{active,history}, items:[...] }`
item 字段：`id、name、state、prelist、armed、configured、externalId、price、visibility、readyAt、scheduledAt、updatedAt、materials[]、simulation:{cost,expectedValue,outcomes 总数 + 最多 5 条按价格排序的产物}`（不含图片 URL 与完整皮肤对象）。
- 预上架草稿特征：`prelist=true, armed=false, configured=false, state=queued`。

### csforge_prelist_create
参数：
```json
{
  "name": "红色轮胎",           // 平台标题，≤10 个字符
  "assetIds": ["10 个不同 assetId"],
  "idempotencyKey": "uuid",     // 可省略；结果会返回，重试必须复用
  "visibility": "private",      // 可选 private|public
  "approvalId": "uuid"          // 仅在网站批准后重试时传
}
```
行为：服务端强制 `kind=pack`、`prelist=true`、`armed=false`、`configured=false`；材料立即锁定并从库存隐藏；**不付款、不提交、默认不开启自动上架**。发布需 `csforge_prelist_arm` 并经用户在网站批准。
返回：`{ status, idempotencyKey, operationId, state, externalId?, message }`（202 时含 approvalRequired/approvalId 与提示）。

### csforge_prelist_configure
参数：
```json
{
  "id": "预上架 uuid",
  "title": "红色轮胎",          // ≤10 个字符
  "sellPrice": 7.5,             // 两位小数，必须低于最高产物价值
  "visibility": "private",
  "paymentMethod": "alipay",    // 可选：balance|alipay
  "approvalId": "uuid"          // 可选，仅批准后重试
}
```
返回：`{ status, id, configured, title, sellPrice, visibility, paymentMethod? }`

### csforge_prelist_arm
参数：`{ "id": "预上架 uuid", "approvalId": "uuid" }`
- 首次调用返回 `202 approvalRequired=true + approvalId`；用户必须在网站“Agent 接入”页面批准，然后用相同 id+approvalId 重试。
- Agent 确认未开启或用户未批准时不会发布；服务端仍按 CD、押金、平台提交校验执行。
返回：`{ status, id, armed, scheduledAt? }`。

### csforge_alipay_qr
参数：`{ "id": "uuid 或合炉编号", "kind": "pack", "maxWaitMs": 20000 }`
- `id`：`kind=pack` 时是打包任务 UUID；`kind=furnace` 时是平台合炉编号（create 返回的 `externalId`）。
- `kind`：`pack|furnace`，默认 pack。
- `maxWaitMs`：0–120000，工具内部轮询等待二维码就绪。
返回：`{ status, id, kind, qrIncluded, state, amountCents, amount, amountBasis, paid, expiresAt, message, canRenew }` + MCP image content（PNG/JPEG）。
- `amount` 是元为单位的两位小数字符串（如 `"0.62"`），`amountCents` 是分；`amountBasis="checkout-quote"` 表示它是**二维码订单报价（应付估算）**，**不是实际扣款金额**——实际扣款以平台/支付宝账单为准；`paid=true` 表示平台已确认支付。
- **交付二维码时必须同时说明金额（元）、过期时间、任务/合炉编号与当前状态，不能只发图片**；支付完成后如实说明实际金额以账单为准（用户告知实际值如 ¥0.59 时以用户/账单为准），不得把报价当已扣款。
- 本地插件会把图片保存为临时文件并在结果中返回 `imagePath`，可交给 Host 展示给用户。
- **只读**：不创建订单、不支付、不提交；二维码只能转给用户本人，过期/未就绪如实告知，禁止代付。

### csforge_prelist_simulate
参数：`{ "id": "预上架 uuid" }`
返回：`{ status, id, cost, expectedValue, pricingPending, outcomes:[{name,skinId,float,wear,probability,price}] }`
- 只更新最近一次模拟缓存；不提交、不扣款、不改业务状态。

### csforge_prelist_cancel
参数：`{ "id": "uuid", "kind": "pack", "approvalId": "uuid" }`
- `kind`: `pack|furnace`，默认 pack
返回：`{ status, id, kind, state }`
- 取消进行中的预上架/自动上架并释放材料锁；不会创建或提交新上架。

### csforge_pack_list
参数：`{ "listedOnly": true, "status": 100, "limit": 50 }`
- `listedOnly` 默认 true：只返回上架中 `status=100`；false 返回全部历史。
- `status` 可选：100=上架中、101=接单中、0=待支付、999=已完成、-100=已取消。
返回：`{ status, listedOnly, filterStatus, counts:{listed,total,returned}, items:[{id,title,status,statusText,price,visibility,description,alipay,priceChange}] }`
- 只读；用于找到要改价/查看的打包编号。

### csforge_pack_price
参数：`{ "id": "打包编号", "price": 8.8, "expectedPrice": 7.5, "idempotencyKey": "uuid", "approvalId": "uuid" }`
- `price` 必须由用户明确给出；`expectedPrice` 是改价前当前价，省略时工具先读 price-preview；带 approvalId 重试时必须原样回传。
- 首次可能返回 `202 approvalRequired + approvalId`；用户批准后，用完全相同 id/price/expectedPrice/idempotencyKey + approvalId 重试。
- 只能改自己、上架中、无待处理改价/下架操作的打包；不能改他人或已接单/已取消的记录。
返回：`{ status, id, price, expectedPrice, operationId?, state, message }`。

### csforge_save_recipe
参数：
```json
{
  "name": "配方名",
  "materials": [{"skinId":"skin-...","float":0.07,"souvenir":false}],  // 恰好 10 件
  "idempotencyKey": "uuid",   // 必填，重试复用
  "approvalId": "uuid"
}
```
- 只保存 EcoSteam 平台配方，不占用库存、不进入预上架。

### csforge_open_page
参数：`{ "page": "prelist" }`
- 可选：`forge|inventory|catalog|procurement|publish-pack|prelist|revenue`
- 返回 `{ queued:true }` 表示已发给在线网页；`no_active_browser` 表示没有可控网页（不要拼 URL）。

### csforge_request
参数：`{ "method": "GET|POST", "path": "/api/...", "body": {...}, "approvalId": "uuid" }`
- 仅用于专用工具未覆盖的业务接口；`/api/auth/*`、`/api/admin/*`、令牌管理不可用。
- 写请求 202 后按批准流程重试。

## 确认（approval）流程

1. 写操作返回 `202` 与 `approvalId`（工具结果为 `approvalRequired:true`）。
2. 告诉用户：去网站 →“Agent 接入”→ 确认该请求。
3. 用户确认后，用**完全相同**的方法/路径/参数重试，并携带 `approvalId`；同一写操作必须复用首次的 `idempotencyKey`。
4. 可用 `GET /api/agent/approvals/:id/status` 查询 `pending/approved/rejected/consumed/expired`。
5. `approvalId` 10 分钟过期、只能消费一次；过期需重新发起并重新确认。

## 结果不明时

- 超时/连接中断/响应异常：先 `csforge_prelist_list` 或读取原业务状态核对；
- **不要**换 `idempotencyKey` 重新提交，可能重复创建或重复付款；
- 明确被平台拒绝（如 ECO `ResultCode=1/2001`）时，读 `message` 并转告用户，不要盲目重试。

## 批量 / 精简工具（v0.3.0 新增，本地桥实现）

> 这些工具由本地工具桥执行：内部并发（默认 5，可调 1–8）、对“库存状态已变化 / 分页重复 / 超时”等**执行前**失败做指数退避重试；只读工具标记为可并发。批量写仍受 Agent Skill §0.2 参数确认约束；批量模式不处理网站 202 确认，遇到 `approvalRequired` 的条目需人工逐条处理。

### csforge_prelist_create_many
参数：`{ "items": [{"name":"标题","assetIds":[10 个],"visibility":"public"}], "concurrency": 5 }`（1–50 条）
- 返回逐项 `{index, ok, id, operationId, state, error?, approvalRequired?}`；`id`（= operationId）可直接用于 configure / cancel。

### csforge_prelist_configure_many
参数：`{ "items": [{"id":"uuid","title":"标题","sellPrice":7.5,"visibility":"public","paymentMethod":"alipay"}], "concurrency": 5 }`（1–50 条）

### csforge_prelist_create_configure_many
参数：`{ "items":[{"name","assetIds","visibility?"}], "configure":{"title?","sellPrice","visibility","paymentMethod?"}, "concurrency":5 }`
- 一步完成“建草稿 + 填发布信息”；返回逐项 `{index, ok, id, state, configured, error}`。仍不 arm、不付款、不提交。

### csforge_prelist_cancel_many
参数：`{ "ids": ["uuid", ...], "kind": "pack", "concurrency": 5 }`（1–100 条）

### csforge_preview_many
参数：`{ "steamId":"17 位", "sets":[{"assetIds":[10 个]}], "targetSkinId":"skin-...", "concurrency":3 }`（1–100 组）
- 自动按站点上限 5 组分片并发；传 `targetSkinId` 时每项只回 `target`（该产物的 float/wear/概率），否则回精简 outcomes；另给 `minFloat/maxFloat`。

### csforge_prelist_brief
参数：`{ "view":"active", "kind":"pack", "phase":"all" }`
- 返回 counts + 每个任务的 id/名称/状态/armed/configured/价格/可见性/材料件数，不含 10 件材料明细。

### csforge_inventory_summary
参数：`{ "skinIds":["skin-..."], "includeIds":false, "limit":200 }`
- 一次读取完整库存快照并按 skinId 聚合：件数、ready/available/locked/prelisted 计数、float min/max/avg；`includeIds=true` 时附带 assetId 列表。
