// HOSTILE TRACK — deterministic simulation core. No DOM access: runs headless in tests.
const HT_SIM = (() => {
const D = (typeof HT_DATA !== 'undefined') ? HT_DATA : require('./data.js');
const {TYPES, WEAPONS, MAP} = D;
const DEG = Math.PI / 180, DT = 0.05;
const RADAR = {rmax:170, half:60, h:.005};
const PRI_W = {1:1, 2:.6, 3:.35};

// ---------- math helpers ----------
function rng32(seed){ let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const brgOf = (dx, dy) => (Math.atan2(dx, dy) / DEG + 360) % 360;
const polar = (b, r, o) => ({x:(o ? o.x : 0) + Math.sin(b * DEG) * r, y:(o ? o.y : 0) + Math.cos(b * DEG) * r});
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const horizon = z => 4.12 * (Math.sqrt(RADAR.h * 1000) + Math.sqrt(Math.max(0, z) * 1000));
function segInter(ax, ay, bx, by, cx, cy, dx, dy){
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return u > 0 && u < 1 && v > 0 && v < 1;
}
function segParam(ax, ay, bx, by, cx, cy, dx, dy){ // param along AB of intersection with CD, or null
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(d) < 1e-9) return null;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return (u > 0 && u < 1 && v > 0 && v < 1) ? u : null;
}
function distSeg(px, py, ax, ay, bx, by){ const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function distPoly(px, py, pts){ let m = 1e9; for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, distSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return m; }
function pip(poly, x, y){ let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){ const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }

// ---------- terrain ----------
function hash2(i, j, s){ let h = (i * 374761393 + j * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s){ const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
function fbm(x, y, s){ let t = 0, a = .5, f = 1; for (let k = 0; k < 4; k++){ t += a * vnoise(x * f, y * f, s + k * 17); f *= 2; a *= .5; } return t; }
function isLand(map, x, y){ let inP = false; for (const p of map.polys || []) if (pip(p, x, y)){ inP = true; break; } return map.landDefault ? !inP : inP; }
function heightAt(map, x, y){
  if (!isLand(map, x, y)) return -1;
  let h = fbm(x / (map.nscale || 45), y / (map.nscale || 45), map.seed || 7) * (map.namp || .3);
  for (const r of map.ridges || []){ const d = distSeg(x, y, r.a[0], r.a[1], r.b[0], r.b[1]), w = r.w || 8; h = Math.max(h, r.h * Math.exp(-(d * d) / (w * w)) + h * .3); }
  return h;
}
function masked(map, sx, sy, x, y, z){
  for (const r of map.ridges || []) if (z < r.h * .95 && segInter(sx, sy, x, y, r.a[0], r.a[1], r.b[0], r.b[1])) return true;
  return false;
}
function lowAltReach(map, sx, sy, b, z){ // distance at which a target at alt z first disappears along bearing b
  let r = Math.min(horizon(z), RADAR.rmax); const e = polar(b, RADAR.rmax, {x:sx, y:sy});
  for (const rd of map.ridges || []){ if (z >= rd.h * .95) continue; const u = segParam(sx, sy, e.x, e.y, rd.a[0], rd.a[1], rd.b[0], rd.b[1]); if (u != null) r = Math.min(r, u * RADAR.rmax); }
  return r;
}

function coverage(scn, site, ptl){
  const map = MAP[scn.map];
  const assets = scn.assets.map(a => { const dx = a.x - site.x, dy = a.y - site.y, d = Math.hypot(dx, dy); const b = brgOf(dx, dy); return {a, b, d, ok: d < 2.5 || Math.abs(angDiff(b, ptl)) <= RADAR.half}; });
  const axis = (scn.axis || []).map(b => ({b, ok: Math.abs(angDiff(b, ptl)) <= RADAR.half, reach: lowAltReach(map, site.x, site.y, b, .1)}));
  return {assets, axis, ok: assets.every(x => x.ok) && axis.every(x => x.ok)};
}

// ---------- speech helpers ----------
const DIG = ['zero','one','two','three','four','five','six','seven','eight','niner'];
const spoken = n => String(n).split('').map(c => DIG[+c] ?? c).join(' ');
const brgS = b => spoken(String(Math.round(b) % 360).padStart(3, '0'));

// ---------- creation ----------
function createSim(scn, o = {}){
  const seed = (o.seed >>> 0) || 20261013;
  const rng = rng32(Math.imul(seed ^ 0x9E3779B9, 2654435761) >>> 0);
  const map = MAP[scn.map];
  const siteI = o.site || 0, site = scn.sites[siteI] || scn.sites[0];
  const S = {scn, map, seed, rng, t:0, ents:[], ms:[], plans:[], out:[], log:[], ev:[], snaps:[],
    uid:1, mid:1, pid:1, trkNext:1000 + Math.floor(rng() * 700),
    bat:{x:site.x, y:site.y, site:siteI, ptl:o.ptl != null ? o.ptl : scn.ptl, alive:true, emcon:false, reorient:0, newPtl:null, displace:0, dispTo:null, radarFault:0, epp:0, silentFor:0, half:60, sector:'WIDE'},
    wcs:scn.wcs, adw:scn.adw, mode:o.mode || scn.mode,
    doctrine:Object.assign({TBM:'RIPPLE', AIR:'SLS', UAV:'SINGLE'}, o.doctrine || {}),
    launchers:[], reserve:{MSE:0, GEMT:0}, loaded:{MSE:0, GEMT:0},
    assets:scn.assets.map(a => ({...a, hpMax:a.hp || 2, hp:a.hp || 2})),
    acks:[], ceaseUntil:-1, spawns:[], si:0, orderQ:[], faultQ:[], threatsLeft:0, threatsTotal:0, lastThreatT:0,
    neighbors:(scn.neighbors || []).map(n => ({...n, on:true, cool:0})),
    st:{fired:{GEMT:0, MSE:0}, spent:0, killVal:0, wasted:0, waste:{decoy:0, fals:0, nondal:0, protect:0}, mseDrone:0, viol:0, lateAck:0, misId:0, frat:0, hitsW:0, potW:0, leak:0, kills:0, miss:0, radarLost:false, lsLost:0, vetoes:0, debris:0, engMissed:0, outSector:0, holdSaves:0},
    xp:o.xp || 0, tut:scn.tutorial || null, diff:o.difficulty || 'normal',
    ended:false, endAt:null, endReason:'', idLog:{}, n:0, inputs:[], replayQ:null, faults:[], radar:{load:0, searchF:1, trackPct:8}, radiateT:0, wccSlow:0, nextSnap:0, nextAuto:0, firstHostile:false, firstTbm:false, idCount:0,
  };
  const stock = o.stock ? {...o.stock} : null;
  const take = (k, n) => { if (!stock) return n; const g = Math.min(n, stock[k]); stock[k] -= g; return g; };
  scn.launchers.forEach((L, i) => {
    const type = L[0], cap = type === 'MSE' ? {MSE:12, GEMT:0} : type === 'GEMT' ? {MSE:0, GEMT:4} : {MSE:6, GEMT:2};
    const mse = take('MSE', L[1]), gemt = take('GEMT', L[2]);
    S.launchers.push({id:i + 1, type, cap, MSE:mse, GEMT:gemt, state:'READY', timer:0, x:0, y:0, dead:false, pend:null});
    S.loaded.MSE += mse; S.loaded.GEMT += gemt;
  });
  S.reserve.MSE = take('MSE', (scn.reserve && scn.reserve.MSE) || 0);
  S.reserve.GEMT = take('GEMT', (scn.reserve && scn.reserve.GEMT) || 0);
  S.loaded.MSE += S.reserve.MSE; S.loaded.GEMT += S.reserve.GEMT;
  S.opts = JSON.parse(JSON.stringify(o));
  S.tca = makeTca(o.tca);
  placeLaunchers(S);
  S.red = planRed(S, o.red);
  S.redWaves = [].concat(...S.red.map(t => t.waves || []));
  buildSpawns(S);
  S.orderQ = (scn.orders || []).slice().sort((a, b) => a.t - b.t);
  buildFaults(S);
  S.cover = coverage(scn, site, S.bat.ptl);
  return S;
}

function placeLaunchers(S){
  const n = S.launchers.length, b = S.bat;
  S.launchers.forEach((L, i) => { const p = polar(b.ptl + 180 + (i - (n - 1) / 2) * 30, 1.3 + (i % 2) * .5, b); L.x = p.x; L.y = p.y; });
}

function assetById(S, id){ return S.assets.find(a => a.id === id); }
function priOf(S, id){ if (id === 'BTY') return 1; const a = assetById(S, id); return a ? a.pri : 3; }

function missPoint(S){
  for (let k = 0; k < 30; k++){
    const p = polar(S.rng() * 360, 14 + S.rng() * 24, {x:0, y:0});
    if (S.assets.every(a => Math.hypot(a.x - p.x, a.y - p.y) > 7) && Math.hypot(p.x - S.bat.x, p.y - S.bat.y) > 7) return p;
  }
  return polar(S.rng() * 360, 40, {x:0, y:0});
}

function resolveTarget(S, tgt){
  if (tgt === 'miss') return {pt:missPoint(S), id:null};
  if (tgt === 'battery') return {pt:{x:S.bat.x + (S.rng() - .5) * .4, y:S.bat.y + (S.rng() - .5) * .4}, id:'BTY'};
  const a = assetById(S, tgt);
  if (!a) return {pt:missPoint(S), id:null};
  return {pt:{x:a.x + (S.rng() - .5) * .6, y:a.y + (S.rng() - .5) * .6}, id:a.id};
}

function addSpawn(S, t, fn, threat){ S.spawns.push({t, fn, threat}); if (threat){ S.threatsLeft++; S.threatsTotal++; S.lastThreatT = Math.max(S.lastThreatT, t); } }

function routeLen(pts){ let L = 0; for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); return L; }
function placeOnRoute(e, frac){
  let d = routeLen(e.wp) * frac; e.x = e.wp[0].x; e.y = e.wp[0].y; e.wi = 1;
  while (e.wi < e.wp.length){ const w = e.wp[e.wi], s = Math.hypot(w.x - e.x, w.y - e.y); if (s >= d){ if (s > 0){ e.x += (w.x - e.x) / s * d; e.y += (w.y - e.y) / s * d; } return; } d -= s; e.x = w.x; e.y = w.y; e.wi++; }
  e.wi = e.wp.length - 1;
}

function mkEnt(S, kind, o){
  const T = TYPES[kind];
  const e = {uid:S.uid++, kind, T, truth:T.truth, x:0, y:0, z:o.alt != null ? o.alt : (T.alt || 0), alt:o.alt != null ? o.alt : (T.alt || 0), vx:0, vy:0, alive:true, born:S.t,
    tag:o.tag || null, tgt:o.tgt || null, tgtPt:o.tgtPt || null, dmg:T.dmg, iffFail:!!o.iffFail, squawk:o.squawk || null, trk:null, phase:S.rng() * 6.28, model:o.model || 'route', speed:o.speed || T.speed};
  Object.assign(e, o.extra || {});
  if (e.model === 'route'){ e.wp = o.wp; e.loop = o.loop || false; e.loopTo = o.loopTo || 0; e.onEnd = o.onEnd || 'exit'; e.x = e.wp[0].x; e.y = e.wp[0].y; e.wi = 1; if (o.frac) placeOnRoute(e, o.frac); }
  S.ents.push(e);
  return e;
}

function squawkCode(S){ let s = ''; for (let i = 0; i < 4; i++) s += Math.floor(S.rng() * 8); return s === '7500' || s === '7600' || s === '7700' ? '2' + s.slice(1) : s; }

function buildSpawns(S){
  const scn = S.scn, map = S.map, rng = S.rng;
  const P = p => ({x:p[0], y:p[1]});
  for (const c of scn.civil || []){
    const aw = map.airways[c.aw]; if (!aw) continue;
    for (let k = 0; k < c.n; k++){
      const t = c.t0 + k * c.every + rng() * 12, rev = rng() < .5, frac = k < 2 ? .2 + rng() * .45 : rng() * .25, alt = (c.alt || aw.alt) + (rng() - .5) * 2;
      const pts = aw.pts.map(P); if (rev) pts.reverse();
      const sq = squawkCode(S);
      addSpawn(S, t, () => mkEnt(S, 'CIV', {wp:pts, frac, alt, squawk:sq, onEnd:'exit'}));
    }
  }
  for (const d of scn.deviants || []){
    const aw = map.airways[d.aw];
    addSpawn(S, d.t, () => {
      const pts = aw.pts.map(P), e0 = mkEnt(S, 'CIV', {wp:pts, frac:.72, alt:aw.alt, squawk:d.squawk, tag:d.tag || 'dev'});
      const here = {x:e0.x, y:e0.y}, to = P(d.to), away = polar(brgOf(to.x - here.x, to.y - here.y) + 25, 220, to);
      e0.wp = [here, to, away]; e0.wi = 1; e0.deviant = true; e0.alt = Math.min(e0.alt, 6);
    });
  }
  for (const f of scn.friendly || []){
    const cor = map.corridors[f.cor]; if (!cor) continue;
    for (let i = 0; i < f.n; i++){
      const iffFail = (f.iffFail || []).includes(i);
      addSpawn(S, f.t + i * 14, () => {
        let pts = cor.pts.map(P); if (f.out) pts.reverse();
        const kind = f.type || 'FRD';
        const e = mkEnt(S, kind, {wp:pts, frac:f.out ? 0 : .45, tag:f.tag || null, iffFail, onEnd:'exit', alt:TYPES[kind].alt + (rng() - .5)});
        if (iffFail) e.iffInter = true;
      });
    }
  }
  for (const ot of scn.others || []){
    addSpawn(S, ot.t, () => mkEnt(S, ot.type, {wp:ot.route.map(P), alt:ot.alt, loop:!!ot.loop, tag:ot.tag || null, onEnd:'exit'}));
  }
  let waves = scn.waves || [];
  if (scn.random) waves = randomWaves(S, scn);
  waves = waves.concat(S.redWaves || []);
  for (const w of waves){
    for (let i = 0; i < w.n; i++){
      const t = w.t + i * (w.every || 3) + (w.every ? rng() * w.every * .3 : 0);
      const tg = i >= w.n - (w.miss || 0) ? 'miss' : (w.targets ? w.targets[i % w.targets.length] : 'miss');
      const isThreat = !['JAM','UAV'].includes(w.type);
      addSpawn(S, t, () => spawnThreat(S, w, tg, i), isThreat);
    }
  }
  S.spawns.sort((a, b) => a.t - b.t);
}

function randomWaves(S, scn){
  const r = S.rng, lo = scn.random.lo, hi = scn.random.hi, ids = scn.assets.map(a => a.id);
  const pool = [['SRBM',3,5],['OWA',6,10],['CM',3,6],['DECOY',4,8],['MRBM',3,6],['ABM',2,4],['FTR',1,2],['JAM',1,2],['HELO',2,3]];
  const out = []; const n = 6 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++){
    const p = pool[Math.floor(r() * pool.length)], cnt = p[1] + Math.floor(r() * (p[2] - p[1] + 1)), brg = lo + r() * (hi - lo);
    const t = 20 + k * (430 / n) + r() * 20;
    const ballistic = TYPES[p[0]].ballistic;
    const range = ballistic ? (p[0] === 'MRBM' ? 650 : p[0] === 'ABM' ? 380 : 300) : p[0] === 'FTR' || p[0] === 'JAM' ? 200 : p[0] === 'HELO' ? 45 : p[0] === 'CM' ? 160 : 90;
    const tg = []; for (let i = 0; i < cnt; i++) tg.push(ids[Math.floor(r() * ids.length)]);
    out.push({t, type:p[0], n:cnt, brg, spread:10, range, every:ballistic ? 3 : 8, targets:tg, miss:Math.floor(r() * 2), role:p[0] === 'FTR' ? (r() < .5 ? 'sead' : 'standoff') : undefined, arm:2, cm:2, alt:p[0] === 'CM' ? .04 : undefined});
  }
  return out;
}

function spawnThreat(S, w, tg, i){
  const T = TYPES[w.type], rng = S.rng;
  const b = w.brg + (rng() * 2 - 1) * (w.spread || 0);
  const origin = {x:0, y:0};
  if (T.ballistic){
    const R = resolveTarget(S, tg);
    const L = polar(b, w.range, R.pt), I = R.pt;
    const e = mkEnt(S, w.type, {model:'bal', tgt:R.id, tgtPt:I, tag:w.tag});
    e.L = L; e.I = I; e.t0 = S.t; e.T0 = Math.hypot(I.x - L.x, I.y - L.y) / T.speed; e.H = T.apogee * Math.min(1, Math.sqrt(w.range / 400)) + 10; e.x = L.x; e.y = L.y; e.z = 0;
    if (T.maneuver){ e.manA = 1.2 + rng() * 1.2; e.manK = 2 + rng() * 2; }
    if (R.id) S.st.potW += e.dmg * PRI_W[priOf(S, R.id)];
    return e;
  }
  if (w.type === 'JAM'){
    const p1 = polar(b - 6, w.range, origin), p2 = polar(b + 6, w.range, origin);
    const e = mkEnt(S, 'JAM', {wp:[p1, p2], loop:true, tag:w.tag}); e.jamT = 10 + rng() * 10; return e;
  }
  if (w.type === 'UAV' && w.role === 'recon'){
    const P0 = polar(b, w.range, S.bat); const pts = [P0];
    for (let k = 0; k < 6; k++) pts.push(polar(k * 60 + rng() * 20, 9, S.bat));
    const e = mkEnt(S, 'UAV', {wp:pts, loop:true, loopTo:1, tag:w.tag}); e.role = 'recon'; e.fixT = 0; return e;
  }
  if (w.type === 'FTR'){
    const P0 = polar(b, w.range, origin);
    const R = tg !== 'miss' ? resolveTarget(S, tg) : {pt:missPoint(S), id:null};
    let wp, role = w.role || 'standoff';
    if (role === 'standoff'){ const rel = polar(brgOf(P0.x - R.pt.x, P0.y - R.pt.y), 50, R.pt); wp = [P0, rel, P0]; }
    else if (role === 'sead'){ const near = polar(brgOf(P0.x - S.bat.x, P0.y - S.bat.y), 62, S.bat); wp = [P0, near, P0]; }
    else { const beyond = polar(brgOf(R.pt.x - P0.x, R.pt.y - P0.y), 120, R.pt); wp = [P0, R.pt, beyond]; }
    const e = mkEnt(S, 'FTR', {wp, alt:w.alt || TYPES.FTR.alt, tag:w.tag, onEnd:'exit'});
    e.role = role; e.cm = w.cm || 2; e.arm = w.arm || 2; e.armCool = 0; e.cmTargets = (w.targets || []).filter(x => x !== 'miss');
    return e;
  }
  // generic air-breathing threat
  const R = resolveTarget(S, tg);
  const cap = T.cls === 'CM' ? 115 : (T.speed < .25 ? 80 : 400);
  const P0 = polar(b, Math.min(w.range, cap), origin);
  const wp = [P0];
  for (const v of w.via || []) wp.push(polar(v.brg, v.r, origin));
  wp.push(R.pt);
  const e = mkEnt(S, w.type, {wp, alt:w.alt, tgt:R.id, tgtPt:R.pt, tag:w.tag, onEnd:'impact'});
  if (w.attrit && rng() < w.attrit) e.attritAt = S.t + 60 + rng() * 160;
  if (R.id && e.dmg > 0) S.st.potW += e.dmg * PRI_W[priOf(S, R.id)];
  return e;
}

function buildFaults(S){
  const f = S.scn.faults;
  if (Array.isArray(f)){ S.faultQ = f.slice(); return; }
  if (f === 'none' || S.diff === 'off') return;
  const n = S.diff === 'hard' ? 4 : 2, kinds = ['RADAR', 'LS', 'EPP', 'LS', 'WCC'];
  for (let i = 0; i < n; i++) S.faultQ.push({t:100 + S.rng() * Math.max(60, S.scn.dur - 200), k:kinds[Math.floor(S.rng() * kinds.length)]});
  S.faultQ.sort((a, b) => a.t - b.t);
}

// ---------- outputs ----------
function say(S, who, text, opt = {}){
  S.log.push({t:S.t, who, text, cls:opt.cls || ''});
  if (who === 'TCA' && S.tca && (opt.pri || 1) < 3 && S.tca.fatigue > .2 && ((S.n * 7919 + text.length) % 100) / 100 < S.tca.fatigue * .4) return;
  if (!opt.silent) S.out.push({k:'say', who, text:opt.speak || text, pri:opt.pri || 1});
}
const tone = (S, v) => S.out.push({k:'tone', v});
function ev(S, k, text, extra = {}){ S.ev.push({t:S.t, k, text, ...extra}); }
const callsign = S => S.scn.bty.startsWith('BATTERY') ? S.scn.bty.charAt(0) + S.scn.bty.slice(1).toLowerCase() : S.scn.bty.split(' ')[0].charAt(0) + S.scn.bty.split(' ')[0].slice(1).toLowerCase();
const tdName = S => S.scn.td;
const trkName = e => e.trk && e.trk.num ? e.trk.num : '----';

// ---------- radar ----------
function radarOn(S){ const b = S.bat; return b.alive && !b.emcon && b.reorient <= 0 && b.displace <= 0 && b.epp <= 0; }
function jamFactor(S, brg, r){
  let f = 1;
  for (const j of S.ents) if (j.alive && j.kind === 'JAM'){
    const jb = brgOf(j.x - S.bat.x, j.y - S.bat.y);
    if (Math.abs(angDiff(brg, jb)) < 5 && r > 30) f = Math.min(f, .35);
  }
  return f;
}
function detects(S, src, e, own){
  const dx = e.x - src.x, dy = e.y - src.y, r = Math.hypot(dx, dy);
  if (r < .3) return true;
  const brg = brgOf(dx, dy);
  if (Math.abs(angDiff(brg, src.ptl)) > (src.half || RADAR.half)) return false;
  let R = RADAR.rmax * Math.pow(e.T.rcs, .25);
  if (own){ if (S.bat.radarFault > 0) R *= .6; R *= jamFactor(S, brg, r) * S.radar.searchF * (S.bat.half < 60 ? 1.25 : 1); }
  if (r > R) return false;
  if (r > horizon(e.z)) return false;
  if (masked(S.map, src.x, src.y, e.x, e.y, e.z)) return false;
  return true;
}
function onAirway(S, e){ return e.z > 2 && (S.map.airways || []).some(a => distPoly(e.x, e.y, a.pts) < 7); }
function inCorridor(S, e){ return (S.map.corridors || []).some(c => distPoly(e.x, e.y, c.pts) < 7); }

function interrogate(S, e, manual){
  if (e.T.ballistic || e.kind === 'ARM') return 'NO RESP';
  if (e.truth === 'F'){ if (e.iffFail) return manual && e.iffInter && S.rng() < .35 ? 'M4 VALID' : 'NO RESP'; return 'M4 VALID'; }
  if (e.truth === 'N') return `M3 ${e.squawk} · M-C FL${Math.round(e.z * 32.8)}`;
  return 'NO RESP';
}

function setId(S, e, id, by){
  const k = e.trk; if (!k) return;
  if (k.id === id && k.idBy === by) return;
  k.id = id; k.idBy = by;
  if (by === 'PLAYER'){
    S.idLog[e.uid] = {id, truth:e.truth, kind:e.kind, tag:e.tag, dev:!!e.deviant, iffFail:e.iffFail};
    ev(S, 'ID', `TRK ${k.num} declared ${id}`, {trk:k.num, uid:e.uid});
    const wrong = (id === 'HOS' && (e.truth === 'F' || e.truth === 'N')) || ((id === 'FRD' || id === 'NEU') && e.truth === 'H');
    if (wrong && !e.misIdCounted){ e.misIdCounted = true; S.st.misId++; }
    if (id === 'HOS' && k.iff === 'M4 VALID') say(S, 'TCA', `Sir, track ${k.num} is squawking Mode 4 valid.`, {speak:`Sir, track ${spoken(k.num)} is squawking mode four valid`});
  } else if (by === 'AUTO' && id === 'HOS' && !e.T.ballistic && S.mode === 'AUTO' && e.kind !== 'ARM'){
    say(S, 'TCA', `Computer declared track ${k.num} hostile. No IFF response.`, {speak:`Computer declares track ${spoken(k.num)} hostile`});
  }
}

function autoId(S, e){
  const k = e.trk; if (!k || k.idBy === 'PLAYER') return;
  if ((e.T.ballistic || e.kind === 'ARM') && k.cls){ setId(S, e, 'HOS', 'AUTO'); return; }
  if (S.tut && S.tut.noAutoId) return;
  if (k.iff === 'M4 VALID'){ setId(S, e, 'FRD', 'AUTO'); return; }
  if (k.iff && k.iff.startsWith('M3') && onAirway(S, e)){ setId(S, e, 'NEU', 'AUTO'); return; }
  if (k.cls && k.id === 'PND') setId(S, e, 'UNK', 'AUTO');
}

function establish(S, e){
  const k = e.trk; k.est = true; k.num = S.trkNext++; e.everTrk = true;
  if (S.trkNext % 100 === 99) S.trkNext += 2;
  if (!e.T.ballistic && e.kind !== 'FALSE') k.iff = interrogate(S, e, false);
  else if (e.kind === 'FALSE') k.iff = 'NO RESP';
  autoId(S, e);
  const b = brgOf(e.x - S.bat.x, e.y - S.bat.y), r = Math.hypot(e.x - S.bat.x, e.y - S.bat.y);
  if (!k.remote && Math.abs(angDiff(b, S.bat.ptl)) > 50) S.st.outSector++;
  ev(S, 'TRK', `New track ${k.num} · ${Math.round(b).toString().padStart(3,'0')}° · ${Math.round(r)} km${k.remote ? ' (remote)' : ''}`, {trk:k.num, uid:e.uid, quiet:true});
  S.log.push({t:S.t, who:'SYS', text:`NEW TRACK ${k.num}  BRG ${Math.round(b).toString().padStart(3,'0')}  RNG ${Math.round(r)} KM${k.remote ? '  REMOTE ' + (k.remName || '') : ''}`, cls:'sys'});
  if (!e.T.ballistic && e.truth !== 'N' && k.iff === 'NO RESP' && r < 120 && e.kind !== 'FALSE'){
    tone(S, 'new');
    if (S.tca && inCorridor(S, e) && S.rng() < tcaEff(S)) say(S, 'TCA', `Track ${k.num} is silent but flying the lane. Could be a friendly with a dead Mode 4.`, {pri:2, speak:`Track ${spoken(k.num)} is silent but in the lane. Possible friendly, dead mode four`});
  }
}

function classify(S, e){
  const k = e.trk; k.cls = true;
  autoId(S, e);
  if (e.T.ballistic){
    tone(S, 'tbm');
    const a = assess(S, e);
    say(S, 'TCA', `Track ${k.num}, ${e.T.cls}, hostile. ${a.dal ? 'Impact ' + a.dal.name + ', ' + Math.round(a.tta) + ' seconds.' : 'Impact outside the defended area.'}`,
      {speak:`Track ${spoken(k.num)}, ${e.T.cls === 'ABM' ? 'aero ballistic' : 'T B M'}, hostile. ${a.dal ? 'Impact ' + a.dal.name + ', ' + Math.round(a.tta) + ' seconds' : 'No D A L threat'}`, pri:3});
    if (!S.firstTbm){ S.firstTbm = true; if (S.adw !== 'RED'){ S.adw = 'RED'; tone(S, 'klaxon'); order(S, {k:'ADW', v:'RED', text:`All stations, ${tdName(S)}. Ballistic missile warning. ADW Red.`}); } }
  } else if (e.kind === 'ARM'){
    tone(S, 'hostile'); say(S, 'TCA', `Track ${k.num}, anti-radiation missile, inbound on us!`, {speak:`Track ${spoken(k.num)}, A R M inbound on us`, pri:3});
  }
}

function dropTrack(S, e){ e.trk = null; }

function updateTracks(S, dt){
  const on = radarOn(S), own = {x:S.bat.x, y:S.bat.y, ptl:S.bat.ptl, half:S.bat.half};
  for (const e of S.ents){
    if (!e.alive) continue;
    const ownDet = on && detects(S, own, e, true);
    let remDet = false, remName = null;
    if (!ownDet) for (const nb of S.neighbors) if (nb.on && detects(S, nb, e, false)){ remDet = true; remName = nb.name; break; }
    if (e.kind === 'FALSE' && !ownDet) remDet = false;
    if (ownDet || remDet){
      if (!e.trk) e.trk = {num:0, q:0, est:false, cls:false, id:'PND', idBy:'', last:S.t, remote:!ownDet, iff:null, hold:false, firstT:S.t, remName, zs:[]};
      const k = e.trk; k.last = S.t; k.remote = !ownDet; k.remName = remName;
      const rate = e.T.ballistic ? .7 : .35;
      k.q = Math.min(e.kind === 'FALSE' ? .45 : 1, k.q + dt * rate * (ownDet ? 1 : .6));
      if (!k.est && k.q >= .3) establish(S, e);
      if (k.est && !k.cls && k.q >= .6) classify(S, e);
    } else if (e.trk){
      if (S.t - e.trk.last > 8) dropTrack(S, e); else e.trk.q = Math.max(.05, e.trk.q - dt * .05);
    }
  }
}

// ---------- motion ----------
function balPos(e, t){
  const s = (t - e.t0) / e.T0;
  const x = e.L.x + (e.I.x - e.L.x) * s, y = e.L.y + (e.I.y - e.L.y) * s;
  let z = e.T.maneuver ? e.H * Math.pow(Math.sin(Math.PI * Math.min(1, s)), .8) * (1 - .3 * s) : 4 * e.H * s * (1 - s);
  return {x, y, z:Math.max(0, z), s};
}
function walk(e, dist){
  let x = e.x, y = e.y, wi = e.wi, rem = dist, guard = 0;
  while (rem > 0 && guard++ < 50){
    const w = e.wp[wi], dx = w.x - x, dy = w.y - y, d = Math.hypot(dx, dy);
    if (d <= rem){ x = w.x; y = w.y; rem -= d; wi++; if (wi >= e.wp.length){ if (e.loop) wi = e.loopTo; else return {x, y, z:e.z, end:true}; } }
    else { x += dx / d * rem; y += dy / d * rem; rem = 0; }
  }
  return {x, y, z:e.z, end:false};
}
function predict(S, e, dt){
  if (!e.alive) return {x:e.x, y:e.y, z:e.z, end:true};
  if (e.model === 'bal'){ const t = S.t + dt; if (t >= e.t0 + e.T0) return {x:e.I.x, y:e.I.y, z:0, end:true}; const p = balPos(e, t); return {x:p.x, y:p.y, z:p.z, end:false}; }
  if (e.model === 'false') return {x:e.x + e.vx * dt, y:e.y + e.vy * dt, z:e.z, end:false};
  const p = walk(e, e.speed * dt);
  if (e.kind === 'ARM'){ const d = Math.hypot(p.x - S.bat.x, p.y - S.bat.y); p.z = Math.min(e.alt, d / 9); }
  return p;
}

function stepEnt(S, e, dt){
  if (e.model === 'bal'){
    const p = balPos(e, S.t);
    if (p.s >= 1){ impact(S, e, e.I.x, e.I.y); return; }
    let x = p.x, y = p.y;
    if (e.T.maneuver && p.s > .6){ const k = (p.s - .6) / .4, off = e.manA * Math.sin(p.s * Math.PI * e.manK) * k, hb = brgOf(e.I.x - e.L.x, e.I.y - e.L.y) + 90; const o = polar(hb, off); x += o.x; y += o.y; }
    e.vx = (x - e.x) / dt; e.vy = (y - e.y) / dt; e.vz = (p.z - e.z) / dt; e.x = x; e.y = y; e.z = p.z;
    return;
  }
  if (e.model === 'false'){
    e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt;
    if (S.rng() < dt * .3){ e.vx += (S.rng() - .5) * .08; e.vy += (S.rng() - .5) * .08; }
    if (e.life <= 0) e.alive = false;
    return;
  }
  const ox = e.x, oy = e.y;
  let rem = e.speed * dt, guard = 0;
  while (rem > 0 && e.alive && guard++ < 20){
    const w = e.wp[e.wi], dx = w.x - e.x, dy = w.y - e.y, d = Math.hypot(dx, dy);
    if (d <= rem){
      e.x = w.x; e.y = w.y; rem -= d; e.wi++;
      if (e.wi >= e.wp.length){ if (e.loop) e.wi = e.loopTo; else { routeEnd(S, e); break; } }
    } else { e.x += dx / d * rem; e.y += dy / d * rem; rem = 0; }
  }
  e.vx = (e.x - ox) / dt; e.vy = (e.y - oy) / dt;
  // altitude behaviour
  if (e.kind === 'ARM'){ const d = Math.hypot(e.x - S.bat.x, e.y - S.bat.y); e.z = Math.min(e.alt, d / 9); }
  else if (e.T.altVar) e.z = e.alt + e.T.altVar * Math.sin(S.t * .23 + e.phase) + e.T.altVar * .5 * Math.sin(S.t * .61 + e.phase * 2);
  else e.z += (e.alt - e.z) * Math.min(1, dt * .2);
  // roles
  if (e.kind === 'FTR' && e.alive){
    if (e.role === 'standoff' && !e.released && e.wi >= 2){
      e.released = true;
      for (let i = 0; i < e.cm; i++){
        const tg = e.cmTargets.length ? e.cmTargets[i % e.cmTargets.length] : 'miss';
        const R = resolveTarget(S, tg);
        const c = mkEnt(S, 'CM', {wp:[{x:e.x + (S.rng() - .5) * 2, y:e.y + (S.rng() - .5) * 2}, R.pt], alt:.05, tgt:R.id, tgtPt:R.pt, onEnd:'impact'});
        c.z = 1.5; if (R.id) S.st.potW += c.dmg * PRI_W[priOf(S, R.id)];
        S.threatsTotal++;
      }
      if (e.trk && e.trk.est) say(S, 'TCA', `Track ${e.trk.num} has released weapons.`, {speak:`Track ${spoken(e.trk.num)} weapons release`, pri:2});
    }
    if (e.role === 'sead'){
      e.armCool -= dt;
      const d = Math.hypot(e.x - S.bat.x, e.y - S.bat.y);
      if (e.arm > 0 && d < 90 && radarOn(S) && e.armCool <= 0){
        e.arm--; e.armCool = 6;
        const a = mkEnt(S, 'ARM', {wp:[{x:e.x, y:e.y}, {x:S.bat.x, y:S.bat.y}], alt:e.z, tgt:'BTY', tgtPt:{x:S.bat.x, y:S.bat.y}, onEnd:'impact'});
        a.z = e.z; a.armT0 = S.t; a.silentT = 0; S.st.potW += a.dmg; S.threatsTotal++;
      }
    }
  }
  if (e.kind === 'ARM' && e.alive){ if (!radarOn(S)) e.silentT += dt; if (e.silentT > 4) e.lost = true; }
  if (e.kind === 'JAM'){
    e.jamT -= dt;
    if (e.jamT <= 0){ e.jamT = 16 + S.rng() * 14; spawnFalse(S, e); }
  }
  if (e.role === 'recon' && e.alive){
    const d = Math.hypot(e.x - S.bat.x, e.y - S.bat.y);
    if (d < 25) e.fixT += dt;
    const need = (S.scn.recon && S.scn.recon.fix) || 70;
    if (!e.fixed && e.fixT >= need){
      e.fixed = true; const fixPos = {x:S.bat.x, y:S.bat.y};
      say(S, 'TCA', 'Recon drone has been overhead over a minute. Expect a strike on our position.', {pri:3});
      ev(S, 'FIX', 'Enemy recon fixed the battery position');
      const sb = (S.scn.recon && S.scn.recon.strikeBrg) || 150;
      for (let i = 0; i < 2; i++) addSpawn(S, S.t + 20 + i * 3, () => {
        const L = polar(sb + (S.rng() - .5) * 6, 230, fixPos), I = {x:fixPos.x + (S.rng() - .5) * .5, y:fixPos.y + (S.rng() - .5) * .5};
        const m = mkEnt(S, 'SRBM', {model:'bal', tgt:'BTY', tgtPt:I});
        m.L = L; m.I = I; m.t0 = S.t; m.T0 = 230 / TYPES.SRBM.speed; m.H = 60; m.x = L.x; m.y = L.y; m.z = 0; m.fixStrike = true;
        S.st.potW += m.dmg;
      }, true);
      S.spawns.sort((a, b) => a.t - b.t);
    }
  }
  if (e.attritAt && S.t >= e.attritAt && e.alive && Math.hypot(e.x, e.y) > 30){
    e.alive = false; e.attrited = true;
    if (e.trk && e.trk.est) say(S, 'TD', `${callsign(S)}, ${tdName(S)}. Splash track ${e.trk.num}, friendly air.`, {pri:1, silent:S.rng() < .6});
  }
}

function spawnFalse(S, j){
  const jb = brgOf(j.x - S.bat.x, j.y - S.bat.y);
  const p = polar(jb + (S.rng() - .5) * 8, 50 + S.rng() * 80, S.bat);
  const e = mkEnt(S, 'FALSE', {model:'false', alt:1 + S.rng() * 8});
  e.x = p.x; e.y = p.y; const inb = polar(jb + 180 + (S.rng() - .5) * 60, .08 + S.rng() * .2); e.vx = inb.x; e.vy = inb.y; e.life = 25 + S.rng() * 35;
}

function routeEnd(S, e){
  if (e.onEnd === 'impact') impact(S, e, e.x, e.y);
  else { e.alive = false; e.exited = true; }
}

function impact(S, e, x, y){
  e.alive = false; e.impacted = true;
  if (e.truth !== 'H' || e.dmg <= 0){
    if (e.T.decoy && e.trk && e.trk.est) ev(S, 'DECOY', `Track ${e.trk.num} crashed. No warhead: decoy.`, {trk:e.trk.num});
    return;
  }
  let ix = x, iy = y;
  if (e.kind === 'ARM' && e.lost){ const o = polar(S.rng() * 360, 2.5 + S.rng() * 2); ix += o.x; iy += o.y; ev(S, 'ARM', 'ARM lost the radar and missed', {good:true}); say(S, 'TCA', 'ARM impact, wide. It lost us.', {pri:2}); return; }
  const b = S.bat;
  const dB = Math.hypot(ix - b.x, iy - b.y);
  if (b.alive && dB < (e.tgt === 'BTY' ? 1.6 : .5) && b.displace <= 0){
    b.alive = false; S.st.radarLost = true;
    S.st.hitsW += e.dmg * PRI_W[1]; S.st.leak++;
    tone(S, 'klaxon'); ev(S, 'HIT', 'RADAR DESTROYED', {bad:true});
    say(S, 'TCA', 'Impact on the radar! Radar is down! We are blind!', {pri:5});
    S.out.push({k:'banner', text:'RADAR DESTROYED', cls:'bad'});
    S.endAt = S.endAt == null ? S.t + 8 : S.endAt; S.endReason = 'Radar destroyed';
    return;
  }
  for (const L of S.launchers) if (!L.dead && Math.hypot(ix - L.x, iy - L.y) < 1.0){ L.dead = true; L.state = 'DEAD'; S.st.lsLost++; S.st.leak++; ev(S, 'HIT', `Launcher ${L.id} destroyed`, {bad:true}); say(S, 'TCA', `Launcher ${L.id} destroyed.`, {pri:4}); return; }
  let hit = null, best = 1e9;
  for (const a of S.assets){ const d = Math.hypot(ix - a.x, iy - a.y); const rad = e.T.ballistic ? 2.6 : 1.6; if (d < rad && d < best){ best = d; hit = a; } }
  if (!hit && e.tgt && e.tgt !== 'BTY'){ const a = assetById(S, e.tgt); if (a && Math.hypot(ix - a.x, iy - a.y) < 3) hit = a; }
  if (hit){
    hit.hp = Math.max(0, hit.hp - e.dmg); S.st.hitsW += e.dmg * PRI_W[hit.pri]; S.st.leak++;
    tone(S, 'impact'); ev(S, 'HIT', `${hit.name} hit by ${e.T.cls}${e.trk && e.trk.num ? ' (track ' + e.trk.num + ')' : ' (never tracked)'}`, {bad:true, trk:e.trk ? e.trk.num : 0, untracked:!e.everTrk, x:ix, y:iy});
    say(S, 'TD', `${callsign(S)}, ${tdName(S)}. Impact at ${hit.name}.`, {pri:4});
    S.out.push({k:'impact', x:ix, y:iy});
  } else {
    if (e.everTrk) ev(S, 'IMPACT', `${e.T.cls} impact in open ground`, {x:ix, y:iy});
    S.out.push({k:'impact', x:ix, y:iy, harmless:true});
  }
}

// ---------- threat evaluation ----------
function assess(S, e){
  const tg = [...S.assets.filter(a => a.hp > 0 || true), {id:'BTY', name:'the battery', x:S.bat.x, y:S.bat.y, pri:1}];
  if (e.model === 'bal'){
    const tImp = Math.max(0, e.t0 + e.T0 - S.t); let dal = null, bd = 1e9;
    for (const a of tg){ const d = Math.hypot(e.I.x - a.x, e.I.y - a.y); if (d < (a.id === 'BTY' ? 3 : 4) && d < bd){ bd = d; dal = a; } }
    return {dal, tta:tImp, impact:e.I, closing:true};
  }
  if (e.kind === 'ARM') return {dal:tg[tg.length - 1], tta:Math.hypot(e.x - S.bat.x, e.y - S.bat.y) / e.speed, impact:null, closing:true};
  const sp = Math.hypot(e.vx, e.vy); if (sp < .005) return {dal:null, tta:Infinity, impact:null, closing:false};
  const h = brgOf(e.vx, e.vy); let dal = null, best = Infinity, tta = Infinity;
  for (const a of tg){
    const d = Math.hypot(a.x - e.x, a.y - e.y), b = brgOf(a.x - e.x, a.y - e.y);
    const tol = d < 15 ? 30 : 16;
    if (Math.abs(angDiff(b, h)) < tol && d < 220){ const t = d / sp, sc = t / PRI_W[a.pri]; if (sc < best){ best = sc; dal = a; tta = t; } }
  }
  const closing = Math.hypot(e.x + e.vx - S.bat.x, e.y + e.vy - S.bat.y) < Math.hypot(e.x - S.bat.x, e.y - S.bat.y);
  return {dal, tta, impact:null, closing};
}

function threatQueue(S){
  const out = [];
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est) continue;
    const k = e.trk; if (k.id === 'FRD' || k.id === 'ASF' || k.id === 'NEU') continue;
    if (k.id !== 'HOS' && k.id !== 'SUS' && !(k.iff === 'NO RESP' && e.kind !== 'FALSE' && e.kind !== 'CIV') && e.kind !== 'FALSE') continue;
    const a = assess(S, e);
    const sc = a.dal ? a.tta / PRI_W[a.dal.pri] : 1e5 + (a.tta || 0);
    out.push({e, a, sc, plan:activePlan(S, e)});
  }
  out.sort((x, y) => x.sc - y.sc);
  return out;
}

// ---------- engagement ----------
function rec(e){ if (e.T.ballistic || e.kind === 'ARM') return ['MSE', 'GEMT']; return ['GEMT', 'MSE']; }
function rounds(S, w, readyOnly = true){ return S.launchers.reduce((s, L) => s + ((!L.dead && (!readyOnly || L.state === 'READY')) ? L[w] : 0), 0); }
function pickLauncher(S, w){ let best = null; for (const L of S.launchers) if (!L.dead && L.state === 'READY' && L[w] > 0 && (!best || L[w] > best[w])) best = L; return best; }
function activePlan(S, e){ return S.plans.find(p => p.uid === e.uid && p.state !== 'DONE'); }
function solve(S, e, wk){
  const W = WEAPONS[wk], b = S.bat;
  const tmax = e.model === 'bal' ? Math.max(.6, e.t0 + e.T0 - S.t - .2) : 240;
  const f = tg => { const p = predict(S, e, tg), hd = Math.hypot(p.x - b.x, p.y - b.y); return 2 + Math.hypot(hd, p.z) / W.speed - tg; };
  let lo = .5, hi = tmax;
  if (f(hi) <= 0){ for (let i = 0; i < 26; i++){ const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; } }
  const tg = hi, p = predict(S, e, tg);
  const h = Math.hypot(p.x - b.x, p.y - b.y), lim = e.T.ballistic ? W.rTbm : W.rAir;
  let ok = true, why = '';
  if (f(tmax) > 0 && e.T.ballistic){ ok = false; why = 'NO INTERCEPT TIME'; }
  else if (p.end){ ok = false; why = e.T.ballistic ? 'NO INTERCEPT TIME' : 'TARGET LEAVES BEFORE INTERCEPT'; }
  else if (h > lim){ ok = false; why = 'OUT OF RANGE'; }
  else if (p.z > W.maxAlt){ ok = false; why = 'ABOVE CEILING'; }
  else if (e.T.ballistic && p.z < 2.5){ ok = false; why = 'TOO LOW · DEBRIS'; }
  else if (h < W.minR && p.z < 1.5){ ok = false; why = 'INSIDE MIN RANGE'; }
  return {ok, why, tof:tg, p, h};
}
function waitable(S, e, why){
  if (why === 'OUT OF RANGE' || why === 'ABOVE CEILING') return e.T.ballistic || assess(S, e).closing;
  return false;
}
function docFor(S, e){ if (e.T.ballistic) return S.doctrine.TBM; if (e.T.cls === 'UAV') return S.doctrine.UAV; return S.doctrine.AIR; }
function isSelfDef(S, e){ const a = assess(S, e); return a.dal && a.dal.id === 'BTY'; }
function roeCheck(S, e){
  const v = [], k = e.trk, id = k ? k.id : 'PND';
  if (S.t < S.ceaseUntil) v.push('CEASE FIRE in effect');
  if (e.holdOrder) v.push('HOLD FIRE ordered on this track');
  if (id === 'FRD' || id === 'ASF') v.push('Track is identified FRIEND');
  else if (id === 'NEU') v.push('Track is identified NEUTRAL');
  if (S.wcs === 'HOLD' && !(id === 'HOS' && isSelfDef(S, e))) v.push('WEAPONS HOLD: self-defense only');
  if (S.wcs === 'TIGHT' && id !== 'HOS') v.push('WEAPONS TIGHT: track not declared HOSTILE');
  return v;
}
function reactDelay(S, src){ const base = S.adw === 'WHITE' ? 6 : S.adw === 'YELLOW' ? 3.5 : 2; return base * (1 - .06 * Math.min(5, S.xp)) * (src === 'player' ? 1 : .8) + (S.wccSlow || 0); }

function engage(S, e, o = {}){
  const src = o.src || 'player';
  if (!e || !e.alive) return {ok:false, why:'NO TARGET'};
  if (!e.trk || !e.trk.est) return {ok:false, why:'NO FIRM TRACK'};
  if (e.trk.remote) return {ok:false, why:'REMOTE TRACK · OWN RADAR MUST HOLD TRACK'};
  if (!radarOn(S)) return {ok:false, why:'RADAR NOT RADIATING'};
  if (S.bat.epp > 0) return {ok:false, why:'POWER FAULT'};
  if (activePlan(S, e)) return {ok:false, why:'ALREADY ENGAGED'};
  const v = roeCheck(S, e);
  if (src !== 'player' && v.length) return {ok:false, why:v[0]};
  if (src === 'player' && v.length && !o.force) return {ok:false, viol:v, why:v[0]};
  const pref = o.wpn && o.wpn !== 'AUTO' ? [o.wpn] : rec(e);
  let w = null, sol = null;
  for (const c of pref){ if (rounds(S, c) <= 0) continue; const s = solve(S, e, c); if (s.ok || waitable(S, e, s.why)){ w = c; sol = s; break; } if (!w){ w = c; sol = s; } }
  if (!w) return {ok:false, why:'NO MISSILES READY'};
  if (!sol.ok && !waitable(S, e, sol.why)) return {ok:false, why:sol.why};
  if (v.length){
    S.st.viol++; ev(S, 'VIOL', `ROE violation on track ${e.trk.num}: ${v.join('; ')}`, {bad:true, trk:e.trk.num});
    say(S, 'TD', `${callsign(S)}, ${tdName(S)}. You are not cleared to engage track ${e.trk.num}.`, {pri:4, speak:`${callsign(S)}, ${tdName(S)}. You are not cleared to engage track ${spoken(e.trk.num)}`});
  }
  const doc = docFor(S, e);
  const p = {id:S.pid++, uid:e.uid, trk:e.trk.num, w, wpref:o.wpn || 'AUTO', doc, src, state:src === 'auto' ? 'VETO' : (sol.ok ? 'READY' : 'WAIT'), vetoT:src === 'auto' ? 5 : 0, fireAt:S.t + reactDelay(S, src), shots:0, max:doc === 'RIPPLE' ? 2 : 1, inflight:0, salvo:1, created:S.t, result:''};
  S.plans.push(p);
  if (e.engageOrder) e.engageDone = true;
  ev(S, 'ENG', `${src === 'player' ? 'Engage' : src === 'semi' ? 'Semi-auto engage' : 'Auto engage'} track ${e.trk.num} · ${WEAPONS[w].name} · ${doc}`, {trk:e.trk.num, uid:e.uid, src, kind:e.kind});
  if (src === 'auto'){ tone(S, 'veto'); say(S, 'TCA', `Auto engage track ${e.trk.num}. Veto window five seconds.`, {speak:`Auto engage track ${spoken(e.trk.num)}`, pri:2}); }
  else say(S, 'TCA', `Engaging track ${e.trk.num}, ${WEAPONS[w].name}.`, {speak:`Engaging track ${spoken(e.trk.num)}`, pri:1, silent:src === 'semi' && S.rng() < .5});
  return {ok:true, plan:p};
}

function launch(S, p, e, L, sol){
  L[p.w]--; S.st.fired[p.w]++; S.st.spent += WEAPONS[p.w].cost;
  const m = {id:S.mid++, plan:p.id, uid:e.uid, w:p.w, x:L.x, y:L.y, z:0, sx:L.x, sy:L.y, t0:S.t, tEnd:S.t + sol.tof, aim:{x:sol.p.x, y:sol.p.y, z:sol.p.z}, owner:'own', alive:true, lastAim:S.t, guidLost:0};
  S.ms.push(m); p.inflight++;
  const a = assess(S, e);
  if (e.truth === 'X'){ S.st.wasted++; S.st.waste.fals++; }
  else if (e.T.decoy){ S.st.wasted++; S.st.waste.decoy++; }
  else if (e.truth === 'F' || e.truth === 'N'){ S.st.wasted++; S.st.waste.protect++; }
  else if (e.T.ballistic && !a.dal){ S.st.wasted++; S.st.waste.nondal++; }
  if (p.w === 'MSE' && e.T.cls === 'UAV') S.st.mseDrone++;
  tone(S, 'launch');
  ev(S, 'LAUNCH', `${WEAPONS[p.w].name} away, launcher ${L.id} → track ${p.trk}`, {trk:p.trk, uid:e.uid});
  if (p.shots === 0) say(S, 'TCA', `Missile away, launcher ${L.id}.`, {pri:1, silent:S.rng() < .35});
  if (L.MSE === 0 && L.GEMT === 0) say(S, 'TCA', `Launcher ${L.id} empty.`, {pri:2});
  S.out.push({k:'launch', x:L.x, y:L.y});
}

function processPlans(S, dt){
  for (const p of S.plans){
    if (p.state === 'DONE') continue;
    const e = S.ents.find(x => x.uid === p.uid);
    if (!e || !e.alive){ if (p.inflight === 0){ p.state = 'DONE'; p.result = p.result || (e && e.killed ? 'KILL' : 'TARGET GONE'); } continue; }
    if (e.trk && e.trk.hold){ cancelPlan(S, p, 'HOLD FIRE'); continue; }
    if (p.src !== 'player' && p.state !== 'GUIDING' && roeCheck(S, e).length){ if (S.t < S.ceaseUntil) continue; p.state = 'DONE'; p.result = 'ROE'; continue; }
    if (p.state === 'VETO'){ p.vetoT -= dt; if (p.vetoT <= 0){ p.state = 'WAIT'; p.fireAt = S.t + .4; } continue; }
    if (p.state === 'WAIT'){
      if (!e.trk || !e.trk.est){ continue; }
      const sol = solve(S, e, p.w);
      if (sol.ok){ p.state = 'READY'; if (p.fireAt < S.t) p.fireAt = S.t + .5; }
      else if (!waitable(S, e, sol.why)){ p.state = 'DONE'; p.result = sol.why; say(S, 'TCA', `No intercept on track ${p.trk}. ${sol.why.toLowerCase()}.`, {pri:2}); ev(S, 'NOSOL', `No intercept solution, track ${p.trk}: ${sol.why}`, {trk:p.trk}); }
      continue;
    }
    if (p.state === 'READY' && S.t >= p.fireAt){
      if (!radarOn(S) || S.bat.epp > 0) continue;
      if (!e.trk || e.trk.remote) continue;
      if (S.t < S.ceaseUntil && p.src !== 'player') continue;
      let sol = solve(S, e, p.w);
      if (!sol.ok){ p.state = waitable(S, e, sol.why) ? 'WAIT' : 'DONE'; if (p.state === 'DONE') p.result = sol.why; continue; }
      let L = pickLauncher(S, p.w);
      if (!L && p.wpref === 'AUTO'){ const alt = p.w === 'MSE' ? 'GEMT' : 'MSE'; const s2 = solve(S, e, alt); if (s2.ok && pickLauncher(S, alt)){ p.w = alt; sol = s2; L = pickLauncher(S, alt); } }
      if (!L){ p.state = 'DONE'; p.result = 'NO MISSILES'; say(S, 'TCA', `No ready missiles for track ${p.trk}.`, {pri:3}); ev(S, 'NOMSL', `No ready missiles for track ${p.trk}`, {bad:true}); continue; }
      if (S.t < S.ceaseUntil && p.src === 'player' && !p.cfViol){ p.cfViol = true; }
      launch(S, p, e, L, sol); p.shots++;
      if (p.shots < p.max) p.fireAt = S.t + 1.5; else p.state = 'GUIDING';
      continue;
    }
    if (p.state === 'GUIDING' && p.inflight === 0){
      if (!e.alive){ p.state = 'DONE'; continue; }
      if ((p.doc === 'SLS' || p.src !== 'player') && p.salvo < 3){
        p.salvo++; p.shots = 0; p.max = p.doc === 'RIPPLE' ? 2 : 1;
        const sol = solve(S, e, p.w);
        p.state = sol.ok ? 'READY' : (waitable(S, e, sol.why) ? 'WAIT' : 'DONE'); p.fireAt = S.t + 1.2;
        if (p.state !== 'DONE') say(S, 'TCA', `Re-engaging track ${p.trk}.`, {pri:1, speak:`Re engage ${spoken(p.trk)}`});
        else p.result = 'MISS';
      } else { p.state = 'DONE'; p.result = 'MISS'; }
    }
  }
  if (S.plans.length > 300) S.plans = S.plans.filter(p => p.state !== 'DONE' || S.t - p.created < 60);
}

function cancelPlan(S, p, why){
  p.state = 'DONE'; p.result = why;
  for (const m of S.ms) if (m.alive && m.plan === p.id){ m.alive = false; m.res = 'DESTRUCT'; p.inflight--; S.out.push({k:'destruct', x:m.x, y:m.y, z:m.z}); }
}

function stepMissiles(S, dt){
  const on = radarOn(S);
  for (const m of S.ms){
    if (!m.alive) continue;
    const e = S.ents.find(x => x.uid === m.uid);
    if (!e || !e.alive){ m.alive = false; m.res = 'NO TARGET'; if (m.owner === 'own') planDec(S, m); continue; }
    if (m.owner === 'own' && !on) m.guidLost += dt;
    if (S.t - m.lastAim > 1 && (m.owner !== 'own' || on)){ const rem = m.tEnd - S.t; if (rem > .4){ const pr = predict(S, e, rem); m.aim = {x:pr.x, y:pr.y, z:pr.z}; m.lastAim = S.t; } }
    const f = clamp((S.t - m.t0) / (m.tEnd - m.t0), 0, 1);
    const d = Math.hypot(m.aim.x - m.sx, m.aim.y - m.sy);
    m.x = m.sx + (m.aim.x - m.sx) * f; m.y = m.sy + (m.aim.y - m.sy) * f; m.z = m.aim.z * Math.pow(f, .9) + Math.sin(Math.PI * f) * Math.min(10, d * .1);
    if (f >= 1) resolveMissile(S, m, e);
  }
  if (S.ms.length > 200) S.ms = S.ms.filter(m => m.alive);
}
function planDec(S, m){ const p = S.plans.find(q => q.id === m.plan); if (p) p.inflight = Math.max(0, p.inflight - 1); }

function resolveMissile(S, m, e){
  m.alive = false;
  if (m.owner !== 'own'){
    if (S.rng() < .75){ kill(S, e, m); const nb = m.nb; say(S, 'NET', `${nb}: splash track ${e.trk && e.trk.num ? e.trk.num : ''}.`, {silent:true, cls:'net'}); }
    return;
  }
  planDec(S, m);
  let pk = e.T.pk[m.w] || 0;
  pk *= e.trk ? (.75 + .25 * Math.min(1, e.trk.q)) : .5;
  if (m.guidLost > 1.5) pk *= .15;
  if (S.tut && S.tut.pkMin && pk > 0) pk = Math.max(pk, S.tut.pkMin);
  if (S.tut && S.tut.pk) pk = S.tut.pk;
  if (S.rng() < pk){ kill(S, e, m); }
  else {
    m.res = 'MISS'; S.st.miss++;
    const n = e.trk ? e.trk.num : '';
    tone(S, 'miss'); ev(S, 'MISS', `Miss on track ${n}`, {trk:n});
    say(S, 'TCA', `Miss, track ${n}.`, {speak:`Miss, track ${spoken(n)}`, pri:2});
    S.out.push({k:'miss', x:m.x, y:m.y, z:m.z});
  }
}

function kill(S, e, m){
  e.alive = false; e.killed = true; m.res = 'KILL';
  S.out.push({k:'kill', x:e.x, y:e.y, z:e.z, own:m.owner === 'own'});
  if (m.owner !== 'own'){ ev(S, 'NBKILL', `${m.nb} killed track ${e.trk && e.trk.num ? e.trk.num : '(untracked)'}`); return; }
  S.st.kills++;
  const n = e.trk ? e.trk.num : '';
  if (e.truth === 'F' || e.truth === 'N'){
    S.st.frat++; tone(S, 'klaxon');
    ev(S, 'FRAT', `${e.truth === 'F' ? 'FRATRICIDE' : 'CIVIL AIRCRAFT DOWN'}: track ${n} was a ${e.T.name.toLowerCase()}`, {bad:true, trk:n});
    say(S, 'TD', `CEASE FIRE, CEASE FIRE! ${callsign(S)}, you have shot down a ${e.truth === 'F' ? 'friendly' : 'civil'} aircraft.`, {pri:9});
    S.out.push({k:'banner', text:e.truth === 'F' ? 'FRATRICIDE' : 'CIVIL AIRCRAFT DOWN', cls:'bad'});
    S.endAt = S.t + 6; S.endReason = e.truth === 'F' ? 'Fratricide' : 'Civil aircraft shot down';
    return;
  }
  if (e.truth === 'H') S.st.killVal += e.T.value;
  tone(S, 'kill');
  ev(S, 'KILL', `Kill, track ${n} (${e.T.cls}${e.T.decoy ? ', decoy' : ''}${e.kind === 'FALSE' ? ', false target' : ''})`, {good:true, trk:n});
  say(S, 'TCA', `Kill assessment, track ${n}, probable kill.`, {speak:`Track ${spoken(n)}, probable kill`, pri:2});
  if (e.T.ballistic && e.z < 6){
    for (const a of S.assets) if (Math.hypot(e.x - a.x, e.y - a.y) < 3){ a.hp = Math.max(0, a.hp - .5); S.st.debris++; S.st.hitsW += .5 * PRI_W[a.pri]; ev(S, 'DEBRIS', `Intercept debris fell on ${a.name}`, {bad:true}); break; }
  }
}

function stepNeighbors(S, dt){
  for (const nb of S.neighbors){
    if (!nb.on) continue;
    if (nb.failAt && S.t >= nb.failAt){ nb.on = false; ev(S, 'NBDOWN', `${nb.name} battery off the net`, {bad:true}); tone(S, 'fault'); continue; }
    nb.cool -= dt; if (nb.cool > 0 || nb.inv <= 0) continue;
    for (const e of S.ents){
      if (!e.alive || e.truth !== 'H' || e.nbEng || !(e.dmg > 0 || e.kind === 'FTR')) continue;
      if (!detects(S, nb, e, false)) continue;
      const h = Math.hypot(e.x - nb.x, e.y - nb.y);
      if (e.T.ballistic ? (e.z < 30 && h < 40 && (e.vz || 0) < 0) : h < 45){
        const tof = 6 + h / 1.5, pr = predict(S, e, tof);
        S.ms.push({id:S.mid++, uid:e.uid, w:'MSE', x:nb.x, y:nb.y, z:0, sx:nb.x, sy:nb.y, t0:S.t, tEnd:S.t + tof, aim:{x:pr.x, y:pr.y, z:pr.z}, owner:'nb', nb:nb.name, alive:true, lastAim:S.t, guidLost:0});
        e.nbEng = true; nb.inv--; nb.cool = 4;
        S.log.push({t:S.t, who:'NET', text:`${nb.name} ENGAGING ${e.trk && e.trk.num ? 'TRK ' + e.trk.num : 'NET TRACK'}`, cls:'net'});
        break;
      }
    }
  }
}

// ---------- orders / acks ----------
function order(S, o){
  const a = {id:S.acks.length + 1, text:o.text, t:S.t, due:S.t + 15, done:false, late:false, k:o.k};
  S.acks.push(a);
  say(S, 'TD', o.text, {pri:3});
  tone(S, 'order');
  ev(S, 'ORDER', o.text, {k:o.k});
}
function processOrders(S){
  while (S.orderQ.length && S.orderQ[0].t <= S.t){
    const o = S.orderQ.shift();
    if (o.k === 'ADW'){ S.adw = o.v; if (o.v === 'RED') tone(S, 'klaxon'); }
    if (o.wcs) S.wcs = o.wcs;
    if (o.k === 'WCS') S.wcs = o.v;
    if (o.k === 'HOLDFIRE'){ for (const e of S.ents) if (e.alive && e.tag === o.tag){ e.holdOrder = true; for (const p of S.plans) if (p.uid === e.uid && p.state !== 'DONE' && p.src !== 'player') cancelPlan(S, p, 'HOLD FIRE ORDER'); } }
    if (o.k === 'CEASEFIRE') S.ceaseUntil = S.t + (o.dur || 20);
    if (o.k === 'ENGAGE'){ for (const e of S.ents) if (e.alive && e.tag === o.tag) e.engageOrder = S.t + 40; }
    order(S, o);
  }
  for (const a of S.acks) if (!a.done && !a.late && S.t > a.due){
    a.late = true; S.st.lateAck++; ev(S, 'LATE', 'Order not acknowledged in 15 seconds', {bad:true});
    say(S, 'TD', `${callsign(S)}, ${tdName(S)}. Acknowledge my last.`, {pri:3});
  }
  for (const e of S.ents) if (e.engageOrder && !e.engageDone && S.t > e.engageOrder){ e.engageDone = true; if (e.alive){ S.st.engMissed++; ev(S, 'LATE', 'Failed to comply with an engage order', {bad:true}); } }
}
function ack(S){
  const a = S.acks.find(x => !x.done); if (!a) return false;
  a.done = true; a.ackT = S.t; ev(S, 'ACK', `Acknowledged: ${a.text.slice(0, 60)}${a.text.length > 60 ? '…' : ''}`, {good:!a.late});
  S.log.push({t:S.t, who:callsign(S).toUpperCase(), text:`${tdName(S)}, ${callsign(S)}. Roger, wilco.`, cls:'me'});
  return true;
}

// ---------- faults / launchers ----------
function processFaults(S){
  while (S.faultQ.length && S.faultQ[0].t <= S.t){
    const f = S.faultQ.shift();
    if (f.k === 'RADAR'){ S.bat.radarFault = 60; say(S, 'TCA', 'Radar BIT fault. Search range degraded about one minute.', {pri:3}); ev(S, 'FAULT', 'Radar BIT fault: range degraded 60 s', {bad:true}); }
    else if (f.k === 'EPP'){ S.bat.epp = 12; say(S, 'TCA', 'Power plant fault! Radar and launchers down.', {pri:4}); ev(S, 'FAULT', 'Power plant fault: 12 s outage', {bad:true}); }
    else { const c = S.launchers.filter(L => !L.dead && L.state === 'READY'); if (c.length){ const L = c[Math.floor(S.rng() * c.length)]; L.state = 'COMMS'; L.timer = 45; say(S, 'TCA', `Launcher ${L.id} data link down.`, {pri:3}); ev(S, 'FAULT', `Launcher ${L.id} comms lost 45 s`, {bad:true}); } }
    tone(S, 'fault');
  }
}
function stepLaunchers(S, dt){
  for (const L of S.launchers){
    if (L.dead) continue;
    if (L.state === 'COMMS' || L.state === 'RELOAD' || L.state === 'MOVE'){
      L.timer -= dt;
      if (L.timer <= 0){
        if (L.state === 'RELOAD' && L.pend){ L.MSE += L.pend.MSE; L.GEMT += L.pend.GEMT; L.pend = null; say(S, 'TCA', `Launcher ${L.id} reloaded.`, {pri:1, silent:true}); ev(S, 'RELOAD', `Launcher ${L.id} reloaded`); }
        L.state = 'READY';
      }
    }
  }
}
function reload(S, id){
  const L = S.launchers.find(x => x.id === id); if (!L || L.dead || L.state !== 'READY') return false;
  const need = {MSE:Math.min(L.cap.MSE - L.MSE, S.reserve.MSE), GEMT:Math.min(L.cap.GEMT - L.GEMT, S.reserve.GEMT)};
  if (need.MSE + need.GEMT <= 0) return false;
  S.reserve.MSE -= need.MSE; S.reserve.GEMT -= need.GEMT; L.pend = need; L.state = 'RELOAD'; L.timer = 90 * (1 - .05 * Math.min(5, S.xp));
  ev(S, 'RELOAD', `Launcher ${L.id} reload started`);
  S.log.push({t:S.t, who:'TCA', text:`LAUNCHER ${L.id} RELOADING · ${need.MSE ? need.MSE + ' MSE ' : ''}${need.GEMT ? need.GEMT + ' GEM-T' : ''}`, cls:'sys'});
  return true;
}

// ---------- player controls ----------
function setMode(S, m){ if (S.mode === m) return; S.mode = m; ev(S, 'MODE', `Engagement mode ${m}`); S.log.push({t:S.t, who:'SYS', text:`ENGAGEMENT MODE ${m}`, cls:'sys'}); }
function setEmcon(S, on){ S.bat.emcon = on; ev(S, 'EMCON', on ? 'Radar silent (EMCON)' : 'Radar radiating'); S.log.push({t:S.t, who:'SYS', text:on ? 'RADAR SILENT · EMCON' : 'RADAR RADIATING', cls:'sys'}); }
function playerId(S, e, id){ if (e && e.trk) setId(S, e, id, 'PLAYER'); }
function playerIff(S, e){ if (!e || !e.trk) return; e.trk.iff = interrogate(S, e, true); if (e.trk.iff === 'M4 VALID' && e.trk.idBy !== 'PLAYER') setId(S, e, 'FRD', 'AUTO'); S.log.push({t:S.t, who:'SYS', text:`IFF TRK ${e.trk.num}: ${e.trk.iff}`, cls:'sys'}); }
function holdFire(S, e){
  if (!e || !e.trk) return;
  e.trk.hold = !e.trk.hold;
  if (e.trk.hold){
    let n = 0; for (const p of S.plans) if (p.uid === e.uid && p.state !== 'DONE'){ n += p.inflight; cancelPlan(S, p, 'HOLD FIRE'); }
    if (n && (e.truth === 'F' || e.truth === 'N')) S.st.holdSaves++;
    ev(S, 'HOLD', `Hold fire track ${e.trk.num}${n ? ', ' + n + ' missile(s) destroyed' : ''}`, {trk:e.trk.num, good:n > 0 && e.truth !== 'H'});
    say(S, 'TCA', `Hold fire, track ${e.trk.num}.${n ? ' Missiles destroyed.' : ''}`, {speak:`Hold fire, track ${spoken(e.trk.num)}`});
  } else S.log.push({t:S.t, who:'SYS', text:`HOLD FIRE RELEASED TRK ${e.trk.num}`, cls:'sys'});
}
function veto(S, pid){ const p = S.plans.find(x => x.id === pid); if (!p || p.state !== 'VETO') return; p.state = 'DONE'; p.result = 'VETO'; S.st.vetoes++; const e = S.ents.find(x => x.uid === p.uid); if (e && e.trk) e.trk.hold = true; ev(S, 'VETO', `Veto on track ${p.trk}`, {trk:p.trk, good:e && e.truth !== 'H'}); say(S, 'TCA', `Veto, track ${p.trk}.`, {speak:`Veto ${spoken(p.trk)}`}); }
function reorient(S, ptl){ if (S.bat.reorient > 0 || S.bat.displace > 0 || !S.bat.alive) return; S.bat.reorient = 25; S.bat.newPtl = (ptl + 360) % 360; ev(S, 'PTL', `Reorienting PTL to ${Math.round(S.bat.newPtl)}°`); say(S, 'TCA', 'Reorienting. Radar down for twenty-five seconds.', {pri:2}); }
function displace(S, si){ if (!S.scn.displace || S.bat.displace > 0 || !S.bat.alive || si === S.bat.site) return; S.bat.displace = 50; S.bat.dispTo = si; for (const L of S.launchers) if (!L.dead){ L.state = 'MOVE'; L.timer = 50; } ev(S, 'DISPLACE', `March order to ${S.scn.sites[si].name}`); say(S, 'TCA', 'March order. Battery offline fifty seconds.', {pri:3}); }


// =====================================================================
// 2.0 · faults with isolation, AI crew, radar budget, red commander,
//       command log, rewind, doctrinal ghost
// =====================================================================
const FAULTS = {
  RADAR:{fam:3, title:'Transmitter', effect:'Search range down 40%', fix:'RESET TRANSMITTER', auto:120},
  LS:{fam:2, title:'Launcher data link', effect:'One launcher cannot fire', fix:'RESET DATA LINK', auto:90},
  EPP:{fam:5, title:'Prime power', effect:'Radar and launchers dark', fix:'TRANSFER TO STANDBY EPP', auto:45},
  WCC:{fam:6, title:'Weapons control computer', effect:'Engagement solutions 4 s slower', fix:'REBOOT WCC', auto:90},
};
const FIX_ACTIONS = ['RESET DATA LINK', 'RESET TRANSMITTER', 'TRANSFER TO STANDBY EPP', 'REBOOT WCC'];
const CREW = [
  {id:'alvarez', name:'SGT Alvarez', skill:.85, note:'Steady. Catches IFF anomalies and lane traffic.'},
  {id:'okafor', name:'SPC Okafor', skill:.62, note:'Fast hands, misses details when tired.'},
  {id:'brandt', name:'SSG Brandt', skill:.93, note:'Best fault isolator in the battalion. Wears out fast.'},
];
function makeTca(o){
  const c = CREW.find(x => x.id === (o && o.id)) || CREW[0];
  return {id:c.id, name:c.name, skill:c.skill, fatigue:Math.max(0, Math.min(.8, (o && o.fatigue) || 0)), delegate:{reload:true, faults:true, ...((o && o.delegate) || {})}, busyUntil:0};
}
const tcaEff = S => Math.max(.2, S.tca.skill * (1 - S.tca.fatigue * .5));

function openFault(S, k, extra = {}){
  const F = FAULTS[k], f = {id:(S.fid = (S.fid || 0) + 1), k, code:`${F.fam}${String(10 + Math.floor(S.rng() * 89))}`, title:F.title, effect:F.effect, t0:S.t, auto:S.t + F.auto, fixing:null, ...extra};
  S.faults.push(f);
  if (k === 'LS'){ const L = S.launchers.find(x => x.id === f.ls); if (L){ L.state = 'COMMS'; L.timer = 1e9; } }
  tone(S, 'fault');
  say(S, 'TCA', `BIT fault ${f.code}, ${F.title.toLowerCase()}${f.ls ? ', launcher ' + f.ls : ''}.`, {pri:3, speak:`B I T fault ${spoken(f.code)}, ${F.title}`});
  ev(S, 'FAULT', `BIT ${f.code} · ${F.title}${f.ls ? ' · LS' + f.ls : ''}: ${F.effect}`, {bad:true});
  return f;
}
function closeFault(S, f, how){
  S.faults = S.faults.filter(x => x !== f);
  if (f.k === 'LS'){ const L = S.launchers.find(x => x.id === f.ls); if (L && !L.dead && L.state === 'COMMS'){ L.state = 'READY'; L.timer = 0; } }
  ev(S, 'FIXED', `BIT ${f.code} cleared${how ? ' · ' + how : ''}`, {good:true});
  S.log.push({t:S.t, who:'TCA', text:`BIT ${f.code} CLEARED${how ? ' · ' + how.toUpperCase() : ''}`, cls:'sys'});
}
function fixFault(S, fid, action, by = 'TCO'){
  const f = S.faults.find(x => x.id === fid); if (!f || f.fixing) return false;
  const ok = action === FAULTS[f.k].fix;
  const dur = by === 'TCO' ? (ok ? 8 : 15) : 20 * (1.6 - S.tca.skill) * (1 + S.tca.fatigue);
  f.fixing = {by, action, ok, until:S.t + dur};
  S.log.push({t:S.t, who:by === 'TCO' ? callsign(S).toUpperCase() : 'TCA', text:`${action} · BIT ${f.code} · ${Math.round(dur)} S`, cls:by === 'TCO' ? 'me' : 'sys'});
  return true;
}
function stepFaults(S){
  while (S.faultQ.length && S.faultQ[0].t <= S.t){
    const q = S.faultQ.shift();
    if (q.k === 'LS'){ const c = S.launchers.filter(L => !L.dead && L.state === 'READY'); if (c.length) openFault(S, 'LS', {ls:c[Math.floor(S.rng() * c.length)].id}); }
    else openFault(S, q.k);
  }
  for (const f of S.faults.slice()){
    if (f.fixing && S.t >= f.fixing.until){
      if (f.fixing.ok) closeFault(S, f, f.fixing.by === 'TCO' ? 'fixed by you' : 'fixed by ' + S.tca.name);
      else { say(S, 'TCA', `No joy on ${f.code}. Wrong procedure.`, {pri:2}); f.fixing = null; f.tries = (f.tries || 0) + 1; }
      continue;
    }
    if (!f.fixing && S.t >= f.auto){ closeFault(S, f, 'self-recovered'); continue; }
    if (!f.fixing && S.tca.delegate.faults && S.t - f.t0 > 4 + 6 * S.tca.fatigue){
      const right = S.rng() < tcaEff(S);
      fixFault(S, f.id, right ? FAULTS[f.k].fix : FIX_ACTIONS.find(a => a !== FAULTS[f.k].fix), 'TCA');
    }
  }
  S.bat.radarFault = S.faults.some(f => f.k === 'RADAR') ? 1 : 0;
  S.bat.epp = S.faults.some(f => f.k === 'EPP') ? 1 : 0;
  S.wccSlow = S.faults.some(f => f.k === 'WCC') ? 4 : 0;
}
function stepCrew(S){
  if (!S.tca.delegate.reload) return;
  for (const L of S.launchers){
    if (L.dead || L.state !== 'READY' || L.MSE + L.GEMT > 0) { L.tcaAt = null; continue; }
    const can = (L.cap.MSE && S.reserve.MSE) || (L.cap.GEMT && S.reserve.GEMT); if (!can) continue;
    if (L.tcaAt == null) L.tcaAt = S.t + 4 * (1 + S.tca.fatigue * 2);
    else if (S.t >= L.tcaAt){ L.tcaAt = null; if (reload(S, L.id)) say(S, 'TCA', `Reloading launcher ${L.id}.`, {pri:1, silent:true}); }
  }
}
function setSector(S, v){
  if (S.bat.sector === v) return;
  S.bat.sector = v; S.bat.half = v === 'NARROW' ? 30 : 60;
  ev(S, 'SECTOR', `Search sector ${v} (±${S.bat.half}°)`);
  S.log.push({t:S.t, who:'SYS', text:`SEARCH SECTOR ${v} · ±${S.bat.half}°${v === 'NARROW' ? ' · RANGE +25%' : ''}`, cls:'sys'});
}
function stepRadarBudget(S){
  let n = 0; for (const e of S.ents) if (e.alive && e.trk && e.trk.est && !e.trk.remote) n++;
  S.radar.load = n;
  S.radar.searchF = Math.max(.55, Math.min(1, 1 - .015 * Math.max(0, n - 10)));
  S.radar.trackPct = Math.round(Math.min(.6, .08 + n * .018) * 100);
  if (radarOn(S)) S.radiateT += 1;
}

// ---------- red commander ----------
function circMean(bs){ let x = 0, y = 0; for (const b of bs){ x += Math.sin(b * DEG); y += Math.cos(b * DEG); } return brgOf(x, y); }
function planRed(S, prof){
  const scn = S.scn; if (!prof || scn.tutorial) return [];
  const ax = circMean(scn.axis && scn.axis.length ? scn.axis : [scn.ptl]);
  const top = scn.assets.slice().sort((a, b) => a.pri - b.pri)[0].id, ids = scn.assets.map(a => a.id), dur = scn.dur;
  const n = prof.battles || 0, tac = [];
  tac.push({id:'probe', name:'Probe', why:n ? 'Red tests your sector edges before it commits.' : 'Red has never fought you. It probes first to find your sector.',
    hint:'Single drones on the flanks early in the watch.',
    waves:[{t:15, type:'OWA', n:2, brg:ax - 58, range:80, every:12, targets:['miss']}, {t:30, type:'OWA', n:1, brg:ax + 58, range:80, targets:['miss']}]});
  if (n >= 1){
    const off = prof.ptlOff || 0, side = off >= 0 ? -1 : 1;
    tac.push({id:'gap', name:'Gap strike', why:`Your PTL has sat ${Math.abs(Math.round(off))}° ${off >= 0 ? 'right' : 'left'} of the threat axis on average. Red routes cruise missiles around the opposite edge.`,
      hint:'Low cruise missiles from outside the expected axis.',
      waves:[{t:Math.round(dur * .45), type:'CM', n:3, brg:ax + side * 80, range:115, every:9, alt:.04, targets:[top]}]});
  }
  if ((prof.decoyShots || 0) >= 2) tac.push({id:'decoy', name:'Decoy tax', why:`You have fired ${prof.decoyShots} missiles at decoys. Red sends more of them.`,
    hint:'A heavier share of decoys in the drone stream.',
    waves:[{t:Math.round(dur * .25), type:'DECOY', n:6, brg:ax, spread:14, range:80, every:6, targets:ids}]});
  if (n >= 2 && (prof.radiating == null ? 1 : prof.radiating) > .9) tac.push({id:'sead', name:'SEAD hunt', why:`Your radar radiated ${Math.round((prof.radiating || 1) * 100)}% of the time. Red sends anti-radiation shooters to find it.`,
    hint:'Fighters carrying anti-radiation missiles.',
    waves:[{t:Math.round(dur * .5), type:'FTR', n:2, brg:ax, range:220, every:15, role:'sead', arm:2, alt:7}]});
  if (n >= 3 || (prof.lowStock || 0) >= 1) tac.push({id:'pressure', name:'Pressure salvo', why:'Red watches your launchers. When your ready PAC-3 count runs low, it fires a ballistic salvo.',
    hint:'A ballistic salvo when your launchers run dry.', reactive:true, ax, top});
  return tac;
}
function stepRed(S){
  for (const t of S.red){
    if (!t.reactive || t.used || S.t < 90) continue;
    if (rounds(S, 'MSE') <= 4 && S.loaded.MSE > 6){
      t.used = true; t.at = S.t;
      ev(S, 'RED', `Red pressure salvo: your ready PAC-3 dropped to ${rounds(S, 'MSE')}`, {bad:true});
      for (let i = 0; i < 3; i++) addSpawn(S, S.t + 2 + i * 3, () => spawnThreat(S, {type:'SRBM', brg:t.ax, spread:6, range:300}, t.top, i), true);
      S.spawns.sort((a, b) => a.t - b.t); S.si = S.spawns.findIndex(x => x.t > S.t - 1e-9); if (S.si < 0) S.si = S.spawns.length;
    }
  }
}
function learnRed(prof, S){
  const p = {...(prof || {})}, scn = S.scn; if (scn.tutorial) return p;
  const ax = circMean(scn.axis && scn.axis.length ? scn.axis : [scn.ptl]);
  const w = p.battles ? .5 : 1;
  p.battles = (p.battles || 0) + 1;
  p.ptlOff = (p.ptlOff || 0) * (1 - w) + angDiff(S.bat.ptl, ax) * w;
  p.decoyShots = (p.decoyShots || 0) + S.st.waste.decoy;
  p.shots = (p.shots || 0) + S.st.fired.MSE + S.st.fired.GEMT;
  const rad = Math.min(1, S.radiateT / Math.max(1, S.t));
  p.radiating = p.radiating == null ? rad : p.radiating * .5 + rad * .5;
  if (rounds(S, 'MSE', false) <= 4) p.lowStock = (p.lowStock || 0) + 1;
  return p;
}

// ---------- command log, rewind ----------
const ent = (S, uid) => S.ents.find(e => e.uid === uid);
const CMD = {
  engage:(S, a) => engage(S, ent(S, a.uid), {src:'player', wpn:a.wpn, force:a.force}),
  id:(S, a) => playerId(S, ent(S, a.uid), a.id),
  iff:(S, a) => playerIff(S, ent(S, a.uid)),
  hold:(S, a) => holdFire(S, ent(S, a.uid)),
  veto:(S, a) => veto(S, a.pid),
  ack:S => ack(S),
  reload:(S, a) => reload(S, a.id),
  reorient:(S, a) => reorient(S, a.ptl),
  displace:(S, a) => displace(S, a.site),
  mode:(S, a) => setMode(S, a.v),
  emcon:(S, a) => setEmcon(S, a.v),
  sector:(S, a) => setSector(S, a.v),
  fix:(S, a) => fixFault(S, a.fid, a.act),
  delegate:(S, a) => { S.tca.delegate[a.k] = a.v; },
  end:S => { S.endAt = S.t; S.endReason = 'Ended by the TCO'; S.abandon = true; },
};
function cmd(S, c, a = {}){ if (S.ended) return; S.inputs.push({n:S.n, c, a}); return CMD[c](S, a); }
function rewind(scn, opts, inputs, nStop){
  const S = createSim(scn, opts);
  S.replayQ = inputs.filter(x => x.n < nStop).map(x => ({...x}));
  while (S.n < nStop && !S.ended) step(S);
  S.replayQ = null; S.out.length = 0; S.rewoundAt = S.t;
  return S;
}

// ---------- doctrinal ghost: a by-the-book crew on the same seed ----------
function ghostThink(S){
  if (S.acks.some(a => !a.done)) cmd(S, 'ack');
  if (S.mode !== 'SEMI') cmd(S, 'mode', {v:'SEMI'});
  let armClose = false;
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || e.trk.remote) continue;
    const k = e.trk;
    if (e.kind === 'ARM' && Math.hypot(e.x - S.bat.x, e.y - S.bat.y) < 45) armClose = true;
    if (e.T.ballistic || k.idBy === 'PLAYER') continue;
    const sp = Math.hypot(e.vx, e.vy), zs = k.zs || [];
    let id = null;
    if (k.iff === 'M4 VALID') id = 'FRD';
    else if (k.iff && k.iff.startsWith('M3')) id = 'NEU';
    else if (k.iff === 'NO RESP'){
      if (inCorridor(S, e) && sp > .18){ if (!k.ghostIff){ k.ghostIff = 1; cmd(S, 'iff', {uid:e.uid}); continue; } id = 'FRD'; }
      else if (!k.cls) id = null;
      else if (e.T.cls === 'UAV' && zs.length >= 10){ const m = zs.reduce((a, c) => a + c, 0) / zs.length, sd = Math.sqrt(zs.reduce((a, c) => a + (c - m) ** 2, 0) / zs.length); id = sd < .005 ? 'SUS' : 'HOS'; }
      else if (e.T.cls !== 'UAV' && assess(S, e).closing) id = 'HOS';
      else if (e.kind === 'FTR' || e.kind === 'JAM' || e.kind === 'HELO') id = 'HOS';
    }
    if (id && k.id !== id) cmd(S, 'id', {uid:e.uid, id});
  }
  if (armClose !== S.bat.emcon) cmd(S, 'emcon', {v:armClose});
}
function runGhost(scn, opts){
  const S = createSim(scn, {...opts, mode:'SEMI', tca:{...(opts.tca || {}), fatigue:0, delegate:{reload:true, faults:true}}});
  let n = 0;
  while (!S.ended && n < 60000){ step(S); n++; if (n % 10 === 0) ghostThink(S); S.out.length = 0; }
  const engaged = {}; for (const x of S.ev) if (x.k === 'ENG' && x.uid) engaged[x.uid] = x.t;
  return {score:S.score, st:S.st, engaged, ev:S.ev.filter(x => ['ENG','KILL','HIT','VIOL','FRAT','EMCON'].includes(x.k)), t:S.t, kinds:Object.fromEntries(S.ents.map(e => [e.uid, e.kind]))};
}

