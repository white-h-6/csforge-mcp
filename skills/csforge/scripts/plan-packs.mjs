#!/usr/bin/env node
/**
 * Read-only pack planner for CSForge ten-item trade-up contracts.
 *
 * Budget-driven algorithm (replaces "sort + sliding window + guess"):
 *   1. normalize every material with the site's normalized-2025-10 rule
 *   2. convert the requested product float into a per-pack filler budget
 *      demand = 10 * allowedAverage - normalizedMain
 *   3. check feasibility first (per-pack max sum, total supply) and, when the
 *      target is impossible, report the maximum reachable uniform float instead
 *      of building packs that cannot qualify
 *   4. assign fillers pack by pack with exact subset selection
 *      (k standalone fillers + a best window for the remaining slots)
 *   5. polish with 1-swap against unused fillers and cross-pack swaps so every
 *      pack ends up as close to the boundary as the material pool allows
 *
 * It never talks to the network, never reads tokens and never creates anything.
 * Output is a candidate list; verify with `csforge_preview_assets` (or
 * `csforge_preview_many`) before creating drafts.
 *
 * Usage:
 *   node plan-packs.mjs --input plan.json [--json] [--target 0.0699]
 *   node plan-packs.mjs < plan.json
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const WEAR_TIERS = [
  [0.07, 'FN'],
  [0.15, 'MW'],
  [0.38, 'FT'],
  [0.45, 'WW'],
  [1, 'BS'],
]
const EPS = 1e-12
const DEFAULT_MARGIN = 0.0001

export function wearOf(float) {
  for (const [limit, wear] of WEAR_TIERS) if (float < limit) return wear
  return 'BS'
}

function assertNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`plan-packs: ${label} must be a finite number`)
  }
}

function normalizeMaterial(material, label) {
  if (!material || typeof material !== 'object') throw new Error(`plan-packs: ${label} is not an object`)
  const min = material.minFloat
  const max = material.maxFloat
  assertNumber(min, `${label}.minFloat`)
  assertNumber(max, `${label}.maxFloat`)
  assertNumber(material.float, `${label}.float`)
  if (!(max > min)) throw new Error(`plan-packs: ${label} has an invalid float range`)
  if (material.float < min - 1e-9 || material.float > max + 1e-9) {
    throw new Error(`plan-packs: ${label}.float is outside its range`)
  }
  const normalized = (material.float - min) / (max - min)
  return {
    assetId: String(material.assetId ?? ''),
    name: typeof material.name === 'string' ? material.name : undefined,
    float: material.float,
    minFloat: min,
    maxFloat: max,
    normalized,
  }
}

/** Sum of the largest `slots` normalized values. */
function topSum(items, slots) {
  if (items.length < slots) return undefined
  const sorted = [...items].sort((left, right) => right.normalized - left.normalized)
  let sum = 0
  for (let index = 0; index < slots; index += 1) sum += sorted[index].normalized
  return sum
}

/** Best consecutive window of `slots` items whose sum stays within `cap`. */
function bestWindow(items, slots, cap) {
  if (slots <= 0) return { sum: 0, start: 0 }
  if (items.length < slots || cap < -EPS) return undefined
  let best
  let sum = 0
  for (let index = 0; index < slots; index += 1) sum += items[index].normalized
  if (sum <= cap + EPS) best = { sum, start: 0 }
  for (let start = 1; start + slots <= items.length; start += 1) {
    sum += items[start + slots - 1].normalized - items[start - 1].normalized
    if (sum <= cap + EPS && (best === undefined || sum > best.sum)) best = { sum, start }
  }
  return best
}

/** Exact-ish selection: k standalone fillers + a window filling the remaining slots. */
function selectFillers(pool, slots, demand) {
  let best
  const consider = (total, chosen) => {
    if (total > demand + EPS) return
    if (best === undefined || total > best.sum) best = { sum: total, chosen }
  }
  const window0 = bestWindow(pool, slots, demand)
  if (window0 !== undefined) consider(window0.sum, pool.slice(window0.start, window0.start + slots).map((item) => item.assetId))
  for (let index = 0; index < pool.length; index += 1) {
    if (slots - 1 < 0) break
    const head = pool[index]
    const rest = pool.slice(0, index).concat(pool.slice(index + 1))
    const window = bestWindow(rest, slots - 1, demand - head.normalized)
    if (window === undefined) continue
    const chosen = [head, ...rest.slice(window.start, window.start + slots - 1)]
    consider(head.normalized + window.sum, chosen.map((item) => item.assetId))
  }
  const limit2 = Math.min(24, pool.length)
  for (let first = 0; first < limit2; first += 1) {
    for (let second = first + 1; second < limit2; second += 1) {
      if (slots - 2 < 0) break
      const headSum = pool[first].normalized + pool[second].normalized
      const rest = pool.filter((_, index) => index !== first && index !== second)
      const window = bestWindow(rest, slots - 2, demand - headSum)
      if (window === undefined) continue
      const chosen = [pool[first], pool[second], ...rest.slice(window.start, window.start + slots - 2)]
      consider(headSum + window.sum, chosen.map((item) => item.assetId))
    }
  }
  return best
}

