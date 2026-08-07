import type { Action, GameEvent, GameState } from './engine/types'
import { livingHeroes, unitById } from './engine/types'
import { LEVEL1 } from './data/level1'
import { initGame, resolveMonsterTurn, resolvePartyTurn } from './engine/turn'
import { summarize } from './engine/summary'
import { fallbackMonsterActions, fallbackPartyActions } from './ai/fallback'
import { fetchMonsterActions, fetchNarration, fetchPartyActions } from './ai/client'
import type { BeatSignal, GameScene } from './scenes/GameScene'
import * as hud from './ui/hud'
import * as chatter from './ui/chatter'
import * as history from './ui/history'
import type { Beat } from './ui/beat'
import { displayName, resetLabels } from './ui/labels'
import { MONSTER_DEFS } from './data/monsters'

// Orchestrates the whole turn loop:
//   order -> interpret (LLM) -> party resolve -> party animation
//        \-> (monster LLM fired in parallel with the animation)
//         -> monster resolve -> monster animation -> await next order

export class Controller {
  state!: GameState
  private scene: GameScene
  private busy = false
  noLLM = false

  constructor(scene: GameScene) {
    this.scene = scene
    scene.onChatter = (ev) => {
      const u = unitById(this.state, ev.unitId)
      const cls = u?.cls ?? 'goblin'
      const who = u ? displayName(u) : ev.name
      if (ev.kind === 'party') {
        chatter.heroSays(who, cls, ev.text)
      } else {
        chatter.monsterSays(who, cls, ev.text)
      }
    }
    // The hero cards show the mechanical action each hero just took ("Struck
    // Goblin", "Braced"); the flavour quote lives in the chatter log.
    scene.onAction = (unitId, text) => hud.noteAction(unitId, text)
    scene.onBeat = (b) => this.handleBeat(b)
    scene.onWave = (wave) => {
      hud.showBanner(wave >= this.state.totalWaves ? 'THE FINAL WAVE' : `WAVE ${wave}`)
      hud.updateHud(this.state)
      history.setChapter(wave, this.state.turn)
      history.logLine('system', `Wave ${wave} of ${this.state.totalWaves} pours through the doors.`)
      this.narrate(`Wave ${wave} of ${this.state.totalWaves} pours in.`)
    }
    scene.bindState(() => this.state)
  }

  // Every landed blow, at the frame it lands: written to the chatter feed and
  // the chronicle, and lit on both sides of the sidebar.
  private handleBeat(sig: BeatSignal): void {
    const actor = unitById(this.state, sig.actorId)
    const target = unitById(this.state, sig.targetId)
    if (!actor || !target) return
    const beat: Beat = {
      kind: sig.kind,
      actorId: actor.id,
      actorName: displayName(actor),
      actorCls: actor.cls,
      actorSide: actor.side,
      targetId: target.id,
      targetName: sig.kind === 'shrine' ? 'the Shrine' : displayName(target),
      targetCls: target.cls,
      amount: sig.amount,
      hpAfter: sig.hpAfter,
      ranged: sig.ranged,
      killed: sig.killed,
    }
    chatter.beatHappened(beat)
    hud.pulseActor(actor.id)
    hud.pulseTarget(target.id, sig.hpAfter, target.maxHp, sig.kind === 'heal')
    if (sig.killed) {
      hud.markSlain(target.id)
      if (target.side === 'party') history.logLine('system', `${target.name} has fallen.`)
    }
  }

  newGame(seed?: number): void {
    const { state, events } = initGame(LEVEL1, seed ?? ((Math.random() * 1e9) | 0))
    this.state = state
    resetLabels()
    history.resetHistory()
    history.setChapter(1, 1)
    chatter.clearChatter()
    this.scene.syncUnits(state)
    hud.updateHud(state)
    hud.setPhase('awaiting')
    // The opening wave is already on the board; let the banner announce it.
    const waveEv = events.find((e) => e.type === 'wave_spawned')
    if (waveEv && waveEv.type === 'wave_spawned') {
      hud.showBanner('WAVE 1')
      history.logLine('system', 'Wave 1 pours through the doors.')
      this.narrate('The first goblins slip through the doors of Emberdeep.')
    }
  }

