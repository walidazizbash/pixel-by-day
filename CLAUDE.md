# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this app does

Pixel By Day turns an uploaded photo into a mosaic/glitch-art image driven by sliders. It is entirely client-side: no server, no database, no accounts, no persistence. The only route is `/` (`app/page.tsx`); everything else in `app/` is metadata (SEO, OG images, robots, sitemap).

Stack: Next.js 16 App Router, React 19, Tailwind v4, shadcn (`base-nova` style, Base UI primitives), TypeScript strict. Path alias `@/*` → repo root.

## Commands

```bash
npm run dev              # local dev at http://localhost:3000
npm run build            # production build
npm run start            # serve the production build
npm run lint             # eslint (flat config: next/core-web-vitals + typescript)
npx tsc --noEmit -p .    # type-check
npm run verify:phase1    # Phase 1 layout regression checks (its check 12 also runs tsc)
npm run verify:smear     # directional smear exclusivity + Recursive stack
```

There is no test framework. The two `verify:*` scripts are the only automated checks — plain `tsx` scripts that assert invariants and print `[PASS]`/`[FAIL]` lines. They run in Node with no DOM, so they only cover pure logic in `lib/`. Neither takes a filter argument, so there is no way to run a single check — a failure only sets `process.exitCode`, so read the printed lines rather than trusting a quiet exit. `verify:phase1` is the slow one: its check 12 shells out to `npx tsc --noEmit`.

- Run `verify:phase1` after touching `lib/phase1-floor.ts`, `lib/layout-types.ts`, or the layout/debug paths in `workers/effect-worker.ts`.
- Run `verify:smear` after touching `lib/smear-styles.ts` or `lib/pipeline.ts` (`chooseSmear` / `chooseRecursiveSmear`).
- Everything else (worker rendering, canvas output, UI) has no automated coverage — verify in the browser with `npm run dev`.

Two things to know about `verify:phase1`:

- Check 11 reads `workers/effect-worker.ts` **as text** and asserts on function names, a branch shape, and a literal comment string. Renaming `drawComposite`, restructuring the `showCellLayout` early return, or editing the comment `Phase 1 floor only — no source image, no Phase 2 mask` fails it even when behavior is correct.
- Both scripts build full `EffectSettings` literals by hand, so any new field on `EffectSettings` breaks their compile until the fixtures are updated.

## The three-phase pipeline

Terminology used throughout the code: a **Cell** is a structural block of the layout grid; **baseCellSize** is the grid unit in pixels (~1/100 of the longest source edge); **Phase 1/2/3** are the stages below.

**Phase 1 — Layout** (`lib/phase1-floor.ts`). Recursive quadrant subdivision starting from one full-frame Cell, seeded and deterministic. Produces `CachedLayout` (`baseCellSize` plus `CachedCell[]`, each Cell carrying geometry, a source-sample origin `sx`/`sy`, and a stable `randomVal`). Guarantees exact, gap-free, non-overlapping pixel coverage — that invariant is what `verify:phase1` protects.

**Phase 2 — Mask, Color Masters, smear, textures** (`workers/effect-worker.ts`, `lib/pipeline.ts`, `lib/color-masters.ts`, `lib/thermal.ts`, `lib/slit-scan.ts`, `lib/smear-styles.ts`, `lib/texture-styles.ts`). A value-noise mask decides per Cell whether it is ON. Each ON Cell gets **one** effect from the relative weights (`dither` / `invert` / `surreal` / `pixelate` / `halftone` / `original` / `thermal` / `slitscan`) via `chooseEffect` (base-100 padding: a lone weight of 50 covers ~50% of ON Cells; the remainder is `"original"`). The Cell copies a window from the matching Color Master (texture effects always start from the original/Normal master), then **at most one** directional smear via `chooseSmear` (exclusive buckets and base-100 padding — remainder unsmeared). Recursive is a separate pass (`chooseRecursiveSmear`) with its own 0–100 coverage of ON Cells and stacks on top of any directional smear. Dither / halftone / pixelate then run as post-smear textures on those pixels.

The four content-derived masters (`original`, `invert`, `surreal`, `thermal`) are eager-built by `buildBaseColorMasters` on `setSource` / Bake and reused for pass 0. Extra Repeat passes build throwaway masters from the previous frame and never write the persistent pass-0 cache — so a master builder runs once per pass, not once per load.

`slitscan` is the fifth master and the exception: it is a 2D curl-noise warp, it is the only master driven by `EffectSettings`, and `setSource` runs before any settings exist. It is therefore absent from `BaseColorMasters` and attached per render by `withSlitScanMaster`, behind the invalidation seam described below.

