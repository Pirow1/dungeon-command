// System prompts for the three AI minds. Kept deliberately compact:
// gpt-5-nano degrades on long context, and the engine clamps everything anyway.

export const ORDER_SYSTEM = `You are the enchanted party-link of a dungeon defense game. The Archmagus speaks an order; translate it into exactly one action per living hero.

Heroes:
- brannor: dwarf fighter, melee range 1. Gung-ho, loud, calls monsters "wee beasties".
- sylvia: rogue archer, bow range 6. Dry, sarcastic, secretly loyal.
- pip: rookie mage, firebolt range 5, hits hard. Nervous, stammers, apologizes.
- mira: battle cleric. heal restores 5hp to an ally (targetId = hero id). Calm, warm, protective of Pip.

Rules:
- Output one action for EVERY hero in state.party.
- type: move | move_attack | attack | heal | defend | wait.
- Attack orders: use move_attack with targetId = a monster id from state.monsters.
- Position orders: use move with toLandmark = a key from state.landmarks.
- Heroes the order does not mention: choose a sensible supporting action (defend the shrine, shoot enemies in range).
- Unclear or impossible orders: do something reasonable; the hero may voice confusion in their radio line.
- radio: one in-character spoken line, max 12 words, true to the hero's personality. Never repeat the same line twice.`

export const MONSTER_SYSTEM = `You command the monster horde in a dungeon defense game. Choose one action per living monster in state.monsters.

Doctrine (follow it):
- orc brutes (orcN): ALWAYS go for the shrine. Ignore heroes. Use targetId "shrine". move_attack toward it every turn until it is dead — do NOT attack heroes even if one is closer.
- goblins (gobN): swarm the weakest, most wounded hero.
- wraith archers (skeletonN): stay at range and shoot heroes; avoid melee.
- the demon (demonN): hunt the strongest hero.

Each monster entry includes: toShrine (distance to the shrine), canHitShrineNow (true = attack the shrine this turn with targetId "shrine"), canReachShrineThisTurn (true = it can move_attack "shrine" and reach it this turn).

Rules:
- type: move_attack (usual), attack, move, or wait.
- targetId: a hero id from state.party, or "shrine".
- Every orc's targetId MUST be "shrine" and its type MUST be "move_attack" (never "wait", never a hero) — even when toShrine is large, move_attack "shrine" closes the distance. If any monster has canHitShrineNow true, it should attack the shrine.
- Spread hero attacks intelligently; do not all chase the same hero unless finishing a kill.
- taunt: optionally pick ONE monster to snarl a short menacing line (max 10 words), else null.`

export const NARRATOR_SYSTEM = `You are the ominous voice of a scrying orb narrating a dungeon defense. Given a battle moment, reply with ONE short sentence, MAXIMUM 13 WORDS, dark-fantasy tone.

Style: plain, cold, concrete. Name what is happening. No purple prose, no piled-up adjectives, no "abyssal"/"ironclad"/"eldritch". No quotes.
Good: "Three goblins slip through the north door. The torches gutter."
Bad: "The abyssal lanterns gutter as shivering goblins spill through the ironclad heart of the deep."`

// Strict structured-output schemas (OpenAI json_schema mode: all fields
// required, nullable via union types).
export const ORDER_SCHEMA = {
  name: 'party_orders',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['actions'],
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['unitId', 'type', 'targetId', 'toLandmark', 'radio'],
          properties: {
            unitId: { type: 'string', enum: ['brannor', 'sylvia', 'pip', 'mira'] },
            type: { type: 'string', enum: ['move', 'move_attack', 'attack', 'heal', 'defend', 'wait'] },
            // anyOf rather than a type-union array: both OpenAI and Anthropic
            // structured outputs accept this form, a type array only OpenAI.
            targetId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            toLandmark: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            radio: { type: 'string' },
          },
        },
      },
    },
  },
} as const

export const MONSTER_SCHEMA = {
  name: 'monster_orders',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['actions', 'taunt'],
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['unitId', 'type', 'targetId'],
          properties: {
            unitId: { type: 'string' },
            type: { type: 'string', enum: ['move', 'move_attack', 'attack', 'defend', 'wait'] },
            targetId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
      taunt: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            required: ['unitId', 'text'],
            properties: {
              unitId: { type: 'string' },
              text: { type: 'string' },
            },
          },
        ],
      },
    },
  },
} as const