/** Maximum reachable uniform product float when the requested target is not feasible. */
function reachableFloat(mains, fillers, targetMinFloat, targetMaxFloat, slots) {
  const span = targetMaxFloat - targetMinFloat
  const fillerSorted = [...fillers].sort((left, right) => right.normalized - left.normalized)
  const maxFillerSum = topSum(fillers, slots)
  const totalSlots = slots + 1
  let low = 0
  let high = 1
  let best = 0
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2
    let possible = true
    let needed = 0
    for (const main of mains) {
      const demand = totalSlots * mid - main.normalized
      if (demand < 0 || demand > maxFillerSum + EPS) {
        possible = false
        break
      }
      needed += demand
    }
    let supply = 0
    const count = Math.min(fillerSorted.length, slots * mains.length)
    for (let index = 0; index < count; index += 1) supply += fillerSorted[index].normalized
    if (possible && needed <= supply + 1e-9) {
      best = mid
      low = mid
    } else {
      high = mid
    }
  }
  return targetMinFloat + best * span
}

/**
 * Build the pack plan.
 * @param {object} input plan input (see README / SKILL.md)
 * @returns {object} plan
 */
export function planPacks(input) {
  if (!input || typeof input !== 'object') throw new Error('plan-packs: input must be an object')
  const target = input.target ?? {}
  const targetMinFloat = target.minFloat ?? 0
  const targetMaxFloat = target.maxFloat ?? 0.55
  assertNumber(targetMinFloat, 'target.minFloat')
  assertNumber(targetMaxFloat, 'target.maxFloat')
  if (!(targetMaxFloat > targetMinFloat)) throw new Error('plan-packs: target range is invalid')
  const boundary = input.boundary ?? target.boundary ?? 0.07
  assertNumber(boundary, 'boundary')
  const margin = input.margin ?? DEFAULT_MARGIN
  assertNumber(margin, 'margin')
  const slots = input.slotsPerPack ?? 9
  if (!Number.isInteger(slots) || slots < 1 || slots > 9) throw new Error('plan-packs: slotsPerPack must be 1–9')
  const totalSlots = slots + 1
  const span = targetMaxFloat - targetMinFloat

  if (!Array.isArray(input.mains) || input.mains.length < 1) throw new Error('plan-packs: mains must be a non-empty array')
  if (!Array.isArray(input.fillers) || input.fillers.length < slots) throw new Error('plan-packs: not enough fillers')
  const mains = input.mains.map((material, index) => normalizeMaterial(material, `mains[${index}]`))
  const fillers = input.fillers.map((material, index) => normalizeMaterial(material, `fillers[${index}]`))
  if (new Set(mains.map((main) => main.assetId)).size !== mains.length) throw new Error('plan-packs: main assetIds must be unique')
  if (new Set(fillers.map((filler) => filler.assetId)).size !== fillers.length) throw new Error('plan-packs: filler assetIds must be unique')

  const requestedFloat = input.targetFloat === undefined ? boundary - margin : Math.min(input.targetFloat, boundary - 1e-7)
  assertNumber(requestedFloat, 'targetFloat')
  const requestedAverage = (requestedFloat - targetMinFloat) / span
  if (requestedAverage <= 0 || requestedAverage >= 1) throw new Error('plan-packs: targetFloat is outside the target float range')

  const warnings = []
  const maxFillerSum = topSum(fillers, slots)
  const demanded = mains.reduce((sum, main) => sum + Math.max(0, totalSlots * requestedAverage - main.normalized), 0)
  const supply = (() => {
    const sorted = [...fillers].sort((left, right) => right.normalized - left.normalized)
    let sum = 0
    const count = Math.min(sorted.length, slots * mains.length)
    for (let index = 0; index < count; index += 1) sum += sorted[index].normalized
    return sum
  })()
  const perPackImpossible = mains.some((main) => {
    const demand = totalSlots * requestedAverage - main.normalized
    return demand < 0 || demand > maxFillerSum + EPS
  })
  let workingFloat = requestedFloat
  let status = 'feasible'
  if (perPackImpossible || demanded > supply + 1e-9) {
    status = 'reduced'
    const reachable = reachableFloat(mains, fillers, targetMinFloat, targetMaxFloat, slots)
    workingFloat = Math.min(reachable, boundary - margin)
    warnings.push(
      `requested product float ${requestedFloat.toFixed(6)} is not reachable with this pool; using ${workingFloat.toFixed(6)}`,
    )
  }
  const workingAverage = (workingFloat - targetMinFloat) / span
  const budgets = mains.map((main) => ({ main, demand: totalSlots * workingAverage - main.normalized }))

  // A pack whose main material plus the smallest possible fillers already lands
  // on or above the boundary can never qualify, no matter what else is used.
  const smallestSum = (() => {
    const sorted = [...fillers].sort((left, right) => left.normalized - right.normalized)
    let sum = 0
    for (let index = 0; index < slots; index += 1) sum += sorted[index].normalized
    return sum
  })()
  const impossibleMains = mains.filter(
    (main) => targetMinFloat + ((main.normalized + smallestSum) / totalSlots) * span >= boundary,
  )
  if (impossibleMains.length > 0) {
    return {
      status: 'infeasible',
      targetFloat: workingFloat,
      summary: {
        packs: 0,
        boundary,
        maxFloat: null,
        minFloat: null,
        avgFloat: null,
        allBelowBoundary: false,
        fillersUsed: 0,
        fillersLeft: fillers.length,
      },
      packs: [],
      warnings: [
        ...warnings,
        `main materials already exceed the boundary even with the smallest fillers: ${impossibleMains.map((main) => main.assetId).join(',')}`,
      ],
    }
  }
  const byId = new Map(fillers.map((filler) => [filler.assetId, filler]))

  let pool = [...fillers].sort((left, right) => right.normalized - left.normalized)
  const packs = []
  const insufficient = []
  for (const entry of [...budgets].sort((left, right) => right.demand - left.demand)) {
    const selected = entry.demand <= 0 ? undefined : selectFillers(pool, slots, entry.demand)
    if (selected === undefined) {
      insufficient.push(entry)
      continue
    }
    packs.push({
      mainAssetId: entry.main.assetId,
      mainFloat: entry.main.float,
      mainNormalized: entry.main.normalized,
      demand: entry.demand,
      fillerSum: selected.sum,
      fillerAssetIds: selected.chosen,
      predictedFloat: 0,
      gap: 0,
      wear: 'BS',
    })
    const used = new Set(selected.chosen)
    pool = pool.filter((filler) => !used.has(filler.assetId))
  }
  for (const entry of insufficient) warnings.push(`main ${entry.main.assetId}: no filler combination fits the request`)
  if (insufficient.length > 0 && status === 'feasible') status = 'partial'

  // Polish pass 1: swap a used filler for a larger unused one while staying in budget.
  for (let round = 0; round < 8; round += 1) {
    let improved = false
    for (const pack of packs) {
      let bestGain = 1e-9
      let bestSwap
      for (const candidate of pool) {
        for (const currentId of pack.fillerAssetIds) {
          const gain = candidate.normalized - byId.get(currentId).normalized
          if (gain > bestGain && pack.fillerSum + gain <= pack.demand + EPS) {
            bestGain = gain
            bestSwap = { outgoing: currentId, incoming: candidate.assetId }
          }
        }
      }
      if (bestSwap !== undefined) {
        pack.fillerAssetIds = pack.fillerAssetIds.map((id) => (id === bestSwap.outgoing ? bestSwap.incoming : id))
        pack.fillerSum += bestGain
        pool = pool.filter((filler) => filler.assetId !== bestSwap.incoming)
        pool.push(byId.get(bestSwap.outgoing))
        improved = true
      }
    }
    if (!improved) break
  }

  // Polish pass 2: cross-pack swaps lift the weakest pack by taking from the strongest.
  for (let round = 0; round < 200 && packs.length > 1; round += 1) {
    const scored = packs.map((pack) => ({
      pack,
      value: targetMinFloat + ((pack.mainNormalized + pack.fillerSum) / totalSlots) * span,
    }))
    const sorted = [...scored].sort((left, right) => left.value - right.value)
    const low = sorted[0]
    const high = sorted[sorted.length - 1]
    if (high.value - low.value < 1e-6) break
    let bestMove
    for (const lowId of low.pack.fillerAssetIds) {
      for (const highId of high.pack.fillerAssetIds) {
        const delta = byId.get(highId).normalized - byId.get(lowId).normalized
        if (delta <= 1e-9) continue
        if (low.pack.fillerSum + delta > low.pack.demand + EPS) continue
        const lowNext = targetMinFloat + ((low.pack.mainNormalized + low.pack.fillerSum + delta) / totalSlots) * span
        const highNext = targetMinFloat + ((high.pack.mainNormalized + high.pack.fillerSum - delta) / totalSlots) * span
        const nextMin = Math.min(lowNext, highNext)
        if (bestMove === undefined || nextMin > bestMove.nextMin) {
          bestMove = { lowId, highId, delta, lowNext, highNext, nextMin }
        }
      }
    }
    if (bestMove === undefined) break
    low.pack.fillerAssetIds = low.pack.fillerAssetIds.map((id) => (id === bestMove.lowId ? bestMove.highId : id))
    high.pack.fillerAssetIds = high.pack.fillerAssetIds.map((id) => (id === bestMove.highId ? bestMove.lowId : id))
    low.pack.fillerSum += bestMove.delta
    high.pack.fillerSum -= bestMove.delta
  }

  // Finalize.
  for (const pack of packs) {
    pack.predictedFloat = targetMinFloat + ((pack.mainNormalized + pack.fillerSum) / totalSlots) * span
    pack.gap = boundary - pack.predictedFloat
    pack.wear = wearOf(pack.predictedFloat)
  }
  packs.sort((left, right) => left.predictedFloat - right.predictedFloat || left.mainAssetId.localeCompare(right.mainAssetId))
  const floats = packs.map((pack) => pack.predictedFloat)
  const summary = {
    packs: packs.length,
    boundary,
    maxFloat: floats.length > 0 ? Math.max(...floats) : null,
    minFloat: floats.length > 0 ? Math.min(...floats) : null,
    avgFloat: floats.length > 0 ? floats.reduce((sum, value) => sum + value, 0) / floats.length : null,
    allBelowBoundary: floats.length > 0 && floats.every((value) => value < boundary),
    fillersUsed: packs.length * slots,
    fillersLeft: pool.length,
  }
  return {
    status,
    targetFloat: workingFloat,
    summary,
    packs: packs.map((pack) => ({
      mainAssetId: pack.mainAssetId,
      mainFloat: pack.mainFloat,
      fillerAssetIds: pack.fillerAssetIds,
      predictedFloat: pack.predictedFloat,
      gap: pack.gap,
      wear: pack.wear,
    })),
    warnings,
  }
}