// ---------- main step ----------
function step(S, dt = DT){
  if (S.ended) return;
  if (S.replayQ) while (S.replayQ.length && S.replayQ[0].n <= S.n){ const x = S.replayQ.shift(); S.inputs.push(x); CMD[x.c](S, x.a); }
  S.t += dt; S.n++;
  const b = S.bat;
  if (b.reorient > 0){ b.reorient -= dt; if (b.reorient <= 0){ b.ptl = b.newPtl; placeLaunchers(S); S.log.push({t:S.t, who:'SYS', text:`PTL ${String(Math.round(b.ptl)).padStart(3,'0')} · RADAR RADIATING`, cls:'sys'}); } }
  if (b.displace > 0){ b.displace -= dt; if (b.displace <= 0){ const s = S.scn.sites[b.dispTo]; b.x = s.x; b.y = s.y; b.site = b.dispTo; placeLaunchers(S); for (const L of S.launchers) if (!L.dead) L.state = 'READY'; say(S, 'TCA', `Emplaced at ${s.name}. Radar radiating.`, {pri:2}); } }
  while (S.si < S.spawns.length && S.spawns[S.si].t <= S.t){ const sp = S.spawns[S.si++]; sp.fn(); if (sp.threat) S.threatsLeft--; }
  processOrders(S);
  stepFaults(S);
  if (S.n % 20 === 0){ stepRadarBudget(S); stepRed(S); stepCrew(S); }
  for (const e of S.ents) if (e.alive) stepEnt(S, e, dt);
  updateTracks(S, dt);
  if (S.t >= S.nextAuto){ S.nextAuto = S.t + .5; autoEngage(S); }
  processPlans(S, dt);
  stepMissiles(S, dt);
  stepNeighbors(S, dt);
  stepLaunchers(S, dt);
  for (const e of S.ents) if (e.alive && e.trk && e.trk.est && !e.T.ballistic){ if (!e.trk.zs) e.trk.zs = []; if (Math.floor(S.t * 2) !== e.trk.zsT){ e.trk.zsT = Math.floor(S.t * 2); e.trk.zs.push(e.z); if (e.trk.zs.length > 30) e.trk.zs.shift(); } }
  if (!S.firstHostile){ const h = S.ents.find(e => e.alive && e.trk && e.trk.est && e.truth === 'H' && e.kind !== 'UAV'); if (h){ S.firstHostile = true; } }
  if (S.t >= S.nextSnap){ S.nextSnap = Math.floor(S.t) + 1; snapshot(S); }
  if (S.ents.length > 260) S.ents = S.ents.filter(e => e.alive || S.t - (e.diedT || (e.diedT = S.t)) < 5);
  checkEnd(S);
}

