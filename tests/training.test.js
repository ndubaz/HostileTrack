// Plays every crew drill table with a correct crew (must pass) and a sloppy crew (must fail).
const D = require('../src/data.js'), S = require('../src/sim.js'), TR = require('../src/training.js');
const scn = id => D.SCN.find(s => s.id === id);
const correctId = e => e.truth === 'F' ? 'FRD' : e.truth === 'N' ? 'NEU' : 'HOS';

function run(id, opts, bot){
  const s = S.createSim(scn(id), {seed:opts.seed, site:opts.site, ptl:opts.ptl ?? scn(id).ptl, mode:opts.mode, doctrine:opts.doctrine});
  const U = {hooked:{kinds:new Set(), ent:null}, tilted:false, zoomed:false};
  let n = 0;
  while (!s.ended && n < 40000){ S.step(s); n++; if (n % 10 === 0) bot(s, U); s.out.length = 0; }
  const objs = TR.evaluate(scn(id).tutorial.table, s, {...U, end:true});
  return {pass:objs.every(o => o.ok), objs, s};
}
const tracked = s => s.ents.filter(e => e.alive && e.trk && e.trk.est && !e.trk.remote);
const declareAll = (s, f) => { for (const e of tracked(s)) if (!e.T.ballistic && e.kind !== 'FALSE' && e.trk.idBy !== 'PLAYER') S.playerId(s, e, f(e)); };

const tables = {
  t1:{good:[{site:0, ptl:70}, s => {}], bad:[{site:2, ptl:70}, s => {}]},
  t2:{good:[{}, (s, U) => { for (const e of tracked(s)) U.hooked.kinds.add(e.kind); U.zoomed = U.tilted = true; }], bad:[{}, (s, U) => { U.zoomed = true; }]},
  t3:{good:[{}, s => declareAll(s, correctId)], bad:[{}, s => declareAll(s, e => e.trk.iff === 'NO RESP' ? 'HOS' : correctId(e))]},
  t4:{good:[{}, s => { for (const e of tracked(s)) if (e.tag === 'target'){ S.playerId(s, e, 'HOS'); S.engage(s, e, {src:'player'}); } }],
      bad:[{}, s => { for (const e of tracked(s)) if (e.tag === 'target') S.engage(s, e, {src:'player', force:true}); }]},
  t5:{good:[{mode:'SEMI'}, s => {}], bad:[{}, s => { for (const e of tracked(s)) if (e.T.ballistic && e.trk.cls) S.engage(s, e, {src:'player'}); }]},
  t6:{good:[{mode:'SEMI'}, s => { S.ack(s); if (s.wcs !== 'HOLD') for (const e of tracked(s)) if (e.tag === 'trg') S.playerId(s, e, 'HOS'); }],
      bad:[{mode:'SEMI'}, s => { if (s.t > 120) S.ack(s); for (const e of tracked(s)) if (e.tag === 'trg') S.playerId(s, e, 'HOS'); }]},
  t7:{good:[{mode:'SEMI'}, s => declareAll(s, correctId)], bad:[{mode:'MANUAL'}, s => declareAll(s, correctId)]},
  t8:{good:[{mode:'SEMI', doctrine:{TBM:'SLS'}}, s => { S.ack(s); declareAll(s, e => e.T.decoy ? 'UNK' : correctId(e)); }], bad:[{mode:'AUTO'}, s => {}]},
};
let fails = 0;
for (const [id, t] of Object.entries(tables)){
  const seeds = [11, 22, 33, 44, 55];
  const good = seeds.map(seed => run(id, {...t.good[0], seed}, t.good[1]));
  const bad = seeds.map(seed => run(id, {...t.bad[0], seed}, t.bad[1]));
  const gp = good.filter(r => r.pass).length, bp = bad.filter(r => r.pass).length;
  const firstFail = good.find(r => !r.pass);
  console.log(`${id}  correct crew passes ${gp}/5   sloppy crew passes ${bp}/5${firstFail ? '   e.g. failed: ' + firstFail.objs.filter(o => !o.ok).map(o => o.t).join('; ') : ''}`);
  if (gp < 4 || bp > 1) fails++;
}
process.exit(fails ? 1 : 0);
