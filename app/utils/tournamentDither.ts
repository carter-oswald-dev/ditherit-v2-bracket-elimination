// Self-contained dithering renderer for the bracket tournament and (later)
// the AI ranker. Deliberately does NOT touch the app's global useDithering()
// state — that state is a shared singleton used by the main editor, and
// mutating it to render two dozen candidate variants would visibly change
// the user's live editor settings mid-render. Everything here works on
// its own throwaway canvases instead.
//
// Only covers RGB-mode error diffusion + Bayer — the same fixed set of
// ~23 combinations (11 algorithms x serpentine on/off, plus Bayer) used
// by the original Nuxt 2 fork this tournament is ported from. This keeps
// candidate configs compatible with AI models trained on that fork.

import { bayerDither, type BayerSize } from './dithering'

export const ERROR_ALGORITHMS = [
  'FloydSteinberg', 'Atkinson', 'Sierra24A', 'Fan', 'ShiauFan',
  'ShiauFan2', 'JarvisJudiceNinke', 'Stucki', 'Burkes', 'Sierra3', 'Sierra2'
] as const

export type TournamentMode = 'error' | 'bayer' | 'both'
export type SerpentineOption = boolean | 'both'

export interface TournamentVariantConfig {
  mode: 'Error Diffusion' | 'Bayer (Ordered)'
  algorithm?: string
  serpentine?: boolean
}

export interface TournamentVariant {
  id: string
  label: string
  config: TournamentVariantConfig
}

// Builds the full candidate list for a given mode/serpentine choice.
export function buildTournamentVariants(mode: TournamentMode, serpentineOpt: SerpentineOption): TournamentVariant[] {
  const variants: TournamentVariant[] = []

  if (mode === 'error' || mode === 'both') {
    const serpOptions: boolean[] = serpentineOpt === 'both' ? [false, true] : [serpentineOpt as boolean]
    ERROR_ALGORITHMS.forEach((algo) => {
      serpOptions.forEach((serp) => {
        variants.push({
          id: `err_${algo}_${serp ? 'serp' : 'noserp'}`,
          label: algo + (serp ? ' (serpentine)' : ''),
          config: { mode: 'Error Diffusion', algorithm: algo, serpentine: serp }
        })
      })
    })
  }

  if (mode === 'bayer' || mode === 'both') {
    variants.push({
      id: 'bayer',
      label: 'Bayer (Ordered)',
      config: { mode: 'Bayer (Ordered)' }
    })
  }

  return variants
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

// Standalone hex -> RGB conversion, deliberately NOT reusing usePalette's
// version (which lives inside that composable's singleton scope). Uses
// new RegExp(...) rather than a regex literal — Vue 2's Babel pipeline in
// the old fork choked on regex literals inside certain nested contexts,
// and there's no reason to risk the same footgun here.
export function hexToRgb(hex: string): number[] | null {
  const pattern = new RegExp('^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$', 'i')
  const result = pattern.exec(hex)
  if (!result || !result[1] || !result[2] || !result[3]) return null
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
}

// A small independent copy of the app's built-in preset palettes, scoped to
// just what the tournament needs (name/value/hex list). Kept separate from
// usePalette's PRESET_PALETTES so selecting a tournament palette never
// touches the main editor's singleton palette state.
export interface TournamentPresetPalette {
  name: string
  value: string
  colors: string[] // hex strings
}

export const TOURNAMENT_PRESET_PALETTES: TournamentPresetPalette[] = [
  { name: 'Original (auto)', value: 'original', colors: [] },
  { name: 'Black & White', value: 'blackwhite', colors: ['#ffffff', '#000000'] },
  { name: 'Red Monochrome', value: 'redmono', colors: ['#ffe3db', '#4f1403'] },
  { name: 'Green Monochrome', value: 'greenmono', colors: ['#eeffdb', '#1d3801'] },
  { name: 'Blue Monochrome', value: 'bluemono', colors: ['#dbf9ff', '#02474f'] },
  { name: 'Yellow Monochrome', value: 'yellowmono', colors: ['#fffedb', '#303001'] },
  { name: 'Red', value: 'red', colors: ['#ffffff', '#f46842', '#aa2f0d', '#000000'] },
]

// Resolves a preset value (or 'custom-gpl' + externally supplied hex list)
// down to an RGB array ready for the renderer, or null for 'original'
// (meaning: auto-sample from the image, same as the old fork's behaviour).
export function resolveTournamentPaletteRgb(paletteValue: string, customHexColors?: string[] | null): number[][] | null {
  if (paletteValue === 'original') return null
  if (paletteValue === 'custom-gpl' && customHexColors && customHexColors.length > 0) {
    return customHexColors.map(hexToRgb).filter((c): c is number[] => c !== null)
  }
  const preset = TOURNAMENT_PRESET_PALETTES.find(p => p.value === paletteValue)
  if (!preset || preset.colors.length === 0) return null
  return preset.colors.map(hexToRgb).filter((c): c is number[] => c !== null)
}

export function resolveTournamentPaletteName(paletteValue: string, customName?: string | null): string {
  if (paletteValue === 'custom-gpl' && customName) return customName
  return TOURNAMENT_PRESET_PALETTES.find(p => p.value === paletteValue)?.name ?? 'Original'
}

// Lazily loaded, same pattern as useDithering.ts, to avoid paying RgbQuant's
// parse cost until a tournament actually runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RgbQuantConstructor = new (opts: any) => any
let _RgbQuant: RgbQuantConstructor | null = null
async function getRgbQuant(): Promise<RgbQuantConstructor> {
  if (!_RgbQuant) {
    const mod = await import('rgbquant')
    _RgbQuant = (mod.default ?? mod) as RgbQuantConstructor
  }
  return _RgbQuant
}

function autoSamplePalette(img: HTMLImageElement): number[][] {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, 16, 16)
  const data = ctx.getImageData(0, 0, 16, 16).data
  const colors: number[][] = []
  for (let i = 0; i < data.length; i += 64) {
    colors.push([data[i]!, data[i + 1]!, data[i + 2]!])
  }
  return colors.slice(0, 16)
}

