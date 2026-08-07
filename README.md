# Dungeon Command

A turn-based dungeon-defence game where you never touch a unit.

You are the Archmagus, watching the Shrine of Emberdeep through a scrying orb. Four heroes hold the vault below. You **speak** your orders — out loud — and an LLM decides what each hero actually does with them.

> *"Brannor hold the north door, Sylvia cover him from range, Pip and Mira guard the shrine."*

Hold **Space**, say that, and watch four AI-driven heroes interpret it, argue with it in character, and carry it out. Then the horde — driven by a second, independent AI — decides how to answer.

---

## Three AI minds, one strict rules engine

The interesting part isn't that an LLM is in the loop. It's that the LLM is **fenced**.

| Mind | Job | Latency budget |
|---|---|---|
| **The party link** | Turns your spoken order into one action per hero, plus an in-character line | Blocking — the player waits |
| **The horde** | Picks an action for every monster, per-archetype doctrine, optional taunt | Free — runs behind the party animation |
| **The orb** | One ominous sentence between waves | Fire-and-forget |

Everything they return is **untrusted input**. A deterministic engine (`src/engine/`, zero framework imports, fully unit-tested) clamps every action into legality before anything renders:

- Unknown monster id → nearest enemy
- Unreachable tile → furthest reachable tile along the path toward it
- Hero the model forgot → sensible default action
- Dead unit, friendly-fire, off-map coordinates → dropped or redirected

The result: **any structurally-valid model response produces a legal, watchable turn.** If the API is slow, wrong, or completely down, heuristic actors take over and the game keeps playing. Model quality buys *plausibility and personality*, never correctness.

There is a test that feeds the engine deliberately garbage actions and asserts the turn still resolves legally.

## Quick start

```bash
npm install
```

Create `.env` from the template:

```bash
cp .env.example .env
```

Add an API key (either provider works), then:

```bash
npm run dev
```

Open **http://localhost:5173** in Chrome and allow the microphone. No key? The game is still fully playable — heuristic actors take over automatically.

## Model routing

Each of the three minds is configured independently. The provider is inferred from the model id — `claude-*` routes to Anthropic, anything else to OpenAI — so there is no second switch.

```bash
ORDERS_MODEL=claude-haiku-4-5     # blocking call; best instruction-following you can afford
MONSTER_MODEL=claude-haiku-4-5    # hidden behind the animation
NARRATOR_MODEL=claude-haiku-4-5   # one throwaway sentence
```

Measured warm latency on Haiku 4.5: **~2.6s** for the blocking orders call, ~4.2s for monsters (fully masked by animation), ~1.1s for narration.

`MOCK_LLM=1` serves canned-but-sensible responses with no API calls at all — demo insurance.

## Voice

Speech-to-text is the browser's **Web Speech API** (`webkitSpeechRecognition`) — no model, no key, no latency. Push-to-talk on **Space** or the rune button, with a live interim transcript. Chrome only; every other browser falls back to the always-visible text input, which is also the demo-safe path.

## Testing

```bash
npm test          # engine unit tests — pathfinding, LOS, action clamping, 50 seeded full games
npx playwright test   # end-to-end, /api/* mocked with fixtures so it is free and deterministic
npm run llm:eval  # fires 10 canned orders at a live endpoint, prints actions + latency
```

Add `?debug=1` to the URL for preset orders, raw JSON action injection, fast-forward, and a no-LLM toggle.

## Stack

Phaser 3 · Vite · TypeScript · Express · Zod · Vitest · Playwright

The engine is deliberately framework-free: `src/engine/` has no Phaser, no DOM, no network. Phaser is a dumb renderer that replays an ordered `GameEvent[]`; game state is already final before the first tween starts.

## Credits

Art: [Kenney — Tiny Dungeon](https://kenney.nl/assets/tiny-dungeon) (CC0). Fonts: Cinzel, IM Fell English. See [CREDITS.md](CREDITS.md).

Built for a hackathon — brief in [HACKATHON.md](HACKATHON.md).
