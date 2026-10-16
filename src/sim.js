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
const PBOX = new WeakMap();
function polyBoxes(map){ let b = PBOX.get(map); if (!b){ b = (map.polys || []).map(p => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of p){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1, p]; }); PBOX.set(map, b); } return b; }
function isLand(map, x, y){ let inP = false; for (const [x0, y0, x1, y1, p] of polyBoxes(map)) if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && pip(p, x, y)){ inP = true; break; } return map.landDefault ? !inP : inP; }
// Terrain: a height field in km built from mountain ranges (multi-point spines with peaks, saddles,
// spurs and escarpments), isolated peaks, scattered hill fields and carved river valleys.
const vn2 = (x, y, s) => vnoise(x, y, s) * 2 - 1;
function ridged(x, y, s){ let t = 0, a = .5, f = 1, w = 1; for (let k = 0; k < 4; k++){ let n = 1 - Math.abs(vn2(x * f, y * f, s + k * 31)); n *= n * w; w = clamp(n * 1.8, 0, 1); t += a * n; f *= 2.07; a *= .5; } return t / .9375; }
function polyInfo(px, py, pts){
  let best = 1e9, side = 1, acc = 0, along = 0;
  for (let i = 0; i < pts.length - 1; i++){
    const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay, l2 = dx * dx + dy * dy, len = Math.sqrt(l2);
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0, d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
    if (d < best){ best = d; side = (dx * (py - ay) - dy * (px - ax)) >= 0 ? 1 : -1; along = acc + t * len; }
    acc += len;
  }
  return {d:best, side, u:acc ? along / acc : .5, len:acc};
}
const TSPEC = new WeakMap();
function terrSpec(map){
  let t = TSPEC.get(map); if (t) return t;
  const r = rng32((map.seed || 7) * 7919 + 13), peaks = (map.peaks || []).map(p => p.slice());
  for (const f of map.hills || []) for (let i = 0; i < f.n; i++) peaks.push([f.a[0] + (f.b[0] - f.a[0]) * r(), f.a[1] + (f.b[1] - f.a[1]) * r(), f.h * (.35 + .65 * r()), f.r * (.6 + .8 * r())]);
  const pad = (map.warp ?? 10) + 1, ranges = (map.ranges || []).map(R => { const w = R.w || 8, e = w * 5.5 + pad; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of R.p){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return {R, w, box:[x0 - e, y0 - e, x1 + e, y1 + e]}; });
  t = {peaks, ranges, pad}; TSPEC.set(map, t); return t;
}
const blend = (a, b) => Math.max(a, b) + Math.min(a, b) * .22;
function heightAt(map, x, y){
  if (!isLand(map, x, y)) return -1;
  const s = map.seed || 7, T = terrSpec(map), ns = map.nscale || 45, wa = map.warp ?? 10;
  const wx = x + wa * (.75 * vn2(x / 55, y / 55, s + 101) + .25 * vn2(x / 16, y / 16, s + 107)), wy = y + wa * (.75 * vn2(x / 55 + 9.1, y / 55 - 3.7, s + 103) + .25 * vn2(x / 16 - 5.3, y / 16 + 2.2, s + 109)); // bends spines and contours
  let rn = -1; const RN = () => rn >= 0 ? rn : (rn = ridged(wx / 7, wy / 7, s + 13)); // crags, spurs and gullies
  let h = (map.namp ?? .2) * (.62 * fbm(wx / (ns * 1.6), wy / (ns * 1.6), s) + .1 * ridged(wx / (ns * .6), wy / (ns * .6), s + 5)); // broad, gentle lowland relief
  for (const {R, w, box} of T.ranges){
    if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
    const I = polyInfo(wx, wy, R.p); if (I.d > w * 5.5) continue;
    const wv = .6 + .85 * fbm(wx / (w * 5) + 11, wy / (w * 5), s + 41); // the range swells and narrows along its length
    const sp = ridged(wx / (w * 1.5) + 3, wy / (w * 1.5) - 7, s + 57); // spurs branching off the crest, gullies between
    let t = I.d / (w * wv) * (1 - .5 * sp); if (R.s) t *= I.side === R.s ? 2.4 : (R.dip ?? .7); // escarpment: steep face on side s, long dip slope behind
    const m = .45 + .8 * fbm(wx / (w * 2.4) + 40, wy / (w * 2.4), s + 29); // peaks and saddles along the crest
    const end = Math.min(1, I.u * I.len / (w * 1.6), (1 - I.u) * I.len / (w * 1.6)), r = RN();
    const core = Math.exp(-t * t * (1.6 - r)) * (.68 + .5 * r), foot = Math.exp(-t * t * .45) * .2;
    h = blend(h, R.h * m * (.35 + .65 * end) * (core + foot));
  }
  for (const [px, py, ph, pr] of T.peaks){
    const dx = wx - px, dy = wy - py, d2 = (dx * dx + dy * dy) / (pr * pr); if (d2 > 9) continue;
    const r = RN(); h = blend(h, ph * Math.exp(-d2 * (1.5 - .9 * r)) * (.72 + .42 * r));
  }
  for (const rv of map.rivers || []){ const d = distPoly(x, y, rv.pts); if (d < 12) h *= 1 - .6 * Math.exp(-(d * d) / 20); }
  if ((map.polys || []).length){ let n = 0; for (const [ox, oy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) n += isLand(map, x + ox, y + oy) ? 1 : 0; if (n < 4) h *= .15 + .85 * (n / 4) ** 2; } // coastal plain
  return Math.max(0, h);
}
// Line of sight from an emplaced radar: one ray per half degree, built on demand. th[i] holds the
// steepest terrain elevation angle seen inside i km; a target is hidden while its own angle is lower.
const RE = 8495, LOS = new WeakMap();
function losSite(map, sx, sy){
  let m = LOS.get(map); if (!m){ m = new Map(); LOS.set(map, m); }
  const k = sx.toFixed(2) + ',' + sy.toFixed(2); let o = m.get(k); if (o) return o;
  let g0 = 0; for (let a = 0; a < 8; a++){ const p = polar(a * 45, .8, {x:sx, y:sy}); g0 = Math.max(g0, heightAt(map, p.x, p.y)); }
  o = {h0:Math.max(g0, heightAt(map, sx, sy), 0) + RADAR.h, x:sx, y:sy, rays:new Array(720)}; m.set(k, o); return o;
}
function losRay(map, o, bin){
  let r = o.rays[bin]; if (r) return r;
  const N = Math.ceil(RADAR.rmax) + 2, th = new Float32Array(N), g = new Float32Array(N), face = []; const b = bin / 2;
  let mx = -1;
  for (let i = 1; i < N; i++){
    const p = polar(b, i, o), hg = Math.max(0, heightAt(map, p.x, p.y)), a = (hg - i * i / (2 * RE) - o.h0) / i;
    g[i] = hg; th[i - 1] = i === 1 ? -1 : mx;
    if (a > mx){ if (hg > .04 && i < 110) face.push(i); mx = a; }
  }
  th[N - 1] = mx;
  return (o.rays[bin] = {th, g, face});
}
const altMsl = (z, g) => z + g * clamp(1 - z / 3, 0, 1); // low fliers hug the ground, high fliers hold altitude
function losClear(map, sx, sy, x, y, z, g){
  const dx = x - sx, dy = y - sy, r = Math.hypot(dx, dy); if (r < 1) return true;
  const o = losSite(map, sx, sy), ray = losRay(map, o, Math.round(brgOf(dx, dy) * 2) % 720), i = Math.min(ray.th.length - 1, Math.floor(r));
  const gg = g ?? Math.max(0, heightAt(map, x, y));
  return (altMsl(z, gg) - r * r / (2 * RE) - o.h0) / r >= ray.th[i];
}
function masked(map, sx, sy, x, y, z){ return !losClear(map, sx, sy, x, y, z); }
function lowAltReach(map, sx, sy, b, z){ // distance at which a target at height z first disappears along bearing b
  const lim = Math.min(horizon(z), RADAR.rmax), o = losSite(map, sx, sy), ray = losRay(map, o, Math.round(((b % 360) + 360) % 360 * 2) % 720);
  for (let i = 2; i < lim; i++) if ((altMsl(z, ray.g[i]) - i * i / (2 * RE) - o.h0) / i < ray.th[i]) return i;
  return lim;
}
function terrainFaces(map, sx, sy, b){ const o = losSite(map, sx, sy); return losRay(map, o, Math.round(((b % 360) + 360) % 360 * 2) % 720).face; }

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
    doctrine:Object.assign({TBM:'RIPPLE', AIR:'SLS', UAV:'SINGLE', THAAD:'SLS', LAYER:'WAIT'}, o.doctrine || {}),
    launchers:[], reserve:{MSE:0, GEMT:0, THAAD:0}, loaded:{MSE:0, GEMT:0, THAAD:0},
    assets:scn.assets.map(a => ({...a, hpMax:a.hp || 2, hp:a.hp || 2})),
    acks:[], ceaseUntil:-1, spawns:[], si:0, orderQ:[], faultQ:[], threatsLeft:0, threatsTotal:0, lastThreatT:0,
    neighbors:(scn.neighbors || []).map(n => ({...n, on:true, cool:0})),
    st:{fired:{GEMT:0, MSE:0, THAAD:0}, duds:0, flightFail:0, uncertain:0, clusterRel:0, clusterHits:0, popHits:0, cuasKills:0, cuasCost:0, killCost:0, nearMiss:0, tpyLost:false, spent:0, killVal:0, wasted:0, waste:{decoy:0, fals:0, nondal:0, protect:0}, mseDrone:0, viol:0, lateAck:0, misId:0, frat:0, hitsW:0, potW:0, leak:0, kills:0, miss:0, radarLost:false, lsLost:0, vetoes:0, debris:0, engMissed:0, outSector:0, holdSaves:0, fuLost:0, dup:0, dupShots:0, swaps:0, duals:0, corr:0, civDebris:0, ppli:0, bnVeto:0},
    xp:o.xp || 0, tut:scn.tutorial || null, diff:o.difficulty || 'normal',
    ended:false, endAt:null, endReason:'', idLog:{}, n:0, inputs:[], replayQ:null, faults:[], radar:{load:0, searchF:1, trackPct:8}, radiateT:0, sbw:[], sbwLast:-99, mopp:0, comms:true, dispFault:false, ewrLost:false, wccSlow:0, nextSnap:0, nextAuto:0, firstHostile:false, firstTbm:false, idCount:0,
  };
  const stock = o.stock ? {...o.stock} : null;
  const take = (k, n) => { if (!stock || stock[k] == null) return n; const g = Math.min(n, stock[k]); stock[k] -= g; return g; };
  scn.launchers.forEach((L, i) => {
    const type = L[0], cap = type === 'MSE' ? {MSE:12, GEMT:0} : type === 'GEMT' ? {MSE:0, GEMT:4} : {MSE:6, GEMT:2};
    const mse = take('MSE', L[1]), gemt = take('GEMT', L[2]);
    cap.THAAD = 0;
    S.launchers.push({id:i + 1, type, cap, MSE:mse, GEMT:gemt, THAAD:0, state:'READY', timer:0, x:0, y:0, dead:false, pend:null});
    S.loaded.MSE += mse; S.loaded.GEMT += gemt;
  });
  if (scn.thaad){ // upper tier: an AN/TPY-2 radar and THAAD launchers on their own site
    const T = scn.thaad;
    S.thaad = {x:T.x, y:T.y, ptl:T.ptl, half:T.half || 60, rmax:T.rmax || 600, name:T.name || 'THAAD', alive:true, emcon:false};
    for (let i = 0; i < (T.launchers || 6); i++){ const n = take('THAAD', T.rounds || 8); S.launchers.push({id:'T' + (i + 1), type:'THAAD', cap:{MSE:0, GEMT:0, THAAD:T.rounds || 8}, MSE:0, GEMT:0, THAAD:n, state:'READY', timer:0, x:0, y:0, dead:false, pend:null}); S.loaded.THAAD += n; }
    S.reserve.THAAD = take('THAAD', (scn.reserve && scn.reserve.THAAD) || 0); S.loaded.THAAD += S.reserve.THAAD;
  }
  S.seat = S.thaad && (o.seat || scn.seat) === 'THAAD' ? 'THAAD' : 'PAT';
  S.fus = [S.bat];
  if (scn.bn) setupBn(S, o, take);
  S.cuas = (scn.cuas || []).map((c, i) => ({...c, id:'C' + (i + 1), left:c.n || 0, busy:0}));
  S.cuasAuto = o.cuasAuto !== false;
  S.reserve.MSE = take('MSE', (scn.reserve && scn.reserve.MSE) || 0);
  S.reserve.GEMT = take('GEMT', (scn.reserve && scn.reserve.GEMT) || 0);
  S.loaded.MSE += S.reserve.MSE; S.loaded.GEMT += S.reserve.GEMT;
  S.opts = JSON.parse(JSON.stringify(o));
  S.tca = makeTca(o.tca);
  if (S.bn) S.tca.delegate = {...S.tca.delegate, reload:true};
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
  for (const b of S.fus || [S.bat]){
    const P = S.launchers.filter(L => L.type !== 'THAAD' && (!S.bn || L.fu === b.id)), n = P.length;
    P.forEach((L, i) => { const p = polar(b.ptl + 180 + (i - (n - 1) / 2) * 30, 1.3 + (i % 2) * .5, b); L.x = p.x; L.y = p.y; });
  }
  if (S.thaad){ const T = S.launchers.filter(L => L.type === 'THAAD'), m = T.length; T.forEach((L, i) => { const p = polar(S.thaad.ptl + 180 + (i - (m - 1) / 2) * 24, 2 + (i % 2) * .6, S.thaad); L.x = p.x; L.y = p.y; }); }
}
const lsTotal = L => (L.MSE || 0) + (L.GEMT || 0) + (L.THAAD || 0);
function thaadOn(S){ const T = S.thaad; return !!T && T.alive && !T.emcon; }

