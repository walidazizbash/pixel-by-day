/**
 * Eager Color Master builders — full-frame RGBA, once per source.
 * Canvas diffusion for Thermal is injected by the worker (`HeatBlurFn`).
 */

import type { ColorMasterName } from "@/lib/pipeline"
import { buildThermalMaster, type HeatBlurFn } from "@/lib/thermal"

export type ColorMasters = {
  original: Uint8ClampedArray
  invert: Uint8ClampedArray
  surreal: Uint8ClampedArray
  thermal: Uint8ClampedArray
}

const SURREAL_R = new Uint8ClampedArray(256)
const SURREAL_G = new Uint8ClampedArray(256)
const SURREAL_B = new Uint8ClampedArray(256)
for (let v = 0; v < 256; v++) {
  SURREAL_R[v] = Math.sin((v / 255) * Math.PI) * 255
  SURREAL_G[v] = Math.cos((v / 255) * Math.PI) * 255
  SURREAL_B[v] = Math.sin((v / 255) * 2 * Math.PI) * 255
}

function buildNormalMaster(
  sourceRgba: Uint8ClampedArray
): Uint8ClampedArray {
  return new Uint8ClampedArray(sourceRgba)
}

function buildInvertMaster(
  sourceRgba: Uint8ClampedArray
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sourceRgba.length)
  for (let i = 0; i < sourceRgba.length; i += 4) {
    out[i] = 255 - sourceRgba[i]!
    out[i + 1] = 255 - sourceRgba[i + 1]!
    out[i + 2] = 255 - sourceRgba[i + 2]!
    out[i + 3] = 255
  }
  return out
}

function buildSurrealMaster(
  sourceRgba: Uint8ClampedArray
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sourceRgba.length)
  for (let i = 0; i < sourceRgba.length; i += 4) {
    out[i] = SURREAL_R[sourceRgba[i]!]!
    out[i + 1] = SURREAL_G[sourceRgba[i + 1]!]!
    out[i + 2] = SURREAL_B[sourceRgba[i + 2]!]!
    out[i + 3] = 255
  }
  return out
}

/** Eager-build all four Color Masters. No lazy / weight gates. */
export function buildColorMasters(
  sourceRgba: Uint8ClampedArray,
  width: number,
  height: number,
  blurHeat: HeatBlurFn
): ColorMasters {
  return {
    original: buildNormalMaster(sourceRgba),
    invert: buildInvertMaster(sourceRgba),
    surreal: buildSurrealMaster(sourceRgba),
    thermal: buildThermalMaster(sourceRgba, width, height, blurHeat),
  }
}

export function masterForName(
  masters: ColorMasters,
  name: ColorMasterName
): Uint8ClampedArray {
  return masters[name]
}