async function main() {
  const argv = process.argv.slice(2)
  let inputPath
  let jsonMode = false
  let targetFloat
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input') {
      inputPath = argv[index + 1]
      index += 1
    } else if (arg === '--json') {
      jsonMode = true
    } else if (arg === '--target') {
      targetFloat = Number(argv[index + 1])
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node plan-packs.mjs --input plan.json [--json] [--target 0.0699]')
      return
    }
  }
  let raw
  if (inputPath === undefined) {
    raw = await new Promise((resolve, reject) => {
      let data = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', (chunk) => {
        data += chunk
      })
      process.stdin.on('end', () => resolve(data))
      process.stdin.on('error', reject)
    })
  } else {
    raw = readFileSync(inputPath, 'utf8')
  }
  const input = JSON.parse(raw)
  if (targetFloat !== undefined) input.targetFloat = targetFloat
  const plan = planPacks(input)
  if (jsonMode) {
    console.log(JSON.stringify(plan, null, 2))
    return
  }
  console.log(`[plan-packs] status=${plan.status} target=${plan.targetFloat.toFixed(6)} packs=${plan.summary.packs}`)
  console.log(
    `[plan-packs] floats ${plan.summary.minFloat?.toFixed(6)} – ${plan.summary.maxFloat?.toFixed(6)} avg ${plan.summary.avgFloat?.toFixed(6)} | allBelow ${plan.summary.boundary}: ${plan.summary.allBelowBoundary}`,
  )
  for (const pack of plan.packs) {
    console.log(
      `  ${pack.mainAssetId}  float=${pack.predictedFloat.toFixed(7)}  gap=${pack.gap.toFixed(7)}  fillers=${pack.fillerAssetIds.join(',')}`,
    )
  }
  for (const warning of plan.warnings) console.log(`  ! ${warning}`)
}

const invokedPath = process.argv[1] === undefined ? '' : fileURLToPath(import.meta.url) === process.argv[1]
if (invokedPath || process.argv[1]?.endsWith('plan-packs.mjs')) {
  main().catch((error) => {
    console.error(`plan-packs: ${error?.message || error}`)
    process.exitCode = 1
  })
}