function assetById(S, id){ return S.assets.find(a => a.id === id); }
function priOf(S, id){ if (id === 'BTY' || id === 'TPY' || (id && id.startsWith && id.startsWith('FU:'))) return 1; const a = assetById(S, id); return a ? a.pri : 3; }

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
  if (tgt === 'tpy' && S.thaad) return {pt:{x:S.thaad.x + (S.rng() - .5) * .4, y:S.thaad.y + (S.rng() - .5) * .4}, id:'TPY'};
  if (tgt && tgt.startsWith && tgt.startsWith('fu:')){ const f = fuById(S, tgt.slice(3)) || S.bat; return {pt:{x:f.x + (S.rng() - .5) * .4, y:f.y + (S.rng() - .5) * .4}, id:f === S.bat && !S.bn ? 'BTY' : 'FU:' + f.id}; }
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
      const iffFail = (f.iffFail || []).includes(i), stray = (f.stray || []).includes(i);
      addSpawn(S, f.t + i * 14, () => {
        let pts = cor.pts.map(P); if (f.out) pts.reverse();
        if (stray){ const a = pts[0], b = pts[pts.length - 1], hd = brgOf(b.x - a.x, b.y - a.y), m = polar(hd + 90 * (f.side || 1), f.off || 16, {x:a.x + (b.x - a.x) * .55, y:a.y + (b.y - a.y) * .55}), m2 = polar(hd + 90 * (f.side || 1), (f.off || 16) * .6, {x:a.x + (b.x - a.x) * .85, y:a.y + (b.y - a.y) * .85}); pts = [a, m, m2, b]; }
        const kind = f.type || 'FRD';
        const e = mkEnt(S, kind, {wp:pts, frac:f.out ? 0 : .45, tag:f.tag || null, iffFail, onEnd:'exit', alt:TYPES[kind].alt + (rng() - .5)});
        if (iffFail) e.iffInter = true;
      });
    }
  }
  for (const ot of scn.others || []){
    addSpawn(S, ot.t, () => { const e = mkEnt(S, ot.type, {wp:ot.route.map(P), alt:ot.alt, loop:!!ot.loop, tag:ot.tag || null, onEnd:'exit', iffFail:!!ot.iffFail}); if (ot.iffFail) e.iffInter = true; if (ot.until) e.leaveAt = ot.until; });
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
    if (T.maneuver || T.marv){ e.manA = 1.2 + rng() * 1.2; e.manK = 2 + rng() * 2; }
    if (T.cluster) e.relAlt = T.cluster.alt[0] + rng() * (T.cluster.alt[1] - T.cluster.alt[0]);
    if (R.id) S.st.potW += e.dmg * PRI_W[priOf(S, R.id)] * (T.cluster ? 1.4 : 1);
    if (S.scn.sbw !== false && !S.tut) S.sbw.push({uid:e.uid, t:S.t + (S.ewrLost ? 30 : 12) + rng() * 6, ex:(rng() - .5) * 30, ey:(rng() - .5) * 30, L:{x:L.x, y:L.y}, on:false});
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
    else if (role === 'sead'){ const hm = (w.home && fuById(S, w.home)) || S.bat; const near = polar(brgOf(P0.x - hm.x, P0.y - hm.y), 62, hm); wp = [P0, near, P0]; }
    else { const beyond = polar(brgOf(R.pt.x - P0.x, R.pt.y - P0.y), 120, R.pt); wp = [P0, R.pt, beyond]; }
    const e = mkEnt(S, 'FTR', {wp, alt:w.alt || TYPES.FTR.alt, tag:w.tag, onEnd:'exit'});
    e.role = role; if (w.home && fuById(S, w.home)) e.home = fuById(S, w.home); e.cm = w.cm || 2; e.arm = w.arm || 2; e.armCool = 0; e.cmTargets = (w.targets || []).filter(x => x !== 'miss');
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
  const n = S.diff === 'hard' ? 4 : 2, kinds = ['RADAR', 'LS', 'EPP', 'LS', 'WCC', 'COMMS', 'DISP'];
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
function radarOnFu(f){ return !!f && f.alive && !f.emcon && !(f.reorient > 0) && !(f.displace > 0) && !(f.epp > 0); }
const fuById = (S, id) => (S.fus || []).find(f => f.id === id);
function jamFactor(S, brg, r, src = S.bat){
  let f = 1;
  for (const j of S.ents) if (j.alive && j.kind === 'JAM'){
    const jb = brgOf(j.x - src.x, j.y - src.y);
    if (Math.abs(angDiff(brg, jb)) < 5 && r > 30) f = Math.min(f, .35);
  }
  return f;
}
function detects(S, src, e, own){
  const dx = e.x - src.x, dy = e.y - src.y, r = Math.hypot(dx, dy);
  if (r < .3) return true;
  const brg = brgOf(dx, dy);
  if (Math.abs(angDiff(brg, src.ptl)) > (src.half || RADAR.half)) return false;
  let R = RADAR.rmax * Math.pow(e.T.rcs, .25) * (src.rf || 1);
  if (own){ if (S.bat.radarFault > 0) R *= .6; R *= jamFactor(S, brg, r) * S.radar.searchF * (S.bat.half < 60 ? 1.25 : 1); }
  else if (src.fuUnit) R *= jamFactor(S, brg, r, src);
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

function tpyDetects(S, e){
  const T = S.thaad; if (!e.T.ballistic || e.z < .8) return false;
  const dx = e.x - T.x, dy = e.y - T.y, r = Math.hypot(dx, dy);
  if (e.z < r * r / (2 * RE)) return false; // below the radar horizon: still too low and too far to see
  return r <= T.rmax * Math.pow(e.T.rcs / .45, .25) && Math.abs(angDiff(brgOf(dx, dy), T.ptl)) <= T.half;
}
function updateTracks(S, dt){
  if (S.bn) return updateTracksBn(S, dt);
  const on = radarOn(S), own = {x:S.bat.x, y:S.bat.y, ptl:S.bat.ptl, half:S.bat.half}, tOn = thaadOn(S);
  for (const e of S.ents){
    if (!e.alive) continue;
    const ownDet = on && detects(S, own, e, true), tpy = tOn && tpyDetects(S, e);
    let remDet = false, remName = null;
    if (!ownDet && S.comms) for (const nb of S.neighbors) if (nb.on && detects(S, nb, e, false)){ remDet = true; remName = nb.name; break; }
    if (!ownDet && !remDet && tpy){ remDet = true; remName = 'TPY-2'; }
    if (e.kind === 'FALSE' && !ownDet) remDet = false;
    if (ownDet || remDet){
      if (!e.trk) e.trk = {num:0, q:0, est:false, cls:false, id:'PND', idBy:'', last:S.t, remote:!ownDet, iff:null, hold:false, firstT:S.t, remName, zs:[]};
      const k = e.trk; k.last = S.t; k.remote = !ownDet; k.remName = remName; k.tpy = tpy;
      const rate = e.T.ballistic ? .7 : .35;
      k.q = Math.min(e.kind === 'FALSE' ? .45 : 1, k.q + dt * rate * (ownDet || tpy ? 1 : .6));
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
  if (e.model === 'fall'){ const z = e.z + e.vz * dt; return z <= 0 ? {x:e.I.x, y:e.I.y, z:0, end:true} : {x:e.x + e.vx * dt, y:e.y + e.vy * dt, z, end:false}; }
  if (e.model === 'bal'){ const t = S.t + dt; if (t >= e.t0 + e.T0) return {x:e.I.x, y:e.I.y, z:0, end:true}; const p = balPos(e, t); return {x:p.x, y:p.y, z:p.z, end:false}; }
  if (e.model === 'false') return {x:e.x + e.vx * dt, y:e.y + e.vy * dt, z:e.z, end:false};
  const p = walk(e, e.speed * dt);
  if (e.kind === 'ARM'){ const hm = e.home || S.bat, d = Math.hypot(p.x - hm.x, p.y - hm.y); p.z = Math.min(e.alt, d / 9); }
  return p;
}

function stepEnt(S, e, dt){
  if (e.model === 'fall'){ e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt; if (e.z <= 0){ e.z = 0; impact(S, e, e.I.x, e.I.y); } return; }
  if (e.model === 'bal'){
    const p = balPos(e, S.t);
    if (p.s >= 1){ impact(S, e, e.I.x, e.I.y); return; }
    if (e.T.liquid && !e.sep && p.s >= .5) separate(S, e, p);
    if (e.T.cluster && !e.released && p.s > .5 && p.z <= e.relAlt) releaseCluster(S, e);
    let x = p.x, y = p.y;
    if ((e.T.maneuver || e.T.marv) && p.s > .6){ const k = (p.s - .6) / .4, off = e.manA * Math.sin(p.s * Math.PI * e.manK) * k, hb = brgOf(e.I.x - e.L.x, e.I.y - e.L.y) + 90; const o = polar(hb, off); x += o.x; y += o.y; }
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
  if (e.kind === 'ARM'){ const hm = e.home || S.bat, d = Math.hypot(e.x - hm.x, e.y - hm.y); e.z = Math.min(e.alt, d / 9); }
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
      const hm = e.home || S.bat, d = Math.hypot(e.x - hm.x, e.y - hm.y);
      if (e.arm > 0 && d < 90 && radarOnFu(hm) && e.armCool <= 0){
        e.arm--; e.armCool = 6;
        const a = mkEnt(S, 'ARM', {wp:[{x:e.x, y:e.y}, {x:hm.x, y:hm.y}], alt:e.z, tgt:S.bn ? 'FU:' + hm.id : 'BTY', tgtPt:{x:hm.x, y:hm.y}, onEnd:'impact'});
        a.z = e.z; a.armT0 = S.t; a.silentT = 0; a.home = hm; S.st.potW += a.dmg; S.threatsTotal++;
      }
    }
  }
  if (e.kind === 'ARM' && e.alive){ if (!radarOnFu(e.home || S.bat)) e.silentT += dt; if (e.silentT > 4) e.lost = true; }
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
  if (e.leaveAt && S.t >= e.leaveAt && e.loop){ e.loop = false; e.wp = [{x:e.x, y:e.y}, polar(e.leaveBrg != null ? e.leaveBrg : brgOf(e.x, e.y), 280, {x:0, y:0})]; e.wi = 1; }
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
  if (e.released){ clusterImpact(S, e, ix, iy); return; }
  const T = S.thaad;
  if (T && T.alive && Math.hypot(ix - T.x, iy - T.y) < (e.tgt === 'TPY' ? 1.4 : .5)){
    T.alive = false; S.st.tpyLost = true; S.st.hitsW += e.dmg * PRI_W[1]; S.st.leak++;
    tone(S, 'klaxon'); ev(S, 'HIT', 'AN/TPY-2 RADAR DESTROYED', {bad:true, x:ix, y:iy});
    say(S, 'TD', `${callsign(S)}, ${tdName(S)}. The TPY-2 is down. No upper tier. You are on your own.`, {pri:5});
    S.out.push({k:'banner', text:'TPY-2 DESTROYED', cls:'bad'}); S.out.push({k:'impact', x:ix, y:iy});
    for (const p of S.plans) if (p.tier === 'UT' && p.state !== 'DONE') cancelPlan(S, p, 'TPY-2 LOST');
    return;
  }
  if (S.bn) for (const f of S.fus){
    if (!f.alive) continue; const d = Math.hypot(ix - f.x, iy - f.y);
    if (d < (e.tgt === 'FU:' + f.id ? 1.6 : .5)){
      f.alive = false; S.st.fuLost++; S.st.hitsW += e.dmg * PRI_W[1]; S.st.leak++;
      tone(S, 'klaxon'); ev(S, 'HIT', `${f.name} RADAR DESTROYED`, {bad:true, x:ix, y:iy});
      say(S, 'NET', `${f.name}: impact on the radar. ${f.name} is blind.`, {pri:5, cls:'net'});
      S.out.push({k:'banner', text:`${f.name} RADAR DESTROYED`, cls:'bad'}); S.out.push({k:'impact', x:ix, y:iy});
      return;
    }
  }
  if (b.alive && dB >= .5 && dB < 4 && e.tgt !== 'BTY' && e.tgt !== 'FU:' + b.id){ S.st.nearMiss++; S.out.push({k:'shake', d:dB}); ev(S, 'NEAR', `Impact ${dB.toFixed(1)} km from the battery`, {x:ix, y:iy}); }
  if (!S.bn && b.alive && dB < (e.tgt === 'BTY' ? 1.6 : .5) && b.displace <= 0){
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
    hit.hp = Math.max(0, hit.hp - e.dmg); S.st.hitsW += e.dmg * PRI_W[hit.pri]; S.st.leak++; if (hit.pop) S.st.popHits++;
    if (hit.ewr && hit.hp <= 0 && !S.ewrLost){ S.ewrLost = true; ev(S, 'EWR', `${hit.name} out of action: space-based and early warning slower`, {bad:true}); }
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
  const tg = S.bn ? [...S.assets, ...S.fus.filter(f => f.alive).map(f => ({id:'FU:' + f.id, name:f.name + ' radar', x:f.x, y:f.y, pri:1}))] : [...S.assets, {id:'BTY', name:'the battery', x:S.bat.x, y:S.bat.y, pri:1}];
  if (S.thaad && S.thaad.alive) tg.push({id:'TPY', name:'the TPY-2', x:S.thaad.x, y:S.thaad.y, pri:1});
  if (e.model === 'bal' || e.model === 'fall'){
    const tImp = Math.max(0, e.t0 + e.T0 - S.t); let dal = null, bd = 1e9;
    const rr = e.T.cluster ? e.T.cluster.r : 0;
    for (const a of tg){ const d = Math.hypot(e.I.x - a.x, e.I.y - a.y); if (d < (a.id === 'BTY' || a.id === 'TPY' || a.id.startsWith('FU:') ? 3 : 4) + rr && d < bd){ bd = d; dal = a; } }
    return {dal, tta:tImp, impact:e.I, closing:true};
  }
  if (e.kind === 'ARM'){ const hm = e.home || S.bat, d = tg.find(a => a.id === (S.bn ? 'FU:' + hm.id : 'BTY')) || tg[tg.length - 1]; return {dal:d, tta:Math.hypot(e.x - hm.x, e.y - hm.y) / e.speed, impact:null, closing:true}; }
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
function rounds(S, w, readyOnly = true, fuId){ return S.launchers.reduce((s, L) => s + ((!L.dead && (!fuId || L.fu === fuId) && (!readyOnly || L.state === 'READY')) ? (L[w] || 0) : 0), 0); }
function pickLauncher(S, w, fuId){ let best = null; for (const L of S.launchers) if (!L.dead && (!fuId || L.fu === fuId) && L.state === 'READY' && L[w] > 0 && (!best || L[w] > best[w])) best = L; return best; }
function activePlan(S, e, tier){ return S.plans.find(p => p.uid === e.uid && p.state !== 'DONE' && (!tier || p.tier === tier)); }
function solve(S, e, wk, fuId){
  const W = WEAPONS[wk], ut = wk === 'THAAD', b = ut ? (S.thaad || S.bat) : (fuId && fuById(S, fuId)) || S.bat;
  if (e.released) return {ok:false, why:'SUBMUNITIONS RELEASED', tof:0, p:{x:e.x, y:e.y, z:e.z}, h:0};
  if (ut && !e.T.ballistic) return {ok:false, why:'BALLISTIC TARGETS ONLY', tof:0, p:{x:e.x, y:e.y, z:e.z}, h:0};
  const tmax = e.model === 'bal' || e.model === 'fall' ? Math.max(.6, e.t0 + e.T0 - S.t - .2) : 240;
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
  else if (ut && p.z < W.minAlt){ ok = false; why = 'BELOW THAAD FLOOR'; }
  else if (e.T.ballistic && p.z < 2.5){ ok = false; why = 'TOO LOW · DEBRIS'; }
  else if (h < W.minR && p.z < 1.5){ ok = false; why = 'INSIDE MIN RANGE'; }
  return {ok, why, tof:tg, p, h};
}
function waitable(S, e, why){
  if (why === 'OUT OF RANGE' || why === 'ABOVE CEILING') return e.T.ballistic || assess(S, e).closing;
  return false;
}
function docFor(S, e, ut){ if (ut) return S.doctrine.THAAD; if (e.T.ballistic) return S.doctrine.TBM; if (e.T.cls === 'UAV') return S.doctrine.UAV === 'CUAS' ? 'SINGLE' : S.doctrine.UAV; return S.doctrine.AIR; }
function isSelfDef(S, e){ const a = assess(S, e); return a.dal && (a.dal.id === 'BTY' || a.dal.id.startsWith('FU:')); }
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
function reactDelay(S, src){ const base = S.adw === 'WHITE' ? 6 : S.adw === 'YELLOW' ? 3.5 : 2; return base * (1 - .06 * Math.min(5, S.xp)) * (src === 'player' ? 1 : .8) + (S.wccSlow || 0) + (S.mopp >= 4 && src === 'player' ? 1.2 : 0); }

function engage(S, e, o = {}){
  const src = o.src || 'player';
  if (!e || !e.alive) return {ok:false, why:'NO TARGET'};
  if (!e.trk || !e.trk.est) return {ok:false, why:'NO FIRM TRACK'};
  const ut = o.wpn === 'THAAD', tier = ut ? 'UT' : 'LT';
  if (ut){
    if (!S.thaad) return {ok:false, why:'NO THAAD BATTERY'};
    if (!thaadOn(S)) return {ok:false, why:S.thaad.alive ? 'TPY-2 SILENT' : 'TPY-2 DESTROYED'};
    if (!e.T.ballistic) return {ok:false, why:'THAAD ENGAGES BALLISTIC TARGETS ONLY'};
    if (!e.trk.tpy) return {ok:false, why:'NO TPY-2 TRACK'};
  } else if (S.bn){
    if (!o.fu || o.fu === 'BEST'){ const bs = bestShooter(S, e, o.wpn); if (!bs) return {ok:false, why:S.bn.arch === 'IBCS' ? 'NO FIRE UNIT HAS A SOLUTION' : 'NO BATTERY HOLDS IT WITH A SOLUTION'}; o = {...o, fu:bs.fu, wpn:o.wpn && o.wpn !== 'AUTO' ? o.wpn : bs.w}; }
    const f = fuById(S, o.fu); if (!f) return {ok:false, why:'NO SUCH FIRE UNIT'};
    if (f.epp > 0) return {ok:false, why:f.name + ' POWER FAULT'};
    if (S.bn.arch === 'IBCS'){ if (!e.trk.by || !e.trk.by.length) return {ok:false, why:'NO SENSOR HOLDS THE TRACK'}; }
    else { if (!radarOnFu(f)) return {ok:false, why:f.name + ' RADAR NOT RADIATING'}; if (!e.trk.by || !e.trk.by.includes(f.id)) return {ok:false, why:f.name + ' HOLDS NO TRACK · LEGACY FIRES ON OWN RADAR ONLY'}; }
    if (S.plans.some(p => p.uid === e.uid && p.state !== 'DONE' && p.tier === 'LT' && p.fu === f.id)) return {ok:false, why:'ALREADY ENGAGED BY ' + f.name};
    const oth = S.plans.find(p => p.uid === e.uid && p.state !== 'DONE' && p.tier === 'LT');
    if (oth && src === 'player' && !o.force) return {ok:false, why:'ALREADY ENGAGED BY ' + (fuById(S, oth.fu) || {name:'BATTALION'}).name};
  } else {
    if (e.trk.remote) return {ok:false, why:'REMOTE TRACK · OWN RADAR MUST HOLD TRACK'};
    if (!radarOn(S)) return {ok:false, why:'RADAR NOT RADIATING'};
    if (S.bat.epp > 0) return {ok:false, why:'POWER FAULT'};
  }
  if (!S.bn || ut){ if (activePlan(S, e, tier)) return {ok:false, why:'ALREADY ENGAGED'}; }
  const v = roeCheck(S, e);
  if (src !== 'player' && v.length) return {ok:false, why:v[0]};
  if (src === 'player' && v.length && !o.force) return {ok:false, viol:v, why:v[0]};
  const pref = o.wpn && o.wpn !== 'AUTO' ? [o.wpn] : rec(e), fid = S.bn && !ut ? o.fu : undefined;
  let w = null, sol = null;
  for (const c of pref){ if (rounds(S, c, true, fid) <= 0) continue; const s = solve(S, e, c, fid); if (s.ok || waitable(S, e, s.why)){ w = c; sol = s; break; } if (!w){ w = c; sol = s; } }
  if (!w) return {ok:false, why:'NO MISSILES READY'};
  if (!sol.ok && !waitable(S, e, sol.why)) return {ok:false, why:sol.why};
  if (v.length){
    S.st.viol++; ev(S, 'VIOL', `ROE violation on track ${e.trk.num}: ${v.join('; ')}`, {bad:true, trk:e.trk.num});
    say(S, 'TD', `${callsign(S)}, ${tdName(S)}. You are not cleared to engage track ${e.trk.num}.`, {pri:4, speak:`${callsign(S)}, ${tdName(S)}. You are not cleared to engage track ${spoken(e.trk.num)}`});
  }
  const doc = docFor(S, e, ut);
  const bnVeto = S.bn && !ut && src !== 'player' && !e.T.ballistic && e.trk.idBy === 'AUTO'; // battalion: crews give the FDC a veto window on air tracks the computer declared
  const p = {id:S.pid++, uid:e.uid, trk:e.trk.num, w, tier, wpref:o.wpn || 'AUTO', doc, src, fu:fid, state:src === 'auto' || bnVeto ? 'VETO' : (sol.ok ? 'READY' : 'WAIT'), vetoT:src === 'auto' ? 5 : bnVeto ? 6 : 0, fireAt:S.t + reactDelay(S, src), shots:0, max:doc === 'RIPPLE' ? 2 : 1, inflight:0, salvo:1, created:S.t, result:''};
  if (S.bn && !ut){ const oth = S.plans.find(q => q.uid === e.uid && q.state !== 'DONE' && q.tier === 'LT'); if (oth){ p.dup = true; S.st.dup++; ev(S, 'DUP', `Duplicate engagement: ${fuById(S, fid).name} and ${(fuById(S, oth.fu) || {name:'?'}).name} both on track ${e.trk.num}`, {bad:true, trk:e.trk.num}); } }
  S.plans.push(p);
  if (e.engageOrder) e.engageDone = true;
  const fnm = fid ? fuById(S, fid).name : null;
  ev(S, 'ENG', `${src === 'player' ? 'Engage' : src === 'semi' ? 'Semi-auto engage' : src === 'ai' ? (ut ? 'THAAD crew engages' : fnm ? fnm + ' engages' : 'Patriot crew engages') : 'Auto engage'} track ${e.trk.num}${fnm && src !== 'ai' ? ' · ' + fnm : ''} · ${WEAPONS[w].name} · ${doc}`, {trk:e.trk.num, uid:e.uid, src, kind:e.kind, tier, fu:fid});
  if (bnVeto){ tone(S, 'veto'); S.log.push({t:S.t, who:'NET', text:`${fnm} ENGAGING TRK ${e.trk.num} · ${WEAPONS[w].name} · VETO 6 S`, cls:'net'}); say(S, 'NET', `${fnm} engaging track ${e.trk.num}. Veto window six seconds.`, {speak:`${fnm} engaging ${spoken(e.trk.num)}`, pri:2, silent:true}); }
  else if (src === 'ai'){ S.log.push({t:S.t, who:'NET', text:`${ut ? 'THAAD' : fnm || 'PATRIOT'} ENGAGING TRK ${e.trk.num} · ${WEAPONS[w].name} · ${doc}`, cls:'net'}); }
  else if (src === 'auto'){ tone(S, 'veto'); say(S, S.bn ? 'NET' : 'TCA', `Auto engage track ${e.trk.num}${fnm ? ', ' + fnm : ''}. Veto window five seconds.`, {speak:`Auto engage track ${spoken(e.trk.num)}`, pri:2, cls:S.bn ? 'net' : ''}); }
  else if (S.bn) S.log.push({t:S.t, who:'FDC', text:`${fnm} ENGAGE TRK ${e.trk.num} · ${WEAPONS[w].name} · ${doc}${src === 'semi' ? ' · IBCS' : ''}`, cls:'me'});
  else say(S, 'TCA', `Engaging track ${e.trk.num}, ${WEAPONS[w].name}.`, {speak:`Engaging track ${spoken(e.trk.num)}`, pri:1, silent:src === 'semi' && S.rng() < .5});
  return {ok:true, plan:p};
}

const REL = {dud:.02, flight:.03};
const CHAN = {LT:8, UT:6}; // missiles each fire unit can guide at once (game values)
function launch(S, p, e, L, sol){
  L[p.w]--; S.st.fired[p.w]++; S.st.spent += WEAPONS[p.w].cost;
  if (S.rng() < REL.dud && !S.tut){ // misfire: the round is lost, the launcher reports it, the plan fires the next round
    S.st.duds++; tone(S, 'fault'); ev(S, 'DUD', `Misfire on launcher ${L.id}: ${WEAPONS[p.w].name} did not leave the canister`, {bad:true, trk:p.trk});
    say(S, p.tier === 'UT' ? 'NET' : 'TCA', `Misfire, launcher ${L.id}. Next round.`, {pri:2, cls:p.tier === 'UT' ? 'net' : ''});
    return false;
  }
  const m = {id:S.mid++, plan:p.id, uid:e.uid, w:p.w, tier:p.tier, fu:p.fu, x:L.x, y:L.y, z:0, sx:L.x, sy:L.y, t0:S.t, tEnd:S.t + sol.tof, aim:{x:sol.p.x, y:sol.p.y, z:sol.p.z}, owner:'own', alive:true, lastAim:S.t, guidLost:0, fail:!S.tut && S.rng() < REL.flight};
  if (p.dup) S.st.dupShots++;
  S.ms.push(m); p.inflight++;
  const a = assess(S, e);
  if (e.truth === 'X'){ S.st.wasted++; S.st.waste.fals++; }
  else if (e.T.decoy){ S.st.wasted++; S.st.waste.decoy++; }
  else if (e.truth === 'F' || e.truth === 'N'){ S.st.wasted++; S.st.waste.protect++; }
  else if (e.T.ballistic && !a.dal){ S.st.wasted++; S.st.waste.nondal++; }
  if (p.w === 'MSE' && e.T.cls === 'UAV') S.st.mseDrone++;
  tone(S, 'launch');
  ev(S, 'LAUNCH', `${WEAPONS[p.w].name} away, launcher ${L.id} → track ${p.trk}`, {trk:p.trk, uid:e.uid});
  if (p.shots === 0 && p.tier !== 'UT' && !S.bn) say(S, 'TCA', `Missile away, launcher ${L.id}.`, {pri:1, silent:S.rng() < .35});
  if (lsTotal(L) === 0 && p.tier !== 'UT' && !S.bn) say(S, 'TCA', `Launcher ${L.id} empty.`, {pri:2});
  S.out.push({k:'launch', x:L.x, y:L.y, ut:p.tier === 'UT'});
  return true;
}

function processPlans(S, dt){
  for (const p of S.plans){
    if (p.state === 'DONE') continue;
    const e = S.ents.find(x => x.uid === p.uid);
    if (!e || !e.alive){ if (p.inflight === 0){ p.state = 'DONE'; p.result = p.result || (e && e.killed ? 'KILL' : 'TARGET GONE'); } continue; }
    if (e.trk && e.trk.hold){ cancelPlan(S, p, 'HOLD FIRE'); continue; }
    if (p.src !== 'player' && p.state !== 'GUIDING' && roeCheck(S, e).length){ if (S.t < S.ceaseUntil) continue; p.state = 'DONE'; p.result = 'ROE'; continue; }
    if (p.state === 'VETO'){ p.vetoT -= dt; if (p.vetoT <= 0){ p.state = 'WAIT'; p.fireAt = S.t + .4; } continue; }
    if (e.released && p.state !== 'DONE' && p.inflight === 0){ p.state = 'DONE'; p.result = 'SUBMUNITIONS'; continue; }
    if (p.state === 'WAIT'){
      if (!e.trk || !e.trk.est){ continue; }
      const sol = solve(S, e, p.w, p.fu);
      if (sol.ok){ p.state = 'READY'; if (p.fireAt < S.t) p.fireAt = S.t + .5; }
      else if (!waitable(S, e, sol.why)){ p.state = 'DONE'; p.result = sol.why; say(S, S.bn ? 'NET' : 'TCA', `No intercept on track ${p.trk}. ${sol.why.toLowerCase()}.`, {pri:2, cls:S.bn ? 'net' : '', silent:!!S.bn}); ev(S, 'NOSOL', `No intercept solution, track ${p.trk}: ${sol.why}`, {trk:p.trk}); }
      continue;
    }
    if (p.state === 'READY' && S.t >= p.fireAt){
      if (S.ms.reduce((n, m) => n + (m.alive && m.owner === 'own' && m.tier === p.tier && (!S.bn || m.fu === p.fu) ? 1 : 0), 0) >= CHAN[p.tier]){ p.chanWait = (p.chanWait || 0) + dt; continue; } // fire-control channels full
      if (p.tier === 'UT'){ if (!thaadOn(S) || !e.trk || !e.trk.tpy) continue; }
      else if (!canFireLT(S, p, e)) continue;
      if (S.t < S.ceaseUntil && p.src !== 'player') continue;
      let sol = solve(S, e, p.w, p.fu);
      if (!sol.ok){ p.state = waitable(S, e, sol.why) ? 'WAIT' : 'DONE'; if (p.state === 'DONE') p.result = sol.why; continue; }
      const lf = S.bn && p.tier === 'LT' ? p.fu : undefined;
      let L = pickLauncher(S, p.w, lf);
      if (!L && p.wpref === 'AUTO' && p.tier !== 'UT'){ const alt = p.w === 'MSE' ? 'GEMT' : 'MSE'; const s2 = solve(S, e, alt, p.fu); if (s2.ok && pickLauncher(S, alt, lf)){ p.w = alt; sol = s2; L = pickLauncher(S, alt, lf); } }
      if (!L){ p.state = 'DONE'; p.result = 'NO MISSILES'; const fn = lf ? fuById(S, lf).name + ': ' : ''; say(S, S.bn ? 'NET' : 'TCA', `${fn}No ready missiles for track ${p.trk}.`, {pri:3, cls:S.bn ? 'net' : ''}); ev(S, 'NOMSL', `${fn}No ready missiles for track ${p.trk}`, {bad:true}); continue; }
      if (S.t < S.ceaseUntil && p.src === 'player' && !p.cfViol){ p.cfViol = true; }
      if (!launch(S, p, e, L, sol)){ p.fireAt = S.t + 1; continue; }
      p.shots++;
      if (p.shots < p.max) p.fireAt = S.t + 1.5; else p.state = 'GUIDING';
      continue;
    }
    if (p.state === 'GUIDING' && p.inflight === 0){
      if (!e.alive){ p.state = 'DONE'; continue; }
      if ((p.doc === 'SLS' || p.src !== 'player') && p.salvo < (p.tier === 'UT' ? 2 : 3)){
        p.salvo++; p.shots = 0; p.max = p.doc === 'RIPPLE' ? 2 : 1;
        const sol = solve(S, e, p.w, p.fu);
        p.state = sol.ok ? 'READY' : (waitable(S, e, sol.why) ? 'WAIT' : 'DONE'); p.fireAt = S.t + 1.2;
        if (p.state !== 'DONE' && !S.bn) say(S, 'TCA', `Re-engaging track ${p.trk}.`, {pri:1, speak:`Re engage ${spoken(p.trk)}`});
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
  const onP = radarOn(S), onT = thaadOn(S);
  for (const m of S.ms){
    if (!m.alive) continue;
    const e = S.ents.find(x => x.uid === m.uid);
    if (!e || !e.alive){ m.alive = false; m.res = 'NO TARGET'; if (m.owner === 'own') planDec(S, m); continue; }
    const on = m.tier === 'UT' ? onT : S.bn ? guideOk(S, m, e) : onP;
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
  if (m.owner === 'cuas'){ if (S.rng() < .85) kill(S, e, m); else S.out.push({k:'miss', x:m.x, y:m.y, z:m.z}); return; }
  if (m.owner !== 'own'){
    if (!e.released && S.rng() < .75){ kill(S, e, m); const nb = m.nb; say(S, 'NET', `${nb}: splash track ${e.trk && e.trk.num ? e.trk.num : ''}.`, {silent:true, cls:'net'}); }
    return;
  }
  planDec(S, m);
  if (m.fail || e.released){
    m.res = 'MISS'; S.st.miss++; if (m.fail) S.st.flightFail++;
    const n = e.trk ? e.trk.num : '';
    tone(S, 'miss'); ev(S, 'MISS', m.fail ? `Interceptor failed in flight, track ${n}` : `Interceptor arrived after submunition release, track ${n}`, {trk:n});
    say(S, m.tier === 'UT' ? 'NET' : 'TCA', m.fail ? `Missile failure, track ${n}. No intercept.` : `Track ${n} already opened. Nothing to hit.`, {pri:2, cls:m.tier === 'UT' ? 'net' : ''});
    S.out.push({k:'miss', x:m.x, y:m.y, z:m.z});
    return;
  }
  let pk = e.T.pk[m.w] || 0;
  if (e.T.marv && e.z < 40 && m.w !== 'THAAD') pk *= .85;
  pk *= e.trk ? (.75 + .25 * Math.min(1, e.trk.q)) : .5;
  if (m.guidLost > 1.5) pk *= .15;
  if (S.tut && S.tut.pkMin && pk > 0) pk = Math.max(pk, S.tut.pkMin);
  if (S.tut && S.tut.pk) pk = S.tut.pk;
  if (S.rng() < pk){
    if (e.T.ballistic && !e.T.debris && !S.tut && e.z < 30 && S.rng() < (m.w === 'GEMT' ? .22 : .07)){ bodyKill(S, e, m); return; }
    kill(S, e, m);
  }
  else {
    m.res = 'MISS'; S.st.miss++;
    const n = e.trk ? e.trk.num : '';
    tone(S, 'miss'); ev(S, 'MISS', `Miss on track ${n}`, {trk:n});
    say(S, S.bn ? 'NET' : 'TCA', `Miss, track ${n}.`, {speak:`Miss, track ${spoken(n)}`, pri:2, cls:S.bn ? 'net' : ''});
    S.out.push({k:'miss', x:m.x, y:m.y, z:m.z});
  }
}

function kill(S, e, m){
  e.alive = false; e.killed = true; m.res = 'KILL';
  S.out.push({k:'kill', x:e.x, y:e.y, z:e.z, own:m.owner === 'own'});
  if (e.truth === 'H') S.st.killCost += e.T.cost || 0;
  for (const p of S.plans) if (p.uid === e.uid && p.state !== 'DONE' && p.inflight === 0 && p.state !== 'GUIDING'){ p.state = 'DONE'; p.result = 'KILL'; }
  if (m.owner === 'cuas'){ S.st.cuasKills++; ev(S, 'CUAS', `${m.nb} killed track ${e.trk && e.trk.num ? e.trk.num : '(untracked)'}`, {good:true}); return; }
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
  if (S.bn) say(S, 'NET', `${m.fu ? fuById(S, m.fu).name + ': ' : ''}splash track ${n}.`, {speak:`Splash ${spoken(n)}`, pri:2, cls:'net', silent:!e.T.ballistic});
  else say(S, 'TCA', `Kill assessment, track ${n}, probable kill.`, {speak:`Track ${spoken(n)}, probable kill`, pri:2});
  if (S.scn.civHarm && e.T.ballistic && e.z >= 2 && e.z < 18) civDebris(S, e);
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
  while (S.comms && S.orderQ.length && S.orderQ[0].t <= S.t){
    const o = S.orderQ.shift();
    if (o.k === 'MOPP'){ S.mopp = o.v; ev(S, 'MOPP', `MOPP ${o.v}`, {bad:o.v >= 4}); }
    if (o.k === 'ADW'){ S.adw = o.v; if (o.v === 'RED') tone(S, 'klaxon'); }
    if (o.wcs) S.wcs = o.wcs;
    if (o.k === 'WCS') S.wcs = o.v;
    if (o.k === 'HOLDFIRE'){ for (const e of S.ents) if (e.alive && e.tag === o.tag){ e.holdOrder = true; for (const p of S.plans) if (p.uid === e.uid && p.state !== 'DONE' && p.src !== 'player') cancelPlan(S, p, 'HOLD FIRE ORDER'); } }
    if (o.k === 'CEASEFIRE') S.ceaseUntil = S.t + (o.dur || 20);
    if (o.k === 'ENGAGE'){ for (const e of S.ents) if (e.alive && e.tag === o.tag) e.engageOrder = S.t + 40; }
    order(S, o);
  }
  for (const a of S.acks) if (S.comms && !a.done && !a.late && S.t > a.due){
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
        if (L.state === 'RELOAD' && L.pend){ L.MSE += L.pend.MSE; L.GEMT += L.pend.GEMT; L.THAAD = (L.THAAD || 0) + (L.pend.THAAD || 0); L.pend = null; say(S, 'TCA', `Launcher ${L.id} reloaded.`, {pri:1, silent:true}); ev(S, 'RELOAD', `Launcher ${L.id} reloaded`); }
        L.state = 'READY';
      }
    }
  }
}
function reload(S, id){
  const L = S.launchers.find(x => x.id === id); if (!L || L.dead || L.state !== 'READY') return false;
  const need = {MSE:Math.min(L.cap.MSE - L.MSE, S.reserve.MSE), GEMT:Math.min(L.cap.GEMT - L.GEMT, S.reserve.GEMT), THAAD:Math.min((L.cap.THAAD || 0) - (L.THAAD || 0), S.reserve.THAAD || 0)};
  if (need.MSE + need.GEMT + need.THAAD <= 0) return false;
  S.reserve.MSE -= need.MSE; S.reserve.GEMT -= need.GEMT; S.reserve.THAAD -= need.THAAD; L.pend = need; L.state = 'RELOAD'; L.timer = (L.type === 'THAAD' ? 150 : 90) * (1 - .05 * Math.min(5, S.xp));
  ev(S, 'RELOAD', `Launcher ${L.id} reload started`);
  S.log.push({t:S.t, who:'TCA', text:`LAUNCHER ${L.id} RELOADING · ${need.MSE ? need.MSE + ' MSE ' : ''}${need.GEMT ? need.GEMT + ' GEM-T' : ''}${need.THAAD ? need.THAAD + ' THAAD' : ''}`, cls:'sys'});
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
  COMMS:{fam:4, title:'Tactical radio', effect:'TD net and remote tracks lost', fix:'RESET RADIO', auto:100},
  DISP:{fam:7, title:'Tabular display', effect:'Right-hand display frozen', fix:'REBOOT DISPLAY', auto:80},
};
const FIX_ACTIONS = ['RESET DATA LINK', 'RESET TRANSMITTER', 'RESET RADIO', 'TRANSFER TO STANDBY EPP', 'REBOOT WCC', 'REBOOT DISPLAY'];
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
  const c = !S.faults.some(f => f.k === 'COMMS'); if (c && !S.comms) for (const a of S.acks) if (!a.done) a.due = S.t + 15; S.comms = c;
  S.dispFault = S.faults.some(f => f.k === 'DISP');
}
function stepCrew(S){
  if (!S.tca.delegate.reload) return;
  for (const L of S.launchers){
    if (L.dead || L.state !== 'READY' || lsTotal(L) > 0) { L.tcaAt = null; continue; }
    const can = (L.cap.MSE && S.reserve.MSE) || (L.cap.GEMT && S.reserve.GEMT) || (L.cap.THAAD && S.reserve.THAAD); if (!can) continue;
    if (L.tcaAt == null) L.tcaAt = S.t + 4 * (1 + S.tca.fatigue * 2);
    else if (S.t >= L.tcaAt){ L.tcaAt = null; if (reload(S, L.id)) say(S, 'TCA', `Reloading launcher ${L.id}.`, {pri:1, silent:true}); }
  }
}
function setSector(S, v){
  if (S.bat.sector === v || S.bat.ltamds) return;
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

// =====================================================================
// 3.0 · honest failure, upper tier, counter-drone, warning, degraded ops
// =====================================================================
function separate(S, e, p){ // liquid stages separate near apogee and fall short as a big tumbling return
  e.sep = true;
  const f = .8 + S.rng() * .1, t = mkEnt(S, 'TANK', {model:'bal'});
  t.L = e.L; t.I = {x:e.L.x + (e.I.x - e.L.x) * f, y:e.L.y + (e.I.y - e.L.y) * f}; t.t0 = e.t0; t.T0 = e.T0 * f;
  const st = (S.t - t.t0) / t.T0; t.H = p.z / Math.max(.2, 4 * st * (1 - st)); t.x = e.x; t.y = e.y; t.z = p.z; t.parent = e.uid;
}
function releaseCluster(S, e){
  e.released = true; S.st.clusterRel++;
  const n = e.trk && e.trk.est ? e.trk.num : null;
  ev(S, 'CLUSTER', `${n ? 'Track ' + n : 'Untracked missile'} released submunitions at ${e.z.toFixed(0)} km`, {bad:true, trk:n, x:e.x, y:e.y});
  if (n){ tone(S, 'tbm'); say(S, 'TCA', `Track ${n} has opened! Submunitions, ${Math.round(Math.hypot(e.I.x - S.bat.x, e.I.y - S.bat.y))} kilometers from us.`, {pri:4, speak:`Track ${spoken(n)} has opened. Submunitions`}); }
  for (const p of S.plans) if (p.uid === e.uid && p.state !== 'DONE' && p.inflight === 0){ p.state = 'DONE'; p.result = 'SUBMUNITIONS'; }
  S.out.push({k:'cluster', x:e.x, y:e.y, z:e.z, ix:e.I.x, iy:e.I.y, r:e.T.cluster.r});
}
function clusterImpact(S, e, ix, iy){
  const R = e.T.cluster.r; let any = false;
  for (const a of S.assets){
    const d = Math.hypot(ix - a.x, iy - a.y); if (d > R + 1) continue;
    const dmg = e.dmg * clamp(1.15 - d / (R + 1), .35, 1);
    a.hp = Math.max(0, a.hp - dmg); S.st.hitsW += dmg * PRI_W[a.pri]; S.st.leak++; S.st.clusterHits++; any = true; if (a.pop) S.st.popHits++;
    ev(S, 'HIT', `${a.name} hit by submunitions${e.trk && e.trk.num ? ' (track ' + e.trk.num + ')' : ''}`, {bad:true, trk:e.trk ? e.trk.num : 0, untracked:!e.everTrk, x:ix, y:iy, cluster:true});
  }
  for (const L of S.launchers) if (!L.dead && Math.hypot(ix - L.x, iy - L.y) < R * .5 && S.rng() < .35){ L.dead = true; L.state = 'DEAD'; S.st.lsLost++; ev(S, 'HIT', `Launcher ${L.id} destroyed by submunitions`, {bad:true}); }
  if (any){ tone(S, 'impact'); say(S, 'TD', `${callsign(S)}, ${tdName(S)}. Submunitions across the defended area.`, {pri:4}); }
  S.out.push({k:'bloom', x:ix, y:iy, r:R, harmless:!any});
}
function bodyKill(S, e, m){ // the interceptor hit the missile body; the warhead keeps falling, off its aimpoint
  m.res = 'KILL?'; S.st.uncertain++;
  S.out.push({k:'ka', x:e.x, y:e.y, z:e.z});
  const off = polar(S.rng() * 360, .8 + S.rng() * 2.6), I = {x:(e.model === 'fall' ? e.I.x : e.I.x) + off.x, y:e.I.y + off.y};
  const tr = Math.max(4, e.z / Math.max(.4, -(e.vz || -1.5)));
  e.model = 'fall'; e.I = I; e.t0 = S.t; e.T0 = tr; e.vx = (I.x - e.x) / tr; e.vy = (I.y - e.y) / tr; e.vz = -e.z / tr; e.dmg = Math.max(1, Math.round(e.dmg * .6)); e.bodyHit = true;
  const n = e.trk ? e.trk.num : '';
  if (e.trk){ e.trk.ka = 'UNCERTAIN'; }
  tone(S, 'kill'); ev(S, 'KA', `Kill assessment uncertain, track ${n}: debris and a possible warhead still falling`, {trk:n});
  say(S, m.tier === 'UT' ? 'NET' : 'TCA', `Track ${n}, kill assessment uncertain. Something is still coming down.`, {pri:3, speak:`Track ${spoken(n)}, kill assessment uncertain`, cls:m.tier === 'UT' ? 'net' : ''});
}
function stepCuas(S, dt){
  for (const c of S.cuas){
    if (c.dead) continue;
    if (c.type === 'GUN'){
      for (const e of S.ents){
        if (!e.alive || e.T.cls !== 'UAV' && e.T.cls !== 'CM' || e.truth === 'F' || e.z > 2.5 || e.kind === 'UAV' && false) continue;
        if (Math.hypot(e.x - c.x, e.y - c.y) > (c.r || 3.5)) continue;
        if (!e.trk || e.trk.id === 'FRD' || e.trk.id === 'NEU') continue;
        S.st.cuasCost += .004 * dt;
        if (S.rng() < (e.T.cls === 'CM' ? .12 : .32) * dt) kill(S, e, {owner:'cuas', nb:c.name});
        break;
      }
    } else if (c.type === 'COY' && c.left > 0){
      c.busy -= dt; if (c.busy > 0 || !S.cuasAuto) continue;
      const e = cuasPick(S, c); if (e) fireCuas(S, c, e);
    }
  }
}
function cuasPick(S, c){
  let best = null, bd = 1e9;
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || e.T.cls !== 'UAV' || e.cuasEng) continue;
    if (e.trk.id !== 'HOS' && e.trk.id !== 'SUS') continue;
    const d = Math.hypot(e.x - c.x, e.y - c.y); if (d > (c.r || 12) || !assess(S, e).dal) continue;
    if (d < bd){ bd = d; best = e; }
  }
  return best;
}
function fireCuas(S, c, e){
  if (!c || c.left <= 0 || !e || !e.alive) return false;
  c.left--; c.busy = 3; e.cuasEng = true; S.st.cuasCost += .1;
  const d = Math.hypot(e.x - c.x, e.y - c.y), tof = 3 + d / .5, pr = predict(S, e, tof);
  S.ms.push({id:S.mid++, uid:e.uid, w:'COY', x:c.x, y:c.y, z:0, sx:c.x, sy:c.y, t0:S.t, tEnd:S.t + tof, aim:{x:pr.x, y:pr.y, z:pr.z}, owner:'cuas', nb:c.name, alive:true, lastAim:S.t, guidLost:0});
  S.log.push({t:S.t, who:'NET', text:`${c.name.toUpperCase()} ENGAGING TRK ${e.trk ? e.trk.num : ''} · ${c.left} LEFT`, cls:'net'});
  return true;
}
function playerCuas(S, e){
  if (!e || !e.trk || e.T.cls !== 'UAV') return {ok:false, why:'C-UAS ENGAGES DRONES ONLY'};
  if (e.cuasEng) return {ok:false, why:'C-UAS ALREADY ENGAGED'};
  const c = S.cuas.filter(x => x.type === 'COY' && x.left > 0 && !x.dead).sort((a, b) => Math.hypot(e.x - a.x, e.y - a.y) - Math.hypot(e.x - b.x, e.y - b.y))[0];
  if (!c) return {ok:false, why:'NO C-UAS INTERCEPTORS'};
  if (Math.hypot(e.x - c.x, e.y - c.y) > (c.r || 12) * 1.4) return {ok:false, why:'OUT OF C-UAS RANGE'};
  fireCuas(S, c, e); return {ok:true};
}
function stepSbw(S){ // space-based launch warning: an impact area before your radar sees anything
  let fresh = 0, brg = null;
  for (const a of S.sbw){
    const e = S.ents.find(x => x.uid === a.uid);
    if (!a.on && S.t >= a.t && e && e.alive){ a.on = true; fresh++; brg = brgOf(a.L.x - S.bat.x, a.L.y - S.bat.y); }
    if (!e || !e.alive){ a.done = true; continue; }
    const left = Math.max(0, e.t0 + e.T0 - S.t), f = clamp(left / e.T0, 0, 1);
    a.cx = e.I.x + a.ex * f; a.cy = e.I.y + a.ey * f; a.r = 4 + 26 * f; a.tti = left;
  }
  if (fresh && S.t - S.sbwLast > 8){
    S.sbwLast = S.t; tone(S, 'tbm');
    S.log.push({t:S.t, who:'SBW', text:`SPACE-BASED WARNING · ${fresh} LAUNCH${fresh > 1 ? 'ES' : ''} · BRG ${String(Math.round(brg)).padStart(3, '0')} · IMPACT AREAS ON SCOPE`, cls:'net'});
    say(S, 'TD', `All stations, ${tdName(S)}. Launch warning. ${fresh} missile${fresh > 1 ? 's' : ''}, bearing ${spoken(String(Math.round(brg)).padStart(3, '0'))}.`, {pri:3, silent:fresh < 2});
  }
  S.sbw = S.sbw.filter(a => !a.done);
}
function setSeat(S, v){
  if (!S.thaad || S.seat === v) return; S.seat = v;
  ev(S, 'SEAT', v === 'THAAD' ? 'You took the THAAD fire control seat' : 'You took the Patriot ECS seat');
  S.log.push({t:S.t, who:'SYS', text:v === 'THAAD' ? 'SEAT · THAAD FIRE CONTROL · PATRIOT CREW ON AI' : 'SEAT · PATRIOT ECS · THAAD CREW ON AI', cls:'sys'});
}

// ---------- command log, rewind ----------
const ent = (S, uid) => S.ents.find(e => e.uid === uid);
const CMD = {
  engage:(S, a) => engage(S, ent(S, a.uid), {src:'player', wpn:a.wpn, force:a.force, fu:a.fu}),
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
  cuas:(S, a) => playerCuas(S, ent(S, a.uid)),
  cuasAuto:(S, a) => { S.cuasAuto = !!a.v; },
  seat:(S, a) => setSeat(S, a.v),
  layer:(S, a) => { S.doctrine.LAYER = a.v; },
  tpyEmcon:(S, a) => { if (S.thaad){ S.thaad.emcon = !!a.v; ev(S, 'EMCON', a.v ? 'TPY-2 silent' : 'TPY-2 radiating'); } },
  end:S => { S.endAt = S.t; S.endReason = S.bn ? 'Ended by the FDC' : 'Ended by the TCO'; S.abandon = true; },
  corr:(S, a) => correlate(S, ent(S, a.uid)),
  fuCtrl:(S, a) => fuCtrl(S, a.fu, a.v),
  fuEmcon:(S, a) => fuEmcon(S, a.fu, a.v),
  fuPtl:(S, a) => fuPtl(S, a.fu, a.ptl),
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
      if ((inCorridor(S, e) && sp > .18) || (S.bn && inZone(S, e, 'CAP') && sp > .22)){ if (!k.ghostIff){ k.ghostIff = 1; cmd(S, 'iff', {uid:e.uid}); continue; } id = 'FRD'; }
      else if (!k.cls) id = null;
      else if (e.T.cls === 'UAV' && zs.length >= 10){ const m = zs.reduce((a, c) => a + c, 0) / zs.length, sd = Math.sqrt(zs.reduce((a, c) => a + (c - m) ** 2, 0) / zs.length); id = sd < .005 ? 'SUS' : 'HOS'; }
      else if (e.T.cls !== 'UAV' && assess(S, e).closing) id = 'HOS';
      else if (e.kind === 'FTR' || e.kind === 'JAM' || e.kind === 'HELO') id = 'HOS';
    }
    if (id && k.id !== id) cmd(S, 'id', {uid:e.uid, id});
  }
  if (armClose !== S.bat.emcon) cmd(S, 'emcon', {v:armClose});
  if (S.bn){ // a by-the-book FDC re-interrogates every air track a battery wants to shoot, and correlates duals
    for (const p of S.plans){ if (p.state !== 'VETO') continue; const e = ent(S, p.uid); if (!e || !e.trk) continue;
      if (!p.ghostIff){ p.ghostIff = true; cmd(S, 'iff', {uid:e.uid}); }
      if (e.trk.iff === 'M4 VALID' || inCorridor(S, e) || inZone(S, e, 'CAP')) cmd(S, 'veto', {pid:p.id}); }
    for (const e of S.ents) if (e.alive && e.trk && e.trk.dual) cmd(S, 'corr', {uid:e.uid});
  }
}
function runGhost(scn, opts){
  const S = createSim(scn, {...opts, mode:'SEMI', seat:'PAT', tca:{...(opts.tca || {}), fatigue:0, delegate:{reload:true, faults:true}}});
  let n = 0;
  while (!S.ended && n < 60000){ step(S); n++; if (n % 10 === 0) ghostThink(S); S.out.length = 0; }
  const engaged = {}; for (const x of S.ev) if (x.k === 'ENG' && x.uid) engaged[x.uid] = x.t;
  return {score:S.score, st:S.st, engaged, ev:S.ev.filter(x => ['ENG','KILL','HIT','VIOL','FRAT','EMCON'].includes(x.k)), t:S.t, kinds:Object.fromEntries(S.ents.map(e => [e.uid, e.kind]))};
}

// =====================================================================
// 4.0 · battalion fire direction: several fire units, legacy or IBCS
// =====================================================================
const LINK_DELAY = 4; // seconds before a legacy battery sees another battery's engagement over the data link
function setupBn(S, o, take){
  const bn = S.scn.bn, arch = o.arch === 'IBCS' || o.arch === 'LEGACY' ? o.arch : bn.arch || 'LEGACY';
  S.bn = {arch, swapSeen:{}, dualSeq:0};
  S.seat = 'BN';
  const sensor = (f, u) => { f.ltamds = arch === 'IBCS' && !!u.ltamds; f.half = f.ltamds ? 180 : 60; f.rf = f.ltamds ? 1.15 : 1; f.radar = f.ltamds ? 'LTAMDS' : 'MPQ-65'; };
  const u0 = bn.units[0], b = S.bat;
  Object.assign(b, {id:u0.id, name:u0.name, ctrl:'AUTO', fuUnit:true});
  if (o.ptls && o.ptls[0] != null) b.ptl = o.ptls[0];
  sensor(b, u0); b.sector = b.ltamds ? '360' : 'WIDE';
  let k = 0; for (const L of S.launchers) if (L.type !== 'THAAD'){ L.fu = b.id; L.id = b.id + (++k); }
  bn.units.slice(1).forEach((u, j) => {
    const f = {id:u.id, name:u.name, x:u.x, y:u.y, ptl:o.ptls && o.ptls[j + 1] != null ? o.ptls[j + 1] : u.ptl, alive:true, emcon:false, reorient:0, newPtl:null, displace:0, epp:0, radarFault:0, ctrl:'AUTO', fuUnit:true};
    sensor(f, u); S.fus.push(f);
    (u.launchers || []).forEach((L, i) => {
      const type = L[0], cap = type === 'MSE' ? {MSE:12, GEMT:0, THAAD:0} : type === 'GEMT' ? {MSE:0, GEMT:4, THAAD:0} : {MSE:6, GEMT:2, THAAD:0};
      const mse = take('MSE', L[1]), gemt = take('GEMT', L[2]);
      S.launchers.push({id:u.id + (i + 1), fu:u.id, type, cap, MSE:mse, GEMT:gemt, THAAD:0, state:'READY', timer:0, x:0, y:0, dead:false, pend:null});
      S.loaded.MSE += mse; S.loaded.GEMT += gemt;
    });
  });
}
function updateTracksBn(S, dt){
  const tOn = thaadOn(S), on = S.fus.map(radarOnFu), ibcs = S.bn.arch === 'IBCS';
  for (const e of S.ents){
    if (!e.alive) continue;
    const by = [];
    for (let i = 0; i < S.fus.length; i++){ const f = S.fus[i]; if (on[i] && detects(S, f, e, f === S.bat)) by.push(f.id); }
    const tpy = tOn && tpyDetects(S, e);
    let det = by.length > 0, remDet = false, remName = null;
    if (!det && S.comms) for (const nb of S.neighbors) if (nb.on && detects(S, nb, e, false)){ remDet = true; remName = nb.name; break; }
    if (!det && !remDet && tpy){ remDet = true; remName = 'TPY-2'; }
    if (e.kind === 'FALSE' && !det) remDet = false;
    if (det || remDet){
      if (!e.trk) e.trk = {num:0, q:0, est:false, cls:false, id:'PND', idBy:'', last:S.t, remote:!det, iff:null, hold:false, firstT:S.t, remName, zs:[], by:[]};
      const k = e.trk; k.last = S.t; k.remote = !det; k.remName = remName; k.tpy = tpy; k.by = by;
      const rate = (e.T.ballistic ? .7 : .35) * (ibcs ? 1 + .35 * Math.max(0, by.length - 1) : 1);
      k.q = Math.min(e.kind === 'FALSE' ? .45 : 1, k.q + dt * rate * (det || tpy ? 1 : .6));
      if (!k.est && k.q >= .3) establish(S, e);
      if (k.est && !k.cls && k.q >= .6) classify(S, e);
      if (!ibcs && k.est && by.length >= 2 && !k.dualChk && e.kind !== 'FALSE'){ // two batteries report the same target with different track numbers
        k.dualChk = true;
        if (S.rng() < (e.T.ballistic ? .35 : .25)){ const o = polar(S.rng() * 360, 1.2 + S.rng() * 2.2); k.dual = {num:S.trkNext++, dx:o.x, dy:o.y, t:S.t, by:by[by.length - 1]}; S.st.duals++; ev(S, 'DUAL', `Dual designation: track ${k.num} also reported as ${k.dual.num}`, {trk:k.num, quiet:true}); }
      }
      if (k.dual && !by.length) k.dual = null;
    } else if (e.trk){
      if (S.t - e.trk.last > 8) dropTrack(S, e); else { e.trk.q = Math.max(.05, e.trk.q - dt * .05); e.trk.by = []; }
    }
  }
}
function canFireLT(S, p, e){
  if (!S.bn) return radarOn(S) && S.bat.epp <= 0 && !!e.trk && !e.trk.remote;
  const f = fuById(S, p.fu); if (!f || !e.trk || f.epp > 0) return false;
  if (S.bn.arch === 'IBCS') return !!(e.trk.by && e.trk.by.length);
  return radarOnFu(f) && !!e.trk.by && e.trk.by.includes(f.id);
}
function guideOk(S, m, e){
  if (m.owner !== 'own') return true;
  const f = fuById(S, m.fu); if (!f || !e.trk) return false;
  if (S.bn.arch === 'IBCS') return !!(e.trk.by && e.trk.by.length);
  return radarOnFu(f) && !!e.trk.by && e.trk.by.includes(f.id);
}
function roundsFu(S, w, fuId){ return rounds(S, w, true, fuId); }
function bestShooter(S, e, wpref){ // the fire unit with the earliest good shot, sparing units that are low or busy
  if (!e.trk) return null;
  const ibcs = S.bn.arch === 'IBCS', a = assess(S, e), ref = a.impact || e; let best = null;
  for (const f of S.fus){
    if (f.epp > 0) continue;
    if (ibcs ? !(e.trk.by && e.trk.by.length) : !(radarOnFu(f) && e.trk.by && e.trk.by.includes(f.id))) continue;
    const ws = wpref && wpref !== 'AUTO' ? [wpref] : rec(e), busy = S.ms.filter(m => m.alive && m.owner === 'own' && m.tier === 'LT' && m.fu === f.id).length;
    ws.forEach((w, wi) => {
      const n = roundsFu(S, w, f.id); if (n <= 0) return;
      const sol = solve(S, e, w, f.id); if (!sol.ok && !waitable(S, e, sol.why)) return;
      const sc = (sol.ok ? sol.tof : 400 + Math.hypot(ref.x - f.x, ref.y - f.y)) - Math.min(n, 12) * .4 + busy * 3 + wi * 25;
      if (!best || sc < best.sc) best = {fu:f.id, w, sol, sc};
    });
  }
  return best;
}
function cuasCovers(S, d){ return !!d && S.cuas.some(c => !c.dead && (c.type === 'GUN' || c.left > 0) && Math.hypot(d.x - c.x, d.y - c.y) < (c.r || 3.5) + 2); }
function inZone(S, e, k){ return (S.scn.acm || []).some(z => z.k === k && (z.r ? Math.hypot(e.x - z.x, e.y - z.y) <= z.r : pip(z.poly, e.x, e.y))); }
function aiIdBn(S){ // battery crews (legacy) or IBCS track management declare silent, closing air tracks outside the corridors
  const ibcs = S.bn.arch === 'IBCS';
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || e.T.ballistic || e.kind === 'FALSE') continue;
    const k = e.trk; if (k.idBy === 'PLAYER' || !k.cls || (k.id !== 'UNK' && k.id !== 'PND') || k.iff !== 'NO RESP') continue;
    if (!ibcs && !(k.by || []).some(id => (fuById(S, id) || {}).ctrl !== 'HOLD')) continue;
    if (inCorridor(S, e) || inZone(S, e, 'CAP')) continue; // procedural control: friendlies are expected in lanes and CAP boxes
    const zs = k.zs || [], m = zs.length ? zs.reduce((a, c) => a + c, 0) / zs.length : 0, sd = zs.length > 9 ? Math.sqrt(zs.reduce((a, c) => a + (c - m) ** 2, 0) / zs.length) : 1;
    const wfz = inZone(S, e, 'WFZ');
    if (e.T.cls === 'UAV' ? zs.length > 9 && (sd >= .005 || wfz) : (assess(S, e).closing || wfz)) setId(S, e, 'HOS', 'AUTO');
  }
}
function ibcsEngage(S){
  for (const x of threatQueue(S)){
    const e = x.e, k = e.trk;
    if (k.id !== 'HOS' || k.hold || e.released || !x.a.dal) continue;
    if (S.plans.some(p => p.uid === e.uid && p.state !== 'DONE' && p.tier === 'LT')) continue;
    if (layerWait(S, e)) continue;
    if (e.T.cls === 'UAV' && S.doctrine.UAV === 'CUAS' && cuasCovers(S, x.a.dal)) continue;
    if (roeCheck(S, e).length) continue;
    const b = bestShooter(S, e); if (!b) continue;
    const ctl = fuById(S, b.fu); if (ctl.ctrl === 'HOLD') continue;
    engage(S, e, {src:S.mode === 'AUTO' ? 'auto' : 'semi', fu:b.fu, wpn:b.w});
  }
}
function aiBn(S){
  if (S.thaad) aiThaad(S);
  if (S.mode === 'MANUAL') return;
  aiIdBn(S);
  if (S.bn.arch === 'IBCS') return ibcsEngage(S);
  const area = S.scn.bn.area || 30;
  for (const f of S.fus){
    if (f.ctrl === 'HOLD' || !radarOnFu(f) || f.epp > 0) continue;
    for (const e of S.ents){
      if (!e.alive || !e.trk || !e.trk.est || !e.trk.by || !e.trk.by.includes(f.id)) continue;
      const k = e.trk; if (k.hold || k.id !== 'HOS' || e.released) continue;
      if (layerWait(S, e)) continue;
      const a = assess(S, e); if (!a.dal || Math.hypot(a.dal.x - f.x, a.dal.y - f.y) > area) continue; // each battery defends its own area
      if (e.T.cls === 'UAV' && S.doctrine.UAV === 'CUAS' && cuasCovers(S, a.dal)) continue;
      if (roeCheck(S, e).length) continue;
      if (S.plans.some(p => p.uid === e.uid && p.state !== 'DONE' && p.tier === 'LT' && p.fu === f.id)) continue;
      const oth = S.plans.find(p => p.uid === e.uid && p.state !== 'DONE' && p.tier === 'LT');
      if (oth){ if (k.dual && k.dual.by === f.id){} else if (S.t - oth.created > LINK_DELAY || S.rng() < .5) continue; } // the engagement reached this battery over the link, or the crew heard it on the net
      if (rounds(S, rec(e)[0], true, f.id) + rounds(S, rec(e)[1], true, f.id) <= 0) continue;
      engage(S, e, {src:'ai', fu:f.id});
    }
  }
}
function stepBn(S){
  const ibcs = S.bn.arch === 'IBCS';
  if (ibcs){ // Link 16 PPLI: friendly aircraft report their own position, so the composite picture can name them even with a dead Mode 4
    for (const e of S.ents){
      if (!e.alive || e.truth !== 'F' || !e.trk || !e.trk.est || e.trk.ppli || S.t - e.trk.firstT < 6) continue;
      const k = e.trk; k.ppli = true;
      if (k.id !== 'FRD' && k.idBy !== 'PLAYER' && ((e.uid * 2654435761) >>> 0) / 4294967296 < .8){ setId(S, e, 'FRD', 'AUTO'); S.st.ppli++; S.log.push({t:S.t, who:'SYS', text:`IBCS · TRK ${k.num} CORRELATED WITH LINK 16 PPLI · FRIEND`, cls:'sys'}); }
    }
    return;
  }
  // legacy: two tracks that cross can swap numbers and identities
  const L = S.ents.filter(e => e.alive && e.trk && e.trk.est && !e.T.ballistic && e.kind !== 'FALSE');
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++){
    const a = L[i], b = L[j]; if (Math.hypot(a.x - b.x, a.y - b.y) > 1.8 || Math.abs(a.z - b.z) > 2.5) continue;
    const key = Math.min(a.uid, b.uid) + '-' + Math.max(a.uid, b.uid); if (S.bn.swapSeen[key]) continue; S.bn.swapSeen[key] = true;
    if (S.rng() >= .45) continue;
    const ka = a.trk, kb = b.trk; a.trk = kb; b.trk = ka; S.st.swaps++;
    const differ = ka.id !== kb.id;
    ev(S, 'SWAP', `Track numbers swapped where ${ka.num} and ${kb.num} crossed${differ ? ': identities now sit on the wrong aircraft' : ''}`, {bad:differ, trk:ka.num});
    if (differ && S.rng() < tcaEff(S)) say(S, 'TCA', `Tracks ${ka.num} and ${kb.num} merged and split. Check both identities.`, {pri:3, speak:`Tracks ${spoken(ka.num)} and ${spoken(kb.num)} crossed. Check identity`});
  }
}
function stepFus(S, dt){
  for (const f of S.fus){ if (f === S.bat || !(f.reorient > 0)) continue; f.reorient -= dt; if (f.reorient <= 0){ f.ptl = f.newPtl; placeLaunchers(S); S.log.push({t:S.t, who:'NET', text:`${f.name} PTL ${String(Math.round(f.ptl)).padStart(3, '0')} · RADIATING`, cls:'net'}); } }
}
function correlate(S, e){
  if (!e || !e.trk || !e.trk.dual) return false;
  const n = e.trk.dual.num; e.trk.dual = null; S.st.corr++;
  ev(S, 'CORR', `Correlated: ${n} dropped, ${e.trk.num} kept`, {good:true, trk:e.trk.num});
  S.log.push({t:S.t, who:'FDC', text:`CORRELATE TRK ${e.trk.num} / ${n} · ${n} DROPPED`, cls:'me'});
  return true;
}
function fuCtrl(S, id, v){ const f = fuById(S, id); if (!f) return; f.ctrl = v; ev(S, 'CTRL', `${f.name} ${v === 'HOLD' ? 'held: fires only on battalion orders' : 'released to fight its own area'}`); S.log.push({t:S.t, who:'FDC', text:`${f.name} ${v === 'HOLD' ? 'WEAPONS HOLD · FIRE ON BATTALION ORDER ONLY' : 'AUTONOMOUS · DEFEND YOUR AREA'}`, cls:'me'}); }
function fuEmcon(S, id, v){ const f = fuById(S, id); if (!f) return; f.emcon = !!v; ev(S, 'EMCON', `${f.name} radar ${v ? 'silent' : 'radiating'}`); S.log.push({t:S.t, who:'FDC', text:`${f.name} ${v ? 'GO SILENT' : 'RADIATE'}`, cls:'me'}); }
function fuPtl(S, id, ptl){ const f = fuById(S, id); if (!f || f.ltamds) return; if (f === S.bat) return reorient(S, ptl); if (f.reorient > 0 || !f.alive) return; f.reorient = 25; f.newPtl = (ptl + 360) % 360; ev(S, 'PTL', `${f.name} reorienting to ${Math.round(f.newPtl)}°`); S.log.push({t:S.t, who:'NET', text:`${f.name} REORIENTING · RADAR DOWN 25 S`, cls:'net'}); }
function coverageBn(scn, ptls, arch){ // union coverage of every fire unit
  const map = MAP[scn.map], U = scn.bn.units.map((u, i) => ({...u, ptl:ptls && ptls[i] != null ? ptls[i] : u.ptl, half:arch === 'IBCS' && u.ltamds ? 180 : 60}));
  const inFan = (u, x, y) => { const dx = x - u.x, dy = y - u.y; return Math.hypot(dx, dy) < 2.5 || Math.abs(angDiff(brgOf(dx, dy), u.ptl)) <= u.half; };
  const assets = scn.assets.map(a => { const d = Math.hypot(a.x - U[0].x, a.y - U[0].y); return {a, b:brgOf(a.x - U[0].x, a.y - U[0].y), d, ok:U.some(u => inFan(u, a.x, a.y)), n:U.filter(u => inFan(u, a.x, a.y)).length}; });
  const axis = (scn.axis || []).map(b => { const ok = U.filter(u => Math.abs(angDiff(b, u.ptl)) <= u.half); return {b, ok:ok.length > 0, reach:ok.length ? Math.max(...ok.map(u => lowAltReach(map, u.x, u.y, b, .1))) : 0}; });
  return {assets, axis, units:U, ok:assets.every(x => x.ok) && axis.every(x => x.ok)};
}
function civDebris(S, e){ // an intercept low over a town still drops metal on it
  const gx = e.x + (e.vx || 0) * 6, gy = e.y + (e.vy || 0) * 6;
  for (const a of S.assets){ if (!a.pop || Math.hypot(gx - a.x, gy - a.y) > 4) continue;
    S.st.civDebris++; S.st.hitsW += .3 * PRI_W[a.pri]; a.hp = Math.max(0, a.hp - .25);
    ev(S, 'DEBRIS', `Debris from track ${e.trk ? e.trk.num : ''} fell on ${a.name}`, {bad:true, x:gx, y:gy}); S.out.push({k:'debris', x:gx, y:gy, bad:true}); return; }
  S.out.push({k:'debris', x:gx, y:gy, bad:false});
}

