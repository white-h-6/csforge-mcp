# 性能优化：批量工具、求解器与站点侧建议（v0.3.0）

本文件记录一次“25 炉预上架”任务的实测瓶颈与优化落地情况，供后续部署与站点侧改造参考。

## 1. 实测瓶颈（优化前）

| 环节 | 实测 | 结论 |
|---|---|---|
| 本地 PowerShell 脚本 | 0.75–0.95 s / 次（含进程启动），全程 6–9 s | **不是瓶颈**（占整场 <0.5%） |
| 25 炉创建 + 配置 | 50 次串行工具调用 / 轮 | 主因之一：往返次数多 |
| 库存摸底 | 200 条截断 + 一次 48KB 原始库存，多次大响应 | 主因之一：大响应 token 处理 |
| `prelist_list` 核对 | 25 炉 × 10 件材料明细 ≈ 30–40 KB | 主因之一 |
| 3 轮重建（需求两次变更） | 约 167 次写调用 | **最大时间来源（约 2/3）** |

## 2. 已落地的插件侧优化（v0.3.0，本仓库）

`lib/bridge.js`：

1. **批量工具**（对模型是 1 次调用，内部并发）：
   - `csforge_prelist_create_many` / `csforge_prelist_configure_many` / `csforge_prelist_cancel_many`
   - `csforge_prelist_create_configure_many`：建草稿 + 填发布信息一步完成（25 炉从 50 次调用降为 1–2 次）
   - `csforge_preview_many`：1–100 组，自动按站点上限 5 组分片并发，支持 `targetSkinId` 只回目标产物
2. **精简响应**：
   - `csforge_prelist_brief`：状态核对不带 10 件材料明细
   - `csforge_inventory_summary`：一次读取完整库存快照并按 skinId 聚合件数/可用性/float 分布
3. **瞬时错误退避重试**：对“库存状态已变化 / 分页重复 / 未采用不完整结果 / 超时 / 429 / 5xx”等执行前失败自动重试（最多 3 次，指数退避 + 抖动），避免手工重试多轮往返。
4. **并发标记修正**：只读工具（含 `preview_many`、`prelist_brief`、`inventory_summary`）设置 `isConcurrencySafe=true`；此前所有工具都被标记为不可并发，会被 Harness 串行化。
5. **版本**：0.2.11 → 0.3.0（user-agent / clientInfo / package.json 同步）。

`skills/csforge/scripts/plan-packs.mjs`（新增求解器）：

- 预算式算法：归一化 → 每炉 `demand = 10 × allowedAverage − 主料归一化值` → 可行性预检（单炉 9 件最大和 + 总供给）→ 定向选材（k 件高磨损辅料 + 最优窗口）→ 1-swap + 跨炉交换收尾。
- 目标不可达时直接给出“可达上限”（`status=reduced`）或“主料本身越界”（`status=infeasible`），不会再出现“建到一半才发现材料不够”。
- 实测：25 炉 / 295 件备选池 → 全部 0.069895–0.069900（gap≈0.0001），**约 100 ms**。
- 测试：`test/plan-packs.test.mjs` 覆盖可行、降级、不可行与磨损档位边界。

## 3. 部署与生效

- 本机 profile 通过 `dsh-csforge-mcp: link:E:/dsh/csforge-mcp-plugin` 安装（见 `docs/local-adapter.md`），仓库改动即部署到磁盘。
- 新工具/新 Skill 文本需要**重新加载插件或重启 Harness** 后才会出现在 `tools/list` 与技能目录中（当前会话仍使用旧版）。
- 验证：
  ```powershell
  cd E:\dsh\csforge-mcp-plugin
  node --check lib/bridge.js
  node test/register.test.mjs      # 断言注册 27 个工具
  node test/plan-packs.test.mjs    # 求解器
  node test/find-extreme-float.test.mjs
  ```

## 4. 站点侧（CSForge 后端 / MCP 服务端）——已部署（CSForge 提交 `e505da6116c4`）

本地桥能省掉“模型 ↔ Harness”的往返。以下站点侧能力已于 2026-11-10 随 CSForge `e505da6116c4` 部署到生产（回滚点 `5b8bb11e437b`），未实现项保留为后续建议：

| 现状 | 建议接口 | 收益 | 状态 |
|---|---|---|
| 25 炉 = 25 次 create + 25 次 configure | 客户端批量工具 + 建后自动 configure（`csforge_prelist_create_configure_many`） | 50 次 → 1 次 | 已实现（桥接层） |
| 批量取消逐个调用 | 客户端批量工具 `csforge_prelist_cancel_many`（内部并发） | 25 → 1 | 已实现（桥接层） |
| `prelist_list` 返回 10 件材料明细 | `includeMaterials=false`（服务端投影） | 响应缩 ~10 倍 | 已实现（站点） |
| 库存 200 条上限、无游标 | 新工具 `csforge_inventory_summary`（服务端按 skinId 聚合） | 6 次大响应 → 1 次小响应 | 已实现（站点） |
| 写后库存快照变化导致预览失败 | 桥接层对瞬时错误自动退避重试；`inventoryVersion` 仍建议后续加 | 消除大部分手工重试 | 部分实现 |
| `preview_assets` 上限 5 组、回全部产物 | 上限 25 组 + `targetSkinId` 过滤 | 6 次大响应 → 1 次小响应 | 已实现（站点） |
| 任务状态需轮询 list | SSE/Webhook 推送任务状态 | 省轮询 | 后续建议 |

## 5. 结论

- 脚本/本地计算从来不是瓶颈（<0.5%）；瓶颈是**往返次数 × 响应体积 × 返工轮次**。
- 本次已消除“往返次数”与“响应体积”的大部分（批量工具 + 精简工具 + 并发标记 + 重试），并把“返工轮次”的大头（材料池/参数一次问清 + 求解器先算可行性）写进 Skill 流程。
- 站点侧 batch/projection/versioning 落地后，同类任务可再降一个量级（预计 <10 次 HTTP 往返）。

## 6. 站点侧部署记录（2026-11-10）

- 提交：`e505da6116c47af8d37d3aefc455d9bb59258dd6`（上一版 `5b8bb11e437b2392e3760fef543a7e9a235ad81e`）
- 部署脚本：`/home/ubuntu/csforge-recipe-fix-20261107/deploy-full.sh`（备份数据库、构建 API/前端、健康检查，失败自动回滚）
- 验证：`npm run typecheck` / `npm run build` / `npm test`（72 文件 845 测试）通过；部署后本地与公网 `/api/health` 均 200；部署记录 `/opt/csforge/updates/recipe-e505da6116c4`
- 实测收益：25 炉重建从约 75+ 次接口调用降到 5 次调用（批量取消 1 + 库存 1 + 批量预览 1 + 批量建草稿并配置 1 + 精简核对 1），约 2 分钟完成；25 炉产物全部 0.069895–0.069900。
