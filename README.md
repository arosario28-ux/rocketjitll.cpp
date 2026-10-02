# Sunset Circuit

A 3D arcade racing game built with [three.js](https://threejs.org/). Nine tracks, three rivals, a garage of ten cars, player accounts, and a global fastest-lap leaderboard for each track.

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
| `Esc` / `P` | Pause (resume, restart or exit to the menu) |
| `M` | Mute |

Touch devices get on-screen buttons.

## Tracks

Pick the track and the race length (1, 3, 5 or 10 laps) on the start screen. Prize money scales with the number of laps.

| Track | Length | Scene |
| --- | --- | --- |
| Sunset Circuit | 1.6 km | Pine forest at sunset |
| Neon District | 1.9 km | Street circuit through a rain-soaked neon city at night |
| Ember Peak | 2.0 km | Lava fields around an erupting volcano |
| Half-Mile Drag | 804 m | Drag strip: a straight sprint from a standing start, four abreast |
| Palm Island | 1.8 km | Coast road around a sandy island, surrounded by sea |
| Autumn Park | 1.8 km | Parkland in autumn colours |
| Pinewood Speedway | 2.0 km | Sunlit oval with grandstands |
| Switchback Ridge | 2.1 km | Snowy mountain pass |
| Grand Tour | 3.2 km | Desert mesas and cacti |

Each scene has its own sky, lighting, fog, weather (rain, snow or embers) and scenery, all generated in code. Neon District is an original build inspired by the look of [Threejs-Punk Drive](https://threejspunkdrive.vercel.app/); it does not use that game's code or assets.

## Upgrades

Every owned car can be upgraded in the garage, one stage at a time: Stock → Street → Sport → Track. Upgrades cost credits (more for faster cars) and are kept per car.

| Upgrade | Improves | Per stage |
| --- | --- | --- |
| Engine | acceleration, top speed | +4%, +1.5% |
| Brakes | braking | +6% |
| Suspension | handling | +2.5% |
| Tyres | handling | +3% |

Rivals are scaled from your car's upgraded figures, so they keep pace.

## Online head-to-head

"Online 1 v 1" on the start screen pairs you with another player who is searching. Each player races the car they have selected in their own garage, on the track and lap count chosen by whichever of the two becomes host. Each player is timed from their own green light, so the lower race time wins regardless of connection speed. Winning pays the first-place prize, losing the second-place prize.

It runs over Supabase Realtime with no game server (`js/online.js`): waiting players sit in a shared presence channel and pair off, then each pair trades car positions about ten times a second on a private channel. Every player simulates only their own car.

## Garage

Race results pay credits (more for a win, more for longer races, and more in faster cars). Credits buy eight cars above the starter, each a different model with better top speed, acceleration, handling and braking. Rivals get quicker as your car does. Owned cars can be repainted: paint, finish, rims, brake calipers, interior, window tint and underglow, depending on what each model supports.

| Car | Price |
| --- | --- |
| Mitsubishi Lancer Evo X | starter |
| BMW M4 | 700 |
| Nissan GT-R | 1,500 |
| Chevrolet Corvette C8 | 2,500 |
| Ferrari 458 | 4,000 |
| Porsche 911 GT3 RS | 6,000 |
| Lamborghini Huracán EVO | 8,500 |
| McLaren Spider | 11,500 |
| Bugatti Veyron | 15,000 |
| Connor's Car (Pagani Huayra) | one named account only |
| McLaren MCL35M F1 | developer accounts only |

## Accounts

Playing as a guest keeps progress in the browser. Signing up with a username and passcode stores it in Supabase instead, so it follows you between devices, and your username is used on the leaderboards.

A developer account owns every car, including the F1 car. An account becomes a developer account by entering a developer code under "Dev code" after logging in. Codes are stored only as hashes in the `dev_codes` table; to issue a new one, run this in the Supabase SQL editor:

```sql
insert into public.dev_codes (code_hash)
values (extensions.crypt('YOUR-NEW-CODE', extensions.gen_salt('bf', 10)));
```

How it works: the `players`, `player_sessions` and `dev_codes` tables are closed to the public API. The game calls database functions (`register_player`, `login_player`, `get_profile`, `save_progress`, `redeem_dev_code`, `logout_player`) that check the passcode against a bcrypt hash and return a session token. Five wrong passcodes lock an account for a minute.

A car can also be granted to a single account: list its id in that player's `special_cars` column (for example `update public.players set special_cars = array['connor'] where username = 'Connor';`). Only that account sees it in the garage; developer access does not include it.

Limits worth knowing: there is no passcode reset, so a forgotten passcode means a new account. And because the game runs entirely in the browser, credits and purchases are reported by the client; someone determined could edit their own save. The developer flag itself can only be set by the database.

## How it's built

- No build step: plain ES modules, with three.js loaded from a CDN through an import map.
- `js/main.js` — renderer, post-processing (bloom, ACES tone mapping), car physics, rivals, camera, HUD.
- `js/track.js` — the track layouts (each a closed spline through a list of points) and the code that generates road, kerbs, guard rails, lamps, trees and hills for whichever one is selected.
- `js/garage.js` — the car list and stats, saved progress, and the garage screen.
- `js/account.js` — sign-up, login and progress sync against Supabase.
- `js/online.js` — matchmaking and position sync for online races, over Supabase Realtime.
- `js/leaderboard.js` — reads the `best_laps` view (each driver's fastest lap per track) and writes lap times to the `lap_times` table in Supabase, using the project's publishable key. Row level security allows reading and inserting only.
- `tools/build-car.mjs` — the script that prepared the files in `assets/cars/`. It rescales each source model, splits the wheels off so they can spin and steer, merges geometry per material, simplifies it and compresses it. It needs Node with `@gltf-transform/cli` installed; the game itself does not.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Credits

Trees, grass, bushes, rocks, palms and cacti are models from the [Nature Kit](https://kenney.nl/assets/nature-kit) by Kenney (CC0), recoloured in code. Hills, buildings and the rest of the scenery are generated.

The car models are from Sketchfab, used under their Creative Commons licences. Each was modified for this game with `tools/build-car.mjs` (rescaled, wheels separated, simplified, textures reduced, recompressed).

- [Mitsubishi Lancer evo X (2016)](https://sketchfab.com/WarEntertainment) and [BMW M4 [Realistic Free]](https://sketchfab.com/WarEntertainment) by WARENTERTAINMENT, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [2019 Chevrolet Corvette C8 Stingray](https://sketchfab.com/Hari31) by Hari, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [Pagani Huayra [Free]](https://sketchfab.com/BlackSnow02) by Black Snow, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [F1 2021 McLaren MCL35M](https://sketchfab.com/excalibur) by Excalibur, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [Bugatti Veyron fully rigged](https://sketchfab.com/matikassa2) by Eyasu Biyaylgn, [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [Nissan Skyline GTR r35](https://sketchfab.com/3d-models/nissan-skyline-gtr-r35-7b142ea3376e4811a326256c59bbc7a2) by [Black Snow](https://sketchfab.com/BlackSnow02), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- Ferrari 458 Italia by [vicent091036](https://sketchfab.com/vicent091036), as distributed with the [three.js examples](https://threejs.org/examples/#webgl_materials_car)
- [Porsche 911 GT3 RS Snow Edition](https://sketchfab.com/3d-models/porsche-911-gt3-rs-snow-edition-6f44b99606e94753ae83a75ada3ba3c8) by [Drifter Models](https://sketchfab.com/Golden-Models), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [2019 Lamborghini Huracán EVO](https://sketchfab.com/3d-models/2019-lamborghini-huracan-evo-71b4b185956d466689ad6edf759ec8b4) by [adrianaflak09](https://sketchfab.com/adrianaflak09), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
- [McLaren Spider](https://sketchfab.com/3d-models/mclaren-spider-10b474f26b2643be82ee26417ca78a0a) by [SINNIK](https://sketchfab.com/sinnik), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/)
