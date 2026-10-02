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

## Garage

Race results pay credits (more for a win, and more in faster cars). Credits buy four cars above the starter, each a different model with better top speed, acceleration, handling and braking. Rivals get quicker as your car does. Owned cars can be repainted: paint, finish, rims, brake calipers, interior, window tint and underglow. Progress is stored in the browser (`localStorage`).

| Car | Price |
| --- | --- |
| Nissan GT-R | starter |
| Ferrari 458 | 1,200 |
| Porsche 911 GT3 RS | 3,000 |
| Lamborghini Huracán EVO | 6,000 |
| McLaren Spider | 10,000 |

## How it's built

- No build step: plain ES modules, with three.js loaded from a CDN through an import map.
- `js/main.js` — renderer, post-processing (bloom, ACES tone mapping), car physics, rivals, camera, HUD.
- `js/track.js` — the circuit (a closed spline), road, kerbs, guard rails, lamps, trees and hills, all generated in code.
- `js/garage.js` — the car list and stats, saved progress, and the garage screen.
- `js/leaderboard.js` — reads and writes lap times in a Supabase table (`lap_times`) using the project's publishable key. Row level security allows reading and inserting only.
- `tools/build-car.mjs` — the script that prepared the files in `assets/cars/`. It rescales each source model, splits the wheels off so they can spin and steer, merges geometry per material, simplifies it and compresses it. It needs Node with `@gltf-transform/cli` installed; the game itself does not.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

The car models are from Sketchfab, used under their Creative Commons licences. Each was modified for this game with `tools/build-car.mjs` (rescaled, wheels separated, simplified, textures reduced, recompressed).

- [Nissan Skyline GTR r35](https://sketchfab.com/3d-models/nissan-skyline-gtr-r35-7b142ea3376e4811a326256c59bbc7a2) by [Black Snow](https://sketchfab.com/BlackSnow02), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- Ferrari 458 Italia by [vicent091036](https://sketchfab.com/vicent091036), as distributed with the [three.js examples](https://threejs.org/examples/#webgl_materials_car)
- [Porsche 911 GT3 RS Snow Edition](https://sketchfab.com/3d-models/porsche-911-gt3-rs-snow-edition-6f44b99606e94753ae83a75ada3ba3c8) by [Drifter Models](https://sketchfab.com/Golden-Models), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [2019 Lamborghini Huracán EVO](https://sketchfab.com/3d-models/2019-lamborghini-huracan-evo-71b4b185956d466689ad6edf759ec8b4) by [adrianaflak09](https://sketchfab.com/adrianaflak09), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [McLaren Spider](https://sketchfab.com/3d-models/mclaren-spider-10b474f26b2643be82ee26417ca78a0a) by [SINNIK](https://sketchfab.com/sinnik), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
