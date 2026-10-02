# Sunset Circuit

A 3D arcade racing game built with [three.js](https://threejs.org/). Three laps, three rivals, and a global fastest-lap leaderboard.

**Play:** https://arosario28-ux.github.io/rocketjitll.cpp/

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Gas |
| `S` / `↓` | Brake, then reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake (drift) |
| `C` | Switch camera |
| `R` | Restart |
| `M` | Mute |

Touch devices get on-screen buttons.

## How it's built

- No build step: plain ES modules, with three.js loaded from a CDN through an import map.
- `js/main.js` — renderer, post-processing (bloom, ACES tone mapping), car physics, rivals, camera, HUD.
- `js/track.js` — the circuit (a closed spline), road, kerbs, guard rails, lamps, trees and hills, all generated in code.
- `js/leaderboard.js` — reads and writes lap times in a Supabase table (`lap_times`) using the project's publishable key. Row level security allows reading and inserting only.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

- Car: [Ferrari 458 Italia](https://sketchfab.com/3d-models/ferrari-458-italia-57bf6cc56931426e87494f554df1dab6) by [vicent091036](https://sketchfab.com/vicent091036), CC BY 4.0, as distributed with the three.js examples.
