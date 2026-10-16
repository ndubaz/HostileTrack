# Hostile Track

A Patriot AN/MSQ-132 Engagement Control Station simulator. You sit as the Tactical Control Officer: identify what is in the sky, decide what deserves an interceptor, and make the load last.

## What is in v1

- **10 crew drill tables** at McGregor Range, with a coach overlay. Table VIII certifies the crew and unlocks the campaign and the legacy console.
- **16 scenarios**: 8 Middle East (Al Udeid, Abqaiq, Erbil, Bahrain, Jeddah, PSAB, Nevatim, seeded endgame) and 8 Europe (Rzeszów, Kyiv, Burshtyn, Mihail Kogălniceanu, Šiauliai, Dnipro, Sliač, seeded endgame), each inspired by public events from 2019 to 2025.
- **Two 7-battle campaigns** with persistent missile stock, resupply, crew experience, TD trust and ironman fratricide rules.
- **Simulation**: 120° MPQ-65-style sector, radar horizon, ridge masking, jamming strobes and false tracks, IFF Mode 4 / Mode 3/C, manual / semiautomatic / automatic engagement with a veto window, ADW and WCS, TD orders with acknowledgment, ripple and shoot-look-shoot doctrine, GEM-T and PAC-3 MSE envelopes, M903 load-outs and reloads, EMCON against ARMs, PTL reorientation, displacement against recon-cued strikes, adjacent and allied batteries passing remote tracks, equipment faults.
- **AAR**: score by asset protection, discipline, economy and survival; rule-based sustain/improve findings; deterministic replay with decision markers and a TRUTH overlay showing what your radar never saw. Same seed, same raid.
- **Console**: plan and tilted 3D scope, WMI and green-phosphor legacy skins, TTS voice for the TCA and TD, synthesized alert tones and shelter ambience. Desktop, tablet and phone layouts.

All performance figures are labelled game values built from open sources (Wikipedia, archived public field manuals, FMS notifications, open press). Slow movers fly about 4× real speed to fit 10–15 minute battles.

## Layout

```
src/
  index.html   page shell with @@ placeholders
  style.css    tokens and layout
  geo.js       generated far-field coastlines, borders and cities (Natural Earth)
  data.js      threat library, interceptors, maps, scenarios, campaigns
  sim.js       deterministic simulation core (no DOM; runs in Node)
  training.js  drill table objectives and coach steps
  ui.js        rendering, audio, panels, tutorial, campaign, AAR
tools/build.py inlines src/ into dist/index.html
tests/sim.test.js runs every scenario headless
tests/training.test.js plays each drill table with a correct and a sloppy crew
tests/v2.test.js checks replay determinism, rewind, red commander and ghost
tests/calib.test.js holds a competent crew inside real 2025-26 leak bands
public/        manifest, service worker, icon
```

## Build and run

```bash
python3 tools/build.py          # writes dist/index.html
node tests/sim.test.js          # headless run of all 24 scenarios
node tests/training.test.js     # every table: correct crew passes, sloppy crew fails
node tests/calib.test.js        # leak rates against the 2025-26 record
npx serve dist                  # or any static server
```

## Deploy to Vercel

1. Create an empty GitHub repo and push this folder.
2. In Vercel: **Add New Project → Import** the repo. `vercel.json` sets the build command (`python3 tools/build.py && cp public/* dist/`) and output directory (`dist`). No framework preset needed.
3. Open the URL on a phone or tablet and use **Add to Home Screen**; the service worker caches the game for offline play.

Saves live in the browser's localStorage. Cross-device saves and a leaderboard would need a small backend (Vercel KV or Supabase); the save format is versioned (`hostiletrack.v1`) for that.

## Changelog

**3.1**
- Video toggle is now SYN (symbols only, the default, as on the real console) or MIX (symbols plus raw returns). The returns-only RAW mode is gone: it hid classified track symbols and confused play.
- Radar display defaults to CLEAN, which matches the real operator picture: no beam on screen, a steady sector, and raw returns (if shown) that refresh quietly once a second. The MPQ-65 and AN/TPY-2 are phased arrays with no rotating beam. BEAMS (the array hopping its search beam and revisiting tracks) and SWEEP (the old rotating beam) remain as stylized options in Settings.
- THAAD console fixed: the scan, the fan (to 600 km), range rings (100 to 600 km) and the 200 km engagement ring are drawn from the TPY-2, not from the Patriot radar. The Patriot fan shows faintly for reference.
- Real far-field geography: coastlines, borders and cities from Natural Earth (public domain) out to 950 km on every map, under the detailed local terrain. `tools/geo.js` rebuilds `src/geo.js`. Nevatim gains its Mediterranean coast.
- The TPY-2 respects the earth's curvature: a missile far out stays invisible until it climbs above the radar horizon.
- Track labels declutter in dense raids; the hooked track always keeps its label.

