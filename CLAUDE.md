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
npm run lint             # eslint (flat config: next/core-web-vitals + typescript)
npx tsc --noEmit -p .    # type-check
npm run verify:phase1    # Phase 1 layout regression checks (its check 12 also runs tsc)
npm run verify:smear     # smear-stacking regression checks
```

There is no test framework. The two `verify:*` scripts are the only automated checks — plain `tsx` scripts that assert invariants and print `[PASS]`/`[FAIL]` lines. They run in Node with no DOM, so they only cover pure logic in `lib/`.

- Run `verify:phase1` after touching `lib/phase1-floor.ts`, `lib/layout-types.ts`, or the layout/debug paths in `workers/effect-worker.ts`.
- Run `verify:smear` after touching `lib/smear-styles.ts`.
- Everything else (worker rendering, canvas output, UI) has no automated coverage — verify in the browser with `npm run dev`.

Two things to know about `verify:phase1`:

- Check 11 reads `workers/effect-worker.ts` **as text** and asserts on function names, a branch shape, and a literal comment string. Renaming `drawComposite`, restructuring the `showCellLayout` early return, or editing the comment `Phase 1 floor only — no source image, no Phase 2 mask` fails it even when behavior is correct.
- Both scripts build full `EffectSettings` literals by hand, so any new field on `EffectSettings` breaks their compile until the fixtures are updated.

## The three-phase pipeline

Terminology used throughout the code: a **Cell** is a structural block of the layout grid; **baseCellSize** is the grid unit in pixels (~1/100 of the longest source edge); **Phase 1/2/3** are the stages below.

**Phase 1 — Layout** (`lib/phase1-floor.ts`). Recursive quadrant subdivision starting from one full-frame Cell, seeded and deterministic. Produces `CachedLayout` (`baseCellSize` plus `CachedCell[]`, each Cell carrying geometry, a source-sample origin `sx`/`sy`, and a stable `randomVal`). Guarantees exact, gap-free, non-overlapping pixel coverage — that invariant is what `verify:phase1` protects.

**Phase 2 — Mask, effects, smear** (`workers/effect-worker.ts` plus `lib/smear-styles.ts`). A value-noise mask decides per Cell whether it is ON; ON Cells get one effect chosen from the relative weights (`dither` / `invert` / `surreal` / `pixelate` / `halftone` / `original`), then the four smear styles run **in fixed order — vertical, horizontal, diagonal, recursive — as independent sequential `if`s, never `else if`**, each gated by its own per-Cell coin flip with a distinct salt.

**Phase 3 — Grain** (`workers/composite-worker.ts`). Blends `public/images/35mm_texture.png` over the finished Phase 2 frame. Deliberately isolated in its own worker so grain-only changes never re-run Phases 1–2.

Phases 1+2 live in the effect worker; Phase 3 must never run there. `settings.passes` (1–3) re-runs Phases 1+2 recursively, each pass feeding its output in as the next pass's source with seed `seed + i` and smear decay `(rate/100)^i`; Phase 3 is applied once, after all passes finish.

### The layout cache — the main correctness trap

Phase 1 is the expensive step, so the effect worker caches the layout and reuses it whenever `LayoutParams` is unchanged (`extractLayoutParams` / `layoutParamsEqual`). `LayoutParams` deliberately lives in its own file, `lib/layout-types.ts`, apart from `lib/effect-types.ts`, and holds **only** geometry inputs. Mask, effect-weight, and smear settings must never be added to it — that would needlessly invalidate the cache, and `verify:phase1` checks 8–10 assert `noiseScale`/`noiseSpread` change neither geometry nor the cache key.

Bump `LAYOUT_CACHE_VERSION` in `lib/phase1-floor.ts` whenever layout or composite semantics change, so stale cached geometry is rejected.

## Adding or changing a setting

`EffectSettings` in `lib/effect-types.ts` is the single source of truth. A new slider/switch must be threaded through **all** of these — skipping any one fails silently rather than loudly:

1. `lib/effect-types.ts` — add the field (and to `LayoutParams` in `lib/layout-types.ts` only if it genuinely changes geometry).
2. `lib/validate-settings.ts` — `sanitizeEffectSettings` **rebuilds** the object field by field, so an unlisted field is dropped before the worker ever sees it.
3. `hooks/useAppWorkers.ts` — add it to the Phase-1+2 dependency array (`scheduleRegen`) **or** the Phase-3-only array (`schedulePhase3Only`), not both. Omitting it means the control renders but changes nothing.
4. `workers/effect-worker.ts` (or `composite-worker.ts` for a Phase 3 setting) — consume it.
5. `app/page.tsx` — `useState`, the `effectSettings` object, `CONTROL_DEFAULTS` / `buildDefaultEffectSettings`, `applyPhase12Settings` (used by Random and history restore), `applyFullEffectSettings`, plus `buildRandomPhase12Settings` and `RANDOM_RANGES` if Random should roll it.
6. `scripts/verify-phase1-floor.ts` and `scripts/verify-smear-stack.ts` — update the hand-written settings fixtures.

Sliders carry UI-facing ranges (mostly 0–100) that the worker maps to internal values — e.g. `noiseScale` 1–100 maps to 0.01–0.5. Keep that mapping in the worker, not the UI.

## Worker protocol

Both workers share one shape: the host assigns a monotonically increasing `jobId`, and any result whose `jobId` is no longer current is discarded and its `ImageBitmap` closed. Message types are `result` / `cancelled` / `error`. Both workers re-validate incoming payloads through `lib/validate-settings.ts` — treat worker input as untrusted and never skip that step.

`ImageBitmap` ownership matters: bitmaps are transferred, not copied, so one posted to a worker is detached on the host side. Close every bitmap you stop using; the codebase's `releaseBitmap` swallows double-close.

## `hooks/useAppWorkers.ts`

The traffic controller between UI state and the two workers.

- Dispatches are coalesced onto a `requestAnimationFrame`, so dragging a slider produces at most one job per frame.
- Two source bitmaps are kept: the full-resolution original (Save/export takes its dimensions from this) and a preview capped at `MAX_PREVIEW_DIMENSION` (1200px longest edge) that the workers actually render. Export upscales the finished preview frame to full-res dimensions — it does not re-render at full resolution.
- The last Phase 2 frame is retained (`phase2BitmapRef`) so grain-only changes can go straight to the composite worker, and so Bake can capture pre-grain output — that is why repeated Bakes don't stack grain.
- Source images beyond `MAX_DECODE_EDGE` (8192) or `MAX_DECODE_PIXELS` (36M) are rejected.

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
