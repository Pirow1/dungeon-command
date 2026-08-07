# Dungeon Command

**You never move a single unit. You only speak.**

You are the Archmagus of the Order, watching the Shrine of Emberdeep through a scrying orb. Four heroes stand in the dark below, and they only know what you tell them. Hold the microphone, say what you want — *"Brannor plug the north gap, Sylvia and Pip shoot over him, Mira stay on the shrine"* — and an LLM turns your words into their turn. They answer back in character. The horde on the other side of the doors is thinking too.

Survive five waves. Keep the shrine standing.

```bash
npm install
npm run dev        # http://localhost:5173
```

The API key lives in `.env` (`OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5-nano`) and never leaves the server.

---

## Three AI minds, one strict rules engine

| Mind | Endpoint | What it decides |
|---|---|---|
| **The party link** | `POST /api/orders` | Turns one spoken sentence into one action per hero, plus an in-character radio line each. |
| **The horde** | `POST /api/monster-turn` | Picks every monster's action, and occasionally a taunt. |
| **The orb** | `POST /api/narrator` | One ominous line when a wave lands or the game ends. |

The interesting part is not that an LLM plays the game. It's that **it cannot break it.**

Everything in `src/engine/` is pure TypeScript with no Phaser, no DOM, and no network — a deterministic rules engine with a seeded PRNG. The LLM never moves a unit. It returns *intent*, and `engine/actions.ts` clamps that intent into something legal:

- Names a monster that just died → retargets to the nearest living enemy.
- Asks for a tile across a wall → walks as far along the real path as the move budget allows.
- Invents a landmark → falls back to a sensible position.
- Forgets a hero entirely → that hero holds ground and says so.
- Tries to heal an enemy, or move the shrine → dropped.

So the model gets to be creative about *what the party should do*, and the engine stays the only thing that decides *what actually happens*. A run with the API unplugged is still a complete, playable game (`?debug=1` → "no LLM").

### Making a small model look smart

`gpt-5-nano` is not good at grid geometry, so it is never shown a grid. `engine/summary.ts` sends **landmarks and precomputed hints** instead — `north_door`, `shrine_room`, `enemiesInRangeNow`, `canReachThisTurn` — and the engine converts names back into tiles and does all the pathfinding. The model picks *who does what to whom*; the engine answers *is that even possible*. Prompts stay under ~600 tokens and responses come back in ~2s.

### Hiding the latency

The monster-brain request is fired the instant the party's actions resolve, then awaited only *after* the hero animations finish — so the horde is thinking while you watch your own orders play out. Radio chatter types itself out during the animation, which turns model output into content instead of waiting. Every call has a hard timeout and drops to heuristic actors rather than stalling.

---

## The game

- 20×13 handcrafted dungeon (ASCII art in `src/data/level1.ts` — edit it and the game changes).
- Shrine room with three approaches; monsters pour in from the north, east and west doors.
- Five escalating waves: goblins → wraith archers → orc brutes → a mixed press → **Ashmaw**.
- A wave only arrives once the last one is cleared (or you stall for six turns). Clearing a wave outright buys the party a breather heal — decisive play is rewarded.
- Hover any unit to see exactly where it can reach this turn.

| Hero | HP | Move | Attack | Voice |
|---|---|---|---|---|
| Brannor, dwarf fighter | 22 | 3 | melee, 4–6 | gung-ho, calls them "wee beasties" |
| Sylvia, rogue archer | 15 | 4 | bow range 6, 3–5 | dry, sarcastic, secretly loyal |
| Pip, rookie mage | 13 | 3 | firebolt range 5, 5–7 | nervous, apologetic, hits hardest |
| Mira, battle cleric | 15 | 3 | heal 6 (range 3) / smite | calm, protective of Pip |

Voice uses the Web Speech API (push-to-talk on the rune button or the Space bar; Chrome). The text box beside it always works and is the recommended path for a noisy demo room.

---

## Build pipeline

The tooling exists because a game with a language model in the turn loop is otherwise very hard to iterate on.

```bash
npm test           # Vitest — the pure engine, including the clamp layer
npm run e2e        # Playwright — full turn loop against mocked /api fixtures
npm run llm:eval   # fire 10 canned orders at the live model, print parsed actions
npm run playtest   # play complete games against the real LLM, report win rate
npm run shots      # drive the game in a real browser, screenshot every phase
```

- **`npm test`** feeds the engine deliberately illegal action JSON and asserts it still resolves legally, then simulates 50 seeded games to prove they always terminate. Same seed, same outcome — the PRNG lives in game state.
- **`npm run playtest`** is how the difficulty was tuned. The first pass lost 3 games out of 3 (stacked waves outnumbered the party 2:1 in actions per turn); after the wave-pacing fix it wins 3 out of 4.
- **`npm run llm:eval`** catches prompt regressions in about twenty seconds — including nonsense orders like *"Brannor go make friends with the goblins"*.
- **`?debug=1`** adds preset orders, raw action injection, instant win/lose, an animation-speed toggle and an LLM kill switch. It is both the dev loop and the demo insurance.
- **`MOCK_LLM=1`** makes the server serve canned-but-sensible responses, so a dead API on demo day costs nothing.

## Layout

```
server/     Express proxy — prompts, structured outputs, retry/repair, mock mode
src/engine/ pure rules: map, BFS pathfinding, LOS, combat, waves, turn machine, prompt summary
src/ai/     typed fetch wrappers + heuristic fallback actors
src/scenes/ Phaser — plays back the engine's event stream, owns none of the rules
src/ui/     DOM overlays: HUD, radio chatter, voice, SFX, debug panel
```

Art and audio: [Kenney](https://kenney.nl) (CC0). See [CREDITS.md](CREDITS.md).
