<script setup lang="ts">
import {
  TOURNAMENT_PRESET_PALETTES,
  buildTournamentVariants,
  renderAllTournamentVariants,
  resolveTournamentPaletteRgb,
  resolveTournamentPaletteName,
  type TournamentMode,
  type SerpentineOption
} from '~/utils/tournamentDither'
import { useTournament, type TournamentContestant } from '~/composables/useTournament'

definePageMeta({ layout: 'content' })
useSeoMeta({ title: 'Dither Tournament — Dither it!' })

const t = useTournament()

// --- Upload ---
const isDragging = ref(false)
const previewSrc = ref<string | null>(null)
const sourceImgEl = ref<HTMLImageElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) loadFile(file)
  input.value = ''
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) loadFile(file)
}

function loadFile(file: File) {
  if (!file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    previewSrc.value = ev.target?.result as string
    t.phase.value = 'wizard'
  }
  reader.readAsDataURL(file)
}

// --- Wizard step tracking ---
const wizardStep = ref(1)
const totalWizardSteps = 4

function goToPaletteStep() {
  wizardStep.value = 3
}

function onPaletteNext() {
  if (t.mode.value === 'bayer') {
    t.serpentine.value = false
    startProcessing()
  } else {
    wizardStep.value = 4
  }
}

// --- Custom palette import (GPL / JSON), fully local to this page —
// never touches the singleton usePalette() state ---
const customPaletteColors = ref<string[] | null>(null)
const customPaletteName = ref<string | null>(null)
const gplError = ref('')
const gplSuccess = ref('')
const paletteJsonImport = ref('')
const paletteImportError = ref('')
const paletteImportSuccess = ref('')

function parseGpl(text: string): { name: string, colors: string[] } | { error: string } {
  const lines = text.split('\n').map(l => (l.charAt(l.length - 1) === '\r' ? l.slice(0, -1) : l))
  if (!lines[0] || lines[0].trim() !== 'GIMP Palette') return { error: 'Not a valid GIMP .gpl file.' }
  let name = 'Custom GPL'
  const colors: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (!line || line.charAt(0) === '#') continue
    if (line.indexOf('Name:') === 0) { name = line.slice(5).trim(); continue }
    if (line.indexOf('Columns:') === 0) continue
    const parts = line.split(' ').join('\t').split('\t').filter(s => s.length > 0)
    if (parts.length >= 3) {
      const r = parseInt(parts[0]!)
      const g = parseInt(parts[1]!)
      const b = parseInt(parts[2]!)
      if (!isNaN(r) && !isNaN(g) && !isNaN(b) && r <= 255 && g <= 255 && b <= 255) {
        colors.push('#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''))
      }
    }
  }
  return { name, colors }
}

function loadGplFile(e: Event) {
  gplError.value = ''
  gplSuccess.value = ''
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const result = parseGpl(ev.target?.result as string)
    if ('error' in result) { gplError.value = result.error; return }
    if (result.colors.length === 0) { gplError.value = 'No colours found in this .gpl file.'; return }
    if (result.colors.length > 256) { gplError.value = `This palette has ${result.colors.length} colours — maximum is 256.`; return }
    customPaletteColors.value = result.colors
    customPaletteName.value = result.name
    t.paletteValue.value = 'custom-gpl'
    gplSuccess.value = `Loaded "${result.name}" — ${result.colors.length} colours`
  }
  reader.onerror = () => { gplError.value = 'Could not read the file.' }
  reader.readAsText(file)
  input.value = ''
}

function importJsonPalette() {
  paletteImportError.value = ''
  paletteImportSuccess.value = ''
  try {
    const parsed = JSON.parse(paletteJsonImport.value)
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty')
    if (parsed.length > 256) { paletteImportError.value = 'Maximum 256 colours allowed.'; return }
    const colors: string[] = parsed.map((e: unknown) => (typeof e === 'string' ? e : (e as { hex?: string })?.hex)).filter(Boolean) as string[]
    customPaletteColors.value = colors
    customPaletteName.value = 'JSON Import'
    t.paletteValue.value = 'custom-gpl'
    paletteJsonImport.value = ''
    paletteImportSuccess.value = `Loaded ${colors.length} colours`
  } catch {
    paletteImportError.value = 'Invalid JSON. Expected: [{"hex":"#ff0000"},...]'
  }
}

// --- Processing ---
async function startProcessing() {
  t.phase.value = 'processing'
  t.doneCount.value = 0
  await nextTick()

  const img = sourceImgEl.value
  if (!img) return
  if (!img.complete) {
    await new Promise((resolve) => { img.onload = resolve })
  }

  const variants = buildTournamentVariants(t.mode.value as TournamentMode, t.serpentine.value as SerpentineOption)
  t.totalCount.value = variants.length

  const paletteRgb = resolveTournamentPaletteRgb(t.paletteValue.value ?? 'original', customPaletteColors.value)

  const rendered = await renderAllTournamentVariants(img, variants, paletteRgb, (done, total) => {
    t.doneCount.value = done
    t.totalCount.value = total
  })

  const contestants: TournamentContestant[] = rendered.map(r => ({ ...r, roundsSurvived: 0 }))
  t.startBracketWith(contestants)
}

