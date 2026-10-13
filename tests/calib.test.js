// 3.0 calibration harness: a competent crew must still lose about as much as real defenders did.
// Bands come from open reporting (see README): UAE early March 2026 ~0-7%, Qatar ~3%, Israel June 2025 ~10-14%,
// Israel mid-March 2026 ~27% of ballistic missiles reaching populated areas.
const D = require('../src/data.js'), S = require('../src/sim.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
function crew(scn, seed){
  const s = S.createSim(scn, {seed, mode:'SEMI', doctrine:scn.cuas ? {UAV:'CUAS'} : {}, tca:{delegate:{reload:true, faults:true}}}); let n = 0;
  while (!s.ended && n < 40000){ S.step(s); n++;
    if (n % 10 === 0){ if (s.acks.some(a => !a.done)) S.cmd(s, 'ack');
      for (const e of s.ents) if (e.alive && e.trk && e.trk.est && !e.trk.remote && !e.T.ballistic && e.trk.id !== 'HOS' && e.truth === 'H' && e.kind !== 'FALSE') S.cmd(s, 'id', {uid:e.uid, id:'HOS'});
      for (const f of s.faults) if (!f.fixing) S.cmd(s, 'fix', {fid:f.id, act:S.FAULTS[f.k].fix}); }
    s.out.length = 0; }
  return s;
}
const bands = {me9:[5, 25, 'Israel, June 2025'], me10:[0, 10, 'UAE, first night 2026'], me12:[2, 20, 'Qatar, 2026'], me13:[8, 35, 'Israel, mid-March 2026']};
const tot = {};
for (const [id, [lo, hi, label]] of Object.entries(bands)){
  const scn = D.SCN.find(x => x.id === id); let n = 0, hit = 0, ut = 0, rel = 0, cuas = 0, unc = 0, duds = 0;
  for (const seed of [11, 12, 13, 14, 15]){
    const s = crew(scn, seed);
    const hitT = new Set(s.ev.filter(v => v.k === 'HIT' && v.trk).map(v => v.trk));
    for (const e of s.ents) if (e.T.ballistic && e.truth === 'H' && e.tgt){ n++; if (e.impacted && e.trk && hitT.has(e.trk.num)) hit++; }
    ut += s.st.fired.THAAD; rel += s.st.clusterRel; cuas += s.st.cuasKills; unc += s.st.uncertain; duds += s.st.duds;
    tot.unc = (tot.unc || 0) + s.st.uncertain; tot.duds = (tot.duds || 0) + s.st.duds; tot.fail = (tot.fail || 0) + s.st.flightFail;
  }
  const pct = hit / n * 100;
  check(pct >= lo && pct <= hi, `${id} (${label}): competent crew lets ${pct.toFixed(0)}% of ${n} ballistic missiles hit (band ${lo}-${hi}%)`);
  if (scn.thaad) check(ut > 0, `${id}: the upper tier fired ${ut} THAAD rounds`);
  if (scn.cuas) check(cuas > 0, `${id}: counter-drone fire killed ${cuas} drones`);
}
check(tot.duds > 0 && tot.fail > 0, `interceptor reliability shows up: ${tot.duds} misfires, ${tot.fail} in-flight failures across the runs`);
const s13 = crew(D.SCN.find(x => x.id === 'me13'), 99);
check(s13.ents.some(e => e.kind === 'TANK'), 'liquid-fuel missiles shed booster bodies that radar can track');
const t9 = S.createSim(D.SCN.find(x => x.id === 't9'), {seed:3});
check(t9.seat === 'THAAD' && t9.launchers.filter(L => L.type === 'THAAD').length === 3, 'Table IX seats you at THAAD fire control with three launchers');
process.exit(fails ? 1 : 0);
