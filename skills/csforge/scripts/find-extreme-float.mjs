#!/usr/bin/env node
/**
 * Read-only candidate planner for CSForge ten-item trade-up contracts.
 *
 * It never talks to the network, never reads tokens, and never creates anything:
 * input is a plan JSON (target float range, composition, candidate assets) and
 * output is a ranked list of 10-asset combinations whose projected target float
 * is as close as possible to the requested boundary from the allowed side.
 *
 * The projection uses the site's `normalized-2025-10` rule:
 *   normalized(material) = (float - materialMin) / (materialMax - materialMin)
 *   average = sum(normalized) / 10
 *   targetFloat = targetMin + average * (targetMax - targetMin)
 *
 * Script output is only a candidate list. Before creating a prelist draft the
 * Agent MUST verify the chosen set(s) with `csforge_preview_assets`, which is
 * the authoritative site-side calculation.
 *
 * Usage:
 *   node find-extreme-float.mjs --input plan.json [--top 3]
 *   node find-extreme-float.mjs < plan.json
 */

const EPSILON = 1e-12;
const WEAR_TIERS = [
  [0.07, 'FN'],
  [0.15, 'MW'],
  [0.38, 'FT'],
  [0.45, 'WW'],
  [1, 'BS'],
];
const MODES = ['below', 'atMost', 'above', 'atLeast'];

export function wearOf(float) {
  for (const [limit, wear] of WEAR_TIERS) if (float < limit) return wear;
  return 'BS';
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('plan must be a JSON object');
  const target = plan.target;
  if (!target || typeof target !== 'object') throw new Error('plan.target is required');
  const targetMin = assertFiniteNumber(target.minFloat, 'target.minFloat');
  const targetMax = assertFiniteNumber(target.maxFloat, 'target.maxFloat');
  if (!(targetMin < targetMax)) throw new Error('target.minFloat must be less than target.maxFloat');
  const boundary = assertFiniteNumber(target.boundary, 'target.boundary');
  const mode = target.mode ?? 'below';
  if (!MODES.includes(mode)) throw new Error(`target.mode must be one of ${MODES.join(', ')}`);
  if (!Array.isArray(plan.composition) || plan.composition.length === 0) {
    throw new Error('plan.composition must be a non-empty array');
  }
  const composition = plan.composition.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`composition[${index}] must be an object`);
    if (typeof row.skinId !== 'string' || row.skinId.length === 0) {
      throw new Error(`composition[${index}].skinId is required`);
    }
    const count = row.count;
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new Error(`composition[${index}].count must be an integer between 1 and 10`);
    }
    const minFloat = assertFiniteNumber(row.minFloat, `composition[${index}].minFloat`);
    const maxFloat = assertFiniteNumber(row.maxFloat, `composition[${index}].maxFloat`);
    if (!(minFloat < maxFloat)) {
      throw new Error(`composition[${index}].minFloat must be less than minFloat`);
    }
    return { skinId: row.skinId, count, minFloat, maxFloat, name: row.name ?? row.skinId };
  });
  const totalCount = composition.reduce((sum, row) => sum + row.count, 0);
  if (totalCount !== 10) throw new Error(`composition counts must sum to 10, got ${totalCount}`);
  if (!Array.isArray(plan.assets)) throw new Error('plan.assets must be an array');

  const candidates = new Map();
  for (const row of composition) {
    const assets = plan.assets
      .filter((asset) => asset && asset.skinId === row.skinId && asset.available !== false)
      .map((asset) => {
        const float = assertFiniteNumber(asset.float, `asset ${asset.assetId ?? '?'} float`);
        if (float < row.minFloat - 1e-12 || float > row.maxFloat + 1e-12) return undefined;
        return {
          assetId: String(asset.assetId),
          skinId: row.skinId,
          float,
          normalized: (Math.min(row.maxFloat, Math.max(row.minFloat, float)) - row.minFloat) / (row.maxFloat - row.minFloat),
        };
      })
      .filter(Boolean);
    if (assets.length < row.count) {
      throw new Error(
        `skinId ${row.skinId} needs ${row.count} candidate assets but only ${assets.length} usable assets were provided`,
      );
    }
    candidates.set(row.skinId, assets);
  }

  const options = plan.options ?? {};
  const top = Math.max(1, Math.min(10, Number.isInteger(options.top) ? options.top : 3));
  const restarts = Math.max(1, Math.min(2000, Number.isInteger(options.restarts) ? options.restarts : 250));
  const maxCombinations = Math.max(
    1,
    Math.min(20_000_000, Number.isInteger(options.maxCombinations) ? options.maxCombinations : 2_000_000),
  );
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : 42;
  return { target: { name: target.name ?? '', targetMin, targetMax, boundary, mode }, composition, candidates, options: { top, restarts, maxCombinations, seed } };
}

function projected(plan, totalNormalized) {
  const { targetMin, targetMax } = plan.target;
  return targetMin + (totalNormalized / 10) * (targetMax - targetMin);
}

