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
  computeBasePixelScale,
  extractLayoutParams,
  generateLayout,
  geometryOnly,
  gridDimensions,
  layoutGeometrySignature,
  layoutParamsEqual,
  packSquareFloor,
  verifyFloorCoverage,
  verifyPhotoPixelCoverage,
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
    sampleInPlace: true,
    smearVertical: { enabled: true, amount: 50 },
    smearHorizontal: { enabled: false, amount: 50 },
    smearDiagonal: { enabled: false, amount: 50 },
    smearDrift: { enabled: false, amount: 50 },
    smearRecursive: { enabled: false, amount: 50 },
    smearStrip: { enabled: false, amount: 50 },
    noiseScale: 30,
    noiseSpread: 50,
    maxPixelSize: 10,
    layoutMode: "standard",
    subdivisionLoops: 3,
    subdivisionMode: "frontier",
    subdivisionRate: 60,
    showNoiseMap: false,
    showPixelLayout: false,
    overlayDebug: false,
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
  // Ideal visual baseline: ~1000px max edge → 10 photo-pixel base scale (~100 across).
  const width = 1000
  const height = 800
  const settings = baseSettings({ seed: 42, maxPixelSize: 10 })
  const results: CheckResult[] = []

  results.push(
    runCheck(1, "Deterministic geometry (same seed/settings)", () => {
      const a = geometryOnly(generateLayout(settings, width, height).pixels)
      const b = geometryOnly(generateLayout(settings, width, height).pixels)
      const sigA = layoutGeometrySignature(a)
      const sigB = layoutGeometrySignature(b)
      assert(sigA === sigB, "geometry signatures differ across identical runs")
      assert(a.length === b.length, "pixel counts differ")
      for (let i = 0; i < a.length; i++) {
        assert(a[i].x === b[i].x, `x mismatch at ${i}`)
        assert(a[i].y === b[i].y, `y mismatch at ${i}`)
        assert(a[i].width === b[i].width, `width mismatch at ${i}`)
        assert(a[i].height === b[i].height, `height mismatch at ${i}`)
      }
      return `${a.length} pixels, signature length ${sigA.length}`
    })
  )

  results.push(
    runCheck(2, "Different seed → different floor", () => {
      const a = layoutGeometrySignature(
        generateLayout(settings, width, height).pixels
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, seed: 43 }, width, height).pixels
      )
      assert(a !== b, "seed 42 and 43 produced identical geometry")
      return "signatures differ"
    })
  )

  results.push(
    runCheck(14, "Dynamic base pixel scale with resolution", () => {
      assert(computeBasePixelScale(1000, 800) === 10, "1000px baseline should be 10")
      assert(computeBasePixelScale(4000, 3000) === 40, "4000px should be 40")
      assert(computeBasePixelScale(50, 40) === 1, "tiny images clamp to 1")
      const small = gridDimensions(1000, 800)
      const large = gridDimensions(4000, 3000)
      assert(small.basePixelScale === 10, "small layout scale")
      assert(large.basePixelScale === 40, "large layout scale")
      assert(small.gridWidth === 100, "small grid ~100 across")
      assert(large.gridWidth === 100, "large grid ~100 across")
      const layout = generateLayout(settings, 4000, 3000)
      assert(layout.basePixelScale === 40, "CachedLayout carries basePixelScale")
      verifyPhotoPixelCoverage(layout.pixels, 4000, 3000)
      return "basePixelScale tracks max edge; ~100 units across"
    })
  )

  const floorCases = [
    { maxPixelSize: 1, seed: 7 },
    { maxPixelSize: 10, seed: 42 },
    { maxPixelSize: 20, seed: 99 },
    { maxPixelSize: 12, seed: 1234 },
  ]

  results.push(
    runCheck(3, "Every grid unit covered exactly once", () => {
      for (const c of floorCases) {
        const { gridWidth, gridHeight } = gridDimensions(width, height)
        const floor = packSquareFloor(
          gridWidth,
          gridHeight,
          c.maxPixelSize,
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
          c.maxPixelSize,
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
          c.maxPixelSize,
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
    runCheck(6, "Every App Pixel is a perfect square", () => {
      const layout = generateLayout(settings, width, height)
      for (const p of layout.pixels) {
        assert(
          p.width === p.height,
          `non-square pixel ${p.width}x${p.height} at ${p.x},${p.y}`
        )
      }
      const { gridWidth, gridHeight } = gridDimensions(width, height)
      const floor = packSquareFloor(gridWidth, gridHeight, 10, 42)
      for (const p of floor) {
        assert(p.span >= 1, "invalid span")
      }
      const odd = generateLayout(settings, 325, 247)
      verifyPhotoPixelCoverage(odd.pixels, 325, 247)
      return `${layout.pixels.length} square pixels on aligned canvas; odd size still covers`
    })
  )

  results.push(
    runCheck(7, "Every App Pixel is grid-aligned", () => {
      const layout = generateLayout(settings, width, height)
      const scale = layout.basePixelScale
      for (const p of layout.pixels) {
        assert(p.x % scale === 0, `x ${p.x} not aligned to ${scale}`)
        assert(p.y % scale === 0, `y ${p.y} not aligned to ${scale}`)
      }
      const { gridWidth, gridHeight } = gridDimensions(width, height)
      const floor = packSquareFloor(gridWidth, gridHeight, 10, 42)
      for (const p of floor) {
        assert(Number.isInteger(p.gx) && Number.isInteger(p.gy), "non-integer grid origin")
        assert(Number.isInteger(p.span), "non-integer span")
      }
      return `origins on ${scale} photo-pixel grid`
    })
  )

  results.push(
    runCheck(8, "Noise Spread does not change Phase 1 geometry", () => {
      const a = layoutGeometrySignature(
        generateLayout(settings, width, height).pixels
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, noiseSpread: 90 }, width, height).pixels
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
        generateLayout(settings, width, height).pixels
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, noiseScale: 80 }, width, height).pixels
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
        generateLayout(settings, width, height).pixels
      )
      const b = layoutGeometrySignature(
        generateLayout({ ...settings, noiseSpread: 10 }, width, height).pixels
      )
      assert(a === b, "noiseSpread changed geometry")
      const pa = extractLayoutParams(settings, width, height)
      const pb = extractLayoutParams(
        { ...settings, noiseSpread: 10 },
        width,
        height
      )
      assert(layoutParamsEqual(pa, pb), "layout params should ignore noiseSpread")
      assert(pa.maxPixelSize === settings.maxPixelSize, "maxPixelSize missing")
      assert(pa.basePixelScale === 10, "basePixelScale missing from LayoutParams")
      return "geometry + LayoutParams unchanged"
    })
  )

  results.push(
    runCheck(11, "Show Pixel Layout is mask-independent", () => {
      const workerPath = resolve(__dirname, "../workers/effect-worker.ts")
      const source = readFileSync(workerPath, "utf8")
      const drawCompositeIdx = source.indexOf("function drawComposite(")
      assert(drawCompositeIdx >= 0, "drawComposite not found")
      const body = source.slice(drawCompositeIdx, drawCompositeIdx + 1200)
      assert(
        body.includes("if (settings.showPixelLayout)"),
        "missing showPixelLayout branch"
      )
      assert(
        body.includes("drawPixelLayoutDebug(ctx, layout.pixels, width, height"),
        "missing drawPixelLayoutDebug call"
      )
      const branch = body.slice(body.indexOf("if (settings.showPixelLayout)"))
      const returnIdx = branch.indexOf("return")
      assert(returnIdx >= 0, "showPixelLayout branch does not return early")
      const beforeReturn = branch.slice(0, returnIdx)
      assert(
        !beforeReturn.includes("samplePixelMask"),
        "showPixelLayout path samples mask before return"
      )
      assert(
        source.includes("Phase 1 floor only — no source image, no Phase 2 mask"),
        "drawPixelLayoutDebug missing Phase 1-only comment/guarantee"
      )
      const layout = generateLayout(settings, width, height)
      verifyPhotoPixelCoverage(layout.pixels, width, height)
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
