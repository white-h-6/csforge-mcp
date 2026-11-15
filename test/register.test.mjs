import assert from 'node:assert/strict'
import { existsSync, unlinkSync } from 'node:fs'
import { apply, Config, projectMcpResult, normalizeInventory, normalizePrelistCreate, normalizeFurnaceCreate, normalizePrelistConfigure } from '../lib/bridge.js'

const tools = []
const skills = []
const disposers = []
const ctx = {
  tools: {
    register(definition) {
      tools.push(definition)
      return () => {}
    },
  },
  skills: {
    register(definition) {
      skills.push(definition)
      return () => {}
    },
  },
  effect(factory) {
    disposers.push(factory())
  },
}

const config = Config({
  endpoint: 'https://csforge.hkui.ccwu.cc/api/agent/mcp',
  tokenFile: 'C:\\private\\token.dpapi',
  socksProxy: '',
  timeoutMs: 5000,
  tunnel: {
    enabled: false,
    executable: '',
    configPath: '',
    socksHost: '127.0.0.1',
    socksPort: 10999,
    startupTimeoutMs: 1000,
  },
})

await apply(ctx, config)
assert.deepEqual(
  tools.map((tool) => tool.name),
  [
    'csforge_help',
    'csforge_whoami',
    'csforge_find_skins',
    'csforge_analyze_recipe',
    'csforge_inventory',
    'csforge_prelist_create',
    'csforge_furnace_create',
    'csforge_prelist_list',
    'csforge_furnace_status',
    'csforge_prelist_simulate',
    'csforge_prelist_configure',
    'csforge_prelist_arm',
    'csforge_alipay_qr',
    'csforge_prelist_cancel',
    'csforge_pack_list',
    'csforge_pack_relist_preview',
    'csforge_pack_relist',
    'csforge_pack_price',
    'csforge_preview_assets',
    'csforge_save_recipe',
    'csforge_request',
    'csforge_open_page',
    'csforge_prelist_create_many',
    'csforge_prelist_configure_many',
    'csforge_prelist_create_configure_many',
    'csforge_prelist_cancel_many',
    'csforge_preview_many',
    'csforge_prelist_brief',
    'csforge_inventory_summary',
  ],
)
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
assert.ok(byName.csforge_prelist_create_many.parameters.properties.items)
assert.ok(byName.csforge_prelist_create_many.parameters.properties.concurrency)
assert.ok(byName.csforge_prelist_create_configure_many.parameters.properties.configure)
assert.ok(byName.csforge_prelist_cancel_many.parameters.properties.ids)
assert.ok(byName.csforge_preview_many.parameters.properties.targetSkinId)
assert.ok(byName.csforge_inventory_summary.parameters.properties.includeIds)
for (const name of ['csforge_inventory', 'csforge_inventory_summary', 'csforge_prelist_create', 'csforge_furnace_create']) {
  assert.equal(byName[name].parameters.properties.steamId.type, 'string')
  assert.ok(!byName[name].parameters.required?.includes('steamId'))
}
for (const name of ['csforge_prelist_create_many', 'csforge_prelist_create_configure_many']) {
  assert.equal(byName[name].parameters.properties.items.items.properties.steamId.type, 'string')
}
assert.ok(byName.csforge_pack_list.parameters.properties.listedOnly)
assert.ok(byName.csforge_pack_price.parameters.properties.expectedPrice)
assert.ok(byName.csforge_pack_relist.parameters.properties.configurationHash)
assert.ok(byName.csforge_pack_relist.parameters.properties.approvalId)
assert.equal(byName.csforge_pack_relist_preview.isConcurrencySafe({ id: 'pack' }), true)
assert.equal(byName.csforge_pack_relist.isConcurrencySafe({ id: 'pack' }), false)
assert.equal(typeof byName.csforge_preview_assets.isConcurrencySafe, 'function')
assert.equal(byName.csforge_prelist_brief.isConcurrencySafe({}), true)
assert.equal(byName.csforge_inventory_summary.isConcurrencySafe({}), true)
assert.equal(byName.csforge_preview_many.isConcurrencySafe({}), false)
assert.equal(
  byName.csforge_preview_many.isConcurrencySafe({
    steamId: '76561199538876525',
    sets: [{ assetIds: Array.from({ length: 10 }, (_, index) => `asset-${index}`) }],
  }),
  true,
)
assert.equal(
  byName.csforge_prelist_create_many.isConcurrencySafe({
    items: [{ name: '标题', assetIds: Array.from({ length: 10 }, (_, index) => `asset-${index}`) }],
  }),
  false,
)
assert.ok(byName.csforge_analyze_recipe.parameters.properties.timeoutMs)
assert.ok(byName.csforge_open_page.parameters.properties.page.enum.includes('prelist'))
assert.ok(byName.csforge_prelist_create.parameters.properties.assetIds)
assert.ok(byName.csforge_furnace_create.parameters.properties.prices)
assert.equal(byName.csforge_furnace_create.parameters.properties.prices.oneOf.length, 2)
assert.equal('multiplier' in byName.csforge_furnace_create.parameters.properties, false)
const furnaceArgs = {
  name: '倍率测试', assetIds: Array.from({ length: 10 }, (_, i) => `asset-${i}`),
  visibility: 'private', depositMethod: 'official',
}
// An explicit account survives the adapter for both creation tools and approval
// retries. Omitting it leaves resolution to the current server-side selection.
const accountId = '76561199538876525'
const draftArgs = { name: '账号测试', assetIds: furnaceArgs.assetIds }
const pricedArgs = { ...furnaceArgs, prices: furnaceArgs.assetIds.map(assetId => ({ assetId, price: 1 })) }
for (const [normalise, args] of [[normalizeInventory, {}], [normalizePrelistCreate, draftArgs], [normalizeFurnaceCreate, pricedArgs]]) {
  assert.equal(normalise({ ...args, steamId: accountId }).steamId, accountId)
  assert.equal('steamId' in normalise(args), false)
  for (const steamId of ['', '7656', '7656119953887652x', 76561199538876525, null]) {
    assert.throws(() => normalise({ ...args, steamId }), /17-digit string/)
  }
}
const retryArgs = {
  steamId: accountId,
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174001',
  estimatedDepositCents: 12345,
}
const retry = normalizeFurnaceCreate({ ...pricedArgs, ...retryArgs })
for (const [key, value] of Object.entries(retryArgs)) assert.equal(retry[key], value)
assert.deepEqual(retry.prices, pricedArgs.prices)
assert.equal(normalizePrelistCreate({ ...draftArgs, ...retryArgs }).steamId, accountId)
assert.equal(normalizePrelistCreate({ ...draftArgs, kind: 'furnace' }).kind, 'furnace')
assert.throws(() => normalizePrelistCreate({ ...draftArgs, kind: 'unknown' }), /kind must be/)
assert.ok(byName.csforge_prelist_create.parameters.properties.kind.enum.includes('furnace'))
assert.ok(byName.csforge_prelist_create_many.parameters.properties.items.items.properties.kind.enum.includes('furnace'))
assert.ok(byName.csforge_prelist_configure_many.parameters.properties.items.items.properties.prices)
const furnaceConfig = {
  id: retryArgs.idempotencyKey, title: '合炉草稿', kind: 'furnace', prices: pricedArgs.prices,
  visibility: 'public', paymentMethod: 'alipay', openFeeRate: 10, freeOpenFee: false, selfOpen: true,
}
assert.deepEqual(normalizePrelistConfigure(furnaceConfig), furnaceConfig)
assert.throws(() => normalizePrelistConfigure({ ...furnaceConfig, prices: undefined }), /ten fixed prices/)
assert.throws(() => normalizePrelistConfigure({ ...furnaceConfig, openFeeRate: 11 }), /between 0 and 10/)
assert.throws(() => normalizePrelistConfigure({ ...furnaceConfig, prices: pricedArgs.prices.slice(0, 9) }), /exactly 10/)
const packConfig = { id: retryArgs.idempotencyKey, title: '打包草稿', sellPrice: 10, visibility: 'private' }
assert.deepEqual(normalizePrelistConfigure(packConfig), packConfig)
await assert.rejects(byName.csforge_inventory_summary.execute({ steamId: 'invalid' }), /17-digit string/)
for (const multiplier of [0, -1]) {
  await assert.rejects(byName.csforge_furnace_create.execute({
    ...furnaceArgs, prices: { basis: 'cost', multiplier },
  }), /positive multiplier/)
}
await assert.rejects(byName.csforge_furnace_create.execute({
  ...furnaceArgs, prices: { basis: 'floor', multiplier: 1.2 },
  approvalId: '123e4567-e89b-42d3-a456-426614174000',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174001', estimatedDepositCents: 100,
}), /returned fixed prices array/)
assert.ok(byName.csforge_furnace_create.parameters.properties.estimatedDepositCents)
assert.ok(byName.csforge_furnace_status.parameters.properties.operationId)
assert.ok(byName.csforge_prelist_configure.parameters.properties.paymentMethod)
assert.ok(byName.csforge_prelist_arm.parameters.properties.id)
assert.ok(byName.csforge_alipay_qr.parameters.properties.kind)
assert.ok(byName.csforge_inventory.parameters.properties.availableOnly)
assert.ok(byName.csforge_preview_assets.parameters.properties.sets)
assert.ok(byName.csforge_alipay_qr.output.schema.properties.imagePath)
assert.ok(tools.every((tool) => typeof tool.execute === 'function'))

