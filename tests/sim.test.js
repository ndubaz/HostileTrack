// Headless regression: runs every scenario with a crude bot and fails on exceptions or non-terminating battles.
const D = require('../src/data.js');
const S = require('../src/sim.js');
let fail = 0;
for (const scn of D.SCN){
  for (const mode of ['SEMI', 'AUTO']){
    try {
      const s = S.createSim(scn, {seed:42, mode});
      let n = 0;
      while (!s.ended && n < 30000){
        S.step(s); n++;
        if (n % 20 === 0){ S.ack(s); for (const e of s.ents) if (e.alive && e.trk && e.trk.est && e.trk.id === 'UNK' && e.truth === 'H' && e.kind !== 'FALSE') S.playerId(s, e, 'HOS'); }
        s.out.length = 0;
      }
      if (!s.ended) throw new Error('did not end');
      console.log(`${scn.id.padEnd(4)} ${mode.padEnd(4)} T+${s.t.toFixed(0).padStart(4)}  score ${String(s.score.total).padStart(3)}  fired ${s.st.fired.MSE} MSE / ${s.st.fired.GEMT} GEM-T  kills ${s.st.kills}  leak ${s.st.leak}`);
    } catch (e){ fail++; console.error(scn.id, mode, 'FAILED', e.message); }
  }
}
process.exit(fail ? 1 : 0);