// Renders one candidate config against the given loaded <img>, using a
// throwaway canvas. Returns a PNG data URL. paletteRgb: null means
// "auto-sample from the image" (matches the old fork's behaviour for the
// 'original' palette option).
export async function renderTournamentVariant(
  img: HTMLImageElement,
  config: TournamentVariantConfig,
  paletteRgb: number[][] | null
): Promise<string> {
  const w = img.naturalWidth
  const h = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)

  try {
    if (config.mode === 'Bayer (Ordered)') {
      const imageData = ctx.getImageData(0, 0, w, h)
      const pal = paletteRgb ?? autoSamplePalette(img)
      // bayerDither expects a bayerSize; 4x4 matches the old fork's single fixed Bayer variant
      bayerDither(ctx, imageData, pal, 1, 4 as BayerSize)
    } else {
      const RgbQuant = await getRgbQuant()
      const qOpts = {
        colors: paletteRgb ? paletteRgb.length : 8,
        method: 2,
        boxSize: [8, 8] as [number, number],
        boxPxls: 2,
        initColors: 4096,
        minHueCols: 2000,
        dithKern: config.algorithm,
        dithDelta: 0,
        dithSerp: config.serpentine,
        reIndex: false,
        useCache: true,
        cacheFreq: 10,
        colorDist: 'euclidean',
        palette: paletteRgb ?? []
      }
      const q = new RgbQuant(qOpts)
      q.sample(img)
      const result = q.reduce(canvas, 1, config.algorithm, config.serpentine)
      const imageData = ctx.getImageData(0, 0, w, h)
      imageData.data.set(result)
      ctx.putImageData(imageData, 0, 0)
    }
  } catch {
    // fall through — canvas keeps the plain drawImage copy if dithering failed
  }

  return canvas.toDataURL('image/png')
}

// Renders every variant against `img` sequentially, yielding to the
// browser between each so a progress UI can update smoothly.
export async function renderAllTournamentVariants(
  img: HTMLImageElement,
  variants: TournamentVariant[],
  paletteRgb: number[][] | null,
  onProgress?: (done: number, total: number) => void
): Promise<Array<TournamentVariant & { dataUrl: string }>> {
  const results: Array<TournamentVariant & { dataUrl: string }> = []

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i]!
    await new Promise((resolve) => setTimeout(resolve, 10))
    const dataUrl = await renderTournamentVariant(img, v.config, paletteRgb)
    results.push({ ...v, dataUrl })
    onProgress?.(i + 1, variants.length)
  }

  return results
}