**Phase 3 — Grain** (`workers/composite-worker.ts`). Blends `public/images/35mm_texture.webp` over the finished Phase 2 frame. Deliberately isolated in its own worker so grain-only changes never re-run Phases 1–2.

Phases 1+2 live in the effect worker; Phase 3 must never run there. `settings.passes` (1–3) re-runs Phases 1+2 recursively, each pass feeding its output in as the next pass's source with seed `seed + i` and smear decay `(rate/100)^i`; Phase 3 is applied once, after all passes finish.

### The layout cache — the main correctness trap

Phase 1 is the expensive step, so the effect worker caches the layout and reuses it whenever `LayoutParams` is unchanged (`extractLayoutParams` / `layoutParamsEqual`). `LayoutParams` deliberately lives in its own file, `lib/layout-types.ts`, apart from `lib/effect-types.ts`, and holds **only** geometry inputs. Mask, effect-weight, and smear settings must never be added to it — that would needlessly invalidate the cache, and `verify:phase1` checks 8–10 assert `noiseScale`/`noiseSpread` change neither geometry nor the cache key.

Bump `LAYOUT_CACHE_VERSION` in `lib/phase1-floor.ts` whenever layout or composite semantics change, so stale cached geometry is rejected.

### The Slit Scan invalidation seam — the second correctness trap

Slit Scan warps the frame through a divergence-free **curl-noise** field: the vector at each pixel is the curl of a single scalar fBm potential ψ, `v = (∂ψ/∂y, −∂ψ/∂x)`. Being divergence-free is the point — the warp swirls around vortices rather than piling pixels up in some places and tearing them apart in others, which is what independent per-axis noise does. `verify:smear` asserts that property directly, against a compressible control field so the metric cannot pass trivially.

That field is expensive, so `lib/slit-scan.ts` caches it behind **two** keys, deliberately coarser than each other:

- **`SlitScanParams`** (`width`, `height`, `seed`, `amount`, `frequency`) is the master key. `resolveSlitScanMaster` in the effect worker compares it via `slitScanParamsEqual` before every render and rebuilds only on a miss.
- **`SlitScanFieldKey`** is that minus `amount`. Amplitude is applied at gather time, not baked into the field, so dragging Amount re-runs only the gather.

This is a performance contract, not a nicety. At 1200×800 an unrelated drag (smear, effect weights, mask, grain) costs a five-field compare — 0.017 µs; an Amount drag costs ~4.3 ms; a Frequency or seed change costs ~8.6 ms. Adding an unrelated field to `SlitScanParams` would put that 8.6 ms on every frame of every drag, and moving `amount` into the field key would put it on every Amount frame. It is the same discipline as `LayoutParams`, for the same reason — and like `LayoutParams`, the verify scripts assert both halves: that each key member invalidates, and that unrelated settings do not.

Three implementation notes that keep the field affordable:

- The potential is evaluated on a **coarse grid and bilinearly expanded**, not per pixel. `noiseSampleStep` derives the spacing from the highest octave's wavelength so there are always ≥4 samples per period — 8px at low Frequency down to 3px at the top of the range, or 9–64× fewer noise evaluations than per-pixel fBm.
- The **curl is differenced from that same grid**, so the derivatives cost no extra noise taps. One fBm evaluation per node covers both axes, which is why curl is cheaper here than the two independent passes it replaced.
- The **gather** (O(width×height)) is the only half a Repeat pass has to redo, since its pixels change every frame. The field is content-independent and survives.

Vectors are normalized so the strongest vortex reaches magnitude 1, which is what keeps `slitScanAmount` mapping to pixels the same way at any Frequency, and what holds the [-1, 1] invariant through the bilinear expansion.

## Adding or changing a setting

`EffectSettings` in `lib/effect-types.ts` is the single source of truth. A new slider/switch must be threaded through **all** of these — skipping any one fails silently rather than loudly:

