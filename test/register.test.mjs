import assert from 'node:assert/strict'
import { existsSync, unlinkSync } from 'node:fs'
import { apply, Config, projectMcpResult } from '../lib/bridge.js'

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
    'csforge_preview_assets',
    'csforge_save_recipe',
    'csforge_request',
    'csforge_open_page',
  ],
)
const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
assert.ok(byName.csforge_analyze_recipe.parameters.properties.timeoutMs)
assert.ok(byName.csforge_open_page.parameters.properties.page.enum.includes('prelist'))
assert.ok(byName.csforge_prelist_create.parameters.properties.assetIds)
assert.ok(byName.csforge_furnace_create.parameters.properties.prices)
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
assert.ok(skills[0].content.includes('预上架'))
for (const marker of ['1.05', '1.4', '批量', '越极限越好', '纪念品', 'guardStatus=102']) {
  assert.ok(skills[0].content.includes(marker), `skill missing rule marker: ${marker}`)
}
assert.ok(skills[0].resourceBase?.path?.includes('skills'))
assert.ok(skills[0].path?.endsWith('SKILL.md'))
for (const dispose of disposers.reverse()) dispose()
console.log(`registered ${tools.length} CSForge tools and ${skills.length} embedded skill`)

