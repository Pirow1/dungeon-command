import Phaser from 'phaser'
import type { GameEvent, GameState, Unit, Vec } from '../engine/types'
import { unitById } from '../engine/types'
import { LEVEL1 } from '../data/level1'
import { reachable } from '../engine/pathfind'
import { CELL, FRAMES, SHEET, UNIT_FRAME } from '../spritemap'
import { HEROES } from '../data/heroes'
import { sfx } from '../ui/sfx'
import { displayName } from '../ui/labels'

interface UnitView {
  root: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite
  hpBar: Phaser.GameObjects.Graphics
  unitId: string
  bob?: Phaser.Tweens.Tween
}

// One concrete exchange, raised at the exact frame it lands on screen so the
// log, the chatter and the sidebar all move with the animation.
export interface BeatSignal {
  kind: 'attack' | 'heal' | 'shrine'
  actorId: string
  targetId: string
  amount: number
  hpAfter: number
  ranged: boolean
  killed: boolean
}

const px = (t: number) => t * CELL + CELL / 2

export class GameScene extends Phaser.Scene {
  private views = new Map<string, UnitView>()
  private rangeOverlay!: Phaser.GameObjects.Graphics
  private speed = 1
  private getState: (() => GameState) | null = null
  onChatter: ((ev: Extract<GameEvent, { type: 'chatter' }>) => void) | null = null
  onWave: ((wave: number) => void) | null = null
  onAction: ((unitId: string, text: string) => void) | null = null
  onBeat: ((beat: BeatSignal) => void) | null = null

  constructor() {
    super('game')
  }

  setSpeed(fast: boolean): void {
    this.speed = fast ? 0.15 : 1
  }

  bindState(getter: () => GameState): void {
    this.getState = getter
  }

  create(): void {
    this.drawMap()
    this.rangeOverlay = this.add.graphics().setDepth(4)
    this.game.events.emit('scene-ready', this)
  }