function autoEngage(S){
  if (S.mode === 'MANUAL' || !radarOn(S)) return;
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || e.trk.remote || e.trk.hold) continue;
    const k = e.trk;
    if (S.mode === 'AUTO' && k.idBy !== 'PLAYER' && (k.id === 'UNK' || k.id === 'PND') && k.iff === 'NO RESP' && e.kind !== 'FALSE'){
      const sp = Math.hypot(e.vx, e.vy), a0 = assess(S, e);
      if (sp > .1 && a0.closing && S.t - k.firstT > 6) setId(S, e, 'HOS', 'AUTO');
    }
    if (k.id !== 'HOS' || activePlan(S, e)) continue;
    const a = assess(S, e);
    if (!a.dal) continue;
    if (roeCheck(S, e).length) continue;
    engage(S, e, {src:S.mode === 'AUTO' ? 'auto' : 'semi', wpn:'AUTO'});
  }
}

function snapshot(S){
  const e = [];
  for (const x of S.ents){ if (!x.alive) continue; const k = x.trk; e.push([x.uid, +x.x.toFixed(2), +x.y.toFixed(2), +x.z.toFixed(3), x.kind, x.truth, k && k.est ? k.num : 0, k && k.est ? k.id : '', k && k.est ? (k.remote ? 2 : 1) : 0, +x.vx.toFixed(3), +x.vy.toFixed(3)]); }
  const m = S.ms.filter(q => q.alive).map(q => [+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), q.owner === 'own' ? 1 : 0]);
  S.snaps.push({t:Math.round(S.t), e, m, bat:{x:S.bat.x, y:S.bat.y, ptl:S.bat.ptl, on:radarOn(S), alive:S.bat.alive}, hp:S.assets.map(a => a.hp)});
}

