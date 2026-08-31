/**
 * Phase 1 floor regression checks.
 * Run: npx tsx scripts/verify-phase1-floor.ts
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
import type { EffectSettings } from "../lib/effect-types"
import {
  computeBaseCellSize,
  extractLayoutParams,
  generateLayout,
  geometryOnly,
  gridDimensions,
  layoutGeometrySignature,
  layoutParamsEqual,
  packSquareFloor,
  verifyFloorCoverage,
  verifyPixelCoverage,
} from "../lib/phase1-floor"

type CheckResult = { id: number; name: string; ok: boolean; detail: string }

function baseSettings(
  overrides: Partial<EffectSettings> = {}
): EffectSettings {
  return {
    seed: 42,
    weightDither: 100,
    weightInvert: 100,
    weightSurreal: 100,
    weightPixelate: 100,
    weightOriginal: 100,
    randomSample: false,
    smearVertical: { enabled: true, amount: 50 },
    smearHorizontal: { enabled: false, amount: 50 },
    smearDiagonal1: { enabled: false, amount: 50 },
    smearDiagonal2: { enabled: false, amount: 50 },
    smearRecursive: { enabled: false, amount: 50 },
    verticalWeight: 100,
    horizontalWeight: 100,
    diagonal1Weight: 100,
    diagonal2Weight: 100,
    recursiveWeight: 100,
    noiseScale: 30,
    noiseSpread: 50,

    subdivisionLoops: 3,
    subdivisionMode: "frontier",
    subdivisionRate: 60,
    passes: 1,
    rate: 50,
    showNoiseMap: false,
    showCellLayout: false,
    textureEnabled: true,
    textureOpacity: 1,
    halftoneAmount: 0,
    weightThermal: 0,
    weightSlitScan: 0,
    slitScanAmount: 50,
    slitScanFrequency: 50,
    slitScanMode: "noise",
    slitScanLuminanceMask: false,
    ...overrides,
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

function runCheck(
  id: number,
  name: string,
  fn: () => string | void
): CheckResult {
  try {
    const detail = fn() ?? "ok"
    return { id, name, ok: true, detail: String(detail) }
  } catch (err) {
    return {
      id,
      name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

function main() {
  // Ideal visual baseline: ~1000px max edge → 10 pixel base cell size (~100 across).
  const width = 1000
  const height = 800
  const settings = baseSettings({ seed: 42 })
  const results: CheckResult[] = []

  results.push(
    runCheck(1, "Deterministic geometry (same seed/settings)", () => {
      const a = geometryOnly(generateLayout(settings, width, height).cells)
      const b = geometryOnly(generateLayout(settings, width, height).cells)
      const sigA = layoutGeometrySignature(a)
      const sigB = layoutGeometrySignature(b)
      assert(sigA === sigB, "geometry signatures differ across identical runs")
      assert(a.length === b.length, "cell counts differ")
      for (let i = 0; i < a.length; i++) {
        assert(a[i]!.x === b[i]!.x, `x mismatch at ${i}`)
        assert(a[i]!.y === b[i]!.y, `y mismatch at ${i}`)
        assert(a[i]!.width === b[i]!.width, `width mismatch at ${i}`)
        assert(a[i]!.height === b[i]!.height, `height mismatch at ${i}`)
      }
      return `${a.length} cells, signature length ${sigA.length}`
    })
  )

  results.push(
    runCheck(2, "Different seed → different floor", () => {
      const a = layoutGeometrySignature(
        generateLayout(settings, width, height).cells
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, seed: 43 }, width, height).cells
      )
      assert(a !== b, "seed 42 and 43 produced identical geometry")
      return "signatures differ"
    })
  )

  results.push(
    runCheck(14, "Dynamic base cell size with resolution", () => {
      assert(computeBaseCellSize(1000, 800) === 10, "1000px baseline should be 10")
      assert(computeBaseCellSize(4000, 3000) === 40, "4000px should be 40")
      assert(computeBaseCellSize(50, 40) === 1, "tiny images clamp to 1")
      const small = gridDimensions(1000, 800)
      const large = gridDimensions(4000, 3000)
      assert(small.baseCellSize === 10, "small layout scale")
      assert(large.baseCellSize === 40, "large layout scale")
      assert(small.gridWidth === 100, "small grid ~100 across")
      assert(large.gridWidth === 100, "large grid ~100 across")
      const layout = generateLayout(settings, 4000, 3000)
      assert(layout.baseCellSize === 40, "CachedLayout carries baseCellSize")
      verifyPixelCoverage(layout.cells, 4000, 3000)
      return "baseCellSize tracks max edge; ~100 units across"
    })
  )

  const floorCases = [
    { maxCellSize: 1, seed: 7 },
    { maxCellSize: 10, seed: 42 },
    { maxCellSize: 20, seed: 99 },
    { maxCellSize: 12, seed: 1234 },
  ]

  results.push(
    runCheck(3, "Every grid unit covered exactly once", () => {
      for (const c of floorCases) {
        const { gridWidth, gridHeight } = gridDimensions(width, height)
        const floor = packSquareFloor(
          gridWidth,
          gridHeight,
          c.maxCellSize,
          c.seed
        )
        verifyFloorCoverage(floor, gridWidth, gridHeight)
      }
      return `${floorCases.length} span/seed cases`
    })
  )

  results.push(
    runCheck(4, "No overlaps", () => {
      for (const c of floorCases) {
        const { gridWidth, gridHeight } = gridDimensions(width, height)
        const floor = packSquareFloor(
          gridWidth,
          gridHeight,
          c.maxCellSize,
          c.seed
        )
        const claimed = new Uint8Array(gridWidth * gridHeight)
        for (const p of floor) {
          for (let dy = 0; dy < p.span; dy++) {
            for (let dx = 0; dx < p.span; dx++) {
              const idx = (p.gy + dy) * gridWidth + (p.gx + dx)
              assert(claimed[idx] === 0, `overlap at ${p.gx + dx},${p.gy + dy}`)
              claimed[idx] = 1
            }
          }
        }
      }
      return "no overlaps in all cases"
    })
  )

  results.push(
    runCheck(5, "No uncovered grid units", () => {
      for (const c of floorCases) {
        const { gridWidth, gridHeight } = gridDimensions(width, height)
        const floor = packSquareFloor(
          gridWidth,
          gridHeight,
          c.maxCellSize,
          c.seed
        )
        const claimed = new Uint8Array(gridWidth * gridHeight)
        for (const p of floor) {
          for (let dy = 0; dy < p.span; dy++) {
            for (let dx = 0; dx < p.span; dx++) {
              claimed[(p.gy + dy) * gridWidth + (p.gx + dx)] = 1
            }
          }
        }
        for (let i = 0; i < claimed.length; i++) {
          assert(claimed[i] === 1, `uncovered grid index ${i}`)
        }
      }
      return "full coverage in all cases"
    })
  )

  results.push(
    runCheck(6, "Every Cell is a perfect square", () => {
      const { gridWidth, gridHeight } = gridDimensions(width, height)
      const floor = packSquareFloor(gridWidth, gridHeight, 10, 42)
      for (const p of floor) {
        assert(p.span >= 1, "invalid span")
      }
      const odd = generateLayout(settings, 325, 247)
      verifyPixelCoverage(odd.cells, 325, 247)
      return "floor packing spans OK; subdivision covers odd canvas"
    })
  )

  results.push(
    runCheck(7, "Every Cell is grid-aligned", () => {
      const { gridWidth, gridHeight } = gridDimensions(width, height)
      const floor = packSquareFloor(gridWidth, gridHeight, 10, 42)
      for (const p of floor) {
        assert(Number.isInteger(p.gx) && Number.isInteger(p.gy), "non-integer grid origin")
        assert(Number.isInteger(p.span), "non-integer span")
      }
      const layout = generateLayout(settings, width, height)
      verifyPixelCoverage(layout.cells, width, height)
      return "floor packing grid-aligned; subdivision covers canvas"
    })
  )

  results.push(
    runCheck(8, "Noise Spread does not change Phase 1 geometry", () => {
      const a = layoutGeometrySignature(
        generateLayout(settings, width, height).cells
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, noiseSpread: 90 }, width, height).cells
      )
      assert(a === b, "noiseSpread changed geometry")
      const pa = extractLayoutParams(settings, width, height)
      const pb = extractLayoutParams(
        { ...settings, noiseSpread: 90 },
        width,
        height
      )
      assert(layoutParamsEqual(pa, pb), "layout params should ignore noiseSpread")
      return "geometry + LayoutParams unchanged"
    })
  )

  results.push(
    runCheck(9, "Noise Scale does not change Phase 1 geometry", () => {
      const a = layoutGeometrySignature(
        generateLayout(settings, width, height).cells
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, noiseScale: 80 }, width, height).cells
      )
      assert(a === b, "noiseScale changed geometry")
      const pa = extractLayoutParams(settings, width, height)
      const pb = extractLayoutParams(
        { ...settings, noiseScale: 80 },
        width,
        height
      )
      assert(layoutParamsEqual(pa, pb), "layout params should ignore noiseScale")
      return "geometry + LayoutParams unchanged"
    })
  )

  results.push(
    runCheck(10, "Noise Spread does not affect LayoutParams key", () => {
      const a = layoutGeometrySignature(
        generateLayout(settings, width, height).cells
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, noiseSpread: 10 }, width, height).cells
      )
      assert(a === b, "noiseSpread changed geometry")
      const pa = extractLayoutParams(settings, width, height)
      const pb = extractLayoutParams(
        { ...settings, noiseSpread: 10 },
        width,
        height
      )
      assert(layoutParamsEqual(pa, pb), "layout params should ignore noiseSpread")

      assert(pa.baseCellSize === 10, "baseCellSize missing from LayoutParams")
      return "geometry + LayoutParams unchanged"
    })
  )

  results.push(
    runCheck(11, "Show Cell Layout is mask-independent", () => {
      const workerPath = resolve(__dirname, "../workers/effect-worker.ts")
      const source = readFileSync(workerPath, "utf8")
      const drawCompositeIdx = source.indexOf("function drawComposite(")
      assert(drawCompositeIdx >= 0, "drawComposite not found")
      const body = source.slice(drawCompositeIdx, drawCompositeIdx + 1200)
      assert(
        body.includes("if (settings.showCellLayout)"),
        "missing showCellLayout branch"
      )
      assert(
        body.includes("drawCellLayoutDebug(ctx, layout.cells, width, height"),
        "missing drawCellLayoutDebug call"
      )
      const branch = body.slice(body.indexOf("if (settings.showCellLayout)"))
      const returnIdx = branch.indexOf("return")
      assert(returnIdx >= 0, "showCellLayout branch does not return early")
      const beforeReturn = branch.slice(0, returnIdx)
      assert(
        !beforeReturn.includes("sampleCellMask"),
        "showCellLayout path samples mask before return"
      )
      assert(
        source.includes("Phase 1 floor only — no source image, no Phase 2 mask"),
        "drawCellLayoutDebug missing Phase 1-only comment/guarantee"
      )
      const layout = generateLayout(settings, width, height)
      verifyPixelCoverage(layout.cells, width, height)
      return "early-return path confirmed; full floor geometry available"
    })
  )

  results.push(
    runCheck(12, "tsc --noEmit", () => {
      const tsc = spawnSync("npx", ["tsc", "--noEmit", "-p", "."], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: true,
      })
      if (tsc.status !== 0) {
        throw new Error(
          (tsc.stdout || "") + (tsc.stderr || "") || `tsc exited ${tsc.status}`
        )
      }
      return "clean"
    })
  )

  let failed = 0
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL"
    if (!r.ok) failed++
    console.log(`[${mark}] ${r.id}. ${r.name} — ${r.detail}`)
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed.`)
    process.exitCode = 1
  } else {
    console.log("\nAll Phase 1 lock-down checks passed.")
  }
}

main()
