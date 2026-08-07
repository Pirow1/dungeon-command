import type { Action, GameEvent, GameState, MapDef, Unit, Vec } from './types'
import { SHRINE_ID, chebyshev, keyOf, livingUnits, unitById } from './types'
import { isStandable, landmarkPos, occupiedSet } from './map'
import { bestTileToward, distanceField, pathTo, reachable } from './pathfind'
import { hasLOS } from './los'
import { rollDamage } from './combat'

// ---------------------------------------------------------------------------
// The safety fence. Actions (especially LLM-produced ones) are UNTRUSTED.
// Every branch here clamps to something legal, so any structurally-valid
// action list resolves into a watchable, rule-abiding turn.
// ---------------------------------------------------------------------------

function enemiesOf(state: GameState, unit: Unit): Unit[] {
  return livingUnits(state).filter((u) => u.side !== unit.side)
}

function alliesOf(state: GameState, unit: Unit): Unit[] {
  return livingUnits(state).filter((u) => u.side === unit.side && u.id !== unit.id && !u.isStructure)
}

function nearestOf(unit: Unit, candidates: Unit[]): Unit | undefined {
  let best: Unit | undefined
  let bestD = Infinity
  for (const c of candidates) {
    const d = chebyshev(unit.pos, c.pos)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

function inAttackRange(map: MapDef, attacker: Unit, target: Unit, from?: Vec): boolean {
  const pos = from ?? attacker.pos
  const d = chebyshev(pos, target.pos)
  if (d > attacker.attack.range) return false
  if (attacker.attack.range > 1 && !hasLOS(map, pos, target.pos)) return false
  return true
}

function applyDamage(state: GameState, attacker: Unit, target: Unit, events: GameEvent[]): void {
  const dmg = rollDamage(state, attacker.attack.dmgMin, attacker.attack.dmgMax, target.defending)
  target.hp = Math.max(0, target.hp - dmg)
  state.stats.damageDealt[attacker.id] = (state.stats.damageDealt[attacker.id] ?? 0) + dmg
  if (target.id === SHRINE_ID) {
    events.push({ type: 'shrine_damaged', amount: dmg, hpAfter: target.hp })
  } else {
    events.push({ type: 'damage', targetId: target.id, amount: dmg, hpAfter: target.hp })
  }
  if (target.hp <= 0) {
    target.alive = false
    state.stats.kills[attacker.id] = (state.stats.kills[attacker.id] ?? 0) + 1
    events.push({ type: 'unit_died', unitId: target.id })
  }
}

function performAttack(map: MapDef, state: GameState, attacker: Unit, target: Unit, events: GameEvent[]): void {
  events.push({
    type: 'unit_attacked',
    unitId: attacker.id,
    targetId: target.id,
    ranged: attacker.attack.range > 1,
  })
  applyDamage(state, attacker, target, events)
}

// Move `unit` along the best legal interpretation of "go to dest", emitting a
// unit_moved event. Returns final position.
function moveToward(map: MapDef, state: GameState, unit: Unit, dest: Vec, events: GameEvent[]): Vec {
  const reach = reachable(map, state, unit.pos, unit.move, unit.id)
  let target: Vec | undefined
  if (reach.has(keyOf(dest))) {
    target = dest
  } else {
    const field = distanceField(map, dest)
    target = bestTileToward(reach, field)
  }
  if (!target || (target.x === unit.pos.x && target.y === unit.pos.y)) return unit.pos
  const path = pathTo(reach, target)
  if (!path.length) return unit.pos
  unit.pos = { ...target }
  events.push({ type: 'unit_moved', unitId: unit.id, path })
  return unit.pos
}

// Move into attack position against `target` if possible, else advance toward it.
// Returns true if an attack is possible from the final position.
function moveIntoRange(
  map: MapDef,
  state: GameState,
  unit: Unit,
  target: Unit,
  range: number,
  events: GameEvent[],
): boolean {
  const needsLOS = range > 1
  const okFrom = (from: Vec) =>
    chebyshev(from, target.pos) <= range && (!needsLOS || hasLOS(map, from, target.pos))

  if (okFrom(unit.pos)) return true

  const reach = reachable(map, state, unit.pos, unit.move, unit.id)
  let best: { pos: Vec; cost: number } | undefined
  for (const [, e] of reach) {
    if (!okFrom(e.pos)) continue
    if (!best || e.cost < best.cost) best = { pos: e.pos, cost: e.cost }
  }
  if (best) {
    const path = pathTo(reach, best.pos)
    if (path.length) {
      unit.pos = { ...best.pos }
      events.push({ type: 'unit_moved', unitId: unit.id, path })
    }
    return true
  }
  // No firing position reachable — advance toward the target instead.
  const field = distanceField(map, target.pos)
  const stepTo = bestTileToward(reach, field)
  if (stepTo && (stepTo.x !== unit.pos.x || stepTo.y !== unit.pos.y)) {
    const path = pathTo(reach, stepTo)
    if (path.length) {
      unit.pos = { ...stepTo }
      events.push({ type: 'unit_moved', unitId: unit.id, path })
    }
  }
  return okFrom(unit.pos)
}

function resolveTargetEnemy(state: GameState, unit: Unit, targetId?: string): Unit | undefined {
  if (targetId) {
    const t = unitById(state, targetId)
    if (t && t.alive && t.side !== unit.side) return t
  }
  // Clamp: unknown/dead/friendly target -> nearest enemy.
  return nearestOf(unit, enemiesOf(state, unit))
}

function resolveTargetAlly(state: GameState, unit: Unit, targetId?: string): Unit | undefined {
  if (targetId) {
    const t = unitById(state, targetId)
    if (t && t.alive && t.side === unit.side && !t.isStructure && t.id !== unit.id) return t
  }
  // Clamp: heal the most wounded ally (or self if everyone is fine).
  const wounded = alliesOf(state, unit)
    .concat([unit])
    .filter((a) => a.hp < a.maxHp)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
  return wounded[0]
}

function resolveDest(map: MapDef, action: Action): Vec | undefined {
  if (action.toLandmark) {
    const p = landmarkPos(map, action.toLandmark)
    if (p) return p
  }
  if (action.to && Number.isInteger(action.to.x) && Number.isInteger(action.to.y)) {
    return { x: action.to.x, y: action.to.y }
  }
  return undefined
}

// Landmark tiles (doors, shrine) may be unstandable or occupied; nudge to the
// nearest standable neighbor so "go to the shrine" means "stand beside it".
function nudgeDest(map: MapDef, state: GameState, dest: Vec, forUnitId: string): Vec {
  if (isStandable(map, dest) && !occupiedSet(state, forUnitId).has(keyOf(dest))) return dest
  const field = distanceField(map, dest)
  let best: { pos: Vec; d: number } | undefined
  const occ = occupiedSet(state, forUnitId)
  for (const [k, d] of field) {
    const [x, y] = k.split(',').map(Number)
    const p = { x, y }
    if (!isStandable(map, p) || occ.has(k)) continue
    if (!best || d < best.d) best = { pos: p, d }
  }
  return best?.pos ?? dest
}

export function resolveUnitAction(
  map: MapDef,
  state: GameState,
  action: Action,
  events: GameEvent[],
): void {
  const unit = unitById(state, action.unitId)
  if (!unit || !unit.alive || unit.isStructure) return

  // Defending lasts until the unit's next action.
  unit.defending = false

  if (action.radio) {
    events.push({
      type: 'chatter',
      unitId: unit.id,
      name: unit.name,
      text: action.radio,
      kind: unit.side === 'party' ? 'party' : 'monster',
    })
  }

  switch (action.type) {
    case 'wait':
      return
    case 'defend': {
      unit.defending = true
      events.push({ type: 'defend', unitId: unit.id })
      return
    }
    case 'heal': {
      if (!unit.heal) {
        // Non-healer told to heal -> clamp to defend.
        unit.defending = true
        events.push({ type: 'defend', unitId: unit.id })
        return
      }
      const ally = resolveTargetAlly(state, unit, action.targetId)
      if (!ally) return
      const inRange = () => chebyshev(unit.pos, ally.pos) <= unit.heal!.range
      if (!inRange()) moveToward(map, state, unit, ally.pos, events)
      if (inRange()) {
        const amount = Math.min(unit.heal.amount, ally.maxHp - ally.hp)
        if (amount > 0) {
          ally.hp += amount
          events.push({ type: 'heal', unitId: unit.id, targetId: ally.id, amount, hpAfter: ally.hp })
        }
      }
      return
    }
    case 'move': {
      const destRaw = resolveDest(map, action)
      if (!destRaw) {
        // "Move" with no destination -> hold ground defensively.
        unit.defending = true
        events.push({ type: 'defend', unitId: unit.id })
        return
      }
      moveToward(map, state, unit, nudgeDest(map, state, destRaw, unit.id), events)
      return
    }
    case 'attack':
    case 'move_attack': {
      const target = resolveTargetEnemy(state, unit, action.targetId)
      if (!target) {
        // Nothing to fight: follow the positional part if any, else defend.
        const destRaw = resolveDest(map, action)
        if (destRaw) moveToward(map, state, unit, nudgeDest(map, state, destRaw, unit.id), events)
        else {
          unit.defending = true
          events.push({ type: 'defend', unitId: unit.id })
        }
        return
      }
      const canAttack = moveIntoRange(map, state, unit, target, unit.attack.range, events)
      if (canAttack) performAttack(map, state, unit, target, events)
      return
    }
  }
}