function hostileActive(S){ return S.ents.some(e => e.alive && e.truth === 'H' && (e.dmg > 0 || e.kind === 'FTR')); }
function checkEnd(S){
  if (S.endAt != null && S.t >= S.endAt) return finish(S, S.endReason);
  const active = hostileActive(S) || S.ms.some(m => m.alive);
  if (S.t >= S.scn.dur && !active) return finish(S, 'Watch complete');
  if (S.threatsTotal > 0 && S.threatsLeft === 0 && !active && S.t > S.lastThreatT + 8 && S.t > 60) return finish(S, 'Raid defeated or spent');
  if (S.t >= S.scn.dur + 180) return finish(S, 'Watch complete');
}
function finish(S, reason){
  if (S.ended) return;
  S.ended = true; S.endReason = reason || 'Watch complete';
  if (S.abandon){ // unresolved threats count against you when the watch is abandoned
    for (const e of S.ents) if (e.alive && e.truth === 'H' && e.dmg > 0 && e.tgt){ const w = e.dmg * PRI_W[priOf(S, e.tgt)]; S.st.hitsW += w; }
    if (S.threatsLeft > 0){ S.st.potW += S.threatsLeft * 2; S.st.hitsW += S.threatsLeft * 2; }
  }
  snapshot(S);
  S.score = score(S);
  S.out.push({k:'end'});
}

