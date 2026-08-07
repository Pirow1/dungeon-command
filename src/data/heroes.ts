import type { Unit } from '../engine/types'

// The four heroes of the Order. Personalities are one-liners fed to the LLM;
// canned lines are the no-LLM fallback voice.
export interface HeroDef extends Omit<Unit, 'pos'> {
  cannedLines: string[]
  color: number
}

export const HEROES: HeroDef[] = [
  {
    id: 'brannor',
    name: 'Brannor',
    cls: 'fighter',
    side: 'party',
    hp: 22,
    maxHp: 22,
    move: 3,
    attack: { range: 1, dmgMin: 4, dmgMax: 6 },
    defending: false,
    alive: true,
    personality:
      'Brannor, dwarf fighter. Gung-ho, loud, loves a scrap, calls monsters "wee beasties". Speaks with dwarvish gusto.',
    cannedLines: ['Aye, crackin\' skulls!', 'For the Order!', 'Come get some, beasties!', 'Hold fast!'],
    color: 0xd98e04,
  },
  {
    id: 'sylvia',
    name: 'Sylvia',
    cls: 'archer',
    side: 'party',
    hp: 15,
    maxHp: 15,
    move: 4,
    attack: { range: 6, dmgMin: 3, dmgMax: 5 },
    defending: false,
    alive: true,
    personality:
      'Sylvia, rogue archer. Dry, sarcastic, acts unimpressed by everything, secretly loyal. Short quips.',
    cannedLines: ['Fine. On it.', 'Another glorious plan.', 'Loosing arrows, hooray.', 'You owe me for this.'],
    color: 0x4caf50,
  },
  {
    id: 'pip',
    name: 'Pip',
    cls: 'mage',
    side: 'party',
    hp: 13,
    maxHp: 13,
    move: 3,
    attack: { range: 5, dmgMin: 5, dmgMax: 7 },
    defending: false,
    alive: true,
    personality:
      'Pip, rookie mage. Nervous, stammers, apologizes a lot, but his firebolts hit HARD. Easily startled.',
    cannedLines: ['O-okay, casting now!', 'Please work, please work...', 'S-sorry! Firebolt!', 'Was that good?'],
    color: 0x7e57c2,
  },
  {
    id: 'mira',
    name: 'Mira',
    cls: 'cleric',
    side: 'party',
    hp: 15,
    maxHp: 15,
    move: 3,
    attack: { range: 1, dmgMin: 2, dmgMax: 3 },
    heal: { range: 3, amount: 6 },
    defending: false,
    alive: true,
    personality:
      'Mira, battle cleric. Calm, warm, unshakeable. Speaks softly even mid-battle. Protective of Pip.',
    cannedLines: ['The Light holds.', 'I am with you.', 'Breathe. I have you.', 'Stand tall, friends.'],
    color: 0xeceff1,
  },
]
