import assert from 'node:assert/strict'
import { assessPlan, wearOf } from '../skills/csforge/scripts/find-extreme-float.mjs'

function frameworkPlan(overrides = {}) {
  const plan = {
    target: {
      name: 'Glock-18 | Red Tire',
      minFloat: 0,
      maxFloat: 0.55,
      boundary: 0.07,
      mode: 'below',
    },
    composition: [
      { skinId: 'skin-framework', name: 'CZ75-Auto | Framework', count: 1, minFloat: 0, maxFloat: 0.8 },
      { skinId: 'skin-sleet', name: 'M249 | Sleet', count: 9, minFloat: 0, maxFloat: 0.7 },
    ],
    assets: [
      { assetId: 'fw-1', skinId: 'skin-framework', float: 0.3435618281364441, available: true },
      ...[
        0.06950322538614273,
        0.06929081678390503,
        0.06926276534795761,
        0.06914781033992767,
        0.06900698691606522,
        0.06870391219854355,
        0.06868567317724228,
        0.06814967095851898,
        0.03846553713083267,
      ].map((float, index) => ({ assetId: `s-${index + 1}`, skinId: 'skin-sleet', float, available: true })),
    ],
    options: { top: 2 },
  }
  return { ...plan, ...overrides }
}

// Exact site-verified example from the real Red Tire prelist task.
const exact = assessPlan(frameworkPlan())
assert.equal(exact.status, 'feasible')
assert.equal(exact.search.method, 'exhaustive')
assert.equal(exact.results.length, 1)
assert.ok(Math.abs(exact.results[0].predictedFloat - 0.06999402126031264) < 1e-15)
assert.equal(exact.results[0].wear, 'FN')
assert.equal(exact.results[0].meetsBoundary, true)
assert.equal(exact.results[0].assets.length, 10)

// Local-search path: large candidate pools must still land just below the boundary.
function localSearchPlan() {
  const sleeps = []
  for (let index = 0; index < 40; index += 1) {
    sleeps.push({ assetId: `s-${index}`, skinId: 'skin-sleet', float: 0.49 + index * 0.0005, available: true })
  }
  return {
    target: { name: 'Test', minFloat: 0, maxFloat: 1, boundary: 0.5, mode: 'below' },
    composition: [
      { skinId: 'skin-framework', count: 1, minFloat: 0, maxFloat: 1 },
      { skinId: 'skin-sleet', count: 9, minFloat: 0, maxFloat: 1 },
    ],
    assets: [
      { assetId: 'fw', skinId: 'skin-framework', float: 0.5, available: true },
      ...sleeps,
    ],
    options: { top: 3, maxCombinations: 100, restarts: 80, seed: 7 },
  }
}
const local = assessPlan(localSearchPlan())
assert.equal(local.status, 'feasible')
assert.equal(local.search.method, 'local-search')
assert.ok(local.results[0].predictedFloat < 0.5)
assert.ok(0.5 - local.results[0].predictedFloat < 1e-3, `expected close boundary, got ${local.results[0].predictedFloat}`)
assert.equal(local.results[0].meetsBoundary, true)

// Infeasible boundary: report the closest candidates and a warning instead of throwing.
const infeasible = assessPlan({
  target: { name: 'Too low', minFloat: 0, maxFloat: 1, boundary: 0.1, mode: 'below' },
  composition: [{ skinId: 'a', count: 10, minFloat: 0, maxFloat: 1 }],
  assets: Array.from({ length: 12 }, (_, index) => ({ assetId: `a-${index}`, skinId: 'a', float: 0.8 + index * 0.001 })),
  options: { top: 2, maxCombinations: 1000 },
})
assert.equal(infeasible.status, 'infeasible')
assert.equal(infeasible.results[0].meetsBoundary, false)
assert.ok(infeasible.warnings.length > 0)
assert.ok(infeasible.results.length <= 2)

// Available=false candidates are ignored.
const unavailable = assessPlan(frameworkPlan())
assert.ok(unavailable.results[0].assets.every((asset) => asset.assetId !== 'missing'))

// Invalid composition sums fail loudly.
assert.throws(
  () =>
    assessPlan({
      target: { minFloat: 0, maxFloat: 1, boundary: 0.5, mode: 'below' },
      composition: [{ skinId: 'a', count: 9, minFloat: 0, maxFloat: 1 }],
      assets: [],
    }),
  /sum to 10/,
)

// Wear boundary is strictly below each tier limit.
assert.equal(wearOf(0.069999999), 'FN')
assert.equal(wearOf(0.07), 'MW')
assert.equal(wearOf(0.149999), 'MW')
assert.equal(wearOf(0.15), 'FT')
assert.equal(wearOf(0.449999), 'WW')
assert.equal(wearOf(0.45), 'BS')

console.log('find-extreme-float: all assertions passed')