function score(S){
  const st = S.st;
  const protect = Math.round(st.potW > 0 ? 40 * Math.max(0, 1 - st.hitsW / st.potW) : 40);
  const disc = Math.round(Math.max(0, 25 - 6 * st.viol - 3 * st.lateAck - 2 * st.misId - 3 * st.engMissed));
  const econ = Math.round(Math.max(0, Math.min(20, 20 - 2.5 * st.wasted - 1.5 * st.mseDrone)));
  const surv = Math.round(st.radarLost ? 0 : Math.max(0, 15 - 4 * st.lsLost));
  const total = st.frat ? 0 : protect + disc + econ + surv;
  return {protect, disc, econ, surv, total, frat:st.frat > 0};
}

function remaining(S){
  const r = {MSE:S.reserve.MSE, GEMT:S.reserve.GEMT};
  for (const L of S.launchers){ if (L.dead) continue; r.MSE += L.MSE; r.GEMT += L.GEMT; if (L.pend){ r.MSE += L.pend.MSE; r.GEMT += L.pend.GEMT; } }
  return r;
}

function findings(S){
  const st = S.st, s = S.score || score(S), sus = [], imp = [];
  const hitsUntracked = S.ev.filter(x => x.k === 'HIT' && x.untracked).length;
  if (st.leak === 0 && st.potW > 0) sus.push('No threat reached a defended asset.');
  if (st.viol === 0 && st.lateAck === 0) sus.push('Clean on ROE and orders: every order acknowledged on time.');
  if (st.vetoes > 0 || st.holdSaves > 0) sus.push(`You used veto or hold fire ${st.vetoes + st.holdSaves} time(s) to stop a bad engagement.`);
  if (st.wasted === 0 && st.fired.MSE + st.fired.GEMT > 0) sus.push('Every missile went at a real threat to the DAL.');
  if (st.waste.decoy) imp.push(`You fired ${st.waste.decoy} missile(s) at decoys. Decoys hold a fixed altitude: check ALT VAR before engaging slow drones.`);
  if (st.waste.fals) imp.push(`You fired ${st.waste.fals} missile(s) at false targets. Jammer-made tracks never firm up past low quality and never classify.`);
  if (st.waste.nondal) imp.push(`You fired ${st.waste.nondal} missile(s) at ballistic missiles falling outside the DAL. Read the impact marker: grey means let it fall.`);
  if (st.mseDrone) imp.push(`${st.mseDrone} PAC-3 MSE went at drones. GEM-T kills drones and cruise missiles at lower cost and saves PAC-3 for ballistic threats.`);
  if (hitsUntracked) imp.push(`${hitsUntracked} impact(s) came from threats you never tracked. Check the PTL against the threat axis and the low-altitude mask.`);
  if (st.viol) imp.push(`${st.viol} engagement(s) broke ROE. Under Weapons Tight, declare the track Hostile first; respect Hold Fire and Cease Fire orders.`);
  if (st.lateAck) imp.push(`${st.lateAck} order(s) went unacknowledged for 15 seconds. Press Space or ACK the moment the TD speaks.`);
  if (st.misId) imp.push(`${st.misId} identification error(s). Mode 4 valid means friend; airliners squawk Mode 3 on airways; friendlies use the corridor.`);
  if (st.radarLost) imp.push('You lost the radar. Against ARMs, go silent (EMCON) before impact; against a recon drone, kill it or displace.');
  if (st.frat) imp.push('You shot down a protected aircraft. Automatic mode declares any silent closing track hostile: veto or stay semiautomatic around friendly traffic.');
  if (st.lsLost) imp.push(`${st.lsLost} launcher(s) lost to impacts.`);
  let rec = 'Run it again with the same seed and beat your score.';
  if (st.frat) rec = 'Fly semiautomatic around mixed traffic, and hook every NO RESPONSE track inside the corridor before you declare it.';
  else if (hitsUntracked) rec = 'Before you take the watch, put the threat axis in the middle of your sector, not at its edge.';
  else if (st.wasted >= 3) rec = 'Hold your fire on anything without a red impact marker or a DAL heading. The queue ranks threats for you; trust it.';
  else if (st.mseDrone >= 2) rec = 'Set the drone doctrine to GEM-T single shot and keep PAC-3 for ballistic missiles.';
  else if (st.viol || st.lateAck) rec = 'Treat every TD call as an order: acknowledge first, then act.';
  else if (st.leak > 0) rec = 'Engage earlier: approve shots as soon as the track enters the envelope rather than when it is close.';
  return {sustain:sus.slice(0, 3), improve:imp.slice(0, 4), rec};
}

return {createSim, step, DT, RADAR, WEAPONS, TYPES, MAP, brgOf, polar, angDiff, horizon, heightAt, isLand, lowAltReach, coverage, assess, solve, threatQueue, roeCheck, engage, activePlan, radarOn, rounds,
  setMode, setEmcon, playerId, playerIff, holdFire, veto, ack, reload, reorient, displace, remaining, findings, score, onAirway, inCorridor, spoken, brgS, PRI_W,
  cmd, rewind, runGhost, learnRed, planRed, FAULTS, FIX_ACTIONS, CREW, setSector, tcaEff, circMean};
})();
if (typeof module !== 'undefined') module.exports = HT_SIM;
