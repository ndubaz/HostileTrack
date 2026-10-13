# Hostile Track

A Patriot AN/MSQ-132 Engagement Control Station simulator. You sit as the Tactical Control Officer: identify what is in the sky, decide what deserves an interceptor, and make the load last.

## What is in v1

- **8 crew drill tables** at McGregor Range, with a coach overlay. Table VIII certifies the crew and unlocks the campaign and the legacy console.
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
  data.js      threat library, interceptors, maps, scenarios, campaigns
  sim.js       deterministic simulation core (no DOM; runs in Node)
  ui.js        rendering, audio, panels, tutorial, campaign, AAR
tools/build.py inlines src/ into dist/index.html
tests/sim.test.js runs every scenario headless
tests/training.test.js plays each drill table with a correct and a sloppy crew
public/        manifest, service worker, icon
```

## Build and run

```bash
python3 tools/build.py          # writes dist/index.html
node tests/sim.test.js          # headless run of all 24 scenarios
node tests/training.test.js     # every table: correct crew passes, sloppy crew fails
npx serve dist                  # or any static server
```

## Deploy to Vercel

1. Create an empty GitHub repo and push this folder.
2. In Vercel: **Add New Project → Import** the repo. `vercel.json` sets the build command (`python3 tools/build.py && cp public/* dist/`) and output directory (`dist`). No framework preset needed.
3. Open the URL on a phone or tablet and use **Add to Home Screen**; the service worker caches the game for offline play.

Saves live in the browser's localStorage. Cross-device saves and a leaderboard would need a small backend (Vercel KV or Supabase); the save format is versioned (`hostiletrack.v1`) for that.

## Changelog

**1.1**
- Training rebuilt: traffic now flies inside the sector, assets sit inside the low-altitude horizon, and Tables II to VIII use a fixed emplacement. Each table has a live objective checklist, coach steps that stop the clock while they explain, and an AAR that lists every objective with a fix for each failure.
- Table I teaches masking with a real choice (Site C behind Round Hill hides the drones). Table VII budget rebalanced to 16 of 18 missiles; drill surrogates have a 95% kill floor so luck does not fail a correct crew.
- Shelter console: bezelled CRT with glass, scanlines and grain, beam afterglow, raw clutter returns, contour-line terrain, a cursor range and bearing readout, lit ADW and WCS lamp panels, backlit keys.
- Fixes: missing charset outside the artifact host, correlated seeds, a crash in the Table I checklist.

## Roadmap (from the design plan)

- Phase 5: multi-battery and ICC battalion play, IBCS mode, recorded voice lines, online leaderboard.
- Port to the Vite + TypeScript + PixiJS structure in the plan once the gameplay settles; `sim.js` moves into a Web Worker unchanged.
