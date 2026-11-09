import assert from 'node:assert/strict'
import { planPacks, wearOf } from '../skills/csforge/scripts/plan-packs.mjs'

function material(assetId, float, minFloat, maxFloat) {
  return { assetId, float, minFloat, maxFloat }
}

const target = { minFloat: 0, maxFloat: 0.55, boundary: 0.07 }

// Feasible plan: two mains, a pool that can carry both packs close to 0.0699.
const mains = [
  material('m1', 0.34, 0, 0.8),
  material('m2', 0.28, 0, 0.8),
]
const fillers = []
for (let index = 0; index < 60; index += 1) {
  fillers.push(material(`f${index}`, 0.02 + index * 0.003, 0, 0.8))
}
const plan = planPacks({ target, mains, fillers, targetFloat: 0.0699 })
assert.equal(plan.status, 'feasible')
assert.equal(plan.packs.length, 2)
assert.equal(plan.summary.allBelowBoundary, true)
assert.ok(plan.summary.minFloat > 0.0695, `pack floats should sit close to the boundary: ${plan.summary.minFloat}`)
const used = new Set()
for (const pack of plan.packs) {
  assert.equal(pack.fillerAssetIds.length, 9)
  assert.equal(new Set(pack.fillerAssetIds).size, 9)
  for (const assetId of pack.fillerAssetIds) {
    assert.ok(!used.has(assetId), 'filler assetIds must be unique across packs')
    used.add(assetId)
  }
  assert.ok(pack.predictedFloat < 0.07, 'predicted float must stay strictly below the boundary')
  assert.equal(pack.wear, 'FN')
  assert.ok(Math.abs(pack.gap) < 0.005)
}

// Unreachable target: the solver must degrade to the maximum reachable float
// instead of silently producing out-of-boundary packs.
const hardPlan = planPacks({
  target,
  mains: [material('m1', 0.1, 0, 0.8)],
  fillers: [material('f1', 0.02, 0, 0.8), material('f2', 0.03, 0, 0.8)],
  slotsPerPack: 1,
  targetFloat: 0.0699,
})
assert.equal(hardPlan.status, 'reduced')
assert.ok(hardPlan.summary.minFloat !== null)
assert.ok(hardPlan.summary.maxFloat < 0.07)
assert.ok(hardPlan.warnings.some((warning) => warning.includes('not reachable')))

// A main that already lands above the boundary (even with the smallest
// fillers) must be reported as infeasible instead of producing nothing useful.
const clamped = planPacks({
  target,
  mains: [material('m1', 0.5, 0, 0.8)],
  fillers: [material('f1', 0.68, 0, 0.8)],
  slotsPerPack: 1,
  targetFloat: 0.5,
})
assert.equal(clamped.status, 'infeasible')
assert.equal(clamped.packs.length, 0)
assert.ok(clamped.warnings.some((warning) => warning.includes('exceed the boundary')))

// Wear tiers follow the site convention (0.07 itself is MW, not FN).
assert.equal(wearOf(0.0699), 'FN')
assert.equal(wearOf(0.07), 'MW')
assert.equal(wearOf(0.1499), 'MW')
assert.equal(wearOf(0.15), 'FT')

console.log('plan-packs solver: ok')