1. `lib/effect-types.ts` — add the field (and to `LayoutParams` in `lib/layout-types.ts` only if it genuinely changes geometry).
2. `lib/validate-settings.ts` — `sanitizeEffectSettings` **rebuilds** the object field by field, so an unlisted field is dropped before the worker ever sees it. Each field also needs a clamp range and a fallback here; those fallbacks are the sanitizer's own and deliberately independent of `CONTROL_DEFAULTS` in `app/page.tsx`, so changing a UI default does not change them.
3. `hooks/useAppWorkers.ts` — add it to the Phase-1+2 dependency array (`scheduleRegen`) **or** the Phase-3-only array (`schedulePhase3Only`), not both. Omitting it means the control renders but changes nothing.
4. `workers/effect-worker.ts` (or `composite-worker.ts` for a Phase 3 setting, or `lib/texture-styles.ts` for a post-smear texture) — consume it.
5. `app/page.tsx` — `useState`, the `effectSettings` object, `buildNeutralEffectSettings` (Bake) and `buildToolbarResetSettings`, `CONTROL_DEFAULTS` / `buildDefaultEffectSettings`, `applyPhase12Settings` (used by Random and history restore), `applyFullEffectSettings`, plus `buildRandomPhase12Settings` and `RANDOM_RANGES` if Random should roll it.
6. `scripts/verify-phase1-floor.ts` and `scripts/verify-smear-exclusive.ts` — update the hand-written settings fixtures.

Sliders carry UI-facing ranges (mostly 0–100) that the worker maps to internal values — e.g. `noiseScale` 1–100 maps to 0.01–0.5. Keep that mapping in the worker, not the UI.

## Worker protocol

Both workers share one shape: the host assigns a monotonically increasing `jobId`, and any result whose `jobId` is no longer current is discarded and its `ImageBitmap` closed. Message types are `result` / `cancelled` / `error`. Both workers re-validate incoming payloads through `lib/validate-settings.ts` — treat worker input as untrusted and never skip that step.

`ImageBitmap` ownership matters: bitmaps are transferred, not copied, so one posted to a worker is detached on the host side. Close every bitmap you stop using; the codebase's `releaseBitmap` swallows double-close.

## `hooks/useAppWorkers.ts`

The traffic controller between UI state and the two workers.

- Dispatches are coalesced onto a `requestAnimationFrame`, so dragging a slider produces at most one job per frame.
- Two source bitmaps are kept: the full-resolution original (Save/export takes its dimensions from this) and a preview capped at `MAX_PREVIEW_DIMENSION` (1200px longest edge) that the workers actually render. Export upscales the finished preview frame to full-res dimensions — it does not re-render at full resolution.
- The last Phase 2 frame is retained (`phase2BitmapRef`) so grain-only changes can go straight to the composite worker, and so Bake can capture pre-grain output — that is why repeated Bakes don't stack grain.
- Source images beyond `MAX_DECODE_EDGE` (8192) or `MAX_DECODE_PIXELS` (36M) in `lib/constants.ts` are rejected.
- Both workers are instantiated as `new Worker(new URL("../workers/<name>.ts", import.meta.url))`, so they are bundled from plain `.ts` files outside `app/` — that is what needs `worker-src blob:` in the CSP.
- **Effect declaration order is load-bearing.** The Phase-1+2 render effect must stay declared *before* the grain-only effect: `schedulePhase3Only` defers to the `pendingDispatchRef` flag that `scheduleRegen` sets, so swapping them makes a settings change emit a redundant grain job. `paused` is a dependency of the render effect rather than only a guard — unpausing re-runs it, which is how the canvas reconciles with settings that drifted while suspended.

## `app/page.tsx`

~2000 lines holding the entire UI and all slider state. Notable behavior:

- **Random**: rolls Phase 1+2 values only (grain and debug toggles are carried over from current settings), pushing onto an undo/redo stack capped at `MAX_AUTO_FILL_HISTORY`.
- **Bake**: swaps the pre-grain Phase 2 result in as the new source image and resets all controls to defaults, so effects can be layered in stages.
- **History sidebar**: user-captured snapshots (150px JPEG data-URL thumbnail, full-size PNG blob URL, cloned settings), capped at `MAX_VISUAL_HISTORY`, with a preview modal that can restore the snapshot's image *and* its settings.
- **Blob URL ownership is shared and fragile.** One source blob URL can be referenced by the live `imageSrc` and by any number of History snapshots at once. Always free through `releaseSourceBlob`, which checks every holder; revoking a URL another holder still references is what produced `net::ERR_FILE_NOT_FOUND` on restore. The unmount cleanup deliberately depends on `[]`, not `[imageSrc]`.
- `EffectSettings` carries nested smear objects, so copy with `cloneEffectSettings`, never a bare spread.

## Config notes

- `next.config.ts` sets a strict CSP. `worker-src 'self' blob:` and `connect-src 'self'` are what let the workers run and fetch the grain texture; adding any external asset, font, or endpoint requires editing that policy.
- `NEXT_PUBLIC_SITE_URL` (see `.env.example`) sets the canonical origin for metadata/robots/sitemap; `lib/site.ts` falls back to Vercel env vars, then a hardcoded production origin.