  private async narrate(context: string): Promise<void> {
    if (this.noLLM) return
    const res = await fetchNarration(context)
    if (res?.text) chatter.narratorSays(res.text)
  }

  async submitOrder(orderText: string): Promise<void> {
    if (this.busy || this.state.outcome !== 'ongoing') return
    this.busy = true
    try {
      history.setChapter(this.state.wave, this.state.turn)
      chatter.youSaid(orderText)
      hud.setPhase('scrying')

      // 1. Interpret the order (or fall back to heuristics).
      let partyActions: Action[]
      if (this.noLLM) {
        partyActions = fallbackPartyActions(this.state)
      } else {
        const res = await fetchPartyActions(orderText, summarize(LEVEL1, this.state))
        partyActions = res?.actions?.length ? res.actions : fallbackPartyActions(this.state)
      }

      // 2. Resolve party turn (includes any new wave spawning at the end).
      const partyEvents = resolvePartyTurn(LEVEL1, this.state, partyActions)

      // 3. Fire the monster brain NOW — it thinks while the heroes animate.
      let taunt: { unitId: string; text: string } | null = null
      const monsterPromise: Promise<Action[]> =
        this.state.outcome !== 'ongoing'
          ? Promise.resolve([])
          : this.noLLM
            ? Promise.resolve(fallbackMonsterActions(this.state))
            : fetchMonsterActions(summarize(LEVEL1, this.state)).then((res) => {
                if (!res?.actions?.length) return fallbackMonsterActions(this.state)
                if (res.taunt?.text) taunt = res.taunt
                return res.actions
              })

      hud.setPhase('heroes')
      await this.scene.playEvents(this.state, partyEvents)
      hud.updateHud(this.state)
      if (this.checkGameOver()) return

      // 4. Monsters act.
      hud.setPhase('horde')
      const monsterActions = await monsterPromise
      const t = taunt as { unitId: string; text: string } | null
      if (t) {
        const m = unitById(this.state, t.unitId)
        if (m?.alive) chatter.monsterSays(displayName(m), m.cls, t.text)
      }
      const monsterEvents = resolveMonsterTurn(LEVEL1, this.state, monsterActions)
      await this.scene.playEvents(this.state, monsterEvents)
      hud.updateHud(this.state)
      if (this.checkGameOver()) return

      hud.setPhase('awaiting')
    } finally {
      this.busy = false
    }
  }

  // Debug helper: run a turn with explicit party actions, no LLM.
  async runActions(partyActions: Action[]): Promise<void> {
    if (this.busy || this.state.outcome !== 'ongoing') return
    this.busy = true
    try {
      hud.setPhase('heroes')
      const partyEvents = resolvePartyTurn(LEVEL1, this.state, partyActions)
      await this.scene.playEvents(this.state, partyEvents)
      hud.updateHud(this.state)
      if (this.checkGameOver()) return
      hud.setPhase('horde')
      const monsterEvents = resolveMonsterTurn(LEVEL1, this.state, fallbackMonsterActions(this.state))
      await this.scene.playEvents(this.state, monsterEvents)
      hud.updateHud(this.state)
      if (this.checkGameOver()) return
      hud.setPhase('awaiting')
    } finally {
      this.busy = false
    }
  }

  private checkGameOver(): boolean {
    if (this.state.outcome === 'ongoing') return false
    history.logLine(
      'system',
      this.state.outcome === 'victory' ? 'The shrine stands. The horde is broken.' : 'Emberdeep falls to the dark.',
    )
    if (this.state.outcome === 'victory') {
      this.scene.celebrateHeroes()
      this.narrate('The last monster falls. The shrine stands. Victory.')
      setTimeout(() => hud.showEnd(this.state), 1400)
    } else {
      this.narrate(
        livingHeroes(this.state).length === 0
          ? 'The last hero has fallen. The orb goes dark.'
          : 'The shrine is shattered. Darkness pours from the deep.',
      )
      setTimeout(() => hud.showEnd(this.state), 1400)
    }
    return true
  }
}

export type { GameEvent }
export { MONSTER_DEFS }
