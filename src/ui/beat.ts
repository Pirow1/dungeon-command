// A "beat" is one concrete exchange between the party and the horde: a blow
// landing, a wound closed, the shrine taking a hit. The flavour chatter says
// what a hero FEELS; the beat says what actually happened to whom.

import { portraitFor } from './hud'

export interface Beat {
  kind: 'attack' | 'heal' | 'shrine'
  actorId: string
  actorName: string
  actorCls: string
  actorSide: 'party' | 'monsters'
  targetId: string
  targetName: string
  targetCls: string
  amount: number
  hpAfter: number
  ranged: boolean
  killed: boolean
}

// One verb per class so the log reads like a battle account, not a spreadsheet.
const MELEE_VERB: Record<string, string> = {
  fighter: 'cleaves',
  archer: 'cuts',
  mage: 'lashes',
  cleric: 'smites',
  goblin: 'slashes',
  skeleton: 'claws',
  orc: 'smashes',
  demon: 'rends',
}

const RANGED_VERB: Record<string, string> = {
  archer: 'looses on',
  mage: 'scorches',
  skeleton: 'shoots',
  demon: 'blasts',
}

export function beatVerb(b: Beat): string {
  if (b.kind === 'heal') return b.actorId === b.targetId ? 'binds' : 'mends'
  if (b.ranged) return RANGED_VERB[b.actorCls] ?? 'strikes'
  return MELEE_VERB[b.actorCls] ?? 'strikes'
}

export function beatText(b: Beat): string {
  const target = b.kind === 'heal' && b.actorId === b.targetId ? 'their own wounds' : b.targetName
  const delta = b.kind === 'heal' ? `+${b.amount}` : `-${b.amount}`
  return `${b.actorName} ${beatVerb(b)} ${target} ${delta}${b.killed ? ' — slain' : ''}`
}

function portrait(cls: string): string {
  const src = portraitFor(cls)
  return src ? `<img src="${src}" alt="" />` : ''
}

export function beatHtml(b: Beat): string {
  const heal = b.kind === 'heal'
  const selfHeal = heal && b.actorId === b.targetId
  const actorTone = b.actorSide === 'party' ? 'ally' : 'foe'
  const targetTone = b.kind === 'shrine' ? 'shrine' : b.actorSide === 'party' ? (heal ? 'ally' : 'foe') : heal ? 'foe' : 'ally'
  const target = selfHeal
    ? '<b class="tgt ally">their own wounds</b>'
    : `${portrait(b.targetCls)}<b class="tgt ${targetTone}">${b.targetName}</b>`
  return (
    `${portrait(b.actorCls)}<b class="act ${actorTone}">${b.actorName}</b>` +
    `<span class="verb">${beatVerb(b)}</span>` +
    target +
    `<span class="amt ${heal ? 'up' : 'down'}">${heal ? '+' : '−'}${b.amount}</span>` +
    (b.killed ? '<span class="slain">slain</span>' : '')
  )
}
