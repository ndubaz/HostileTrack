// 4.0 checks: battalion fire direction under legacy and IBCS, airspace control, editor share codes.
const D = require('../src/data.js'), S = require('../src/sim.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
function fdc(scn, opts, veto = true){
  const s = S.createSim(scn, {mode:'SEMI', doctrine:scn.cuas ? {UAV:'CUAS'} : {}, ...opts}); let n = 0;
  while (!s.ended && n < 40000){ S.step(s); n++;
    if (n % 10 === 0){ if (s.acks.some(a => !a.done)) S.cmd(s, 'ack');
      if (veto) for (const p of s.plans) if (p.state === 'VETO'){ const e = s.ents.find(x => x.uid === p.uid); if (e && e.truth !== 'H') S.cmd(s, 'veto', {pid:p.id}); }
      for (const e of s.ents) if (e.alive && e.trk && e.trk.dual && opts.corr) S.cmd(s, 'corr', {uid:e.uid}); }
    s.out.length = 0; }
  return s;
}
const bn1 = D.SCN.find(x => x.id === 'bn1'), bn2 = D.SCN.find(x => x.id === 'bn2');
const sum = (arr, f) => arr.reduce((a, s) => a + f(s), 0);
const L2 = [11, 12, 13].map(seed => fdc(bn2, {seed, arch:'LEGACY'})), I2 = [11, 12, 13].map(seed => fdc(bn2, {seed, arch:'IBCS'}));
check(L2.every(s => s.ended) && I2.every(s => s.ended), 'Negev Shield ends under both architectures');
check(sum(L2, s => s.st.dupShots) > 10, `legacy batteries double up: ${sum(L2, s => s.st.dupShots)} duplicate shots in three runs`);
check(sum(I2, s => s.st.dup + s.st.swaps + s.st.duals) === 0, 'IBCS: no duplicate engagements, no dual designations, no track swaps');
check(sum(I2, s => s.st.fired.MSE) < sum(L2, s => s.st.fired.MSE) * .75, `IBCS spends fewer PAC-3: ${sum(I2, s => s.st.fired.MSE)} against ${sum(L2, s => s.st.fired.MSE)}`);
check(sum(I2, s => s.score.total) > sum(L2, s => s.score.total), `IBCS scores higher on the same seeds (${sum(I2, s => s.score.total)} vs ${sum(L2, s => s.score.total)})`);
const L1 = [11, 12, 13].map(seed => fdc(bn1, {seed, arch:'LEGACY'}));
check(sum(L1, s => s.st.swaps) > 0 && sum(L1, s => s.st.duals) > 0, `legacy picture: ${sum(L1, s => s.st.duals)} dual designations, ${sum(L1, s => s.st.swaps)} track swaps`);
const I1 = fdc(bn1, {seed:11, arch:'IBCS'});
check(I1.fus.filter(f => f.ltamds).length === 2 && I1.fus.find(f => f.ltamds).half === 180, 'IBCS fields LTAMDS 360° radars on Alpha and Charlie');
check(I1.st.ppli > 0, `IBCS matched ${I1.st.ppli} friendly fighter(s) to Link 16 PPLI`);
const nv = [12, 13].map(seed => fdc(bn2, {seed, arch:'LEGACY'}, false));
check(nv.some(s => s.st.frat), 'ignore the veto window under legacy and a swapped friendly can die');
const C = fdc(bn1, {seed:12, arch:'LEGACY', corr:true});
check(C.st.corr > 0 && C.st.corr === C.st.duals, `the FDC can correlate every dual designation (${C.st.corr})`);
// HOLD keeps a battery from firing on its own
{ const s = S.createSim(bn1, {seed:11, mode:'SEMI', arch:'LEGACY'}); for (const f of s.fus) S.cmd(s, 'fuCtrl', {fu:f.id, v:'HOLD'}); let n = 0; while (!s.ended && n < 9000){ S.step(s); n++; if (n % 10 === 0) S.cmd(s, 'ack'); s.out.length = 0; }
  check(s.st.fired.MSE + s.st.fired.GEMT === 0, 'batteries on HOLD fire nothing without a battalion order'); }
// player assignment to a named shooter
{ const s = S.createSim(bn2, {seed:11, mode:'MANUAL', arch:'IBCS'}); let ok = null, n = 0;
  while (!ok && n < 12000){ S.step(s); n++; const e = s.ents.find(x => x.alive && x.trk && x.trk.est && x.trk.cls && x.T.ballistic && x.truth === 'H' && S.assess(s, x).dal); if (e && n % 20 === 0){ const r = S.cmd(s, 'engage', {uid:e.uid, fu:'D'}); if (r && r.ok) ok = r.plan; } s.out.length = 0; }
  check(ok && ok.fu === 'D', 'the FDC can assign a named battery to a ballistic track'); }
// determinism with battalion commands
{ const opts = {seed:21, mode:'SEMI', arch:'LEGACY'}; const a = S.createSim(bn1, opts); let n = 0;
  while (!a.ended && n < 40000){ S.step(a); n++; if (n % 10 === 0){ S.cmd(a, 'ack'); for (const e of a.ents) if (e.alive && e.trk && e.trk.dual) S.cmd(a, 'corr', {uid:e.uid}); } if (n === 2000) S.cmd(a, 'fuCtrl', {fu:'B', v:'HOLD'}); if (n === 4000) S.cmd(a, 'fuPtl', {fu:'D', ptl:110}); if (n === 5000) S.cmd(a, 'fuEmcon', {fu:'B', v:true}); a.out.length = 0; }
  const b = S.rewind(bn1, opts, a.inputs, 1e9); while (!b.ended) S.step(b);
  check(JSON.stringify([a.score, a.st.fired, a.ev.length]) === JSON.stringify([b.score, b.st.fired, b.ev.length]), `battalion battles replay exactly from the command log (${a.inputs.length} commands)`);
  const g = S.runGhost(bn1, opts); check(g.score && g.score.total >= 0, `the doctrinal ghost runs a battalion battle (${g.score.total})`); }
// editor share codes
{ const cfg = {base:'me12', name:'Night of drones', lo:10, hi:80, dur:600, mix:{OWA:20, DECOY:8, SRBM:4, MRBMC:2}, fr:2, dead:1, wcs:'TIGHT', seed:4242};
  const code = S.encodeCustom(cfg), back = S.decodeCustom(code);
  check(back && back.mix.OWA === 20 && back.name === 'Night of drones', `share code round-trips (${code.length} characters)`);
  const scn = S.buildCustom(back, D.SCN), scn2 = S.buildCustom(S.decodeCustom(code), D.SCN);
  check(scn && JSON.stringify(scn.waves) === JSON.stringify(scn2.waves), 'the same code builds the same raid');
  const s = S.createSim(scn, {seed:7, mode:'SEMI'}); let n = 0; while (!s.ended && n < 40000){ S.step(s); n++; if (n % 20 === 0) S.cmd(s, 'ack'); s.out.length = 0; }
  check(s.ended && s.threatsTotal >= 34, `a custom raid plays to the end (${s.threatsTotal} threats)`);
  check(S.decodeCustom('HT4-garbage') === null, 'a bad code is rejected');
  const cb = S.buildCustom({base:'bn2', mix:{MRBM:10}, lo:60, hi:100, seed:1}, D.SCN); check(cb && cb.bn && cb.bn.units.length === 4, 'the editor works on battalion layouts'); }
process.exit(fails ? 1 : 0);