**3.0**
- Honest failure, calibrated to the record. Interceptors misfire (2%) and fail in flight (3%); a hit can leave the warhead falling (kill assessment UNCERTAIN). Liquid-fuel missiles shed booster bodies that track like warheads and fall short. Cluster warheads open 12 to 20 km up and scatter bomblets over an area; maneuvering warheads jink in the last third of flight. Fire units guide a limited number of missiles at once (8 Patriot, 6 THAAD), so salvos saturate. `tests/calib.test.js` holds a competent crew inside the real leak bands: UAE first night 0-10%, Qatar 2-20%, Israel June 2025 5-25%, Israel mid-March 2026 8-35%.
- THAAD module. An AN/TPY-2 radar and THAAD launchers on their own site. Sit at THAAD fire control or the Patriot ECS and swap with G; the seat you leave runs on an AI crew. Layer doctrine (wait for THAAD, or concurrent), THAAD doctrine, TPY-2 emission control, and threats aimed at the TPY-2. Tables IX (shoot-look-shoot) and X (layered defense and clusters).
- Counter-drone layer: guns and Coyote launchers with their own cost, auto or on call (U). Drone doctrine LEAVE TO C-UAS keeps Patriot for missiles. A cost ledger compares what you spent with what you killed.
- Space-based launch warning: impact areas with time to impact appear before your radar sees the missile, and arrive later once the early-warning radar is lost.
- Degraded operations: MOPP 4 (mask view, slower reactions), tactical radio loss (TD net down, autonomous operations), a frozen tabular display, red emergency lighting on power loss, shake and dust from near misses.
- Five new battles and a campaign: Twelve Days (Israel 2025), Ruwais Night (UAE), Azraq (Jordan), Udeid, Again (Qatar), Dimona and Arad (Israel 2026), and the four-day campaign Shield Under Strain with one national interceptor pool, almost no resupply, partner stocks running dry and a theater map. New maps: Al Ruwais and Azraq. Each historical battle shows the real outcome in the brief and the AAR.
- Station: system lamps, seat badge, a switch panel with a guarded ENGAGE key and push-to-talk, an A-scope and an elevation strip for the hooked track (terrain, horizon, cluster release band, THAAD floor, predicted trajectory, interceptors), flyout lines to predicted intercept points, cluster and bloom effects, raw, synthetic or blended video (R), filled symbols in the style of MIL-STD-2525, and an LCD pixel grid on the modern console.

**2.1**
- Real terrain: mountain ranges with peaks, saddles, branching spurs and gullies, escarpments with steep faces and long dip slopes, scattered jebels and hills, carved river valleys and coastal plains. Maps follow the real relief: Organ and San Andres ranges and the Sacramento escarpment, the Zagros fold belt, the Hejaz and Tuwaiq escarpments, the Dead Sea rift with the Lisan peninsula, the Carpathian arc, the Low Tatras and Poľana.
- True line-of-sight masking: the radar traces each bearing across the height field (with earth curvature), and low fliers hug the ground, so a cruise missile hides in a valley and pops up over a crest. The 100 m limit line and Table I's Round Hill lesson come from the same terrain you see.
- Scope relief: hillshade lit from the northwest, elevation tint, 100 m contours with 500 m index lines, half-kilometre detail that refines in the background, ground clutter only on terrain faces the radar can see, and a denser 3D mesh.

**2.0**
- Adaptive red commander: each raid draws from five tactics (probe, gap strike, decoy tax, SEAD hunt, pressure salvo) and learns from your last battles (PTL habits, decoy spending, radiating, low stock). Settings switch it to scripted.
- Take the seat: every action goes through a command log, so the AAR can rewind any battle to a chosen moment and hand you the console from there.
- Doctrinal ghost: a by-the-book crew fights the same seed; the AAR compares scores and lists where you diverged.
- Radar time budget: tracks cost search time, and a NARROW ±30° sector trades coverage for 25% more range.
- Station pages: TRACK, TIMELINE (launch, flight, intercept against threat arrival), SYSTEM (BIT codes and fault isolation) and CREW (F1 to F4).
- AI TCA at manstation 2: three operators with different skill, fatigue that carries through a campaign, and delegation of reloads and fault isolation.
- Brief shows red intelligence and your crew roster.

**1.1**
- Training rebuilt: traffic now flies inside the sector, assets sit inside the low-altitude horizon, and Tables II to VIII use a fixed emplacement. Each table has a live objective checklist, coach steps that stop the clock while they explain, and an AAR that lists every objective with a fix for each failure.
- Table I teaches masking with a real choice (Site C behind Round Hill hides the drones). Table VII budget rebalanced to 16 of 18 missiles; drill surrogates have a 95% kill floor so luck does not fail a correct crew.
- Shelter console: bezelled CRT with glass, scanlines and grain, beam afterglow, raw clutter returns, contour-line terrain, a cursor range and bearing readout, lit ADW and WCS lamp panels, backlit keys.
- Fixes: missing charset outside the artifact host, correlated seeds, a crash in the Table I checklist.

## Roadmap (from the design plan)

- Phase 5: multi-battery and ICC battalion play, IBCS mode, recorded voice lines, online leaderboard.
- Port to the Vite + TypeScript + PixiJS structure in the plan once the gameplay settles; `sim.js` moves into a Web Worker unchanged.
