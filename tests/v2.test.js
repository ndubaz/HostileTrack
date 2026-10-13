// 2.0 checks: command log replays exactly, rewind-and-continue matches, red commander adapts, ghost runs.
const D = require('../src/data.js'), S = require('../src/sim.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

function playBot(scn, opts){
  const s = S.createSim(scn, opts); let n = 0;
  while (!s.ended && n < 40000){
    S.step(s); n++;
    if (n % 15 === 0){
      if (s.acks.some(a => !a.done)) S.cmd(s, 'ack');
      for (const e of s.ents) if (e.alive && e.trk && e.trk.est && !e.trk.remote && !e.T.ballistic && e.trk.idBy !== 'PLAYER' && e.trk.iff === 'NO RESP' && e.trk.cls) S.cmd(s, 'id', {uid:e.uid, id:'HOS'});
      if (n === 3000) S.cmd(s, 'sector', {v:'NARROW'});
      if (n === 3600) S.cmd(s, 'sector', {v:'WIDE'});
      for (const f of s.faults) if (!f.fixing) S.cmd(s, 'fix', {fid:f.id, act:S.FAULTS[f.k].fix});
    }
    s.out.length = 0;
  }
  return s;
}
const sig = s => JSON.stringify([s.score, s.st.fired, s.st.kills, s.ev.length, Math.round(s.t * 20)]);
const prof = {battles:4, ptlOff:20, decoyShots:5, radiating:1, lowStock:1};
for (const id of ['me1', 'me3', 'eu2', 'eu6', 't8']){
  const scn = D.SCN.find(x => x.id === id);
  const opts = {seed:777, mode:'SEMI', red:prof, tca:{id:'okafor', fatigue:.4, delegate:{faults:false}}, difficulty:'hard'};
  const a = playBot(scn, opts);
  const full = S.rewind(scn, opts, a.inputs, 1e9);
  while (!full.ended) S.step(full);
  check(sig(full) === sig(a), `${id}: replaying the command log reproduces the battle (${a.inputs.length} commands)`);
  const mid = Math.floor(a.n / 2), r = S.rewind(scn, opts, a.inputs, mid);
  r.replayQ = a.inputs.filter(x => x.n >= mid).map(x => ({...x}));
  while (!r.ended) S.step(r);
  check(sig(r) === sig(a), `${id}: rewind to T+${Math.round(mid * S.DT)}s and continue matches the original`);
  if (!scn.tutorial) check(a.red.length >= 4, `${id}: red commander fielded ${a.red.map(t => t.name).join(', ')}`);
  const g = S.runGhost(scn, opts);
  check(g.score && g.score.total >= 0, `${id}: doctrinal ghost scored ${g.score.total} (bot ${a.score.total})`);
}
const p1 = S.learnRed({}, (() => { const s = playBot(D.SCN.find(x => x.id === 'me2'), {seed:5}); return s; })());
check(p1.battles === 1 && typeof p1.ptlOff === 'number', `red learns a profile after one battle (PTL offset ${Math.round(p1.ptlOff)}°)`);
const fresh = S.createSim(D.SCN.find(x => x.id === 'me2'), {seed:5, red:{}});
const learned = S.createSim(D.SCN.find(x => x.id === 'me2'), {seed:5, red:p1});
check(fresh.red.length < learned.red.length, `an experienced red adds tactics (${fresh.red.length} → ${learned.red.length})`);
process.exit(fails ? 1 : 0);
