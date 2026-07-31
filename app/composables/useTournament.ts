// Bracket elimination logic for the Dither Tournament — pure state,
// no rendering. Deliberately NOT a global singleton composable (unlike
// useDithering/useImageGallery elsewhere in this app): each tournament
// page instance gets its own fresh state via useTournament(), since a
// tournament run is a one-off, page-scoped flow.

import { buildTournamentVariants, shuffle, type TournamentVariant, type TournamentMode, type SerpentineOption } from '~/utils/tournamentDither'

export interface TournamentContestant extends TournamentVariant {
  dataUrl: string | null
  roundsSurvived: number
}

export type TournamentPhase = 'upload' | 'wizard' | 'processing' | 'bracket' | 'winner' | 'solo'

export function useTournament() {
  const phase = ref<TournamentPhase>('upload')

  // Wizard selections
  const showLabels = ref<boolean | null>(null)
  const mode = ref<TournamentMode | null>(null)
  const paletteValue = ref<string | null>(null)
  const serpentine = ref<SerpentineOption | null>(null)

  // Processing progress
  const doneCount = ref(0)
  const totalCount = ref(0)

  // Bracket state
  const contestants = ref<TournamentContestant[]>([])
  const currentPairs = ref<Array<[TournamentContestant, TournamentContestant]>>([])
  const winners = ref<TournamentContestant[]>([])
  const matchIndex = ref(0)
  const currentRound = ref(1)
  const totalRounds = ref(1)
  const winner = ref<TournamentContestant | null>(null)

  const progressPct = computed(() => totalCount.value === 0 ? 0 : Math.round((doneCount.value / totalCount.value) * 100))
  const currentMatch = computed(() => currentPairs.value[matchIndex.value] ?? null)
  const roundProgressPct = computed(() => currentPairs.value.length === 0 ? 0 : Math.round((matchIndex.value / currentPairs.value.length) * 100))

  const willProduceSingleVariant = computed(() => {
    if (!mode.value || serpentine.value === null) return false
    return buildTournamentVariants(mode.value, serpentine.value).length <= 1
  })

  function setupRound(pool: TournamentContestant[]) {
    const bracket = pool.slice()
    const pairs: Array<[TournamentContestant, TournamentContestant]> = []
    for (let i = 0; i + 1 < bracket.length; i += 2) {
      pairs.push([bracket[i]!, bracket[i + 1]!])
    }
    if (bracket.length % 2 === 1) {
      const bye = bracket[bracket.length - 1]!
      bye.roundsSurvived++
      winners.value = [bye]
    } else {
      winners.value = []
    }
    currentPairs.value = pairs
    matchIndex.value = 0
  }

  // Called by the page once it has rendered all variants (rendering itself
  // is the page/AI-ranker's job, kept out of this composable so the bracket
  // logic stays independent of how images actually get produced).
  function startBracketWith(renderedContestants: TournamentContestant[]) {
    if (renderedContestants.length === 0) {
      phase.value = 'wizard'
      return
    }
    if (renderedContestants.length === 1) {
      winner.value = renderedContestants[0]!
      totalRounds.value = 1
      phase.value = 'solo'
      return
    }

    contestants.value = shuffle(renderedContestants)
    setupRound(contestants.value)
    totalRounds.value = Math.ceil(Math.log2(contestants.value.length))
    phase.value = 'bracket'
  }

  // onPick(chosen, loser) lets the caller (page) log AI training data
  // before bracket state advances, without this composable needing to
  // know anything about AI training.
  function pick(chosen: TournamentContestant, onPick?: (chosen: TournamentContestant, loser: TournamentContestant) => void) {
    const pair = currentPairs.value[matchIndex.value]
    if (!pair) return
    const loser = pair[0] === chosen ? pair[1] : pair[0]

    onPick?.(chosen, loser)

    chosen.roundsSurvived++
    loser.dataUrl = null
    winners.value.push(chosen)
    matchIndex.value++

    if (matchIndex.value >= currentPairs.value.length) {
      if (winners.value.length === 1) {
        winner.value = winners.value[0]!
        phase.value = 'winner'
      } else {
        currentRound.value++
        setupRound(shuffle(winners.value))
      }
    }
  }

  function reset() {
    phase.value = 'upload'
    showLabels.value = null
    mode.value = null
    paletteValue.value = null
    serpentine.value = null
    doneCount.value = 0
    totalCount.value = 0
    contestants.value = []
    currentPairs.value = []
    winners.value = []
    matchIndex.value = 0
    currentRound.value = 1
    totalRounds.value = 1
    winner.value = null
  }

  return {
    phase,
    showLabels,
    mode,
    paletteValue,
    serpentine,
    doneCount,
    totalCount,
    contestants,
    currentPairs,
    winners,
    matchIndex,
    currentRound,
    totalRounds,
    winner,
    progressPct,
    currentMatch,
    roundProgressPct,
    willProduceSingleVariant,
    setupRound,
    startBracketWith,
    pick,
    reset
  }
}