// --- Palette display helpers ---
const activePaletteName = computed(() => resolveTournamentPaletteName(t.paletteValue.value ?? 'original', customPaletteName.value))

function downloadWinner() {
  const dataUrl = t.winner.value?.dataUrl
  if (!dataUrl) return
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = 'dithered_winner.png'
  a.click()
}

function reset() {
  t.reset()
  previewSrc.value = null
  wizardStep.value = 1
  customPaletteColors.value = null
  customPaletteName.value = null
  gplError.value = ''
  gplSuccess.value = ''
  paletteJsonImport.value = ''
  paletteImportError.value = ''
  paletteImportSuccess.value = ''
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6 px-4 py-6">
    <div class="text-center">
      <div class="text-4xl">
        🏆
      </div>
      <h1 class="mt-2 text-2xl font-bold text-gray-800 dark:text-gray-100">
        Dither Tournament
      </h1>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Head-to-head bracket to find the best dithering settings for your image, by feel rather than guesswork.
      </p>
    </div>

    <!-- ===== UPLOAD ===== -->
    <UCard v-if="t.phase.value === 'upload'">
      <div
        class="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors"
        :class="isDragging ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
        @click="fileInput?.click()"
      >
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange">
        <UIcon name="i-lucide-upload" class="mb-2 size-8 text-gray-400" />
        <p class="font-medium text-gray-700 dark:text-gray-200">
          Click or drag &amp; drop an image
        </p>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          JPG, PNG, or GIF
        </p>
      </div>
    </UCard>

    <!-- ===== WIZARD ===== -->
    <UCard v-if="t.phase.value === 'wizard'">
      <div class="mb-4 flex justify-center gap-1.5">
        <span
          v-for="s in totalWizardSteps" :key="s"
          class="h-1.5 w-6 rounded-full transition-colors"
          :class="wizardStep >= s ? 'bg-[#C53030]' : 'bg-gray-200 dark:bg-gray-700'"
        />
      </div>

      <!-- Step 1: blind or labelled -->
      <div v-if="wizardStep === 1" class="space-y-4">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Show algorithm names?
        </h3>
        <div class="grid grid-cols-2 gap-3">
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.showLabels.value === true ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.showLabels.value = true"
          >
            <div class="text-xl">
              🏷️
            </div>
            <div class="mt-1 text-sm font-medium">
              Show names
            </div>
          </button>
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.showLabels.value === false ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.showLabels.value = false"
          >
            <div class="text-xl">
              🙈
            </div>
            <div class="mt-1 text-sm font-medium">
              Blind
            </div>
          </button>
        </div>
        <div class="flex justify-end">
          <UButton label="Next →" color="primary" :disabled="t.showLabels.value === null" @click="wizardStep = 2" />
        </div>
      </div>

      <!-- Step 2: mode -->
      <div v-if="wizardStep === 2" class="space-y-4">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Dither mode
        </h3>
        <div class="grid grid-cols-3 gap-3">
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.mode.value === 'error' ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.mode.value = 'error'"
          >
            <div class="text-xl">
              〰️
            </div>
            <div class="mt-1 text-xs font-medium">
              Error Diffusion
            </div>
          </button>
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.mode.value === 'bayer' ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.mode.value = 'bayer'"
          >
            <div class="text-xl">
              ⬛
            </div>
            <div class="mt-1 text-xs font-medium">
              Bayer
            </div>
          </button>
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.mode.value === 'both' ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.mode.value = 'both'"
          >
            <div class="text-xl">
              ⚡
            </div>
            <div class="mt-1 text-xs font-medium">
              Both
            </div>
          </button>
        </div>
        <div class="flex justify-between">
          <UButton label="← Back" color="neutral" variant="ghost" @click="wizardStep = 1" />
          <UButton label="Next →" color="primary" :disabled="!t.mode.value" @click="goToPaletteStep" />
        </div>
      </div>

      <!-- Step 3: palette -->
      <div v-if="wizardStep === 3" class="space-y-4">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Colour palette
        </h3>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div
            v-for="p in TOURNAMENT_PRESET_PALETTES" :key="p.value"
            class="cursor-pointer rounded-lg border-2 p-2 transition-colors"
            :class="t.paletteValue.value === p.value ? 'border-[#C53030]' : 'border-gray-200 dark:border-gray-700'"
            @click="t.paletteValue.value = p.value"
          >
            <div class="flex h-4 overflow-hidden rounded">
              <div v-for="c in p.colors.slice(0, 5)" :key="c" class="flex-1" :style="{ background: c }" />
              <div v-if="p.colors.length === 0" class="flex-1 bg-gradient-to-r from-gray-300 to-gray-600" />
            </div>
            <div class="mt-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
              {{ p.name }}
            </div>
          </div>
          <div
            v-if="customPaletteColors"
            class="cursor-pointer rounded-lg border-2 p-2 transition-colors"
            :class="t.paletteValue.value === 'custom-gpl' ? 'border-[#C53030]' : 'border-gray-200 dark:border-gray-700'"
            @click="t.paletteValue.value = 'custom-gpl'"
          >
            <div class="flex h-4 overflow-hidden rounded">
              <div v-for="c in customPaletteColors.slice(0, 5)" :key="c" class="flex-1" :style="{ background: c }" />
            </div>
            <div class="mt-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
              📄 {{ customPaletteName }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 border-t border-gray-100 pt-3 dark:border-gray-800 sm:grid-cols-2">
          <div class="space-y-2">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
              Paste JSON palette:
            </p>
            <UTextarea v-model="paletteJsonImport" :rows="3" placeholder='[{"hex":"#ff0000"},{"hex":"#000000"}]' class="w-full font-mono text-xs" />
            <UButton label="Import JSON" size="sm" color="neutral" variant="outline" @click="importJsonPalette" />
            <p v-if="paletteImportError" class="text-xs text-red-600 dark:text-red-400">
              {{ paletteImportError }}
            </p>
            <p v-if="paletteImportSuccess" class="text-xs text-green-600 dark:text-green-400">
              {{ paletteImportSuccess }}
            </p>
          </div>
          <div class="space-y-2">
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
              Upload GIMP .gpl file:
            </p>
            <label class="inline-block cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
              📂 Upload .gpl
              <input type="file" accept=".gpl" class="hidden" @change="loadGplFile">
            </label>
            <p v-if="gplError" class="text-xs text-red-600 dark:text-red-400">
              {{ gplError }}
            </p>
            <p v-if="gplSuccess" class="text-xs text-green-600 dark:text-green-400">
              {{ gplSuccess }}
            </p>
          </div>
        </div>

        <div class="flex justify-between">
          <UButton label="← Back" color="neutral" variant="ghost" @click="wizardStep = 2" />
          <UButton label="Next →" color="primary" :disabled="!t.paletteValue.value" @click="onPaletteNext" />
        </div>
      </div>

      <!-- Step 4: serpentine -->
      <div v-if="wizardStep === 4" class="space-y-4">
        <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-100">
          Serpentine dithering
        </h3>
        <div class="grid grid-cols-3 gap-3">
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.serpentine.value === false ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.serpentine.value = false"
          >
            <div class="text-xl">
              ➡️
            </div>
            <div class="mt-1 text-xs font-medium">
              Off
            </div>
          </button>
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.serpentine.value === true ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.serpentine.value = true"
          >
            <div class="text-xl">
              🐍
            </div>
            <div class="mt-1 text-xs font-medium">
              On
            </div>
          </button>
          <button
            class="rounded-lg border-2 p-4 text-center transition-colors"
            :class="t.serpentine.value === 'both' ? 'border-[#C53030] bg-red-50 dark:bg-red-950/30' : 'border-gray-200 dark:border-gray-700'"
            @click="t.serpentine.value = 'both'"
          >
            <div class="text-xl">
              🔀
            </div>
            <div class="mt-1 text-xs font-medium">
              Both
            </div>
          </button>
        </div>
        <UAlert
          v-if="t.willProduceSingleVariant.value"
          color="warning" variant="soft" icon="i-lucide-alert-triangle"
          title="These options only produce 1 image"
          description="There's nothing to compare. Choose &quot;Both&quot; or go back and change your mode."
        />
        <div class="flex justify-between">
          <UButton label="← Back" color="neutral" variant="ghost" @click="wizardStep = 3" />
          <UButton
            label="🏁 Start tournament" color="primary"
            :disabled="t.serpentine.value === null || t.willProduceSingleVariant.value"
            @click="startProcessing"
          />
        </div>
      </div>
    </UCard>

    <!-- ===== PROCESSING ===== -->
    <UCard v-if="t.phase.value === 'processing'">
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-[#C53030]" />
        <h3 class="font-medium text-gray-800 dark:text-gray-100">
          Rendering variants…
        </h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{ t.doneCount.value }} / {{ t.totalCount.value }}
        </p>
        <UProgress :model-value="t.progressPct.value" class="w-full max-w-xs" />
      </div>
      <img v-if="previewSrc" ref="sourceImgEl" :src="previewSrc" alt="" class="hidden">
    </UCard>

    <!-- ===== BRACKET ===== -->
    <div v-if="t.phase.value === 'bracket'" class="space-y-3">
      <UProgress :model-value="t.roundProgressPct.value" size="sm" />
      <p class="text-center text-xs text-gray-500 dark:text-gray-400">
        Round {{ t.currentRound.value }} · match {{ t.matchIndex.value + 1 }} of {{ t.currentPairs.value.length }}
      </p>
      <div v-if="t.currentMatch.value" class="grid grid-cols-2 items-center gap-3">
        <button
          class="group overflow-hidden rounded-lg border-2 border-gray-200 bg-white transition-all hover:border-[#C53030] hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
          @click="t.pick(t.currentMatch.value[0])"
        >
          <div class="bg-gray-800 py-1.5 text-center text-xs font-medium text-white dark:bg-gray-900">
            {{ t.showLabels.value ? t.currentMatch.value[0].label : 'Option A' }}
          </div>
          <img :src="t.currentMatch.value[0].dataUrl ?? ''" class="w-full" style="image-rendering: pixelated;" alt="">
          <div class="border-t border-gray-100 py-2 text-center text-xs font-semibold text-[#C53030] group-hover:bg-[#C53030] group-hover:text-white dark:border-gray-700">
            ✓ Pick this one
          </div>
        </button>
        <button
          class="group overflow-hidden rounded-lg border-2 border-gray-200 bg-white transition-all hover:border-[#C53030] hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
          @click="t.pick(t.currentMatch.value[1])"
        >
          <div class="bg-gray-800 py-1.5 text-center text-xs font-medium text-white dark:bg-gray-900">
            {{ t.showLabels.value ? t.currentMatch.value[1].label : 'Option B' }}
          </div>
          <img :src="t.currentMatch.value[1].dataUrl ?? ''" class="w-full" style="image-rendering: pixelated;" alt="">
          <div class="border-t border-gray-100 py-2 text-center text-xs font-semibold text-[#C53030] group-hover:bg-[#C53030] group-hover:text-white dark:border-gray-700">
            ✓ Pick this one
          </div>
        </button>
      </div>
    </div>

    <!-- ===== WINNER / SOLO ===== -->
    <UCard v-if="t.phase.value === 'winner' || t.phase.value === 'solo'">
      <div class="flex flex-col items-center gap-3 text-center">
        <div v-if="t.phase.value === 'solo'" class="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          ℹ️ Your settings only produced one possible result — no bracket needed.
        </div>
        <div class="text-3xl">
          👑
        </div>
        <h2 class="text-xl font-bold text-[#C53030]">
          {{ t.phase.value === 'solo' ? 'Only option!' : 'Winner!' }}
        </h2>
        <p class="text-sm font-medium text-gray-700 dark:text-gray-200">
          {{ t.winner.value?.label }}
        </p>
        <img :src="t.winner.value?.dataUrl ?? ''" class="max-w-full rounded-lg border border-gray-200 dark:border-gray-700" style="image-rendering: pixelated;" alt="">

        <div class="w-full space-y-1 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left text-sm dark:border-gray-800 dark:bg-gray-800/50">
          <div class="flex justify-between border-b border-gray-100 pb-1 dark:border-gray-800">
            <span class="text-gray-500 dark:text-gray-400">Mode</span>
            <span class="font-medium text-gray-800 dark:text-gray-100">{{ t.winner.value?.config.mode }}</span>
          </div>
          <div v-if="t.winner.value?.config.algorithm" class="flex justify-between border-b border-gray-100 pb-1 dark:border-gray-800">
            <span class="text-gray-500 dark:text-gray-400">Algorithm</span>
            <span class="font-medium text-gray-800 dark:text-gray-100">{{ t.winner.value?.config.algorithm }}</span>
          </div>
          <div v-if="t.winner.value?.config.serpentine !== undefined" class="flex justify-between border-b border-gray-100 pb-1 dark:border-gray-800">
            <span class="text-gray-500 dark:text-gray-400">Serpentine</span>
            <span class="font-medium text-gray-800 dark:text-gray-100">{{ t.winner.value?.config.serpentine ? 'On' : 'Off' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-gray-500 dark:text-gray-400">Palette</span>
            <span class="font-medium text-gray-800 dark:text-gray-100">{{ activePaletteName }}</span>
          </div>
        </div>

        <div class="flex w-full gap-2">
          <UButton label="💾 Download" color="primary" class="flex-1 justify-center" @click="downloadWinner" />
          <UButton label="🔁 Try again" color="neutral" variant="outline" class="flex-1 justify-center" @click="reset" />
        </div>
      </div>
    </UCard>

    <p v-if="t.phase.value !== 'upload'" class="text-center">
      <button class="text-xs font-medium text-gray-500 hover:text-[#C53030] dark:text-gray-400" @click="reset">
        ✕ Cancel &amp; start over
      </button>
    </p>
  </div>
</template>
