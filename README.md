# Pixel By Day

Client-side mosaic / glitch editor. Upload a photo, drive a grid of Cells with sliders, and export the result. Nothing leaves the browser: no server, no database, no accounts, no persistence.

The only route is `/`. Metadata (SEO, Open Graph, robots, sitemap) lives beside it in `app/`.

## Stack

Next.js 16 App Router, React 19, Tailwind v4, shadcn (`base-nova` / Base UI), TypeScript strict. Image work runs in Web Workers (`workers/effect-worker.ts` for layout + effects, `workers/composite-worker.ts` for 35mm grain).

## Commands

```bash
npm run dev              # local app at http://localhost:3000
npm run build            # production build
npm run start            # serve the production build
npm run lint             # eslint
npx tsc --noEmit -p .    # type-check
npm run verify:phase1    # Phase 1 layout invariants
npm run verify:smear     # directional smear exclusivity + Recursive stack
```

There is no unit-test framework. The two `verify:*` scripts are the automated checks; they run in Node and cover pure logic in `lib/`. Canvas output, workers, and UI are verified in the browser.

## Pipeline

1. **Phase 1 — Layout.** Deterministic quadrant subdivision (`lib/phase1-floor.ts`). Exact, gap-free, non-overlapping pixel coverage.
2. **Phase 2 — Mask, Color Masters, smear, textures.** A noise mask turns Cells on. Each ON Cell gets one effect (`chooseEffect`) sampled from an eager Color Master, then at most one directional smear (`chooseSmear`). Recursive smear (`chooseRecursiveSmear`) is independent 0–100 coverage of ON Cells and stacks on top. Then optional dither / halftone / pixelate (`lib/texture-styles.ts`).
3. **Phase 3 — Grain.** Isolated in the composite worker so opacity scrubs never re-run Phases 1–2.

Repeat (1–3) re-runs Phases 1+2, each pass feeding the previous frame back in with `seed + i` and smear decay `(rate/100)^i`. Grain is applied once at the end.

## Config

Copy `.env.example` and set `NEXT_PUBLIC_SITE_URL` to the public origin in production. That value drives canonical URLs, Open Graph, robots, and the sitemap (`lib/site.ts`).
