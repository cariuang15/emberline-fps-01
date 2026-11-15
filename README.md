# Emberline — Kestrel Yard

A round-based tactical first-person shooter in the style Counter-Strike made
famous, built on three.js 0.187.0: two teams of four, short rounds won by
eliminating the other team or by the objective, money between rounds to buy
weapons, and gunfire where accuracy counts more than speed. Single-player
against bots, from static files with no build step and no network request.

## The game

You are Vanguard, the attacking team, in the Kestrel Yard — a container yard
with two spike sites, Foundry (A) and Silo (B). Plant the spike at a site and
defend it until it blows, or eliminate the Sentinel defenders. Lose the round
and the Sentinels keep the yard.

- **Weapons:** P9 sidearm (free), MP9 submachine gun, VK-47 rifle, Longshot
  bolt sniper, frag and smoke grenades, kevlar vest.
- **Gunplay:** hitscan fire with headshot damage, recoil and spread that grow
  when you move or spray, crouching and collision with the map.
- **Bots:** follow routes through the yard, hold angles, react to what they
  see and hear, plant and defuse, and buy between rounds.
- **Rounds:** 100-second rounds, first to 5 wins the match. Money for wins,
  losses, kills and plants, spent in the buy menu.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to capture) |
| Click | Fire |
| Right-click | Aim (sniper scope) |
| R | Reload |
| C / Ctrl | Crouch |
| Shift | Walk (accurate) |
| G | Throw grenade |
| 1 / 2 / 3 | Weapon slots |
| E | Plant / defuse the spike (hold) |
| B | Buy menu (between rounds) |
| Tab | Scoreboard |
| M | Mute |

## Run it

```bash
node serve.ts        # serves game/ on http://localhost:8080
```

Open the page, click to play. `?shot=start|combat|buy|end&seed=1` stages a
deterministic scene for screenshots.

## Hand in

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the kit's library.
