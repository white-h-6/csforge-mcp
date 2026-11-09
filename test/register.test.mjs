import assert from 'node:assert/strict'
import { apply, Config } from '../lib/bridge.js'

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
    'csforge_prelist_list',
    'csforge_prelist_simulate',
    'csforge_prelist_configure',
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
assert.ok(byName.csforge_inventory.parameters.properties.availableOnly)
assert.ok(byName.csforge_preview_assets.parameters.properties.sets)
assert.ok(tools.every((tool) => typeof tool.execute === 'function'))
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