  private drawMap(): void {
    const m = LEVEL1
    const floorVariants = [
      FRAMES.floor,
      FRAMES.floor,
      FRAMES.floor,
      FRAMES.floorAlt,
      FRAMES.floorAlt,
      FRAMES.floorPebble,
      FRAMES.floor,
      FRAMES.floorRubble,
    ]
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const kind = m.tiles[y][x]
        const hash = (x * 73856093) ^ (y * 19349663)
        let frame: number
        let tint = 0xffffff

        if (kind === 'wall') {
          frame = FRAMES.wall
          // Only decorate walls that actually face a walkable tile, and keep it
          // sparse — repeated gargoyles read as noise.
          const facesFloor = (m.tiles[y + 1]?.[x] ?? 'wall') !== 'wall'
          if (facesFloor && Math.abs(hash) % 6 === 0) frame = FRAMES.wallTorch
          else if (facesFloor && Math.abs(hash) % 17 === 0) frame = FRAMES.wallGargoyle
          tint = 0x8a8fa8 // cool, dim stone
        } else if (kind === 'door') {
          frame = FRAMES.door
        } else if (kind === 'shrine') {
          frame = FRAMES.altar
        } else {
          frame = floorVariants[Math.abs(hash) % floorVariants.length]
          tint = 0x9a8c86
        }

        this.add.image(px(x), px(y), SHEET, frame).setScale(CELL / 16).setDepth(0).setTint(tint)

        if (frame === FRAMES.wallTorch) {
          const glow = this.add
            .circle(px(x), px(y) + 10, 46, 0xff9a3c, 0.1)
            .setDepth(1)
            .setBlendMode(Phaser.BlendModes.ADD)
          this.tweens.add({
            targets: glow,
            alpha: { from: 1, to: 0.45 },
            scale: { from: 1, to: 0.9 },
            duration: 780 + (Math.abs(hash) % 500),
            yoyo: true,
            repeat: -1,
          })
        }
        if (kind === 'shrine') {
          const glow = this.add
            .circle(px(x), px(y), 40, 0x64e8d0, 0.13)
            .setDepth(1)
            .setBlendMode(Phaser.BlendModes.ADD)
          this.tweens.add({ targets: glow, alpha: { from: 1, to: 0.35 }, scale: { from: 1.05, to: 0.85 }, duration: 1900, yoyo: true, repeat: -1 })
        }
      }
    }
    this.drawVignette()
  }

  // Darkens the map edges so the play area reads as torch-lit depth.
  private drawVignette(): void {
    const w = LEVEL1.width * CELL
    const h = LEVEL1.height * CELL
    const g = this.add.graphics().setDepth(7)
    const band = 5
    for (let i = 0; i < band; i++) {
      const alpha = 0.13 * (1 - i / band)
      const inset = i * 26
      g.lineStyle(28, 0x05040a, alpha)
      g.strokeRect(inset - 14, inset - 14, w - inset * 2 + 28, h - inset * 2 + 28)
    }
  }

  // -- unit sprites ---------------------------------------------------------

  syncUnits(state: GameState): void {
    for (const u of state.units) {
      if (!u.alive) continue
      if (!this.views.has(u.id)) this.createView(u)
    }
    this.refreshBars(state)
  }

  private createView(u: Unit): void {
    if (u.isStructure) {
      // The shrine is painted into the map itself; it only needs a health bar.
      const bar = this.add.graphics()
      const root = this.add.container(px(u.pos.x), px(u.pos.y), [bar])
      root.setDepth(3)
      const view: UnitView = { root, sprite: this.add.sprite(-9999, -9999, SHEET, 0), hpBar: bar, unitId: u.id }
      this.views.set(u.id, view)
      this.drawHpBar(view, u)
      return
    }
    const sprite = this.add.sprite(0, 0, SHEET, UNIT_FRAME[u.cls] ?? FRAMES.goblin)
    sprite.setScale((CELL / 16) * (u.cls === 'demon' ? 1.3 : u.cls === 'orc' ? 1.12 : 1))
    // Allegiance ring under the feet — the pixel sprites are all similar
    // humanoids, so colour is what makes friend/foe readable at a glance.
    const isParty = u.side === 'party'
    const ringColor = isParty ? 0xffc451 : 0xff4a3a
    const ring = this.add.ellipse(0, 20, 38, 15, ringColor, 0.3).setBlendMode(Phaser.BlendModes.ADD)
    const ringEdge = this.add.ellipse(0, 20, 36, 14).setStrokeStyle(2, ringColor, 0.95)
    const hpBar = this.add.graphics()
    const root = this.add.container(px(u.pos.x), px(u.pos.y), [ring, ringEdge, sprite, hpBar])
    root.setDepth(3)
    const view: UnitView = { root, sprite, hpBar, unitId: u.id }
    view.bob = this.tweens.add({
      targets: sprite,
      y: { from: -1.5, to: 1.5 },
      duration: 700 + ((u.id.charCodeAt(0) * 53) % 500),
      yoyo: true,
      repeat: -1,
      ease: 'sine.inout',
    })
    sprite.setInteractive({ useHandCursor: false })
    sprite.on('pointerover', () => this.showRanges(u.id))
    sprite.on('pointerout', () => this.rangeOverlay.clear())
    if (u.side === 'monsters') sprite.setFlipX(true)
    this.views.set(u.id, view)
    this.drawHpBar(view, u)
    // pop-in
    root.setScale(0)
    this.tweens.add({ targets: root, scale: 1, duration: 220, ease: 'back.out' })
  }

  private drawHpBar(view: UnitView, u: Unit): void {
    const g = view.hpBar
    g.clear()
    if (!u.alive) return
    const w = u.isStructure ? 40 : 34
    const ratio = Math.max(0, u.hp / u.maxHp)
    // The shrine's bar hangs below the altar; heroes stand on top of it.
    const yOff = u.isStructure ? 24 : -28
    g.fillStyle(0x000000, 0.7).fillRect(-w / 2 - 1, yOff - 1, w + 2, 6)
    const color = u.side === 'party' ? (u.isStructure ? 0x2e9e8e : 0x57d977) : 0xe05545
    g.fillStyle(color, 1).fillRect(-w / 2, yOff, w * ratio, 4)
  }

  refreshBars(state: GameState): void {
    for (const [id, view] of this.views) {
      const u = unitById(state, id)
      if (u) this.drawHpBar(view, u)
    }
  }

  private showRanges(unitId: string): void {
    if (!this.getState) return
    const state = this.getState()
    const u = unitById(state, unitId)
    if (!u || !u.alive || u.isStructure) return
    const g = this.rangeOverlay
    g.clear()
    const reach = reachable(LEVEL1, state, u.pos, u.move, u.id)
    g.fillStyle(u.side === 'party' ? 0x6fb8ff : 0xff7060, 0.16)
    for (const [, e] of reach) {
      g.fillRect(e.pos.x * CELL + 3, e.pos.y * CELL + 3, CELL - 6, CELL - 6)
    }
    g.lineStyle(2, u.side === 'party' ? 0x6fb8ff : 0xff7060, 0.5)
    g.strokeRect(u.pos.x * CELL + 2, u.pos.y * CELL + 2, CELL - 4, CELL - 4)
  }

  // -- event playback -------------------------------------------------------

  // When the tab is hidden the browser pauses rAF and Phaser's clock with it.
  // Fall back to wall-clock waits and snap tweens to their end state so turns
  // always resolve, even if the player tabs away mid-animation.
  private wait(ms: number): Promise<void> {
    // Microtask, not setTimeout: hidden tabs throttle chained timers to 1/min.
    if (document.hidden) return Promise.resolve()
    return new Promise((r) => this.time.delayedCall(ms * this.speed, r))
  }

  private tweenP(cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    if (document.hidden) {
      const targets = (Array.isArray(cfg.targets) ? cfg.targets : [cfg.targets]) as Record<string, unknown>[]
      if (!cfg.yoyo) {
        for (const t of targets) {
          for (const k of ['x', 'y', 'alpha', 'scale', 'angle'] as const) {
            const v = (cfg as Record<string, unknown>)[k]
            if (typeof v === 'number') t[k] = v
          }
        }
      }
      return Promise.resolve()
    }
    return new Promise((r) => {
      this.tweens.add({ ...cfg, duration: (cfg.duration as number) * this.speed, onComplete: () => r() })
    })
  }

  // Human-readable summary of each unit's action, keyed by unit id. Attack/heal
  // outrank move so a unit that moves-then-strikes reads as "Struck Goblin",
  // not "Advanced". Shown as a floating tag above the unit and on its card.
  private describeActions(state: GameState, events: GameEvent[]): Map<string, string> {
    const nameOf = (id: string) => {
      const u = unitById(state, id)
      return u ? displayName(u) : id
    }
    const desc = new Map<string, string>()
    const rank = new Map<string, number>()
    const put = (id: string, r: number, text: string) => {
      if ((rank.get(id) ?? 0) <= r) {
        rank.set(id, r)
        desc.set(id, text)
      }
    }
    for (const ev of events) {
      switch (ev.type) {
        case 'unit_attacked':
          put(ev.unitId, 3, `${ev.ranged ? 'Shot' : 'Struck'} ${nameOf(ev.targetId)}`)
          break
        case 'heal':
          put(ev.unitId, 3, ev.unitId === ev.targetId ? 'Healed self' : `Healed ${nameOf(ev.targetId)}`)
          break
        case 'defend':
          put(ev.unitId, 2, 'Braced')
          break
        case 'unit_moved':
          put(ev.unitId, 1, 'Advanced')
          break
      }
    }
    return desc
  }

  async playEvents(state: GameState, events: GameEvent[]): Promise<void> {
    const actionDesc = this.describeActions(state, events)
    const announced = new Set<string>()
    // Damage/death events name only the victim; the blow that caused them is the
    // unit_attacked immediately before, so remember who swung.
    let atkId: string | null = null
    let atkRanged = false
    // The moment a unit first stirs, call out what it is about to do.
    const announce = (unitId: string) => {
      if (announced.has(unitId)) return
      announced.add(unitId)
      const text = actionDesc.get(unitId)
      if (!text) return
      const u = unitById(state, unitId)
      const view = this.views.get(unitId)
      if (u && view) this.floatAction(view, text, u.side === 'party')
      if (u?.side === 'party') this.onAction?.(unitId, text)
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      const next = events[i + 1]
      switch (ev.type) {
        case 'chatter':
          this.onChatter?.(ev)
          break
        case 'wave_spawned': {
          this.onWave?.(ev.wave)
          sfx('door')
          sfx('wave')
          await this.wait(360)
          this.syncUnits(state)
          this.cameras.main.shake(240 * this.speed, 0.004)
          await this.wait(760)
          break
        }
        case 'unit_moved': {
          announce(ev.unitId)
          const view = this.views.get(ev.unitId)
          if (!view) break
          for (const step of ev.path) {
            await this.tweenP({ targets: view.root, x: px(step.x), y: px(step.y), duration: 130, ease: 'sine.inout' })
          }
          await this.wait(180)
          break
        }
        case 'unit_attacked': {
          announce(ev.unitId)
          atkId = ev.unitId
          atkRanged = ev.ranged
          const atk = this.views.get(ev.unitId)
          const tgt = this.views.get(ev.targetId)
          if (!atk || !tgt) break
          // Name the pair before the blow: a line drawn between them and a
          // reticle closing on the target, so the eye is already there.
          this.markEngagement(atk, tgt, unitById(state, ev.unitId)?.side === 'party')
          await this.wait(90)
          if (ev.ranged) {
            const unit = unitById(state, ev.unitId)
            const isMagic = unit?.cls === 'mage' || unit?.cls === 'demon'
            sfx(isMagic ? 'magic' : 'arrow')
            const proj = this.add
              .circle(atk.root.x, atk.root.y, isMagic ? 6 : 4, isMagic ? 0xffa030 : 0xe8dcc0)
              .setDepth(5)
            if (isMagic) proj.setBlendMode(Phaser.BlendModes.ADD)
            await this.tweenP({ targets: proj, x: tgt.root.x, y: tgt.root.y, duration: 210, ease: 'quad.in' })
            proj.destroy()
          } else {
            sfx('melee')
            const dx = (tgt.root.x - atk.root.x) * 0.35
            const dy = (tgt.root.y - atk.root.y) * 0.35
            await this.tweenP({ targets: atk.root, x: atk.root.x + dx, y: atk.root.y + dy, duration: 130, yoyo: true, ease: 'quad.out' })
          }
          break
        }
        case 'damage':
        case 'shrine_damaged': {
          const id = ev.type === 'damage' ? ev.targetId : 'shrine'
          const killed = next?.type === 'unit_died' && next.unitId === id
          const view = this.views.get(id)
          if (view) {
            view.sprite.setTintFill(0xffffff)
            this.time.delayedCall(120 * this.speed, () => view.sprite.clearTint())
            // Heavier blows print bigger — a 7 should not look like a 2.
            this.floatText(view.root.x, view.root.y - 26, `-${ev.amount}`, '#ff6b5a', 18 + Math.min(ev.amount, 8) * 1.6)
            this.impact(view.root.x, view.root.y, 0xff7a5a)
            const u = unitById(state, id)
            if (u) this.drawHpBar(view, u)
          }
          if (ev.type === 'shrine_damaged') {
            sfx('shrine_hit')
            this.cameras.main.shake(200 * this.speed, 0.006)
          } else {
            sfx('hit')
          }
          if (atkId) {
            this.onBeat?.({
              kind: ev.type === 'damage' ? 'attack' : 'shrine',
              actorId: atkId,
              targetId: id,
              amount: ev.amount,
              hpAfter: ev.hpAfter,
              ranged: atkRanged,
              killed,
            })
          }
          await this.wait(300)
          break
        }
        case 'heal': {
          announce(ev.unitId)
          sfx('heal')
          this.onBeat?.({
            kind: 'heal',
            actorId: ev.unitId,
            targetId: ev.targetId,
            amount: ev.amount,
            hpAfter: ev.hpAfter,
            ranged: false,
            killed: false,
          })
          const view = this.views.get(ev.targetId)
          if (view) {
            this.floatText(view.root.x, view.root.y - 26, `+${ev.amount}`, '#6fcf6f')
            const glow = this.add.circle(view.root.x, view.root.y, 22, 0x6fcf6f, 0.35).setDepth(5).setBlendMode(Phaser.BlendModes.ADD)
            this.tweens.add({ targets: glow, alpha: 0, scale: 1.6, duration: 500 * this.speed, onComplete: () => glow.destroy() })
            const u = unitById(state, ev.targetId)
            if (u) this.drawHpBar(view, u)
          }
          await this.wait(320)
          break
        }
        case 'defend': {
          announce(ev.unitId)
          sfx('defend')
          const view = this.views.get(ev.unitId)
          if (view) {
            const s = this.add.image(view.root.x, view.root.y - 20, SHEET, FRAMES.shield).setScale(1.6).setDepth(5).setAlpha(0)
            this.tweens.add({ targets: s, alpha: { from: 0, to: 1 }, y: view.root.y - 30, duration: 300 * this.speed, yoyo: true, onComplete: () => s.destroy() })
          }
          await this.wait(280)
          break
        }
        case 'unit_died': {
          const view = this.views.get(ev.unitId)
          if (view) {
            sfx('die')
            view.bob?.stop()
            const u = unitById(state, ev.unitId)
            const big = u?.cls === 'demon' || u?.isStructure
            this.floatText(view.root.x, view.root.y - 44, 'SLAIN', u?.side === 'party' ? '#ff8a7a' : '#ffd67a', 20)
            this.killPunch()
            this.cameras.main.shake((big ? 320 : 130) * this.speed, big ? 0.008 : 0.003)
            view.sprite.setTintFill(0xff4030)
            await this.tweenP({ targets: view.root, alpha: 0, angle: u?.isStructure ? 0 : 90, scale: 0.6, duration: 330, ease: 'quad.in' })
            view.root.destroy()
            this.views.delete(ev.unitId)
          }
          break
        }
        case 'game_over':
          await this.wait(500)
          break
      }
    }
    this.refreshBars(state)
  }

  // Draws the engagement itself: a taut line between the two units and a
  // reticle collapsing onto the target. The pair reads as a pair.
  private markEngagement(atk: UnitView, tgt: UnitView, byParty: boolean): void {
    if (document.hidden) return
    const color = byParty ? 0xffd67a : 0xff6a55
    const link = this.add.graphics().setDepth(6)
    link.lineStyle(2, color, 0.55)
    link.lineBetween(atk.root.x, atk.root.y, tgt.root.x, tgt.root.y)
    this.tweens.add({ targets: link, alpha: 0, duration: 420 * this.speed, ease: 'quad.in', onComplete: () => link.destroy() })

    const ring = this.add.circle(tgt.root.x, tgt.root.y, 26).setStrokeStyle(2, color, 0.95).setDepth(6)
    ring.setScale(1.9)
    this.tweens.add({
      targets: ring,
      scale: 0.85,
      alpha: 0.15,
      duration: 260 * this.speed,
      ease: 'quad.out',
      onComplete: () => ring.destroy(),
    })
  }

  // Sparks thrown off the point of impact.
  private impact(x: number, y: number, color: number): void {
    if (document.hidden) return
    for (let i = 0; i < 7; i++) {
      const a = (Math.PI * 2 * i) / 7 + Math.random() * 0.6
      const dist = 18 + Math.random() * 14
      const shard = this.add.circle(x, y, 3, color).setDepth(6).setBlendMode(Phaser.BlendModes.ADD)
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        alpha: 0,
        scale: 0.2,
        duration: (260 + Math.random() * 160) * this.speed,
        ease: 'quad.out',
        onComplete: () => shard.destroy(),
      })
    }
  }

  // A short lean-in on a kill. Subtle: the map is framed exactly to the camera,
  // so anything stronger than this crops the edges.
  //
  // Camera effects resolve their ease through a strict lookup table, not the
  // tween parser — a tween-style 'quad.out' here leaves the effect with no ease
  // function and throws inside the game step, which stalls playback outright.
  private killPunch(): void {
    if (document.hidden) return
    const cam = this.cameras.main
    cam.zoomTo(1.035, 110 * this.speed, Phaser.Math.Easing.Quadratic.Out)
    this.time.delayedCall(300 * this.speed, () => cam.zoomTo(1, 320 * this.speed, Phaser.Math.Easing.Sine.InOut))
  }

  private floatText(x: number, y: number, text: string, color: string, size = 20): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'Cinzel, serif',
        fontSize: `${size}px`,
        color,
        stroke: '#000000',
        strokeThickness: 4,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(6)
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 750 * this.speed, ease: 'quad.out', onComplete: () => t.destroy() })
  }

  // A labelled banner above a unit naming the action it is taking ("Struck
  // Goblin", "Braced"). Held longer than damage numbers so it stays readable,
  // and given a quick pop on the sprite so the eye lands on the actor.
  private floatAction(view: UnitView, text: string, party: boolean): void {
    const x = view.root.x
    const y = view.root.y - 40
    const color = party ? '#ffd67a' : '#ff9a8f'
    const label = this.add
      .text(x, y, text, {
        fontFamily: 'Cinzel, serif',
        fontSize: '14px',
        color,
        stroke: '#000000',
        strokeThickness: 4,
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(7)
      .setAlpha(0)
    this.tweens.add({
      targets: label,
      alpha: { from: 0, to: 1 },
      y: y - 8,
      duration: 160 * this.speed,
      ease: 'back.out',
    })
    this.tweens.add({
      targets: label,
      alpha: 0,
      delay: 850 * this.speed,
      duration: 300 * this.speed,
      onComplete: () => label.destroy(),
    })
    // quick emphasis pop on the acting sprite
    this.tweens.add({
      targets: view.sprite,
      scaleX: view.sprite.scaleX * 1.18,
      scaleY: view.sprite.scaleY * 1.18,
      duration: 130 * this.speed,
      yoyo: true,
      ease: 'quad.out',
    })
  }

  celebrateHeroes(): void {
    for (const h of HEROES) {
      const view = this.views.get(h.id)
      if (!view) continue
      this.tweens.add({ targets: view.root, y: view.root.y - 10, duration: 160, yoyo: true, repeat: 3, ease: 'quad.out' })
    }
  }
}

export type { Vec }