function boundaryToTotalNormalized(plan) {
  const { targetMin, targetMax, boundary } = plan.target;
  return ((boundary - targetMin) / (targetMax - targetMin)) * 10;
}

function allowedByMode(predicted, plan) {
  const { boundary, mode } = plan.target;
  if (mode === 'below') return predicted < boundary;
  if (mode === 'atMost') return predicted <= boundary;
  if (mode === 'above') return predicted > boundary;
  return predicted >= boundary;
}

function combinationCount(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

function compareBelowMode(plan) {
  const { mode } = plan.target;
  return mode === 'below' || mode === 'atMost';
}

/** Compare two candidate results; better first. */
function compareResults(plan) {
  const below = compareBelowMode(plan);
  return (left, right) => {
    if (left.allowed !== right.allowed) return left.allowed ? -1 : 1;
    if (left.allowed) return below ? right.predicted - left.predicted : left.predicted - right.predicted;
    return Math.abs(left.predicted - plan.target.boundary) - Math.abs(right.predicted - plan.target.boundary);
  };
}

function makeGroup(plan, row) {
  return {
    row,
    candidates: plan.candidates.get(row.skinId),
  };
}

function selectionOf(groups, picks) {
  const assets = [];
  let total = 0;
  groups.forEach((group, groupIndex) => {
    for (const index of picks[groupIndex]) {
      const asset = group.candidates[index];
      assets.push(asset);
      total += asset.normalized;
    }
  });
  return { assets, totalNormalized: total };
}

function makeResult(plan, groups, picks) {
  const { assets, totalNormalized } = selectionOf(groups, picks);
  const predictedFloat = projected(plan, totalNormalized);
  const allowed = allowedByMode(predictedFloat, plan);
  return {
    allowed,
    predictedFloat,
    marginToBoundary: predictedFloat - plan.target.boundary,
    normalizedAverage: totalNormalized / 10,
    wear: wearOf(predictedFloat),
    assets: assets.map((asset) => ({
      assetId: asset.assetId,
      skinId: asset.skinId,
      float: asset.float,
      normalized: asset.normalized,
    })),
    picks,
  };
}

function dedupeKey(groups, picks) {
  return picks
    .map((indices, groupIndex) =>
      indices
        .map((index) => groups[groupIndex].candidates[index].assetId)
        .sort()
        .join(','),
    )
    .join('|');
}

function pushResult(state, result) {
  const key = dedupeKey(state.groups, result.picks);
  if (state.seen.has(key)) return;
  state.seen.add(key);
  state.results.push(result);
  state.results.sort(compareResults(state.plan));
  if (state.results.length > state.plan.options.top) {
    const removed = state.results.pop();
    state.seen.delete(dedupeKey(state.groups, removed.picks));
  }
}

function createState(plan) {
  return {
    plan,
    groups: plan.composition.map((row) => makeGroup(plan, row)),
    results: [],
    seen: new Set(),
    evaluated: 0,
  };
}

function exhaustiveCombinations(plan) {
  const groups = plan.composition.map((row) => makeGroup(plan, row));
  let product = 1;
  for (const group of groups) {
    product *= combinationCount(group.candidates.length, group.row.count);
    if (product > plan.options.maxCombinations) return undefined;
  }
  const state = createState(plan);
  const picks = groups.map(() => []);
  const visit = (groupIndex) => {
    if (groupIndex === groups.length) {
      state.evaluated += 1;
      pushResult(state, makeResult(plan, groups, picks.map((row) => [...row])));
      return;
    }
    const group = groups[groupIndex];
    const choose = (start, left) => {
      if (left === 0) {
        visit(groupIndex + 1);
        return;
      }
      for (let index = start; index <= group.candidates.length - left; index += 1) {
        picks[groupIndex].push(index);
        choose(index + 1, left - 1);
        picks[groupIndex].pop();
      }
    };
    choose(0, group.row.count);
  };
  visit(0);
  return state;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickClosestToShare(candidates, count, share, random) {
  const indexed = candidates.map((candidate, index) => ({ candidate, index }));
  const sorted = indexed.sort((left, right) => right.candidate.normalized - left.candidate.normalized);
  const targetAverage = share / count;
  const picks = sorted
    .slice()
    .sort((left, right) => Math.abs(left.candidate.normalized - targetAverage) - Math.abs(right.candidate.normalized - targetAverage))
    .slice(0, count)
    .map((entry) => entry.index);
  if (picks.length < count) throw new Error('internal error: not enough picks');
  return picks.sort((a, b) => a - b);
}

function localSearch(plan) {
  const groups = plan.composition.map((row) => makeGroup(plan, row));
  const state = createState(plan);
  const boundaryNormalized = boundaryToTotalNormalized(plan);
  const below = compareBelowMode(plan);
  const idealShare = (group, total) => (group.row.count / 10) * total;
  const random = mulberry32(plan.options.seed);
  let current;

  const score = (result) => {
    if (result.allowed) return below ? result.totalNormalized : -result.totalNormalized;
    return -Math.abs(result.totalNormalized - boundaryNormalized);
  };

  const build = (picks) => {
    const result = makeResult(plan, groups, picks);
    result.totalNormalized = result.normalizedAverage * 10;
    return result;
  };

  const improve = (picks) => {
    let currentResult = build(picks);
    let best = currentResult;
    let changed = true;
    let rounds = 0;
    while (changed && rounds < 400) {
      changed = false;
      rounds += 1;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex];
        const selected = new Set(picks[groupIndex]);
        for (let selectedIndex = 0; selectedIndex < picks[groupIndex].length; selectedIndex += 1) {
          const picked = picks[groupIndex][selectedIndex];
          for (let candidateIndex = 0; candidateIndex < group.candidates.length; candidateIndex += 1) {
            if (selected.has(candidateIndex)) continue;
            state.evaluated += 1;
            picks[groupIndex][selectedIndex] = candidateIndex;
            const candidateResult = build(picks);
            if (score(candidateResult) > score(best) + 1e-15) {
              best = candidateResult;
              selected.delete(picked);
              selected.add(candidateIndex);
              changed = true;
              break;
            }
            picks[groupIndex][selectedIndex] = picked;
          }
          if (changed) break;
        }
        if (changed) break;
      }
      currentResult = best;
    }
    return { result: best, picks: picks.map((row) => [...row]) };
  };

  for (let restart = 0; restart < plan.options.restarts; restart += 1) {
    if (restart === 0) {
      // Smallest normalized subset is a guaranteed low seed for below modes.
      current = groups.map((group) =>
        group.candidates
          .map((candidate, index) => ({ candidate, index }))
          .sort((left, right) => left.candidate.normalized - right.candidate.normalized)
          .slice(0, group.row.count)
          .map((entry) => entry.index),
      );
    } else {
      current = groups.map((group) => {
        const indices = Array.from({ length: group.candidates.length }, (_, index) => index);
        for (let i = indices.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        return indices.slice(0, group.row.count).sort((a, b) => a - b);
      });
    }
    const { result, picks } = improve(current);
    pushResult(state, makeResult(plan, groups, picks));
    if (!result.allowed && restart === 0) {
      // A directed seed using the ideal share often lands closer to the boundary.
      const directed = groups.map((group) =>
        pickClosestToShare(group.candidates, group.row.count, idealShare(group, boundaryNormalized), random),
      );
      const directedResult = improve(directed);
      pushResult(state, makeResult(plan, groups, directedResult.picks));
    }
  }
  return state;
}

/**
 * Evaluate one plan and return the ranked candidate list.
 *
 * @param {object} plan parsed plan JSON
 * @returns {object} compact result document
 */
export function assessPlan(plan) {
  const normalized = normalizePlan(plan);
  const exhaustive = exhaustiveCombinations(normalized);
  const state = exhaustive ?? localSearch(normalized);
  const results = state.results.map((result) => ({
    predictedFloat: result.predictedFloat,
    wear: result.wear,
    marginToBoundary: result.marginToBoundary,
    meetsBoundary: result.allowed,
    normalizedAverage: result.normalizedAverage,
    assets: result.assets,
  }));
  const feasible = results.some((result) => result.meetsBoundary);
  return {
    status: feasible ? 'feasible' : 'infeasible',
    target: {
      name: normalized.target.name,
      minFloat: normalized.target.targetMin,
      maxFloat: normalized.target.targetMax,
      boundary: normalized.target.boundary,
      mode: normalized.target.mode,
    },
    search: {
      method: exhaustive ? 'exhaustive' : 'local-search',
      evaluated: state.evaluated,
      restarts: exhaustive ? 0 : normalized.options.restarts,
    },
    results,
    notes: [
      '候选列表仅用于规划；创建预上架草稿前必须用 csforge_preview_assets 复核。',
      '脚本不联网、不读取令牌、不读取价格，也不代表平台接受结果。',
    ],
    warnings: feasible
      ? []
      : ['在当前候选资产下无法满足边界；results 为最接近边界的候选，请向用户报告差距。'],
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input' || arg === '-i') options.input = argv[++index];
    else if (arg === '--top') options.top = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

async function readInput(options) {
  const { readFile } = await import('node:fs/promises');
  if (options.input) return JSON.parse(await readFile(options.input, 'utf8'));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node find-extreme-float.mjs [--input plan.json] [--top 3]');
    return;
  }
  try {
    const plan = await readInput(options);
    if (options.top !== undefined) {
      plan.options = { ...(plan.options ?? {}), top: options.top };
    }
    console.log(JSON.stringify(assessPlan(plan), null, 2));
  } catch (error) {
    console.log(JSON.stringify({ status: 'error', error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href : '';
if (import.meta.url === invokedPath) await main();