// Image content from MCP is saved to a temp file and surfaced as imagePath so
// the host can present the Alipay QR code.
const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')
const projected = projectMcpResult({
  content: [
    { type: 'text', text: JSON.stringify({ state: 'ready', amountCents: 12345 }) },
    { type: 'image', data: png, mimeType: 'image/png' },
  ],
})
assert.equal(projected.ok, true)
assert.equal(projected.imagePath, JSON.parse(projected.text).imagePath)
assert.ok(existsSync(projected.imagePath))
unlinkSync(projected.imagePath)
// Some Alipay receipts label JPEG bytes as PNG; the saved file must match the bytes.
const jpegLabeledPng = projectMcpResult({
  content: [
    { type: 'text', text: JSON.stringify({ state: 'ready', amountCents: 63 }) },
    { type: 'image', data: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgc', mimeType: 'image/png' },
  ],
})
assert.equal(jpegLabeledPng.ok, true)
assert.ok(jpegLabeledPng.imagePath.endsWith('.jpg'))
assert.ok(existsSync(jpegLabeledPng.imagePath))
unlinkSync(jpegLabeledPng.imagePath)
assert.equal(skills.length, 1)
assert.equal(skills[0].name, 'csforge')
assert.ok(skills[0].description.includes('CSForge'))
assert.ok(skills[0].content.includes('csforge_whoami'))
assert.ok(skills[0].content.includes('API 连接时选择的是默认账号'))
assert.ok(skills[0].content.includes('预上架'))
for (const marker of ['1.05', '1.4', '批量', '越极限越好', '纪念品', 'guardStatus=102']) {
  assert.ok(skills[0].content.includes(marker), `skill missing rule marker: ${marker}`)
}
assert.ok(skills[0].resourceBase?.path?.includes('skills'))
assert.ok(skills[0].path?.endsWith('SKILL.md'))
for (const dispose of disposers.reverse()) dispose()
console.log(`registered ${tools.length} CSForge tools and ${skills.length} embedded skill`)