// ---------- scenario editor: a raid built from a share code ----------
const MIX_KEYS = ['SRBM','MRBM','MRBMC','MARV','ABM','CM','OWA','DECOY','FTR','JAM','HELO'];
const MIX_RANGE = {SRBM:300, MRBM:800, MRBMC:800, MARV:800, ABM:380, CM:115, OWA:100, DECOY:100, FTR:220, JAM:200, HELO:45};
function buildCustom(cfg, SCN){
  const base = SCN.find(x => x.id === cfg.base && !x.tutorial); if (!base) return null;
  const scn = JSON.parse(JSON.stringify(base)), r = rng32((cfg.seed >>> 0) || 7);
  const lo = clamp(+cfg.lo || 0, 0, 359), hi = clamp(+cfg.hi != null ? +cfg.hi : lo + 60, 0, 720), span = ((hi - lo) + 360) % 360 || 60;
  const dur = clamp(+cfg.dur || 600, 300, 1200), ids = scn.assets.map(a => a.id), waves = [];
  for (const k of MIX_KEYS){
    const n = clamp(Math.round(+(cfg.mix || {})[k] || 0), 0, 60); if (!n) continue;
    const parts = n >= 12 ? 3 : n >= 5 ? 2 : 1, T = TYPES[k];
    for (let p = 0; p < parts; p++){
      const cnt = Math.round(n / parts) + (p === parts - 1 ? n - Math.round(n / parts) * parts : 0); if (cnt <= 0) continue;
      const t = Math.round(20 + (dur * .72) * (p + r() * .8) / parts), brg = (lo + r() * span) % 360;
      const tg = []; for (let i = 0; i < cnt; i++) tg.push(ids[Math.floor(r() * ids.length)]);
      waves.push({t, type:k, n:cnt, brg, spread:Math.min(20, span / 3), range:MIX_RANGE[k], every:T.ballistic ? 2.5 : 6, targets:tg, miss:T.ballistic ? Math.floor(cnt / 6) : 0, alt:k === 'CM' ? .05 : undefined, role:k === 'FTR' ? (r() < .5 ? 'sead' : 'standoff') : undefined, arm:2, cm:2});
    }
  }
  waves.sort((a, b) => a.t - b.t);
  Object.assign(scn, {id:'cx', custom:true, theater:scn.theater, name:String(cfg.name || 'Custom raid').slice(0, 40), short:'Custom raid from the editor.', inspired:'Built in the scenario editor on the ' + base.name + ' map.',
    brief:['A raid built in the scenario editor on the ' + base.name + ' layout. Same code, same raid.'], intel:[`Threats from ${String(Math.round(lo)).padStart(3, '0')} to ${String(Math.round(hi) % 360).padStart(3, '0')}.`],
    dur, waves, random:null, real:null, endgame:false, axis:[Math.round(lo), Math.round((lo + span / 2) % 360), Math.round(hi % 360)].filter((v, i, a) => a.indexOf(v) === i),
    wcs:['HOLD','TIGHT','FREE'].includes(cfg.wcs) ? cfg.wcs : scn.wcs, adw:'RED', orders:[{t:6, k:'MSG', text:`${scn.bty.split(' ')[0].charAt(0) + scn.bty.split(' ')[0].slice(1).toLowerCase()}, ${scn.td}. Custom raid inbound. Weapons ${(['HOLD','TIGHT','FREE'].includes(cfg.wcs) ? cfg.wcs : scn.wcs).toLowerCase()}.`}]});
  const fr = clamp(+cfg.fr || 0, 0, 6), cor = (MAP[scn.map].corridors || []).length;
  scn.friendly = fr && cor ? [{t:90, n:fr, cor:0, iffFail:cfg.dead ? [0] : [], stray:cfg.dead ? [0] : [], side:1, off:16}] : [];
  if (!cfg.civil) scn.civil = [];
  if (cfg.faults === 'none') scn.faults = 'none'; else delete scn.faults;
  return scn;
}
function encodeCustom(cfg){ const j = JSON.stringify({v:1, ...cfg}); return 'HT4-' + (typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(j))) : Buffer.from(j, 'utf8').toString('base64')).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function decodeCustom(code){
  try { let b = String(code).trim().replace(/^HT4-/, '').replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    const j = typeof atob !== 'undefined' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8'); const c = JSON.parse(j); return c && c.v === 1 && c.base ? c : null; } catch (e) { return null; }
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
  if (S.n % 20 === 0){ stepRadarBudget(S); stepRed(S); stepCrew(S); stepSbw(S); }
  if (S.bn){ stepFus(S, dt); if (S.n % 10 === 0) stepBn(S); }
  for (const e of S.ents) if (e.alive) stepEnt(S, e, dt);
  updateTracks(S, dt);
  if (S.t >= S.nextAuto){ S.nextAuto = S.t + .5; autoEngage(S); }
  processPlans(S, dt);
  stepMissiles(S, dt);
  stepNeighbors(S, dt);
  stepCuas(S, dt);
  stepLaunchers(S, dt);
  for (const e of S.ents) if (e.alive && e.trk && e.trk.est && !e.T.ballistic){ if (!e.trk.zs) e.trk.zs = []; if (Math.floor(S.t * 2) !== e.trk.zsT){ e.trk.zsT = Math.floor(S.t * 2); e.trk.zs.push(e.z); if (e.trk.zs.length > 30) e.trk.zs.shift(); } }
  if (!S.firstHostile){ const h = S.ents.find(e => e.alive && e.trk && e.trk.est && e.truth === 'H' && e.kind !== 'UAV'); if (h){ S.firstHostile = true; } }
  if (S.t >= S.nextSnap){ S.nextSnap = Math.floor(S.t) + 1; snapshot(S); }
  if (S.ents.length > 260) S.ents = S.ents.filter(e => e.alive || S.t - (e.diedT || (e.diedT = S.t)) < 5);
  checkEnd(S);
}

function layerWait(S, e){ // lower tier holds a ballistic shot while the upper tier still has it in work above the layer altitude
  if (!e.T.ballistic || S.doctrine.LAYER !== 'WAIT') return false;
  const up = activePlan(S, e, 'UT'); return !!up && e.z > 25 && !e.released;
}
function thaadPick(S){
  const out = [];
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || !e.trk.tpy || !e.T.ballistic || e.trk.hold || e.released) continue;
    if (activePlan(S, e, 'UT')) continue;
    const a = assess(S, e); if (!a.dal) continue;
    if (roeCheck(S, e).length) continue;
    out.push({e, a});
  }
  return out.sort((x, y) => x.a.tta / PRI_W[x.a.dal.pri] - y.a.tta / PRI_W[y.a.dal.pri]);
}
function aiThaad(S){ // the THAAD crew when you sit at the Patriot ECS
  if (!thaadOn(S) || rounds(S, 'THAAD', false) <= 0) return;
  for (const x of thaadPick(S)){ const s = solve(S, x.e, 'THAAD'); if (s.ok || s.why === 'ABOVE CEILING') engage(S, x.e, {src:'ai', wpn:'THAAD'}); }
}
function aiPatriot(S){ // the Patriot crew when you sit at THAAD fire control: by-the-book IDs, semiautomatic fire
  if (!radarOn(S)) return;
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || e.trk.remote || e.trk.hold) continue;
    const k = e.trk;
    if (!e.T.ballistic && k.idBy !== 'PLAYER' && k.cls && (k.id === 'UNK' || k.id === 'PND') && k.iff === 'NO RESP' && !inCorridor(S, e)){
      const zs = k.zs || [], m = zs.length ? zs.reduce((a, c) => a + c, 0) / zs.length : 0, sd = zs.length > 9 ? Math.sqrt(zs.reduce((a, c) => a + (c - m) ** 2, 0) / zs.length) : 1;
      if (e.T.cls === 'UAV' ? zs.length > 9 && sd >= .005 : assess(S, e).closing) setId(S, e, 'HOS', 'AUTO');
    }
    if (k.id !== 'HOS' || activePlan(S, e, 'LT') || layerWait(S, e)) continue;
    if (e.T.cls === 'UAV' && S.doctrine.UAV === 'CUAS' && S.cuas.length) continue;
    const a = assess(S, e); if (!a.dal || roeCheck(S, e).length) continue;
    engage(S, e, {src:'ai', wpn:'AUTO'});
  }
}
function autoEngage(S){
  if (S.bn) return aiBn(S);
  if (S.thaad){ if (S.seat === 'THAAD'){ aiPatriot(S); if (S.mode !== 'MANUAL' && thaadOn(S)) for (const x of thaadPick(S)){ const s = solve(S, x.e, 'THAAD'); if (s.ok || s.why === 'ABOVE CEILING') engage(S, x.e, {src:S.mode === 'AUTO' ? 'auto' : 'semi', wpn:'THAAD'}); } return; } aiThaad(S); }
  if (S.mode === 'MANUAL' || !radarOn(S)) return;
  for (const e of S.ents){
    if (!e.alive || !e.trk || !e.trk.est || e.trk.remote || e.trk.hold) continue;
    const k = e.trk;
    if (S.mode === 'AUTO' && k.idBy !== 'PLAYER' && (k.id === 'UNK' || k.id === 'PND') && k.iff === 'NO RESP' && e.kind !== 'FALSE'){
      const sp = Math.hypot(e.vx, e.vy), a0 = assess(S, e);
      if (sp > .1 && a0.closing && S.t - k.firstT > 6) setId(S, e, 'HOS', 'AUTO');
    }
    if (k.id !== 'HOS' || activePlan(S, e, 'LT') || layerWait(S, e)) continue;
    if (e.T.cls === 'UAV' && S.doctrine.UAV === 'CUAS') continue;
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
  const ek = S.bn ? .5 : 1, econ = Math.round(Math.max(0, Math.min(20, 20 - ek * (2.5 * st.wasted + 1.5 * st.mseDrone + st.dupShots))));
  const surv = Math.round(st.radarLost ? 0 : Math.max(0, 15 - 4 * st.lsLost - 5 * st.fuLost - (st.tpyLost ? 6 : 0)));
  const total = st.frat ? 0 : protect + disc + econ + surv;
  return {protect, disc, econ, surv, total, frat:st.frat > 0};
}

function remaining(S){
  const r = {MSE:S.reserve.MSE, GEMT:S.reserve.GEMT, THAAD:S.reserve.THAAD || 0};
  for (const L of S.launchers){ if (L.dead) continue; r.MSE += L.MSE; r.GEMT += L.GEMT; r.THAAD += L.THAAD || 0; if (L.pend){ r.MSE += L.pend.MSE; r.GEMT += L.pend.GEMT; r.THAAD += L.pend.THAAD || 0; } }
  return r;
}

function findings(S){
  const st = S.st, s = S.score || score(S), sus = [], imp = [];
  const hitsUntracked = S.ev.filter(x => x.k === 'HIT' && x.untracked).length;
  if (st.leak === 0 && st.potW > 0) sus.push('No threat reached a defended asset.');
  if (st.cuasKills >= 3) sus.push(`Counter-drone fire killed ${st.cuasKills} drones for a fraction of a Patriot round.`);
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
  if (st.clusterHits) imp.push(`${st.clusterRel} cluster warhead(s) opened before anyone killed them, causing ${st.clusterHits} hit(s). Kill clusters high: the upper tier, or an early Patriot shot, before 12 to 20 km.`);
  if (st.tpyLost) imp.push('The TPY-2 was destroyed. The radar is the target: shoot what is aimed at it first, and keep the THAAD site inside your sector.');
  if (st.uncertain) imp.push(`${st.uncertain} hit(s) left the warhead falling. Watch kill assessment: an UNCERTAIN track still needs a shot.`);
  if (S.bn){
    if (S.bn.arch === 'IBCS' && st.dup === 0 && st.kills > 0) sus.push('One composite picture, one shooter per threat: no battery doubled up on a missile.');
    if (st.corr) sus.push(`You correlated ${st.corr} dual designation(s) so the batteries saw one track, not two.`);
    if (st.dupShots >= 3) imp.unshift(`${st.dupShots} missiles went at targets another battery was already engaging. Legacy batteries learn about each other's shots late. Hold the overlapping batteries and assign from the FDC, or fight under IBCS.`);
    if (st.duals - st.corr >= 3) imp.push(`${st.duals - st.corr} dual designation(s) stayed on the scope. Two numbers moving together are one aircraft: hook it and correlate (X).`);
    if (st.swaps && st.frat) imp.unshift('Track numbers swapped where a fighter crossed the drone stream, and the hostile identity moved onto the friendly. Re-interrogate both tracks after any merge.');
    if (st.fuLost) imp.push(`${st.fuLost} fire unit radar(s) lost. Under IBCS their launchers can still fire on other radars' tracks; under legacy they go dark.`);
    if (st.civDebris) imp.push(`${st.civDebris} intercept(s) low over a town dropped debris on it. Engage earlier and higher over populated areas.`);
    if (st.ppli && S.bn.arch === 'IBCS') sus.push(`IBCS matched ${st.ppli} friendly fighter(s) with a dead Mode 4 to their Link 16 position report.`);
  }
  let rec = 'Run it again with the same seed and beat your score.';
  if (st.frat && st.swaps && S.bn) rec = 'Watch the veto window: when a battery calls an engagement on an air track, check the identity before the six seconds run out.';
  else if (st.frat) rec = 'Fly semiautomatic around mixed traffic, and hook every NO RESPONSE track inside the corridor before you declare it.';
  else if (S.bn && st.dupShots >= 4) rec = 'Run the same seed under IBCS, then under legacy with the overlapping batteries on HOLD. Compare the missiles spent.';
  else if (hitsUntracked) rec = 'Before you take the watch, put the threat axis in the middle of your sector, not at its edge.';
  else if (st.wasted >= 3) rec = 'Hold your fire on anything without a red impact marker or a DAL heading. The queue ranks threats for you; trust it.';
  else if (st.mseDrone >= 2) rec = 'Set the drone doctrine to GEM-T single shot and keep PAC-3 for ballistic missiles.';
  else if (st.viol || st.lateAck) rec = 'Treat every TD call as an order: acknowledge first, then act.';
  else if (st.leak > 0) rec = 'Engage earlier: approve shots as soon as the track enters the envelope rather than when it is close.';
  return {sustain:sus.slice(0, 3), improve:imp.slice(0, 4), rec};
}

return {createSim, step, DT, RADAR, WEAPONS, TYPES, MAP, brgOf, polar, angDiff, horizon, heightAt, isLand, lowAltReach, terrainFaces, coverage, assess, solve, threatQueue, roeCheck, engage, activePlan, radarOn, rounds,
  setMode, setEmcon, playerId, playerIff, holdFire, veto, ack, reload, reorient, displace, remaining, findings, score, onAirway, inCorridor, spoken, brgS, PRI_W,
  CHAN, cmd, rewind, runGhost, buildCustom, encodeCustom, decodeCustom, MIX_KEYS, radarOnFu, fuById, bestShooter, coverageBn, roundsFu, inZone, LINK_DELAY, learnRed, planRed, FAULTS, FIX_ACTIONS, CREW, setSector, tcaEff, circMean, thaadOn, lsTotal, REL, predict, tpyDetects};
})();
if (typeof module !== 'undefined') module.exports = HT_SIM;
