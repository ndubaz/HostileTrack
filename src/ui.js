// HOSTILE TRACK — ECS console, rendering, audio, tutorial, campaign and AAR.
(() => {
const {SCN, CAMPAIGNS, THEATERS, TYPES, WEAPONS, MAP} = HT_DATA;
const H = HT_SIM;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const fmtT = t => `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}`;
const byId = id => SCN.find(s => s.id === id);
const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII','IX','X'];
const tableReq = t => t === 9 ? 5 : t - 1;

// ---------- persistence ----------
const store = {
  d:{s:{skin:'wmi', voice:true, vol:.7, expert:false, diff:'normal', speed:1, unlockAll:false, red:'adaptive', tca:'alvarez', delegate:{reload:true, faults:true}}, p:{tables:{}, best:{}, cert:false, plays:0}, camp:{}, red:{}},
  load(){ try { const j = JSON.parse(localStorage.getItem('hostiletrack.v1') || 'null'); if (j){ Object.assign(this.d.s, j.s || {}); Object.assign(this.d.p, j.p || {}); this.d.camp = j.camp || {}; this.d.red = j.red || {}; } } catch (e) {} },
  save(){ try { localStorage.setItem('hostiletrack.v1', JSON.stringify(this.d)); } catch (e) {} },
  get s(){ return this.d.s; }, get p(){ return this.d.p; },
};
store.load();
const unlocked = () => store.s.unlockAll || store.p.cert;

// ---------- audio ----------
const AU = {ctx:null, out:null, amb:null, noiseBuf:null,
  init(){ if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; } try { const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C(); this.out = this.ctx.createGain(); this.out.gain.value = store.s.vol; this.out.connect(this.ctx.destination); const n = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = b; } catch (e) { this.ctx = null; } },
  vol(v){ if (this.out) this.out.gain.value = v; },
  osc(type, f0, f1, dur, gain, delay = 0){ const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .01); g.gain.setValueAtTime(gain, t + Math.max(.02, dur - .04)); g.gain.linearRampToValueAtTime(0, t + dur); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + .05); },
  noise(dur, freq, gain, delay = 0){ const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noiseBuf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + dur + .05); },
  tone(k){
    if (!this.ctx) return; const o = this.osc.bind(this);
    switch (k){
      case 'new': o('sine', 880, 880, .07, .1); o('sine', 660, 660, .07, .1, .1); break;
      case 'hostile': for (let i = 0; i < 2; i++){ o('square', 740, 740, .12, .05, i * .3); o('square', 980, 980, .12, .05, i * .3 + .15); } break;
      case 'tbm': for (let i = 0; i < 2; i++) o('sawtooth', 420, 1400, .42, .045, i * .52); break;
      case 'klaxon': for (let i = 0; i < 3; i++){ o('sawtooth', 236, 236, .34, .06, i * .42); o('sawtooth', 177, 177, .34, .04, i * .42); } break;
      case 'launch': this.noise(1.6, 420, .55); o('sine', 72, 36, 1.0, .35); this.noise(.5, 2400, .08, .05); break;
      case 'kill': o('triangle', 1200, 1700, .12, .09); o('triangle', 1700, 1700, .1, .07, .14); break;
      case 'miss': o('triangle', 620, 280, .35, .09); break;
      case 'order': for (let i = 0; i < 3; i++) o('square', 1050, 1050, .05, .045, i * .09); break;
      case 'fault': o('square', 330, 330, .3, .05); o('square', 250, 250, .3, .05, .32); break;
      case 'veto': for (let i = 0; i < 4; i++) o('square', 1500, 1500, .06, .05, i * .12); break;
      case 'impact': this.noise(2.4, 240, .8); o('sine', 55, 28, 1.3, .45); break;
      case 'squelch': this.noise(.09, 3200, .05); break;
      case 'click': o('square', 2200, 2200, .015, .025); break;
    }
  },
  startAmb(){
    if (!this.ctx || this.amb) return; const c = this.ctx;
    const n = c.sampleRate * 4, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++){ const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.2; }
    const s = c.createBufferSource(); s.buffer = b; s.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520; const g = c.createGain(); g.gain.value = .07;
    s.connect(f); f.connect(g); g.connect(this.out); s.start();
    const h1 = c.createOscillator(), h2 = c.createOscillator(), hg = c.createGain(); h1.frequency.value = 60; h2.frequency.value = 120; hg.gain.value = .012; h1.connect(hg); h2.connect(hg); hg.connect(this.out); h1.start(); h2.start();
    this.amb = [s, h1, h2];
  },
  stopAmb(){ if (this.amb){ this.amb.forEach(n => { try { n.stop(); } catch (e) {} }); this.amb = null; } },
};

const VO = {q:[], busy:false, voices:[], cur:null,
  init(){ if (!('speechSynthesis' in window)) return; const ld = () => { try { this.voices = speechSynthesis.getVoices(); } catch (e) {} }; ld(); try { speechSynthesis.onvoiceschanged = ld; } catch (e) {} },
  say(who, text, pri = 1){
    if (!store.s.voice || !('speechSynthesis' in window)) return;
    if (this.q.length > 2) this.q = this.q.filter(x => x.pri >= pri);
    if (this.q.length > 4) return;
    this.q.push({who, text, pri}); this.pump();
  },
  pick(who){ const en = this.voices.filter(v => /^en/i.test(v.lang)); if (!en.length) return null;
    if (who === 'TD') return en.find(v => /daniel|male|fred|alex|google uk english male|arthur|guy/i.test(v.name)) || en[0];
    return en.find(v => /samantha|female|karen|zira|google us english|serena|moira/i.test(v.name)) || en[1] || en[0]; },
  pump(){
    if (this.busy || !this.q.length) return;
    this.q.sort((a, b) => b.pri - a.pri); const it = this.q.shift();
    let u; try { u = new SpeechSynthesisUtterance(it.text); } catch (e) { return; }
    const v = this.pick(it.who); if (v) u.voice = v;
    u.rate = it.who === 'TD' ? 1.08 : 1.2; u.pitch = it.who === 'TD' ? .82 : 1.06; u.volume = Math.min(1, store.s.vol + .2);
    const done = () => { if (this.cur !== u) return; this.cur = null; this.busy = false; setTimeout(() => this.pump(), 140); };
    u.onend = done; u.onerror = done; this.cur = u; this.busy = true;
    setTimeout(done, 2500 + it.text.length * 80);
    AU.tone('squelch');
    try { speechSynthesis.speak(u); } catch (e) { done(); }
  },
  stop(){ this.q = []; try { speechSynthesis.cancel(); } catch (e) {} this.busy = false; this.cur = null; },
};

// ---------- screens, modal ----------
function show(id){ $$('.screen').forEach(s => s.hidden = s.id !== 'scr-' + id); window.scrollTo(0, 0); UI.screen = id; }
function modal(title, html, btns, bad){
  $('#mTitle').textContent = title; $('#mBody').innerHTML = html; $('#mCard').classList.toggle('bad', !!bad);
  const b = $('#mBtns'); b.innerHTML = '';
  btns.forEach(x => { const el = document.createElement('button'); el.type = 'button'; el.className = 'btn ' + (x.cls || ''); el.textContent = x.t; el.onclick = () => { $('#modal').hidden = true; x.f && x.f(); }; b.appendChild(el); });
  $('#modal').hidden = false;
  const first = b.querySelector('.btn'); if (first) first.focus();
}
function banner(text){ const el = document.createElement('div'); el.className = 'banner'; el.textContent = text; document.body.appendChild(el); setTimeout(() => el.remove(), 3300); }
function applySkin(){ document.body.classList.toggle('legacy', store.s.skin === 'legacy' && unlocked()); PAL = null; }

const UI = {screen:'title'};

// ---------- rendering ----------
let PAL = null;
function pal(){
  if (PAL) return PAL;
  const cs = getComputedStyle(document.body), g = n => cs.getPropertyValue(n).trim();
  PAL = {bg:g('--bg'), sea:g('--sea'), land:g('--land'), line:g('--line'), line2:g('--line2'), text:g('--text'), dim:g('--dim'), faint:g('--faint'), amber:g('--amber'), cyan:g('--cyan'), red:g('--red'), green:g('--green'), violet:g('--violet'), grid:g('--grid'), mono:g('--f-data'), legacy:document.body.classList.contains('legacy')};
  return PAL;
}
const idCol = (id, P) => id === 'HOS' ? P.red : (id === 'FRD' || id === 'ASF') ? P.cyan : id === 'NEU' ? P.green : P.amber;

const terrCache = {}, gridCache = {}, terrJobs = {};
let terrVer = 0;
// Shaded relief: heights sampled on an N×N grid over the 400 km map, lit from the northwest,
// tinted by elevation, with 100 m contours and 500 m index contours. A 1 km pass paints at once;
// a 0.5 km pass refines in the background and swaps in when done.
function shadeTerrain(P, hg, N){
  const px = 400 / N, c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N), d = img.data;
  const at = (i, j) => hg[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
  const lg = P.legacy;
  const LOW = lg ? [3, 15, 6] : [17, 22, 20], MID = lg ? [6, 30, 10] : [34, 37, 31], HIGH = lg ? [14, 58, 20] : [66, 66, 58];
  const SEA = lg ? [1, 6, 2] : [7, 14, 19], SEA2 = lg ? [2, 10, 4] : [11, 22, 28], COAST = lg ? [40, 150, 55] : [86, 122, 128];
  const CMIN = lg ? [24, 90, 34] : [70, 82, 72], CIDX = lg ? [50, 170, 70] : [120, 128, 108];
  const az = 315 * Math.PI / 180, al = 38 * Math.PI / 180, Lx = Math.sin(az) * Math.cos(al), Ly = Math.cos(az) * Math.cos(al), Lz = Math.sin(al), EX = 3.2;
  const fe = Math.round(N * .05);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const h = at(i, j), o = (j * N + i) * 4, ed = Math.min(i, j, N - 1 - i, N - 1 - j), fa = ed < fe ? Math.round(255 * ed / fe) : 255;
    if (h < 0){
      let coast = false, near = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(i + di, j + dj) >= 0) coast = true;
      if (!coast) for (let k = 2; k <= 8; k += 3) if (at(i + k, j) >= 0 || at(i - k, j) >= 0 || at(i, j + k) >= 0 || at(i, j - k) >= 0){ near = 1 - k / 10; break; }
      const col = coast ? COAST : SEA, n = ((i * 7 + j * 13) % 5) * .35;
      for (let q = 0; q < 3; q++) d[o + q] = col[q] + (SEA2[q] - SEA[q]) * near * (coast ? 0 : 1) + n;
      d[o + 3] = fa; continue;
    }
    const hx0 = Math.max(0, at(i - 1, j)), hx1 = Math.max(0, at(i + 1, j)), hy0 = Math.max(0, at(i, j + 1)), hy1 = Math.max(0, at(i, j - 1));
    const gx = (hx1 - hx0) / (2 * px) * EX, gy = (hy1 - hy0) / (2 * px) * EX; // km per km, exaggerated
    const nl = 1 / Math.sqrt(gx * gx + gy * gy + 1), sh = Math.max(0, (-gx * Lx - gy * Ly + Lz) * nl);
    let l = .22 + .78 * sh / Lz; // flat ground = 1
    const curv = (hx0 + hx1 + hy0 + hy1 - 4 * h) / (px * px); l *= 1 - Math.max(-.12, Math.min(.18, curv * 1.6)); // shadowed valleys, bright crests
    const k = Math.min(1, h / 1.8), k1 = Math.min(1, k * 2), k2 = Math.max(0, k * 2 - 1);
    const steep = Math.hypot(gx, gy) / EX;
    const ci = Math.floor(h / .1), cr = Math.floor(Math.max(0, hx1) / .1), cd = Math.floor(Math.max(0, hy0) / .1);
    const isC = h > .05 && (ci !== cr || ci !== cd), idx = isC && (Math.floor(h / .5) !== Math.floor(Math.max(0, hx1) / .5) || Math.floor(h / .5) !== Math.floor(Math.max(0, hy0) / .5));
    for (let q = 0; q < 3; q++){
      let base = (k2 > 0 ? MID[q] + (HIGH[q] - MID[q]) * k2 : LOW[q] + (MID[q] - LOW[q]) * k1) * l;
      if (idx && steep < .6) base = base * .62 + CIDX[q] * .38; else if (isC && steep < .18) base = base * .82 + CMIN[q] * .18;
      d[o + q] = Math.min(255, base);
    }
    d[o + 3] = fa;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
function terrainImg(mk){
  const P = pal(), key = mk + (P.legacy ? 'L' : 'W'); if (terrCache[key]) return terrCache[key];
  const map = MAP[mk], N = 400, hg = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hg[j * N + i] = H.heightAt(map, -200 + (i + .5) * 400 / N, 200 - (j + .5) * 400 / N);
  terrCache[key] = shadeTerrain(P, hg, N);
  refineTerrain(mk, key, P);
  return terrCache[key];
}
function refineTerrain(mk, key, P){
  if (terrJobs[key]) return; const map = MAP[mk], N = 800, hg = new Float32Array(N * N); let j = 0;
  terrJobs[key] = true;
  const tick = () => {
    const t0 = performance.now();
    while (j < N && performance.now() - t0 < 12){ for (let i = 0; i < N; i++) hg[j * N + i] = H.heightAt(map, -200 + (i + .5) * .5, 200 - (j + .5) * .5); j++; }
    if (j < N) return setTimeout(tick, 0);
    terrCache[key] = shadeTerrain(P, hg, N); terrVer++;
  };
  setTimeout(tick, 300);
}
function heightGrid(mk){
  if (gridCache[mk]) return gridCache[mk];
  const map = MAP[mk], g = [];
  for (let j = 0; j <= 160; j++){ const row = []; for (let i = 0; i <= 160; i++) row.push(H.heightAt(map, -200 + i * 2.5, 200 - j * 2.5)); g.push(row); }
  return (gridCache[mk] = g);
}

function zd(z){ return z <= 20 ? z * 2.4 : 48 + (z - 20) * .5; }
function proj(v, x, y, z = 0){
  const dx = x - v.cx, dy = y - v.cy;
  if (!v.tilt) return [v.W / 2 + dx * v.s, v.H / 2 - dy * v.s, 1];
  const P = .98, c = Math.cos(P), sn = Math.sin(P), Dk = v.H * 1.6 / v.s;
  const f = 1 / Math.max(.25, 1 + dy * sn / Dk);
  return [v.W / 2 + dx * v.s * f, v.H * .62 - (dy * c + zd(z) * sn) * v.s * f, f];
}
function unproj(v, px, py){ return {x:v.cx + (px - v.W / 2) / v.s, y:v.cy - (py - v.H / 2) / v.s}; }
function polyline(ctx, v, pts, z = 0){ ctx.beginPath(); pts.forEach((p, i) => { const q = proj(v, p[0] ?? p.x, p[1] ?? p.y, z); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); }
function circleW(ctx, v, cx, cy, r, z = 0){ ctx.beginPath(); for (let a = 0; a <= 72; a++){ const p = H.polar(a * 5, r, {x:cx, y:cy}), q = proj(v, p.x, p.y, z); a ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } }
const lowCache = {};
function lowLine(map, mk, bx, by, ptl, half = 60){
  const key = mk + bx + ',' + by + ',' + ptl + ',' + half; if (lowCache[key]) return lowCache[key];
  const pts = []; for (let a = ptl - half; a <= ptl + half + .01; a += 2){ const r = H.lowAltReach(map, bx, by, a, .1); const p = H.polar(a, r, {x:bx, y:by}); pts.push([p.x, p.y]); }
  return (lowCache[key] = pts);
}

// far field: real coastlines, borders and cities (Natural Earth) out to 950 km
function drawGeo(ctx, v, G, P){
  const path = arr => { ctx.beginPath(); for (let i = 0; i < arr.length; i += 2){ const q = proj(v, arr[i], arr[i + 1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } };
  ctx.fillStyle = P.legacy ? '#041206' : '#141a18';
  for (const r of G.land){ path(r); ctx.closePath(); ctx.fill('evenodd'); }
  ctx.strokeStyle = P.legacy ? '#1d6a2a' : '#35545c'; ctx.lineWidth = 1; ctx.globalAlpha = .8;
  for (const r of G.land){ path(r); ctx.closePath(); ctx.stroke(); }
  ctx.setLineDash([3, 4]); ctx.strokeStyle = P.dim; ctx.globalAlpha = .45;
  for (const b of G.borders){ path(b); ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (v.s < 1.6){ ctx.font = `600 10px ${P.mono}`; for (const c of G.cities){ if (Math.abs(c[1]) < 205 && Math.abs(c[2]) < 205) continue; const q = proj(v, c[1], c[2]); if (q[0] < -50 || q[0] > v.W + 50 || q[1] < -20 || q[1] > v.H + 20) continue; ctx.fillStyle = P.dim; ctx.globalAlpha = .75; ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); ctx.fillText(c[0], q[0] + 5, q[1] + 3); } ctx.globalAlpha = 1; }
}

// static layer: terrain, overlays, rings, fan, assets, battery
function drawBase(ctx, v, M){
  const P = pal(), map = MAP[M.mapKey];
  ctx.save();
  const G = typeof HT_GEO !== 'undefined' ? HT_GEO[M.mapKey] : null;
  ctx.fillStyle = G ? (P.legacy ? '#010702' : '#081014') : map.landDefault ? (P.legacy ? '#020c04' : '#111614') : P.sea; ctx.fillRect(0, 0, v.W, v.H);
  if (G && !v.tilt) drawGeo(ctx, v, G, P);
  if (!v.tilt){
    const a = proj(v, -200, 200), img = terrainImg(M.mapKey);
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = .9; ctx.drawImage(img, a[0], a[1], 400 * v.s, 400 * v.s); ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, v.W, v.H);
    const g = heightGrid(M.mapKey), G = g.length - 1; ctx.lineWidth = 1;
    const seg = (pts) => { let st = false, hm = 0; ctx.beginPath(); for (const [x, y, h] of pts){ const q = proj(v, x, y, Math.max(0, h) * 1.6); if (q[1] < -50 || q[1] > v.H + 50){ st = false; continue; } st ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); st = true; hm = Math.max(hm, h); } return hm; };
    for (let j = 0; j <= G; j++){ const pts = []; for (let i = 0; i <= G; i++) pts.push([-200 + i * 2.5, 200 - j * 2.5, g[j][i]]); const hm = seg(pts); ctx.strokeStyle = P.grid; ctx.globalAlpha = .55 + Math.min(.45, hm * .3); ctx.stroke(); }
    for (let i = 0; i <= G; i += 2){ const pts = []; for (let j = 0; j <= G; j++) pts.push([-200 + i * 2.5, 200 - j * 2.5, g[j][i]]); seg(pts); ctx.strokeStyle = P.grid; ctx.globalAlpha = .35; ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.dim; ctx.globalAlpha = .7; for (const poly of map.polys || []){ polyline(ctx, v, poly.concat([poly[0]])); ctx.stroke(); } ctx.globalAlpha = 1;
  }
  ctx.font = `10px ${P.mono}`; ctx.textAlign = 'left';
  for (const r of map.rivers || []){ polyline(ctx, v, r.pts); ctx.strokeStyle = P.legacy ? '#0a3010' : '#183440'; ctx.lineWidth = Math.max(1.5, (r.w || 1) * v.s); ctx.stroke(); }
  ctx.lineWidth = 1;
  for (const b of map.borders || []){ polyline(ctx, v, b.pts); ctx.setLineDash([2, 5]); ctx.strokeStyle = P.dim; ctx.globalAlpha = .6; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; const m = b.pts[1], q = proj(v, m[0], m[1]); ctx.fillStyle = P.faint; ctx.fillText(b.name, q[0] + 4, q[1] - 4); }
  for (const a of map.airways || []){ polyline(ctx, v, a.pts); ctx.setLineDash([6, 6]); ctx.strokeStyle = P.green; ctx.globalAlpha = .3; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = .65; const m = a.pts[0], n = a.pts[1], q = proj(v, (m[0] * 2 + n[0]) / 3, (m[1] * 2 + n[1]) / 3); ctx.fillStyle = P.green; ctx.fillText(a.name, q[0] + 4, q[1] - 4); ctx.globalAlpha = 1; }
  for (const c of map.corridors || []){ polyline(ctx, v, c.pts); ctx.strokeStyle = P.cyan; ctx.globalAlpha = .07; ctx.lineWidth = Math.max(6, 12 * v.s * (v.tilt ? .6 : 1)); ctx.stroke(); ctx.globalAlpha = .38; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]); const m = c.pts[0], n = c.pts[1], q = proj(v, (m[0] + n[0]) / 2, (m[1] + n[1]) / 2); ctx.fillStyle = P.cyan; ctx.globalAlpha = .75; ctx.fillText(c.name, q[0] + 8, q[1]); ctx.globalAlpha = 1; }
  ctx.fillStyle = P.faint; ctx.font = `600 10px ${P.mono}`;
  for (const l of map.labels || []){ const q = proj(v, l[1], l[2]); ctx.fillText(l[0], q[0], q[1]); }
  const B = M.bat, utSeat = M.seat === 'THAAD' && M.thaad, RC = utSeat ? M.thaad : B, rings = utSeat ? [100, 200, 300, 400, 500, 600] : [25, 50, 100, 150], rT = rings[rings.length - 1];
  ctx.strokeStyle = P.line2; ctx.lineWidth = 1; ctx.font = `10px ${P.mono}`; ctx.fillStyle = P.faint;
  for (const r of rings){ circleW(ctx, v, RC.x, RC.y, r); ctx.globalAlpha = .6; ctx.stroke(); ctx.globalAlpha = 1; const q = proj(v, RC.x, RC.y + r); ctx.fillText(r + '', q[0] + 3, q[1] + 11); }
  if (!v.tilt){
    for (let a = 0; a < 360; a += 10){ const big = a % 30 === 0, p1 = H.polar(a, rT * (big ? 1 : 1.027), RC), p2 = H.polar(a, rT * 1.053, RC), q1 = proj(v, p1.x, p1.y), q2 = proj(v, p2.x, p2.y); ctx.beginPath(); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.strokeStyle = P.line2; ctx.stroke(); if (big){ const p3 = H.polar(a, rT * 1.107, RC), q3 = proj(v, p3.x, p3.y); ctx.textAlign = 'center'; ctx.fillText(pad(a, 3), q3[0], q3[1] + 3); ctx.textAlign = 'left'; } }
  }
  if (utSeat){ circleW(ctx, v, M.thaad.x, M.thaad.y, 200); ctx.setLineDash([8, 5]); ctx.strokeStyle = P.amber; ctx.globalAlpha = .55; ctx.stroke(); ctx.setLineDash([]); const q = proj(v, H.polar(M.thaad.ptl + 35, 200, M.thaad).x, H.polar(M.thaad.ptl + 35, 200, M.thaad).y); ctx.fillStyle = P.amber; ctx.fillText('THAAD ENGAGEMENT 200 KM', q[0] + 4, q[1]); ctx.globalAlpha = 1; ctx.fillStyle = P.faint; }
  for (const nb of M.neighbors || []){
    const pts = [[nb.x, nb.y]]; for (let a = nb.ptl - 60; a <= nb.ptl + 60.1; a += 4){ const p = H.polar(a, 150, nb); pts.push([p.x, p.y]); } pts.push([nb.x, nb.y]);
    polyline(ctx, v, pts); ctx.setLineDash([4, 6]); ctx.strokeStyle = nb.on ? P.violet : P.faint; ctx.globalAlpha = .55; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const q = proj(v, nb.x, nb.y); ctx.fillStyle = nb.on ? P.violet : P.faint; ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6); ctx.fillText(nb.name + (nb.on ? '' : ' · OFF'), q[0] + 6, q[1] - 6);
  }
  const TH = M.thaad;
  if (TH){
    const pts = [[TH.x, TH.y]]; for (let a = TH.ptl - TH.half; a <= TH.ptl + TH.half + .1; a += 2){ const p = H.polar(a, TH.rmax || 600, TH); pts.push([p.x, p.y]); } pts.push([TH.x, TH.y]);
    polyline(ctx, v, pts);
    if (M.seat === 'THAAD' && TH.alive){ ctx.fillStyle = P.legacy ? 'rgba(90,255,130,.04)' : 'rgba(242,165,58,.05)'; ctx.fill(); }
    ctx.setLineDash(M.seat === 'THAAD' ? [] : [2, 7]); ctx.strokeStyle = TH.alive ? P.amber : P.faint; ctx.globalAlpha = M.seat === 'THAAD' ? .7 : .3; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const tq = proj(v, TH.x, TH.y); ctx.fillStyle = TH.alive ? P.amber : P.red; ctx.fillRect(tq[0] - 6, tq[1] - 3.5, 12, 7);
    if (!TH.alive){ ctx.strokeStyle = P.red; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(tq[0] - 8, tq[1] - 8); ctx.lineTo(tq[0] + 8, tq[1] + 8); ctx.moveTo(tq[0] + 8, tq[1] - 8); ctx.lineTo(tq[0] - 8, tq[1] + 8); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.font = `600 10px ${P.mono}`; ctx.fillText(TH.alive ? 'TPY-2' : 'TPY-2 · DOWN', tq[0] + 9, tq[1] - 6); ctx.font = `10px ${P.mono}`;
  }
  for (const c of M.cuas || []){
    const cq = proj(v, c.x, c.y); ctx.strokeStyle = c.dead ? P.faint : P.green; ctx.globalAlpha = .45; circleW(ctx, v, c.x, c.y, c.r || 3.5); ctx.setLineDash([1, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(cq[0], cq[1] - 5); ctx.lineTo(cq[0] + 5, cq[1]); ctx.lineTo(cq[0], cq[1] + 5); ctx.lineTo(cq[0] - 5, cq[1]); ctx.closePath(); ctx.stroke();
    if (v.s > 1.2 || M.labelsAlways){ ctx.fillStyle = P.green; ctx.globalAlpha = .8; ctx.fillText(c.name.toUpperCase(), cq[0] + 7, cq[1] + 12); ctx.globalAlpha = 1; }
  }
  if (M.showFan !== false){
    const ptl = M.ptlPreview != null ? M.ptlPreview : B.ptl;
    const half = B.half || 60, pts = [[B.x, B.y]]; for (let a = ptl - half; a <= ptl + half + .01; a += 2){ const p = H.polar(a, H.RADAR.rmax, B); pts.push([p.x, p.y]); } pts.push([B.x, B.y]);
    polyline(ctx, v, pts);
    const q0 = proj(v, B.x, B.y), gr = ctx.createRadialGradient(q0[0], q0[1], 0, q0[0], q0[1], H.RADAR.rmax * v.s);
    const on = B.on !== false, cc = P.legacy ? '90,255,130' : '82,205,224';
    if (utSeat){ ctx.setLineDash([3, 5]); ctx.strokeStyle = on ? P.cyan : P.faint; ctx.globalAlpha = .35; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; } else {
    gr.addColorStop(0, on ? `rgba(${cc},.10)` : 'rgba(120,120,120,.05)'); gr.addColorStop(1, on ? `rgba(${cc},.025)` : 'rgba(120,120,120,.02)');
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = on ? P.cyan : P.faint; ctx.globalAlpha = .5; ctx.stroke(); ctx.globalAlpha = 1;
    const low = lowLine(map, M.mapKey, B.x, B.y, ptl, half); polyline(ctx, v, low); ctx.setLineDash([3, 4]); ctx.strokeStyle = P.amber; ctx.globalAlpha = .6; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const lp = low[Math.floor(low.length * .8)], lq = proj(v, lp[0], lp[1]); ctx.fillStyle = P.amber; ctx.globalAlpha = .75; ctx.fillText('100 m LIMIT', lq[0] + 4, lq[1] - 3); ctx.globalAlpha = 1;
    const pe = H.polar(ptl, H.RADAR.rmax, B); polyline(ctx, v, [[B.x, B.y], [pe.x, pe.y]]); ctx.setLineDash([10, 6]); ctx.strokeStyle = P.amber; ctx.globalAlpha = .55; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const pq = proj(v, H.polar(ptl, 130, B).x, H.polar(ptl, 130, B).y); ctx.fillStyle = P.amber; ctx.font = `600 11px ${P.mono}`; ctx.fillText('PTL ' + pad(Math.round(ptl) % 360, 3), pq[0] + 6, pq[1]); ctx.font = `10px ${P.mono}`; ctx.globalAlpha = 1; }
  }
  if (M.axis){ for (const a of M.axis){ const p1 = H.polar(a, 120, B), p2 = H.polar(a, 165, B); polyline(ctx, v, [[p2.x, p2.y], [p1.x, p1.y]]); ctx.strokeStyle = P.red; ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineWidth = 1; const q = proj(v, p1.x, p1.y); ctx.fillStyle = P.red; ctx.fillText('THREAT ' + pad(a, 3), q[0] + 4, q[1]); } }
  if (M.sites) M.sites.forEach((s, i) => { const q = proj(v, s.x, s.y); ctx.strokeStyle = i === M.siteSel ? P.amber : P.dim; ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, 7); ctx.stroke(); ctx.fillStyle = i === M.siteSel ? P.amber : P.dim; ctx.fillText(String.fromCharCode(65 + i), q[0] - 3, q[1] + 3.5); });
  ctx.font = `10px ${P.mono}`; const lbls = [];
  for (const a of M.assets){
    const q = proj(v, a.x, a.y), hp = a.hp / a.hpMax, col = a.hp <= 0 ? P.red : hp < .6 ? P.amber : P.text;
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.strokeRect(q[0] - 5, q[1] - 5, 10, 10); ctx.lineWidth = 1;
    if (a.hp <= 0){ ctx.beginPath(); ctx.moveTo(q[0] - 7, q[1] - 7); ctx.lineTo(q[0] + 7, q[1] + 7); ctx.moveTo(q[0] + 7, q[1] - 7); ctx.lineTo(q[0] - 7, q[1] + 7); ctx.strokeStyle = P.red; ctx.stroke(); }
    ctx.fillStyle = col; ctx.fillText(a.pri, q[0] - 2.8, q[1] + 3.5);
    if (v.s > .9 || M.labelsAlways){ const t = a.name.toUpperCase(), w = ctx.measureText(t).width, r = {x:q[0] + 8, y:q[1] - 6, w, h:11};
      if (!lbls.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h)){ lbls.push(r); ctx.fillStyle = P.dim; ctx.fillText(t, r.x, q[1] + 3); } }
    if (M.cov && M.cov[a.id] != null){ ctx.strokeStyle = M.cov[a.id] ? P.green : P.red; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q[0], q[1], 10, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
  }
  const q = proj(v, B.x, B.y);
  for (const L of M.launchers || []){ const lq = proj(v, L.x, L.y); ctx.fillStyle = L.dead ? P.red : L.type === 'THAAD' ? P.amber : P.dim; ctx.fillRect(lq[0] - 2, lq[1] - 2, 4, 4); }
  ctx.fillStyle = B.alive === false ? P.red : (B.on === false ? P.dim : P.cyan); ctx.beginPath(); ctx.moveTo(q[0], q[1] - 7); ctx.lineTo(q[0] + 6, q[1] + 5); ctx.lineTo(q[0] - 6, q[1] + 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = P.text; ctx.font = `600 10px ${P.mono}`; ctx.fillText(M.bty || '', q[0] + 9, q[1] + 12);
  for (const sc of M.scars || []){ const s = proj(v, sc.x, sc.y); ctx.strokeStyle = sc.harmless ? P.faint : P.red; ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(s[0], s[1], 3, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.restore();
}

// phosphor layer: sweep, clutter, tracks, missiles, effects
function drawLive(ctx, v, M, now, glow){
  const P = pal(), B = M.bat;
  ctx.save();
  const gl = (c, b) => { if (glow){ ctx.shadowColor = c; ctx.shadowBlur = b; } };
  const ng = () => { ctx.shadowBlur = 0; };
  const sbl = [];
  for (const a of M.sbw || []){ // space-based warning: impact areas before the radar sees the missile
    const cq = proj(v, a.cx, a.cy); circleW(ctx, v, a.cx, a.cy, a.r); ctx.setLineDash([5, 4]); ctx.strokeStyle = P.amber; ctx.globalAlpha = .45; ctx.stroke(); ctx.setLineDash([]);
    const lx = cq[0] + a.r * v.s * .72, ly = cq[1] - a.r * v.s * .72;
    if (!sbl.some(o => Math.abs(o[0] - lx) < 110 && Math.abs(o[1] - ly) < 14)){ sbl.push([lx, ly]); const n = (M.sbw || []).filter(b => Math.hypot(b.cx - a.cx, b.cy - a.cy) < 25).length;
      ctx.fillStyle = P.amber; ctx.globalAlpha = .85; ctx.font = `600 10px ${P.mono}`; ctx.fillText(`${n > 1 ? n + ' LAUNCHES' : 'LAUNCH'} · TTI ${fmtT(a.tti)}`, lx, ly); }
    ctx.globalAlpha = 1; ctx.font = `10px ${P.mono}`;
  }
  for (const j of M.jammers || []){ const b = H.brgOf(j.x - B.x, j.y - B.y), e = H.polar(b, 170, B); polyline(ctx, v, [[B.x, B.y], [e.x, e.y]]); ctx.strokeStyle = P.red; ctx.globalAlpha = .18 + Math.random() * .12; ctx.lineWidth = Math.max(4, 14 * v.s * .3); ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; ctx.globalAlpha = 1; }
  // Radar presentation. MPQ-65 and AN/TPY-2 are phased arrays: no rotating beam. The array hops its pencil
  // beam across the sector in an interleaved search raster and revisits every held track several times a second.
  const SR = M.seat === 'THAAD' && M.thaad ? {x:M.thaad.x, y:M.thaad.y, ptl:M.thaad.ptl, half:M.thaad.half || 60, rmax:M.thaad.rmax || 600, on:M.thaad.alive && !M.thaad.emcon, ut:true}
    : {x:B.x, y:B.y, ptl:B.ptl, half:B.half || 60, rmax:H.RADAR.rmax, on:B.on !== false, ut:false};
  if (M.showFan !== false && SR.on && now){
    const q0 = proj(v, SR.x, SR.y), sc = P.legacy ? '140,255,150' : SR.ut ? '242,180,90' : '110,225,240', C = M.clutter;
    const wedge = (a0, a1, al) => { const pa = H.polar(a0, SR.rmax, SR), pb = H.polar(a1, SR.rmax, SR), qa = proj(v, pa.x, pa.y), qb = proj(v, pb.x, pb.y); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.closePath(); ctx.fillStyle = `rgba(${sc},${al.toFixed(3)})`; ctx.fill(); };
    const paint = az => { // what one beam position sends back: targets, ground clutter on lit terrain, near-in clutter
      if (!C || v.tilt || M.video === 'SYN') return;
      for (const e of M.ents) if ((SR.ut ? e.tpy : e.raw) && Math.abs(H.angDiff(H.brgOf(e.x - SR.x, e.y - SR.y), az)) < 1.4){ const j = SR.ut ? 2.5 : .6; C.push({x:e.x + (Math.random() - .5) * j, y:e.y + (Math.random() - .5) * j, t0:now, s:e.rcs > 1 ? 3.6 : e.rcs > .2 ? 2.8 : 2.2}); }
      if (SR.ut) return;
      if (Math.random() < .5){ const r = Math.random() ** 2 * 24 + 1, p = H.polar(az + (Math.random() - .5) * 2, r, SR); C.push({x:p.x, y:p.y, t0:now}); }
      if (Math.random() < .7){ const f = H.terrainFaces(MAP[M.mapKey], SR.x, SR.y, az); if (f.length){ const r = f[Math.floor(Math.random() * f.length)] + Math.random() - .5, p = H.polar(az, r, SR); C.push({x:p.x, y:p.y, t0:now}); } }
    };
    if (M.scan === 'CLEAN' && M.scanS){ // the real operator picture: no beam on screen; raw returns refresh quietly each search frame
      const Z = M.scanS;
      if (C && now - (Z.frame || 0) > 1000){
        Z.frame = now;
        for (const e of M.ents) if (SR.ut ? e.tpy : e.raw){ const j = SR.ut ? 2.5 : .6; C.push({x:e.x + (Math.random() - .5) * j, y:e.y + (Math.random() - .5) * j, t0:now, s:e.rcs > 1 ? 3.6 : e.rcs > .2 ? 2.8 : 2.2, life:2400}); }
        if (!SR.ut) for (let k = 0; k < 40; k++){ const az = SR.ptl - SR.half + Math.random() * 2 * SR.half; if (k < 14){ const r = Math.random() ** 2 * 24 + 1, p = H.polar(az, r, SR); C.push({x:p.x, y:p.y, t0:now, life:2400}); } else { const f = H.terrainFaces(MAP[M.mapKey], SR.x, SR.y, az); if (f.length){ const r = f[Math.floor(Math.random() * f.length)] + Math.random() - .5, p = H.polar(az, r, SR); C.push({x:p.x, y:p.y, t0:now, life:2400}); } } }
      }
    } else if (M.scan === 'SWEEP'){ // stylized rotating sweep, kept as an option
      const ph = (now / (2400 * SR.half / 60)) % 2, dir = ph < 1 ? 1 : -1, f = ph < 1 ? ph : 2 - ph, sw = SR.ptl - SR.half + f * SR.half * 2;
      for (let k = 14; k >= 0; k--){ const a0 = sw - dir * (k + 1) * 1.4, a1 = sw - dir * k * 1.4; if (Math.abs(H.angDiff(a0, SR.ptl)) > SR.half || Math.abs(H.angDiff(a1, SR.ptl)) > SR.half) continue; wedge(a0, a1, .13 * (1 - k / 15)); }
      const se = H.polar(sw, SR.rmax, SR), q1 = proj(v, se.x, se.y); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.strokeStyle = `rgba(${sc},.6)`; ctx.lineWidth = 1.3; gl(P.cyan, 6); ctx.stroke(); ng(); ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) paint(sw + (Math.random() - .5) * 2.5);
    } else if (M.scanS){
      const Z = M.scanS, dtf = Math.min(.1, Z.last ? (now - Z.last) / 1000 : 0); Z.last = now;
      Z.acc += dtf * (SR.ut ? 40 : 65);
      while (Z.acc >= 1){ Z.acc -= 1; Z.k++; const az = SR.ptl - SR.half + ((Z.k * .6180339887) % 1) * 2 * SR.half; Z.beams.push({az, t0:now}); paint(az); }
      while (Z.beams.length && now - Z.beams[0].t0 > 280) Z.beams.shift();
      for (const bm of Z.beams){ const age = (now - bm.t0) / 280; wedge(bm.az - .8, bm.az + .8, .085 * (1 - age)); }
      for (const e of M.ents){ // track dwells
        if (!e.trk || !(SR.ut ? e.tpy : e.ownTrk)) continue;
        const ph = (now / 1000 * (e.ball ? 2.5 : 1.1) + e.uid * .37) % 1; if (ph > .16) continue;
        const a = 1 - ph / .16, q = proj(v, e.x, e.y, e.z);
        ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = `rgba(${sc},${(.16 * a).toFixed(3)})`; ctx.stroke();
        ctx.beginPath(); ctx.arc(q[0], q[1], 5 + 6 * (1 - a), 0, 7); ctx.strokeStyle = `rgba(${sc},${(.6 * a).toFixed(3)})`; ctx.stroke();
      }
    }
    if (C && !v.tilt && M.video !== 'SYN'){
      while (C.length && now - C[0].t0 > (C[0].life || 1800)) C.shift();
      for (const c of C){ const s = proj(v, c.x, c.y), z = c.s || 1.8, L = c.life || 1800, age = (now - c.t0) / L; if (age >= 1) continue; ctx.fillStyle = `rgba(${sc},${((c.s ? .85 : .5) * (c.life ? Math.min(1, 1.6 * (1 - age)) : 1 - age)).toFixed(3)})`; ctx.fillRect(s[0] - z / 2, s[1] - z / 2, z, z); }
    }
  }
  const hits = [], raw = M.video === 'RAW', fill = M.sym === '2525', tl = [];
  for (const m of M.ms || []){ // flyout lines to the predicted intercept point
    if (!m.aim || m.owner === 'nb') continue;
    const q = proj(v, m.x, m.y, m.z), a = proj(v, m.aim.x, m.aim.y, m.aim.z), c = m.owner === 'cuas' ? P.green : m.tier === 'UT' ? P.amber : P.text;
    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(a[0], a[1]); ctx.setLineDash([2, 4]); ctx.strokeStyle = c; ctx.globalAlpha = .38; ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = .75; ctx.beginPath(); ctx.moveTo(a[0] - 3, a[1] - 3); ctx.lineTo(a[0] + 3, a[1] + 3); ctx.moveTo(a[0] + 3, a[1] - 3); ctx.lineTo(a[0] - 3, a[1] + 3); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const e of M.ents){
    if (!e.trk){ if (M.truth){ const q = proj(v, e.x, e.y, e.z); ctx.fillStyle = e.truth === 'H' ? P.red : P.faint; ctx.globalAlpha = .45; ctx.beginPath(); ctx.arc(q[0], q[1], 2.5, 0, 7); ctx.fill(); ctx.fillText(e.kind, q[0] + 5, q[1] - 4); ctx.globalAlpha = 1; } continue; }
    const k = e.trk, col = idCol(k.id, P), q = proj(v, e.x, e.y, e.z);
    if (q[0] < -40 || q[0] > v.W + 40 || q[1] < -40 || q[1] > v.H + 40) continue;
    hits.push({uid:e.uid, x:q[0], y:q[1]});
    if (raw && e.uid !== M.hooked){ ctx.fillStyle = P.dim; ctx.font = `9px ${P.mono}`; ctx.fillText(k.num, q[0] + 6, q[1] - 4); continue; }
    if (e.released){ // a cluster warhead after release: one track becomes a cloud of returns
      ctx.fillStyle = P.red; for (let i = 0; i < 14; i++){ const an = (e.uid * 37 + i * 137) % 360 * Math.PI / 180, rr = 2 + ((e.uid * 13 + i * 71) % 10) * (1.2 + .25 * Math.max(0, 20 - e.z)); ctx.globalAlpha = .55 + .4 * Math.random(); ctx.fillRect(q[0] + Math.cos(an) * rr - 1, q[1] + Math.sin(an) * rr - 1, 2, 2); }
      ctx.globalAlpha = 1; ctx.font = `600 10.5px ${P.mono}`; ctx.fillText(`${k.num} SUBMUNITIONS`, q[0] + 12, q[1] - 6);
      if (e.impact){ const iq = proj(v, e.impact.x, e.impact.y); circleW(ctx, v, e.impact.x, e.impact.y, e.clr || 5); ctx.setLineDash([3, 3]); ctx.strokeStyle = P.red; ctx.globalAlpha = .7; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      continue;
    }
    const al = k.remote ? .55 : 1; ctx.globalAlpha = al;
    if (v.tilt){ const g0 = proj(v, e.x, e.y, 0); ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = col; ctx.globalAlpha = al * .35; ctx.stroke(); ctx.globalAlpha = al; ctx.fillStyle = col; ctx.fillRect(g0[0] - 1, g0[1] - 1, 2, 2); }
    if (e.hist){ ctx.fillStyle = col; e.hist.forEach((h, i) => { const hq = proj(v, h[0], h[1], h[2]); ctx.globalAlpha = al * .5 * (i + 1) / e.hist.length; ctx.fillRect(hq[0] - 1, hq[1] - 1, 2, 2); }); ctx.globalAlpha = al; }
    if (e.impact && k.cls){ const iq = proj(v, e.impact.x, e.impact.y), dal = e.dal; ctx.strokeStyle = dal ? P.red : P.dim; ctx.setLineDash([2, 4]); const g0 = proj(v, e.x, e.y, 0); ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(iq[0], iq[1]); ctx.globalAlpha = .45; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; const r = Math.max(5, 2.5 * v.s * iq[2]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(iq[0], iq[1], r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(iq[0] - 4, iq[1] - 4); ctx.lineTo(iq[0] + 4, iq[1] + 4); ctx.moveTo(iq[0] + 4, iq[1] - 4); ctx.lineTo(iq[0] - 4, iq[1] + 4); ctx.stroke(); ctx.lineWidth = 1; ctx.globalAlpha = al; }
    const lt = e.ball ? 15 : 60, l2 = proj(v, e.x + e.vx * lt, e.y + e.vy * lt, Math.max(0, e.z + (e.vz || 0) * lt));
    gl(col, 7);
    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(l2[0], l2[1]); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
    const r = fill ? 8 : 7; ctx.lineWidth = 1.9; if (k.remote || k.id === 'PND') ctx.setLineDash([2, 2]);
    ctx.beginPath();
    if (e.ball){ ctx.moveTo(q[0], q[1] - r); ctx.lineTo(q[0] + r, q[1]); ctx.lineTo(q[0], q[1] + r); ctx.lineTo(q[0] - r, q[1]); ctx.closePath(); }
    else if (k.id === 'HOS' || k.id === 'SUS'){ ctx.moveTo(q[0] - r, q[1] + 1); ctx.lineTo(q[0], q[1] - r); ctx.lineTo(q[0] + r, q[1] + 1); }
    else if (k.id === 'FRD' || k.id === 'ASF'){ ctx.arc(q[0], q[1] + 1, r, Math.PI, 0); }
    else if (k.id === 'NEU'){ ctx.moveTo(q[0] - r, q[1] + 1); ctx.lineTo(q[0] - r, q[1] - r); ctx.lineTo(q[0] + r, q[1] - r); ctx.lineTo(q[0] + r, q[1] + 1); }
    else { ctx.moveTo(q[0] - r, q[1] + 1); ctx.lineTo(q[0] - r, q[1] - r + 3); ctx.quadraticCurveTo(q[0] - r, q[1] - r, q[0] - r + 3, q[1] - r); ctx.lineTo(q[0] + r - 3, q[1] - r); ctx.quadraticCurveTo(q[0] + r, q[1] - r, q[0] + r, q[1] - r + 3); ctx.lineTo(q[0] + r, q[1] + 1); }
    if (fill){ ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = col; ctx.fill(); ctx.restore(); }
    ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    if (fill && k.cls){ ctx.fillStyle = col; ctx.font = `700 7px ${P.mono}`; ctx.textAlign = 'center'; ctx.fillText(e.ball ? 'M' : e.clsLbl === 'UAV' ? 'UAV' : e.clsLbl === 'CM' ? 'CM' : e.clsLbl === 'FW' ? 'F' : e.clsLbl === 'RW' ? 'H' : '', q[0], q[1] + (e.ball ? 3 : -1)); ctx.textAlign = 'left'; }
    else { ctx.fillStyle = col; ctx.fillRect(q[0] - 1.3, q[1] - 1.3, 2.6, 2.6); }
    ng();
    if (k.ka === 'UNCERTAIN'){ ctx.fillStyle = P.amber; ctx.font = `600 9px ${P.mono}`; ctx.fillText('KA?', q[0] - 26, q[1] - 6); }
    if (e.tpy && !e.ownTrk){ ctx.fillStyle = P.amber; ctx.font = `9px ${P.mono}`; ctx.fillText('TPY', q[0] - 22, q[1] + 10); }
    const lr = {x:q[0] + 8, y:q[1] - 14, w:62, h:24}, clash = e.uid !== M.hooked && tl.some(o => lr.x < o.x + o.w && o.x < lr.x + lr.w && lr.y < o.y + o.h && o.y < lr.y + lr.h);
    if (clash){ ctx.globalAlpha = 1; continue; } tl.push(lr);
    ctx.font = `600 10.5px ${P.mono}`; ctx.fillText(k.num, q[0] + 9, q[1] - 5);
    ctx.font = `10px ${P.mono}`; ctx.fillStyle = P.dim;
    const altTxt = e.ball ? (e.z.toFixed(0) + 'K') : (e.z < 1 ? Math.round(e.z * 3281) + 'FT' : 'FL' + pad(Math.round(e.z * 32.81), 3));
    ctx.fillText(`${k.cls ? (e.clsLbl || '') : '···'} ${altTxt}${e.stat ? ' ' + e.stat : ''}`, q[0] + 9, q[1] + 7);
    if (k.hold){ ctx.fillStyle = P.cyan; ctx.fillText('HF', q[0] - 22, q[1] + 3); }
    if (e.uid === M.hooked){ ctx.strokeStyle = P.text; ctx.lineWidth = 1.2; const b = 12; ctx.beginPath(); ctx.moveTo(q[0] - b, q[1] - b + 4); ctx.lineTo(q[0] - b, q[1] - b); ctx.lineTo(q[0] - b + 4, q[1] - b); ctx.moveTo(q[0] + b - 4, q[1] - b); ctx.lineTo(q[0] + b, q[1] - b); ctx.lineTo(q[0] + b, q[1] - b + 4); ctx.moveTo(q[0] + b, q[1] + b - 4); ctx.lineTo(q[0] + b, q[1] + b); ctx.lineTo(q[0] + b - 4, q[1] + b); ctx.moveTo(q[0] - b + 4, q[1] + b); ctx.lineTo(q[0] - b, q[1] + b); ctx.lineTo(q[0] - b, q[1] + b - 4); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.globalAlpha = 1;
  }
  for (const m of M.ms || []){
    const q = proj(v, m.x, m.y, m.z), mc = m.owner === 'cuas' ? P.green : m.tier === 'UT' ? P.amber : m.own ? P.red : P.violet;
    if (m.trail && m.trail.length > 1){ ctx.beginPath(); m.trail.forEach((t, i) => { const tq = proj(v, t[0], t[1], t[2]); i ? ctx.lineTo(tq[0], tq[1]) : ctx.moveTo(tq[0], tq[1]); }); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = mc; ctx.globalAlpha = .55; ctx.stroke(); ctx.globalAlpha = 1; }
    gl(m.own ? '#fff' : mc, 10); ctx.fillStyle = m.own && m.tier !== 'UT' ? '#fff' : mc; ctx.beginPath(); ctx.arc(q[0], q[1], 2.3, 0, 7); ctx.fill(); ng();
  }
  for (const fx of M.fx || []){
    const age = (now - fx.t0) / fx.dur; if (age < 0 || age > 1) continue;
    const q = proj(v, fx.x, fx.y, fx.z || 0), col = fx.k === 'kill' ? '#fff' : fx.k === 'impact' || fx.k === 'bloom' || fx.k === 'cluster' ? (fx.harmless ? P.dim : P.red) : fx.k === 'launch' || fx.k === 'ka' ? P.amber : P.dim;
    if (fx.k === 'cluster'){ ctx.fillStyle = P.red; for (let i = 0; i < 24; i++){ const an = i / 24 * Math.PI * 2 + i, rr = 3 + age * (10 + (i % 5) * 6); ctx.globalAlpha = (1 - age) * .9; ctx.fillRect(q[0] + Math.cos(an) * rr - 1, q[1] + Math.sin(an) * rr - 1, 2, 2); } ctx.globalAlpha = 1; continue; }
    if (fx.k === 'bloom'){ const R = (fx.r || 5) * v.s; gl(col, 16); ctx.strokeStyle = col; ctx.globalAlpha = (1 - age) * .9; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], R * (.3 + .7 * age), 0, 7); ctx.stroke(); ctx.lineWidth = 1; ctx.fillStyle = col; for (let i = 0; i < 30; i++){ const an = i * 2.39996, rr = R * Math.sqrt((i + .5) / 30); ctx.globalAlpha = (1 - age) * .8; ctx.fillRect(q[0] + Math.cos(an) * rr - 1.5, q[1] + Math.sin(an) * rr - 1.5, 3, 3); } ng(); ctx.globalAlpha = 1; continue; }
    if (fx.k === 'ka'){ ctx.strokeStyle = col; ctx.globalAlpha = 1 - age; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(q[0], q[1], 9 + age * 8, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = `600 10px ${P.mono}`; ctx.fillText('KILL ASSESSMENT UNCERTAIN', q[0] + 14, q[1] + 16); ctx.globalAlpha = 1; continue; }
    gl(col, 14); ctx.strokeStyle = col; ctx.globalAlpha = 1 - age; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], 3 + age * (fx.k === 'impact' ? 26 : 16), 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    if (fx.k === 'kill' || fx.k === 'impact'){ ctx.fillStyle = col; ctx.globalAlpha = (1 - age) * .7; ctx.beginPath(); ctx.arc(q[0], q[1], 5 * (1 - age) + 1, 0, 7); ctx.fill(); }
    ng(); ctx.globalAlpha = 1;
  }
  if (M.cursor){ const c = M.cursor; ctx.strokeStyle = P.text; ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(c.px - 9, c.py); ctx.lineTo(c.px - 3, c.py); ctx.moveTo(c.px + 3, c.py); ctx.lineTo(c.px + 9, c.py); ctx.moveTo(c.px, c.py - 9); ctx.lineTo(c.px, c.py - 3); ctx.moveTo(c.px, c.py + 3); ctx.lineTo(c.px, c.py + 9); ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.restore();
  return hits;
}
function drawScope(ctx, v, M, now){ drawBase(ctx, v, M); return drawLive(ctx, v, M, now, false); }

function sizeCanvas(cv){
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
  return {W:r.width, H:r.height, dpr};
}

// ---------- title animation ----------
let titleRAF = 0;
function titleAnim(){
  const cv = $('#titleCanvas'); if (!cv || $('#scr-title').hidden){ titleRAF = 0; return; }
  const {W, H:Hh, dpr} = sizeCanvas(cv), ctx = cv.getContext('2d'), P = pal(), t = performance.now() / 1000;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, Hh);
  const cx = W * .78, cy = Hh * .62, R = Math.max(W, Hh) * .62;
  ctx.strokeStyle = P.line2; for (let r = R / 5; r <= R; r += R / 5){ ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
  const a0 = -Math.PI / 2 - .9, a1 = -Math.PI / 2 + .9;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath(); ctx.fillStyle = P.legacy ? 'rgba(80,255,120,.05)' : 'rgba(82,205,224,.05)'; ctx.fill();
  const sw = a0 + ((t * .5) % 1) * (a1 - a0); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R); ctx.strokeStyle = P.cyan; ctx.globalAlpha = .5; ctx.stroke(); ctx.globalAlpha = 1;
  for (let i = 0; i < 9; i++){
    const ph = (t * .05 + i * .137) % 1, ang = a0 + .15 + ((i * 37) % 100) / 100 * (a1 - a0 - .3), rr = R * (1 - ph * .9), x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
    const hostile = i % 3 !== 0; ctx.strokeStyle = hostile ? P.red : P.cyan; ctx.lineWidth = 1.6; ctx.beginPath();
    if (hostile){ ctx.moveTo(x - 7, y); ctx.lineTo(x, y - 7); ctx.lineTo(x + 7, y); } else ctx.arc(x, y, 7, Math.PI, 0);
    ctx.stroke(); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(ang) * 30, y - Math.sin(ang) * 30); ctx.stroke();
    ctx.fillStyle = P.dim; ctx.font = `10px ${P.mono}`; ctx.fillText(String(1040 + i * 7), x + 9, y - 6);
  }
  titleRAF = requestAnimationFrame(titleAnim);
}

// ---------- menu ----------
let menuTab = 'TRN';
function openMenu(tab){
  if (tab) menuTab = tab;
  show('menu'); AU.stopAmb();
  const cb = $('#certBadge'); cb.textContent = store.p.cert ? 'CERTIFIED · TABLE VIII' : 'NOT CERTIFIED'; cb.classList.toggle('cert', store.p.cert);
  $$('#menuTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === menuTab));
  const body = $('#menuBody');
  if (menuTab === 'CAMP'){ body.innerHTML = campMenuHtml(); body.querySelectorAll('[data-camp]').forEach(b => b.onclick = () => campStart(b.dataset.camp, b.dataset.new === '1')); return; }
  const list = SCN.filter(s => s.theater === menuTab);
  const intro = menuTab === 'TRN' ? 'Ten crew drill tables at McGregor Range. Each must be passed to open the next. Table VIII certifies your crew, unlocks the campaign and the legacy console. Tables IX and X teach the THAAD upper tier and open after Table V.'
    : menuTab === 'ME' ? 'Gulf and Levant, 2019 to 2026. Ballistic salvos from Iran, drone swarms, cluster warheads and a THAAD upper tier. The 2025 and 2026 battles are calibrated to the record: perfect play still loses some.'
    : 'NATO’s eastern flank and Ukraine. Kinzhal and Kalibr, decoys and jammers, anti-radiation missiles and recon drones that call in Iskanders.';
  body.innerHTML = `<p class="mintro">${intro}</p><div class="scn-grid">${list.map((s, i) => {
    const locked = s.table && s.table > 1 && !store.p.tables[tableReq(s.table)] && !store.s.unlockAll;
    const best = store.p.best[s.id];
    const passed = s.table && store.p.tables[s.table];
    return `<button type="button" class="scn${locked ? ' locked' : ''}" data-id="${s.id}" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="st${passed ? ' pass' : ''}">${passed ? 'PASSED' : best != null ? 'BEST ' + best : locked ? 'LOCKED' : ''}</span>
      <span class="tag">${s.table ? 'TABLE ' + ROMAN[s.table] : s.endgame ? 'ENDGAME · SEEDED' : THEATERS[s.theater].toUpperCase()}</span>
      <span class="n">${esc(s.table ? s.name.split('· ')[1] : s.name)}</span>
      <span class="pl">${esc(s.place)}</span>
      ${s.inspired ? `<span class="in">${esc(s.inspired)}</span>` : ''}
      <span class="sh">${esc(s.short)}</span></button>`; }).join('')}</div>`;
  body.querySelectorAll('.scn').forEach(b => b.onclick = () => { if (b.classList.contains('locked')) return; openBrief(byId(b.dataset.id)); });
}

// ---------- briefing ----------
let BR = null;
function randSeed(){ return 100000 + Math.floor(Math.random() * 899999); }
function openBrief(scn, camp){
  AU.init();
  BR = {scn, site:0, ptl:scn.ptl, mode:scn.mode, doctrine:{TBM:'RIPPLE', AIR:'SLS', UAV:scn.cuas ? 'CUAS' : 'SINGLE', THAAD:'SLS', LAYER:'WAIT'}, seat:scn.seat || 'PAT', seed:randSeed(), camp:camp || null, view:null};
  show('brief');
  const W = s => s.split(' ');
  const ld = scn.launchers.map((L, i) => `<span>LS${i + 1} ${L[0] === 'MSE' ? L[1] + '× MSE' : L[0] === 'GEMT' ? L[2] + '× GEM-T' : L[1] + '× MSE + ' + L[2] + '× GEM-T'}</span>`).join('') + `<span>RESERVE ${scn.reserve.MSE} MSE · ${scn.reserve.GEMT} GEM-T</span>`
    + (scn.thaad ? `<span class="ut">THAAD ${scn.thaad.launchers || 6} LAUNCHERS × ${scn.thaad.rounds || 8}${scn.reserve.THAAD ? ' · RESERVE ' + scn.reserve.THAAD : ''}</span>` : '') + (scn.cuas || []).map(c => `<span class="cu">${esc(c.name)} · ${c.type === 'GUN' ? 'GUN' : c.n + ' COYOTE'}</span>`).join('');
  const redOn = store.s.red !== 'scripted' && !scn.tutorial, redPlan = redOn ? H.planRed({scn}, store.d.red || {}) : [];
  const nb = (store.d.red && store.d.red.battles) || 0;
  const redNote = redOn ? `<h3>Red commander</h3><p class="coach-brief red"><b>${nb ? `Red has studied ${nb} of your battle${nb > 1 ? 's' : ''}.` : 'Red has not fought you yet.'}</b> Intelligence expects: ${redPlan.map(t => esc(t.hint)).join(' ')}</p>` : '';
  BR.tca = store.s.tca || 'alvarez';
  const fatOf = id => camp ? ((camp.fatigue || {})[id] || 0) : 0;
  const campNote = camp ? `<p class="coach-brief">Campaign: launchers load from your stock (${camp.stock.MSE} MSE, ${camp.stock.GEMT} GEM-T${camp.stock.THAAD != null ? ', ' + camp.stock.THAAD + ' THAAD' : ''}). What you do not fire carries to the next battle.</p>` : '';
  const tb = scn.tutorial && scn.tutorial.table, locked = !!scn.lockEmplace;
  const tutNote = tb ? `<h3>How this table passes</h3><ul class="objs" id="bObj"></ul>${tb === 1 ? '<p class="coach-brief">Drag on the map to swing the PTL. Click a site button to move the battery. The checklist updates as you go.</p>' : ''}` : '';
  const lockNote = locked ? `<p class="coach-brief">Range control has emplaced you at ${esc(scn.sites[0].name.split('· ')[1] || 'Site A')}, PTL ${pad(scn.ptl, 3)}°. Emplacement is fixed for this table.</p>` : '';
  $('#briefBody').innerHTML = `<div class="brief-wrap">
   <div>
     <button class="btn sm" type="button" id="bBack">← Back</button>
     <div class="eyebrow" style="margin-top:14px">${scn.table ? 'CREW DRILL · TABLE ' + ROMAN[scn.table] : THEATERS[scn.theater].toUpperCase() + ' · ' + esc(scn.bty)}</div>
     <h2>${esc(scn.table ? scn.name.split('· ')[1] : scn.name)}</h2>
     <div class="pl">${esc(scn.place)}</div>
     ${scn.inspired ? `<div class="insp">${esc(scn.inspired)}</div>` : ''}
     ${scn.real ? `<p class="coach-brief real"><b>The record.</b> ${esc(scn.real)} Perfect play still loses some.</p>` : ''}
     <h3>Situation</h3>${scn.brief.map(p => `<p>${esc(p)}</p>`).join('')}
     <h3>Intelligence</h3><ul class="intel">${scn.intel.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
     <h3>Defended Asset List</h3>
     <table class="dal"><thead><tr><th>PRI</th><th>ASSET</th><th>BRG / RNG FROM SITE</th></tr></thead><tbody id="bDal"></tbody></table>
     <h3>Rules of engagement</h3>
     <div class="roe"><span>ADW <b class="chip c-${scn.adw}">${scn.adw}</b></span><span>WCS <b class="chip c-${scn.wcs}">${scn.wcs}</b></span><span>TD <b>${esc(scn.td)}</b></span><span>CALL SIGN <b>${esc(scn.bty)}</b></span></div>
     <h3>Load-out</h3><div class="loadout">${ld}</div>
     ${campNote}
     ${redNote}
   </div>
   <div>
     <h3 style="margin-top:0">Emplacement</h3>
     ${lockNote}<div class="sites" id="bSites" ${locked ? 'hidden' : ''}>${scn.sites.map((s, i) => `<button type="button" class="tbtn${i === 0 ? ' on' : ''}" data-i="${i}">${esc(s.name)}</button>`).join('')}</div>
     <div class="mapbox" id="bMapBox"><canvas id="bMap"></canvas><div class="maphint">${locked ? 'EMPLACEMENT SET BY RANGE CONTROL' : 'DRAG TO SET PTL'}</div></div>
     <div class="cov" id="bCov"></div>
     ${tutNote}
     <h3>Crew settings</h3>
     <div class="opts">
       <label>MODE</label><div class="seg" id="bMode">${['MANUAL','SEMI','AUTO'].map(m => `<button type="button" data-v="${m}" class="${m === BR.mode ? 'on' : ''} m-${m}">${m === 'MANUAL' ? 'MANUAL' : m === 'SEMI' ? 'SEMIAUTO' : 'AUTO'}</button>`).join('')}</div>
       <label>TBM DOCTRINE</label><div class="seg" data-doc="TBM">${['SINGLE','RIPPLE','SLS'].map(m => `<button type="button" data-v="${m}" class="${m === 'RIPPLE' ? 'on' : ''}">${m === 'SLS' ? 'SHOOT-LOOK-SHOOT' : m}</button>`).join('')}</div>
       <label>AIR DOCTRINE</label><div class="seg" data-doc="AIR">${['SINGLE','RIPPLE','SLS'].map(m => `<button type="button" data-v="${m}" class="${m === 'SLS' ? 'on' : ''}">${m === 'SLS' ? 'SHOOT-LOOK-SHOOT' : m}</button>`).join('')}</div>
       <label>DRONE DOCTRINE</label><div class="seg" data-doc="UAV">${['SINGLE','RIPPLE','SLS'].concat(scn.cuas ? ['CUAS'] : []).map(m => `<button type="button" data-v="${m}" class="${m === BR.doctrine.UAV ? 'on' : ''}">${m === 'SLS' ? 'SHOOT-LOOK-SHOOT' : m === 'CUAS' ? 'LEAVE TO C-UAS' : m}</button>`).join('')}</div>
       ${scn.thaad ? `<label>SEAT</label><div class="seg" id="bSeat">${[['PAT','PATRIOT ECS'],['THAAD','THAAD FIRE CONTROL']].map(x => `<button type="button" data-v="${x[0]}" class="${x[0] === BR.seat ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
       <label>THAAD DOCTRINE</label><div class="seg" data-doc="THAAD">${['SINGLE','RIPPLE','SLS'].map(m => `<button type="button" data-v="${m}" class="${m === 'SLS' ? 'on' : ''}">${m === 'SLS' ? 'SHOOT-LOOK-SHOOT' : m}</button>`).join('')}</div>
       <label>LAYER</label><div class="seg" data-doc="LAYER">${[['WAIT','WAIT FOR THAAD'],['CONC','CONCURRENT']].map(x => `<button type="button" data-v="${x[0]}" class="${x[0] === 'WAIT' ? 'on' : ''}">${x[1]}</button>`).join('')}</div>` : ''}
       <label>TCA</label><div><div class="seg" id="bCrew">${H.CREW.map(c => `<button type="button" data-v="${c.id}" class="${c.id === BR.tca ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div><div class="eyebrow" id="bCrewNote" style="letter-spacing:.04em;margin-top:6px"></div></div>
       <label>SEED</label><div><input class="seedin" id="bSeed" type="text" inputmode="numeric" value="${BR.seed}" aria-label="Raid seed"> <span class="eyebrow" style="letter-spacing:.06em">Same seed, same raid</span></div>
     </div>
     <div class="go"><button class="btn primary big" type="button" id="bGo">Take the watch</button></div>
   </div></div>`;
  $('#bBack').onclick = () => camp ? campScreen() : openMenu();
  $('#bSites').querySelectorAll('button').forEach(b => b.onclick = () => { BR.site = +b.dataset.i; $('#bSites').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); briefDraw(); });
  $('#bMode').querySelectorAll('button').forEach(b => b.onclick = () => { BR.mode = b.dataset.v; $('#bMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  if ($('#bSeat')) $('#bSeat').querySelectorAll('button').forEach(b => b.onclick = () => { BR.seat = b.dataset.v; $('#bSeat').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); briefDraw(); });
  $$('[data-doc]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { BR.doctrine[g.dataset.doc] = b.dataset.v; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }));
  const crewNote = () => { const c = H.CREW.find(x => x.id === BR.tca), f = fatOf(c.id); $('#bCrewNote').textContent = `${c.note} Skill ${Math.round(c.skill * 100)}.${f ? ' Fatigue ' + Math.round(f * 100) + '%.' : ''}`; };
  crewNote();
  $('#bCrew').querySelectorAll('button').forEach(b => b.onclick = () => { BR.tca = b.dataset.v; store.s.tca = BR.tca; store.save(); $('#bCrew').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); crewNote(); });
  $('#bGo').onclick = () => { const sv = parseInt($('#bSeed').value, 10); if (sv > 0) BR.seed = sv; startBattle(); };
  const cv = $('#bMap');
  const setFrom = ev => { const r = cv.getBoundingClientRect(), w = unproj(BR.view, ev.clientX - r.left, ev.clientY - r.top), s = scn.sites[BR.site]; BR.ptl = Math.round(H.brgOf(w.x - s.x, w.y - s.y)); briefDraw(); };
  let drag = false;
  cv.onpointerdown = ev => { if (scn.lockEmplace) return; drag = true; cv.setPointerCapture(ev.pointerId); setFrom(ev); };
  cv.onpointermove = ev => { if (drag) setFrom(ev); };
  cv.onpointerup = cv.onpointercancel = () => { drag = false; };
  requestAnimationFrame(briefDraw);
}
function briefDraw(){
  if (!BR || UI.screen !== 'brief') return;
  const scn = BR.scn, cv = $('#bMap'), {W, H:Hh, dpr} = sizeCanvas(cv), ctx = cv.getContext('2d'), s = scn.sites[BR.site];
  const ext = Math.max(60, ...scn.assets.map(a => Math.hypot(a.x - s.x, a.y - s.y) * 1.35));
  const scale = Math.min(W, Hh) / 2 / Math.min(175, Math.max(ext, 120));
  BR.view = {cx:s.x, cy:s.y, s:scale, W, H:Hh, tilt:false};
  const cov = H.coverage(scn, s, BR.ptl), covMap = {}; cov.assets.forEach(x => covMap[x.a.id] = x.ok);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScope(ctx, BR.view, {mapKey:scn.map, bat:{x:s.x, y:s.y, ptl:BR.ptl, on:true}, ptlPreview:BR.ptl, assets:scn.assets.map(a => ({...a, hpMax:a.hp, hp:a.hp})), ents:[], neighbors:(scn.neighbors || []).map(n => ({...n, on:true})), sites:scn.sites, siteSel:BR.site, axis:scn.axis, cov:covMap, labelsAlways:true, bty:scn.bty.split(' ')[0],
    thaad:scn.thaad ? {...scn.thaad, half:scn.thaad.half || 60, alive:true} : null, cuas:scn.cuas || [], seat:BR.seat}, 0);
  $('#bDal').innerHTML = scn.assets.map(a => { const c = cov.assets.find(x => x.a.id === a.id); return `<tr><td class="p">${a.pri}</td><td>${esc(a.name)}</td><td class="p">${pad(Math.round(c.b), 3)}° / ${c.d.toFixed(1)} km</td></tr>`; }).join('');
  const lines = [`<span class="${cov.assets.every(x => x.ok) ? 'ok' : 'no'}">ASSETS IN SECTOR ${cov.assets.filter(x => x.ok).length}/${cov.assets.length}</span>`];
  cov.axis.forEach(x => lines.push(`<span class="${x.ok ? (x.reach < 30 ? 'warn' : 'ok') : 'no'}">THREAT AXIS ${pad(x.b, 3)}° ${x.ok ? 'COVERED' : 'OUTSIDE FAN'} · LOW-ALT REACH ${Math.round(x.reach)} km${x.reach < 30 ? ' · MASKED' : ''}</span>`));
  lines.push(`<span>PTL ${pad(BR.ptl, 3)}° · SECTOR ${pad((BR.ptl + 300) % 360, 3)}°–${pad((BR.ptl + 60) % 360, 3)}°</span>`);
  $('#bCov').innerHTML = lines.join('');
  const bo = $('#bObj'); if (bo && scn.tutorial){ const r = HT_TRAIN.evaluate(scn.tutorial.table, null, {cover:cov}); bo.innerHTML = r.map(o => `<li class="${o.ok ? 'ok' : ''}"><i>${o.ok ? '✓' : '○'}</i><span>${esc(o.t)}</span></li>`).join(''); }
}

// ---------- battle ----------
let S = null, B = null, rafId = 0;
function startBattle(){
  const scn = BR.scn;
  const o = {seed:BR.seed, site:BR.site, ptl:BR.ptl, mode:BR.mode, doctrine:{...BR.doctrine}, difficulty:store.s.diff, seat:BR.seat,
    red:store.s.red !== 'scripted' && !scn.tutorial ? (store.d.red || {}) : null,
    tca:{id:BR.tca || store.s.tca, fatigue:BR.camp ? ((BR.camp.fatigue || {})[BR.tca] || 0) : 0, delegate:{...(store.s.delegate || {})}}};
  if (BR.camp){ o.stock = {...BR.camp.stock}; o.xp = BR.camp.xp; }
  launchBattle(H.createSim(scn, o), {camp:BR.camp, brief:{...BR}});
}
function launchBattle(sim, ctx){
  S = sim; const scn = S.scn;
  B = {view:{cx:S.bat.x, cy:S.bat.y, s:2.2, W:100, H:100, tilt:false}, hooked:null, hits:[], hist:{}, trails:{}, fx:[], scars:[], speed:store.s.speed || 1, acc:0, last:performance.now(), logN:0, panelT:0, wpn:'AUTO', cardFor:null, coach:null, sheet:'', toastT:0, camp:ctx.camp, brief:ctx.brief, idLog:{}, rewound:S.rewoundAt != null, page:'trk', h:{}, video:store.s.video || 'MIX', stunUntil:0};
  B.wpn = S.seat === 'THAAD' ? 'THAAD' : 'AUTO';
  if (!B.rewound){ store.p.plays++; store.save(); }
  $('#sysPage').innerHTML = '<div id="sysLive"></div>' + MANUAL();
  show('battle');
  const bt = $('#scr-battle'); bt.dataset.sheet = '';
  $('#log').innerHTML = '';
  $('#sDisp').hidden = !scn.displace;
  if (B.rewound){ B.coach = null; $('#coach').hidden = true; B.U = {hooked:{kinds:new Set(), ent:null}}; } else setupCoach();
  AU.init(); AU.startAmb();
  VO.stop();
  fitView(); setPage('trk'); renderLaunchers(true); updatePanels(true);
  if (B.rewound){ B.speed = 0; toast('REWIND', `You have the seat at T+${fmtT(S.t)}. The clock is stopped: press 1× to fight on.`); }
  cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop);
}
function fitView(){
  const cv = $('#scope'); const r = cv.getBoundingClientRect(); const m = Math.min(r.width, r.height);
  if (S.seat === 'THAAD' && S.thaad){ B.view.s = Math.max(.2, m / 2 / 380); const c = H.polar(S.thaad.ptl, 230, S.thaad); B.view.cx = c.x; B.view.cy = c.y; return; }
  B.view.s = Math.max(.6, m / 2 / 120); B.view.cx = S.bat.x + H.polar(S.bat.ptl, 50).x; B.view.cy = S.bat.y + H.polar(S.bat.ptl, 50).y;
}

function loop(now){
  if (!S || UI.screen !== 'battle'){ rafId = 0; return; }
  const dt = Math.min(.25, (now - B.last) / 1000); B.last = now;
  if (B.speed > 0 && !S.ended){
    B.acc += dt * B.speed; let n = 0;
    while (B.acc >= H.DT && n < 240 && !S.ended){ H.step(S); B.acc -= H.DT; n++; sampleHist(); }
  }
  drain(now);
  const cv = $('#scope'), {W, H:Hh, dpr} = sizeCanvas(cv), ctx = cv.getContext('2d');
  B.view.W = W; B.view.H = Hh;
  const M = liveModel(now); M.cursor = B.cursor;
  if (!B.baseCv){ B.baseCv = document.createElement('canvas'); B.clutter = []; }
  if (B.baseCv.width !== cv.width || B.baseCv.height !== cv.height){ B.baseCv.width = cv.width; B.baseCv.height = cv.height; B.baseKey = ''; }
  const v = B.view, P = pal();
  const key = [terrVer, v.cx.toFixed(2), v.cy.toFixed(2), v.s.toFixed(3), v.tilt, cv.width, cv.height, M.bat.ptl, M.bat.half, M.bat.x, M.bat.y, M.bat.on, M.bat.alive, S.assets.map(a => a.hp).join(), S.launchers.map(L => L.dead ? 1 : 0).join(''), S.neighbors.map(n => n.on ? 1 : 0).join(''), B.scars.length, P.legacy, S.thaad ? S.thaad.alive : '', S.seat].join('|');
  if (key !== B.baseKey){ B.baseKey = key; const bctx = B.baseCv.getContext('2d'); bctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawBase(bctx, v, M); }
  M.clutter = B.clutter;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(B.baseCv, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  B.hits = drawLive(ctx, v, M, now, true);
  B.fx = B.fx.filter(f => now - f.t0 < f.dur);
  if (now - B.panelT > 150){ B.panelT = now; updatePanels(); coachTick(); }
  if (S.ended && !B.endShown){ B.endShown = true; setTimeout(endBattle, 1600); }
  rafId = requestAnimationFrame(loop);
}
function sampleHist(){
  const k = Math.floor(S.t / 4); if (k === B.histK) return; B.histK = k;
  for (const e of S.ents){ if (!e.alive || !e.trk || !e.trk.est) continue; const h = B.hist[e.uid] || (B.hist[e.uid] = []); h.push([e.x, e.y, e.z]); if (h.length > 6) h.shift(); }
  for (const m of S.ms){ if (!m.alive) continue; }
}
function liveModel(now){
  const ents = [];
  for (const e of S.ents){
    if (!e.alive) continue;
    const o = {uid:e.uid, x:e.x, y:e.y, z:e.z, vx:e.vx, vy:e.vy, vz:e.vz || 0, kind:e.kind, truth:e.truth, trk:e.trk && e.trk.est ? e.trk : null, ball:!!e.T.ballistic, clsLbl:e.T.cls, hist:B.hist[e.uid],
      raw:!!e.trk && !e.trk.remote && H.radarOn(S), rcs:e.T.rcs, released:!!e.released, clr:e.T.cluster ? e.T.cluster.r : 0, tpy:!!(e.trk && e.trk.tpy), ownTrk:!!(e.trk && !e.trk.remote)};
    if (o.trk && o.ball){ const a = H.assess(S, e); o.impact = a.impact; o.dal = a.dal; }
    if (o.trk){ const p = H.activePlan(S, e); if (p) o.stat = (p.tier === 'UT' ? 'UT ' : '') + (p.state === 'VETO' ? 'VETO' : p.state === 'GUIDING' ? 'ENG' : p.state === 'WAIT' ? 'PLN' : 'ENG'); }
    ents.push(o);
  }
  const ms = [];
  for (const m of S.ms){ if (!m.alive) continue; const tr = B.trails[m.id] || (B.trails[m.id] = []); const last = tr[tr.length - 1]; if (!last || Math.hypot(last[0] - m.x, last[1] - m.y) > .8) { tr.push([m.x, m.y, m.z]); if (tr.length > 40) tr.shift(); } ms.push({x:m.x, y:m.y, z:m.z, own:m.owner === 'own', owner:m.owner, tier:m.tier, aim:m.aim, trail:tr}); }
  return {mapKey:S.scn.map, bat:{x:S.bat.x, y:S.bat.y, ptl:S.bat.ptl, half:S.bat.half, on:H.radarOn(S), alive:S.bat.alive}, launchers:S.launchers, assets:S.assets, ents, ms, fx:B.fx, scars:B.scars, neighbors:S.neighbors, jammers:S.ents.filter(e => e.alive && e.kind === 'JAM'), hooked:B.hooked, bty:S.scn.bty.split(' ')[0],
    thaad:S.thaad, cuas:S.cuas, sbw:S.sbw.filter(a => a.on && a.cx != null), seat:S.seat, video:B.video, sym:store.s.sym, scan:store.s.scan || 'CLEAN', scanS:B.scanS || (B.scanS = {k:0, last:0, acc:0, beams:[]})};
}
function drain(now){
  for (const o of S.out){
    if (o.k === 'say'){ VO.say(o.who, o.text, o.pri); if (o.who === 'TD') toast(S.scn.td, o.text); }
    else if (o.k === 'tone') AU.tone(o.v);
    else if (o.k === 'kill') B.fx.push({k:'kill', x:o.x, y:o.y, z:o.z, t0:now, dur:1200});
    else if (o.k === 'miss' || o.k === 'destruct') B.fx.push({k:'miss', x:o.x, y:o.y, z:o.z, t0:now, dur:700});
    else if (o.k === 'impact'){ B.fx.push({k:'impact', x:o.x, y:o.y, z:0, t0:now, dur:1800, harmless:o.harmless}); B.scars.push({x:o.x, y:o.y, harmless:o.harmless}); }
    else if (o.k === 'launch') B.fx.push({k:'launch', x:o.x, y:o.y, z:0, t0:now, dur:600});
    else if (o.k === 'banner') banner(o.text);
    else if (o.k === 'cluster') B.fx.push({k:'cluster', x:o.x, y:o.y, z:o.z, t0:now, dur:2400});
    else if (o.k === 'bloom'){ B.fx.push({k:'bloom', x:o.x, y:o.y, z:0, r:o.r, t0:now, dur:2600, harmless:o.harmless}); B.scars.push({x:o.x, y:o.y, harmless:o.harmless}); }
    else if (o.k === 'ka') B.fx.push({k:'ka', x:o.x, y:o.y, z:o.z, t0:now, dur:2600});
    else if (o.k === 'shake'){ const w = $('#scopeWrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); B.stunUntil = now + 1800; const d = $('#dustFx'); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); }
  }
  S.out.length = 0;
}
function toast(who, text){ const t = $('#toast'); t.innerHTML = `<b>${esc(who)}</b> · ${esc(text)}`; t.hidden = false; t.style.opacity = 1; clearTimeout(B.toastT); B.toastT = setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.hidden = true, 400); }, 6500); }

const hookedEnt = () => B && B.hooked ? S.ents.find(e => e.uid === B.hooked && e.alive && e.trk && e.trk.est) : null;
function hook(uid){ B.hooked = uid; AU.tone('click'); if (uid && B.U){ const e = S.ents.find(x => x.uid === uid); if (e) B.U.hooked.kinds.add(e.kind); } updatePanels(true); if (window.matchMedia('(max-width:820px)').matches && uid && !B.sheet) setSheet('side'); }

function updatePanels(force){
  if (!S) return;
  const q = H.threatQueue(S);
  $$('#sADW i').forEach(i => i.classList.toggle('on', i.dataset.v === S.adw));
  $$('#sWCS i').forEach(i => i.classList.toggle('on', i.dataset.v === S.wcs));
  $('#sCF').hidden = !(S.t < S.ceaseUntil);
  $$('#sMode button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
  $('#sEmcon').classList.toggle('on', S.bat.emcon);
  $('#sPtl').textContent = 'PTL ' + pad(Math.round(S.bat.ptl) % 360, 3);
  $$('#sSpeed button').forEach(b => b.classList.toggle('on', +b.dataset.s === B.speed));
  let hos = 0, unk = 0; for (const e of S.ents) if (e.alive && e.trk && e.trk.est){ if (e.trk.id === 'HOS') hos++; else if (e.trk.id === 'UNK' || e.trk.id === 'PND') unk++; }
  $('#sHos').textContent = hos; $('#sUnk').textContent = unk;
  $('#sMse').textContent = H.rounds(S, 'MSE', false); $('#sGem').textContent = H.rounds(S, 'GEMT', false);
  $('#sTh').hidden = $('#sThL').hidden = !S.thaad; if (S.thaad) $('#sTh').textContent = H.rounds(S, 'THAAD', false);
  const sb = $('#sSeat'); sb.hidden = !S.thaad; sb.textContent = S.seat === 'THAAD' ? 'THAAD SEAT' : 'PATRIOT SEAT'; sb.classList.toggle('ut', S.seat === 'THAAD');
  const lamp = (k, st) => { const i = $(`#sSys [data-k="${k}"]`); if (i){ i.className = st; } };
  lamp('RAD', !S.bat.alive || S.bat.epp ? 'bad' : S.bat.radarFault || S.bat.emcon || S.bat.reorient > 0 || S.bat.displace > 0 ? 'warn' : 'ok');
  const tl = $('#sSys [data-k="TPY"]'); tl.hidden = !S.thaad; if (S.thaad) lamp('TPY', !S.thaad.alive ? 'bad' : S.thaad.emcon ? 'warn' : 'ok');
  lamp('COM', S.comms ? 'ok' : 'bad'); lamp('PWR', S.bat.epp ? 'bad' : 'ok'); lamp('MOPP', S.mopp >= 4 ? 'warn' : '');
  document.body.classList.toggle('emerg', !!S.bat.epp);
  $('#moppFx').hidden = !(S.mopp >= 4); $('#netDown').hidden = S.comms; $('#dispFz').hidden = !S.dispFault || B.page === 'sys';
  $('#scr-battle').classList.toggle('frozen-side', !!S.dispFault && B.page !== 'sys');
  const he = hookedEnt(); $('#swEng').disabled = !he || !B.guard; $('#swGuard').classList.toggle('up', !!B.guard); $('#swCuas').disabled = !he || !S.cuas.some(c => c.type === 'COY' && c.left > 0) || he.T.cls !== 'UAV';
  $('#swPtt').classList.toggle('pend', S.acks.some(a => !a.done));
  $('#sClock').textContent = 'T+' + fmtT(S.t);
  const d = new Date(Date.UTC(2026, 0, 1, 19, 40) + S.t * 1000 * 4); $('#sZulu').textContent = pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z · ' + S.scn.bty;
  const rs = $('#radarState'); const b = S.bat;
  const rtxt = B.coach && B.coach.held ? 'COACH · CLOCK STOPPED' : !b.alive ? 'RADAR DESTROYED' : b.displace > 0 ? `MARCH ORDER · ${Math.ceil(b.displace)} s` : b.reorient > 0 ? `REORIENTING · ${Math.ceil(b.reorient)} s` : b.epp > 0 ? 'POWER FAULT' : b.emcon ? 'EMCON · RADAR SILENT' : '';
  rs.hidden = !rtxt; rs.textContent = rtxt;
  let cur = ''; if (B.cursor && !B.view.tilt){ const w = unproj(B.view, B.cursor.px, B.cursor.py); cur = ` · CURSOR ${pad(Math.round(H.brgOf(w.x - S.bat.x, w.y - S.bat.y)) % 360, 3)}° ${Math.hypot(w.x - S.bat.x, w.y - S.bat.y).toFixed(1)} KM`; }
  $('#scopeInfo').textContent = `${B.view.tilt ? '3D' : 'PLAN'} · ${(B.view.W / B.view.s).toFixed(0)} KM ACROSS${cur}`;
  // log
  const lg = $('#log');
  while (B.logN < S.log.length){
    const L = S.log[B.logN++], li = document.createElement('li');
    li.className = (L.cls || '') + ' w-' + L.who;
    li.innerHTML = `<span class="tm">${fmtT(L.t)}</span>${L.cls === 'sys' ? '' : `<span class="who">${esc(L.who)}</span>`}${esc(L.text)}`;
    lg.appendChild(li); if (lg.children.length > 120) lg.firstChild.remove();
    lg.scrollTop = lg.scrollHeight;
  }
  const pend = S.acks.some(a => !a.done); $('#btnAck').classList.toggle('pend', pend);
  const rt = $('#ptabs [data-p="radio"]'); if (rt) rt.classList.toggle('dot', pend);
  $('#sRadio').classList.toggle('on', pend);
  if (!(S.dispFault && B.page !== 'sys')){ renderQueue(S.seat === 'THAAD' ? q.filter(x => x.e.T.ballistic) : q); renderCard(); drawDiag(); }
  renderLaunchers();
  const rf = Math.round(S.radar.searchF * (S.bat.half < 60 ? 125 : 100) * (S.bat.radarFault ? .6 : 1));
  $('#sRt').textContent = rf + '%'; $('#sRtg').style.width = Math.min(100, rf) + '%'; $('#sRtg').classList.toggle('low', rf < 75);
  const sysAlert = S.faults.length > 0; const sk = $('#pageKeys [data-pg="sys"]'); if (sk) sk.classList.toggle('alert', sysAlert);
  renderPage();
}

function renderQueue(q){
  const el = $('#queue');
  const rows = q.slice(0, 14).map(x => {
    const e = x.e, k = e.trk, p = S.seat === 'THAAD' ? H.activePlan(S, e, 'UT') : (H.activePlan(S, e, 'LT') || x.plan); let st = '', cls = '';
    if (p){ if (p.tier === 'UT' && S.seat !== 'THAAD'){ const m = S.ms.find(mm => mm.alive && mm.plan === p.id); st = m ? `THAAD ${Math.max(0, Math.ceil(m.tEnd - S.t))}s` : 'THAAD'; cls = 'ut'; } else if (p.state === 'VETO') st = `<button class="veto" type="button" data-veto="${p.id}">VETO ${Math.ceil(p.vetoT)}</button>`; else if (p.state === 'WAIT'){ st = 'WAIT'; cls = 'wait'; } else if (p.state === 'GUIDING' || p.state === 'READY'){ const m = S.ms.find(mm => mm.alive && mm.plan === p.id); st = m ? `AWAY ${Math.max(0, Math.ceil(m.tEnd - S.t))}s` : 'FIRING'; cls = 'away'; } }
    else if (k.hold) st = 'HOLD';
    const tta = isFinite(x.a.tta) ? Math.round(x.a.tta) + 's' : '—';
    return `<div class="qrow${e.uid === B.hooked ? ' hk' : ''}" data-uid="${e.uid}"><b>${k.num}</b><span>${k.cls ? e.T.cls : '···'}</span><span class="id-${k.id}">${k.id}</span><span class="dal${x.a.dal ? ' t' : ''}">${x.a.dal ? esc(x.a.dal.name) + ' ' + tta : 'NO DAL'}</span><span class="qst ${cls}">${st}</span></div>`;
  }).join('');
  const html = rows || '<div class="qempty">No hostile or unknown tracks.</div>';
  if (html !== B.qHtml){ el.innerHTML = html; B.qHtml = html; }
}

function renderCard(){
  const el = $('#card'), e = hookedEnt();
  if (!e){ if (B.cardFor !== 'none'){ el.innerHTML = '<div class="empty">Tap a track on the scope or a row in the queue to hook it. Keys: 1–5 set identity, I interrogates, E engages, H holds fire, Space acknowledges.</div>'; B.cardFor = 'none'; } return; }
  if (B.cardFor !== e.uid){
    B.cardFor = e.uid;
    el.innerHTML = `<div class="ch"><span class="num" id="cNum"></span><span class="cls" id="cCls"></span><b class="chip idc" id="cId"></b></div>
      <div class="qbar"><i id="cQ"></i></div>
      <dl class="kv">
        <dt>BRG</dt><dd id="cBrg"></dd><dt>RNG</dt><dd id="cRng"></dd>
        <dt>ALT</dt><dd id="cAlt"></dd><dt>SPD</dt><dd id="cSpd"></dd>
        <dt>HDG</dt><dd id="cHdg"></dd><dt>ALT VAR</dt><dd id="cVar"></dd>
        <dt>IFF</dt><dd class="wide" id="cIff"></dd>
        <dt>THREAT</dt><dd class="wide" id="cThr"></dd>
        <dt>GEM-T</dt><dd class="wide" id="cG"></dd>
        <dt>MSE</dt><dd class="wide" id="cM"></dd>
        <dt id="cTl">THAAD</dt><dd class="wide" id="cT"></dd>
        <dt>KILL ASMT</dt><dd class="wide" id="cKa"></dd>
        <dt>STATUS</dt><dd class="wide" id="cSt"></dd>
      </dl>
      <div class="idrow" id="cIds">${['FRD','NEU','UNK','SUS','HOS'].map((x, i) => `<button type="button" class="id-${x}" data-id="${x}" title="Key ${i + 1}"><span>${x}</span></button>`).join('')}</div>
      <div class="actrow"><button class="tbtn" type="button" id="cIffB">IFF</button><button class="tbtn" type="button" id="cHold">HOLD FIRE</button><button class="tbtn" type="button" id="cCuas" hidden>C-UAS</button><div class="seg" id="cW">${(S.seat === 'THAAD' ? ['THAAD'] : ['AUTO','GEMT','MSE']).map(w => `<button type="button" data-w="${w}">${w === 'GEMT' ? 'GEM-T' : w}</button>`).join('')}</div></div>
      <button class="engage" type="button" id="cEng"><i></i><span>${store.s.expert ? 'ENGAGE' : 'HOLD TO ENGAGE'}</span></button>
      <div class="eyebrow" id="cMsg" style="letter-spacing:.06em;min-height:1.2em"></div>`;
    $('#cIds').querySelectorAll('button').forEach(b => b.onclick = () => declare(hookedEnt(), b.dataset.id));
    $('#cIffB').onclick = () => { const x = hookedEnt(); if (x) H.cmd(S, 'iff', {uid:x.uid}); };
    $('#cHold').onclick = () => { const x = hookedEnt(); if (x) H.cmd(S, 'hold', {uid:x.uid}); };
    $('#cCuas').onclick = () => assignCuas(hookedEnt());
    $('#cW').querySelectorAll('button').forEach(b => b.onclick = () => { B.wpn = b.dataset.w; });
    holdButton($('#cEng'), () => tryEngage(hookedEnt()));
  }
  const k = e.trk, b = H.brgOf(e.x - S.bat.x, e.y - S.bat.y), r = Math.hypot(e.x - S.bat.x, e.y - S.bat.y), sp = Math.hypot(e.vx, e.vy);
  $('#cNum').textContent = k.num; $('#cCls').textContent = k.cls ? (e.T.cls + (k.remote ? ' · REMOTE ' + (k.remName || '') : '')) : 'CLASSIFYING' + (k.remote ? ' · REMOTE' : '');
  const ci = $('#cId'); ci.textContent = k.id + (k.idBy === 'AUTO' ? ' (AUTO)' : ''); ci.className = 'chip idc id-' + k.id;
  $('#cQ').style.width = Math.round(k.q * 100) + '%';
  $('#cBrg').textContent = pad(Math.round(b) % 360, 3) + '°'; $('#cRng').textContent = r.toFixed(1) + ' km';
  $('#cAlt').textContent = e.T.ballistic ? e.z.toFixed(1) + ' km' : e.z < 1 ? Math.round(e.z * 3281) + ' ft' : 'FL' + pad(Math.round(e.z * 32.81), 3);
  $('#cSpd').textContent = e.T.ballistic ? Math.round(Math.hypot(sp, e.vz || 0) * 1000) + ' m/s' : Math.round(sp * 1944) + ' kt';
  $('#cHdg').textContent = sp > .002 ? pad(Math.round(H.brgOf(e.vx, e.vy)) % 360, 3) + '°' : '—';
  const zs = k.zs || []; let vr = '—'; if (zs.length > 6 && !e.T.ballistic){ const m = zs.reduce((a, c) => a + c, 0) / zs.length; vr = Math.round(Math.sqrt(zs.reduce((a, c) => a + (c - m) ** 2, 0) / zs.length) * 1000) + ' m'; }
  const cv = $('#cVar'); cv.textContent = vr; cv.className = vr === '0 m' ? 'warn' : '';
  const iff = $('#cIff'); iff.textContent = (k.iff || 'PENDING') + (H.onAirway(S, e) ? ' · ON AIRWAY' : '') + (H.inCorridor(S, e) ? ' · IN CORRIDOR' : ''); iff.className = 'wide ' + (k.iff === 'M4 VALID' ? 'good' : k.iff === 'NO RESP' ? 'warn' : '');
  const a = H.assess(S, e), thr = $('#cThr');
  thr.textContent = e.T.ballistic ? (a.dal ? `IMPACT ${a.dal.name.toUpperCase()} · ${Math.round(a.tta)} s` : `IMPACT OUTSIDE DAL · ${Math.round(a.tta)} s`) : (a.dal ? `${a.dal.name.toUpperCase()} · ${Math.round(a.tta)} s` : 'NO DAL HEADING');
  thr.className = 'wide ' + (a.dal ? 'bad' : '');
  for (const [w, id] of [['GEMT', '#cG'], ['MSE', '#cM'], ['THAAD', '#cT']]){
    const el2 = $(id); if (w === 'THAAD'){ el2.hidden = $('#cTl').hidden = !S.thaad; if (!S.thaad) continue; }
    const s = H.solve(S, e, w), n = H.rounds(S, w);
    el2.textContent = w === 'THAAD' && !H.thaadOn(S) ? (S.thaad.alive ? 'TPY-2 SILENT' : 'TPY-2 DESTROYED') : w === 'THAAD' && !k.tpy && e.T.ballistic ? 'NO TPY-2 TRACK' : n <= 0 ? 'NONE READY' : s.ok ? `IN ENVELOPE · TOF ${Math.round(s.tof)} s · P(K) ${Math.round((e.T.pk[w] || 0) * 100)}%` : s.why;
    el2.className = 'wide ' + (n > 0 && s.ok ? 'good' : '');
  }
  const ka = $('#cKa'); ka.textContent = e.released ? 'SUBMUNITIONS RELEASED · NO INTERCEPT POSSIBLE' : k.ka === 'UNCERTAIN' ? 'UNCERTAIN · WARHEAD MAY STILL BE FALLING' : e.bodyHit ? 'UNCERTAIN' : '—'; ka.className = 'wide ' + (e.released || k.ka ? 'bad' : '');
  $('#cCuas').hidden = !(e.T.cls === 'UAV' && S.cuas.some(c => c.type === 'COY'));
  const p = S.seat === 'THAAD' ? H.activePlan(S, e, 'UT') : (H.activePlan(S, e, 'LT') || H.activePlan(S, e)), st = $('#cSt');
  st.textContent = k.hold ? 'HOLD FIRE' : e.holdOrder ? 'HOLD FIRE ORDERED BY TD' : p ? `${p.state}${p.state === 'VETO' ? ' ' + Math.ceil(p.vetoT) + ' s' : ''} · ${WEAPONS[p.w].name} · ${p.doc} · SALVO ${p.salvo}` : 'NOT ENGAGED';
  st.className = 'wide ' + (k.hold || e.holdOrder ? 'good' : p ? 'bad' : '');
  $('#cIds').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.id === k.id || (k.id === 'PND' && x.dataset.id === 'UNK' && false)));
  $('#cHold').classList.toggle('on', !!k.hold);
  $('#cW').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.w === B.wpn));
  $('#cEng').disabled = S.seat === 'THAAD' ? (!!p || !H.thaadOn(S) || !k.tpy) : (!!p && p.tier !== 'UT') || !H.radarOn(S) || k.remote;
}

function holdButton(btn, fire){
  let tm = 0;
  const start = ev => { if (btn.disabled) return; ev.preventDefault(); if (store.s.expert){ fire(); return; } btn.classList.add('holding'); tm = setTimeout(() => { btn.classList.remove('holding'); fire(); }, 450); };
  const stop = () => { clearTimeout(tm); btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop); btn.addEventListener('pointercancel', stop);
  btn.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); fire(); } });
}

function cardMsg(t){ const m = $('#cMsg'); if (m){ m.textContent = t; clearTimeout(B.msgT); B.msgT = setTimeout(() => { if ($('#cMsg')) $('#cMsg').textContent = ''; }, 4000); } else toast('TCA', t); }

function tryEngage(e){
  if (!e) return;
  const r = H.cmd(S, 'engage', {uid:e.uid, wpn:B.wpn});
  if (r.ok){ cardMsg('ENGAGEMENT ORDERED'); return; }
  if (r.viol){
    modal('ROE warning', `<p>Engaging track <b>${e.trk.num}</b> breaks your rules of engagement:</p><ul>${r.viol.map(v => `<li>${esc(v)}</li>`).join('')}</ul><p>The TD will log a violation. A shot at a protected aircraft ends the battle.</p>`,
      [{t:'Cancel'}, {t:'Fire anyway', cls:'danger', f:() => { const r2 = H.cmd(S, 'engage', {uid:e.uid, wpn:B.wpn, force:true}); if (!r2.ok) cardMsg(r2.why); }}], true);
    return;
  }
  cardMsg(r.why); AU.tone('fault');
}
function assignCuas(e){
  if (!e) return; const r = H.cmd(S, 'cuas', {uid:e.uid});
  if (r && r.ok){ cardMsg('C-UAS ENGAGING'); AU.tone('click'); } else { cardMsg(r ? r.why : 'NO C-UAS'); AU.tone('fault'); }
}
function declare(e, id){
  if (!e) return;
  if (id === 'HOS' && e.trk.iff === 'M4 VALID' && !store.s.expert){
    modal('Mode 4 valid', `<p>Track ${e.trk.num} answers Mode 4 valid. That is a friendly transponder. Declare it hostile anyway?</p>`, [{t:'Cancel'}, {t:'Declare hostile', cls:'danger', f:() => H.cmd(S, 'id', {uid:e.uid, id})}], true);
    return;
  }
  H.cmd(S, 'id', {uid:e.uid, id}); AU.tone('click');
}

function renderLaunchers(force){
  const row = $('#lnchRow'); const parts = [];
  const b = S.bat;
  if (S.thaad){ const T = S.thaad; parts.push(`<div class="ls sys ut"><div class="lh"><b>TPY-2</b><span class="stt ${T.alive ? (T.emcon ? 'MOVE' : '') : 'DEAD'}">${!T.alive ? 'DESTROYED' : T.emcon ? 'SILENT' : 'RADIATING'}</span></div><div>${esc(T.name)} · PTL ${pad(Math.round(T.ptl) % 360, 3)}</div><div>RESERVE ${S.reserve.THAAD || 0} THAAD · ${S.seat === 'THAAD' ? 'YOUR SEAT' : 'AI CREW'}</div></div>`); }
  parts.push(`<div class="ls sys"><div class="lh"><b>RADAR</b><span class="stt ${!b.alive ? 'DEAD' : H.radarOn(S) ? '' : 'MOVE'}">${!b.alive ? 'DOWN' : b.emcon ? 'SILENT' : b.reorient > 0 ? 'REORIENT' : b.displace > 0 ? 'MOVING' : b.epp > 0 ? 'NO POWER' : b.radarFault > 0 ? 'DEGRADED' : 'RADIATING'}</span></div><div>MPQ-65 · PTL ${pad(Math.round(b.ptl) % 360, 3)}</div><div>RESERVE ${S.reserve.MSE} MSE · ${S.reserve.GEMT} GEM-T</div></div>`);
  for (const L of S.launchers){
    const pips = (n, cap, g) => Array.from({length:cap}, (_, i) => `<i class="${g ? 'g ' : ''}${i < n ? 'f' : ''}"></i>`).join('');
    const canR = !L.dead && L.state === 'READY' && ((L.cap.MSE > L.MSE && S.reserve.MSE > 0) || (L.cap.GEMT > L.GEMT && S.reserve.GEMT > 0) || (L.cap.THAAD > L.THAAD && S.reserve.THAAD > 0));
    const stt = L.dead ? 'DEAD' : L.state === 'READY' ? 'READY' : `${L.state} ${Math.ceil(L.timer)}s`;
    parts.push(`<div class="ls${L.dead ? ' dead' : ''}${L.type === 'THAAD' ? ' ut' : ''}"><div class="lh"><b>${L.type === 'THAAD' ? L.id : 'LS' + L.id}</b><span class="stt ${L.dead ? 'DEAD' : L.state}">${stt}</span></div>
      ${L.cap.MSE ? `<div class="pips"><em>MSE</em>${pips(L.MSE, L.cap.MSE, false)}</div>` : ''}${L.cap.GEMT ? `<div class="pips"><em>GEM</em>${pips(L.GEMT, L.cap.GEMT, true)}</div>` : ''}${L.cap.THAAD ? `<div class="pips th"><em>THD</em>${pips(L.THAAD, L.cap.THAAD, false)}</div>` : ''}
      ${canR ? `<button type="button" data-reload="${L.id}">RELOAD</button>` : ''}</div>`);
  }
  for (const c of S.cuas) parts.push(`<div class="ls sys cu"><div class="lh"><b>${esc(c.name.toUpperCase())}</b><span class="stt ${c.type === 'COY' && !c.left ? 'DEAD' : ''}">${c.type === 'GUN' ? 'AUTO' : c.left ? c.left + ' LEFT' : 'EMPTY'}</span></div><div>${c.type === 'GUN' ? 'GUN · ' + (c.r || 3.5) + ' KM' : 'COYOTE · ' + (c.r || 12) + ' KM'}</div><div>${c.type === 'COY' ? (S.cuasAuto ? 'AUTO ON DRONES' : 'ON CALL · U KEY') : 'DRONES INSIDE RING'}</div></div>`);
  for (const nb of S.neighbors) parts.push(`<div class="ls sys"><div class="lh"><b>${esc(nb.name)}</b><span class="stt ${nb.on ? '' : 'DEAD'}">${nb.on ? 'ON NET' : 'OFF NET'}</span></div><div>${nb.ally ? 'ALLIED BATTERY' : 'ADJACENT BATTERY'}</div><div>PTL ${pad(nb.ptl, 3)} · ${nb.inv} RDS</div></div>`);
  const html = parts.join('');
  if (html !== B.lHtml){ row.innerHTML = html; B.lHtml = html; }
}

function setSheet(p){
  B.sheet = B.sheet === p ? '' : p;
  $('#scr-battle').dataset.sheet = B.sheet;
  $$('#ptabs button').forEach(b => b.classList.toggle('on', b.dataset.p === B.sheet));
}

// battle input wiring (once)
function wireBattle(){
  $('#sMode').onclick = ev => { const b = ev.target.closest('button'); if (!b || !S) return; const m = b.dataset.m;
    if (m === 'AUTO' && !B.autoWarned && !store.s.expert){ B.autoWarned = true; modal('Automatic mode', '<p>The computer will declare any silent, closing air track hostile and fire after a five-second veto window. It does not know about corridors or broken transponders. Watch the queue for VETO.</p>', [{t:'Cancel'}, {t:'Go automatic', cls:'danger', f:() => H.cmd(S, 'mode', {v:'AUTO'})}], true); return; }
    H.cmd(S, 'mode', {v:m}); };
  $('#sSpeed').onclick = ev => { const b = ev.target.closest('button'); if (b && B) B.speed = +b.dataset.s; };
  $('#sEmcon').onclick = () => S && H.cmd(S, 'emcon', {v:!S.bat.emcon});
  $('#sPtl').onclick = () => { if (!S) return; const cur = Math.round(S.bat.ptl);
    modal('Reorient PTL', `<p>The radar goes dark for 25 seconds while it slews. Threat axes: ${(S.scn.axis || []).map(a => pad(a, 3) + '°').join(', ')}.</p><p><input id="ptlIn" type="range" min="0" max="359" value="${cur}" style="width:100%;accent-color:var(--amber)"> <b id="ptlV" style="font-family:var(--f-data)">${pad(cur, 3)}°</b></p>`, [{t:'Cancel'}, {t:'Reorient', cls:'primary', f:() => H.cmd(S, 'reorient', {ptl:+$('#ptlIn').value})}]);
    $('#ptlIn').oninput = () => $('#ptlV').textContent = pad(+$('#ptlIn').value, 3) + '°'; };
  $('#sDisp').onclick = () => { if (!S) return; modal('March order', '<p>The battery goes offline for 50 seconds and re-emplaces at the new site.</p>', [{t:'Cancel'}, ...S.scn.sites.map((s, i) => ({t:s.name, cls:i === S.bat.site ? '' : 'primary', f:() => H.cmd(S, 'displace', {site:i})})).filter((x, i) => i !== S.bat.site)]); };
  $('#sRadio').onclick = () => B && setSheet('radio');
  $('#sEnd').onclick = () => { if (!S) return; const sp = B.speed; B.speed = 0; modal('End the watch', '<p>The battle is scored as it stands now.</p>', [{t:'Keep fighting', f:() => B.speed = sp || 1}, {t:'End watch', cls:'danger', f:() => { H.cmd(S, 'end'); B.speed = 1; }}]); };
  $('#btnAck').onclick = () => S && H.cmd(S, 'ack');
  $('#pageKeys').onclick = ev => { const b = ev.target.closest('[data-pg]'); if (b && B) setPage(b.dataset.pg); };
  $('#sysPage').addEventListener('pointerdown', ev => { if (!S) return; const f = ev.target.closest('[data-fix]'); if (f){ ev.preventDefault(); H.cmd(S, 'fix', {fid:+f.dataset.fix, act:f.dataset.act}); AU.tone('click'); return; } const sc = ev.target.closest('[data-sector]'); if (sc){ ev.preventDefault(); H.cmd(S, 'sector', {v:sc.dataset.sector}); return; } const se = ev.target.closest('[data-seat]'); if (se){ ev.preventDefault(); H.cmd(S, 'seat', {v:se.dataset.seat}); onSeat(); return; } const ly = ev.target.closest('[data-layer]'); if (ly){ ev.preventDefault(); H.cmd(S, 'layer', {v:ly.dataset.layer}); return; } const ca = ev.target.closest('[data-cuasauto]'); if (ca){ ev.preventDefault(); H.cmd(S, 'cuasAuto', {v:ca.dataset.cuasauto === '1'}); return; } const te = ev.target.closest('[data-tpyemcon]'); if (te){ ev.preventDefault(); H.cmd(S, 'tpyEmcon', {v:!S.thaad.emcon}); return; } if (ev.target.closest('[data-emcon]')){ ev.preventDefault(); H.cmd(S, 'emcon', {v:!S.bat.emcon}); } });
  $('#crewPage').addEventListener('change', ev => { const c = ev.target.closest('[data-del]'); if (!c || !S) return; H.cmd(S, 'delegate', {k:c.dataset.del, v:c.checked}); store.s.delegate = {...S.tca.delegate}; store.save(); });
  $('#ptabs').onclick = ev => { const b = ev.target.closest('button'); if (b && B) setSheet(b.dataset.p); };
  $$('[data-close]').forEach(b => b.onclick = () => B && setSheet(''));
  $('#queue').addEventListener('pointerdown', ev => { const v = ev.target.closest('[data-veto]'); if (v){ ev.preventDefault(); H.cmd(S, 'veto', {pid:+v.dataset.veto}); return; } const r = ev.target.closest('[data-uid]'); if (r) hook(+r.dataset.uid); });
  $('#lnchRow').addEventListener('pointerdown', ev => { const b = ev.target.closest('[data-reload]'); if (b){ ev.preventDefault(); const id = b.dataset.reload; H.cmd(S, 'reload', {id:isNaN(+id) ? id : +id}); } });
  $('#swGuard').onclick = () => { if (!B) return; B.guard = !B.guard; AU.tone('click'); clearTimeout(B.guardT); if (B.guard) B.guardT = setTimeout(() => { B.guard = false; }, 6000); updatePanels(); };
  $('#swEng').onclick = () => { if (!B || !B.guard || stunned()) return; tryEngage(hookedEnt()); B.guard = false; updatePanels(); };
  $('#swHold').onclick = () => { const e = hookedEnt(); if (e && !stunned()) H.cmd(S, 'hold', {uid:e.uid}); };
  $('#swCuas').onclick = () => { if (!stunned()) assignCuas(hookedEnt()); };
  $('#swPtt').onclick = () => { if (S && !stunned()){ H.cmd(S, 'ack'); AU.tone('squelch'); } };
  $('#zVid').onclick = () => { if (!B) return; const o = ['MIX', 'SYN', 'RAW']; B.video = o[(o.indexOf(B.video) + 1) % 3]; $('#zVid').textContent = B.video; store.s.video = B.video; store.save(); };
  $('#zIn').onclick = () => zoom(1.4); $('#zOut').onclick = () => zoom(1 / 1.4);
  $('#zCtr').onclick = () => { if (B){ B.view.cx = S.bat.x; B.view.cy = S.bat.y; } };
  $('#z3d').onclick = () => { if (!B) return; B.view.tilt = !B.view.tilt; if (B.U) B.U.tilted = true; $('#z3d').classList.toggle('on', B.view.tilt); };
  $('#coachNext').onclick = () => coachNext(); $('#coachMin').onclick = () => $('#coach').classList.toggle('min');
  const cv = $('#scope'); const ptrs = new Map(); let dragged = false, pinch0 = 0, s0 = 1;
  cv.addEventListener('pointerdown', ev => { cv.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, {x:ev.clientX, y:ev.clientY, x0:ev.clientX, y0:ev.clientY}); dragged = false; if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); s0 = B.view.s; } });
  cv.addEventListener('pointermove', ev => { const p = ptrs.get(ev.pointerId); if (!p || !B) return; const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY;
    if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) B.view.s = Math.max(.18, Math.min(14, s0 * d / pinch0)); dragged = true; return; }
    if (Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) > 6) dragged = true;
    if (dragged){ B.view.cx -= dx / B.view.s; B.view.cy += dy / B.view.s * (B.view.tilt ? 1.6 : 1); } });
  const up = ev => { const p = ptrs.get(ev.pointerId); ptrs.delete(ev.pointerId); if (!B || !p) return; if (!dragged && ptrs.size === 0 && !stunned()){ const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top; let best = null, bd = 24; for (const h of B.hits){ const d = Math.hypot(h.x - x, h.y - y); if (d < bd){ bd = d; best = h; } } hook(best ? best.uid : null); } };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointermove', ev => { if (!B || ev.pointerType === 'touch') return; const r = cv.getBoundingClientRect(); B.cursor = {px:ev.clientX - r.left, py:ev.clientY - r.top}; });
  cv.addEventListener('pointerleave', () => { if (B) B.cursor = null; }); cv.addEventListener('pointercancel', ev => ptrs.delete(ev.pointerId));
  cv.addEventListener('wheel', ev => { ev.preventDefault(); if (!B) return; const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top; const w0 = unproj(B.view, mx, my); zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15); if (!B.view.tilt){ const w1 = unproj(B.view, mx, my); B.view.cx += w0.x - w1.x; B.view.cy += w0.y - w1.y; } }, {passive:false});
  document.addEventListener('keydown', ev => {
    if (UI.screen !== 'battle' || !S || !$('#modal').hidden) return;
    if (ev.target.matches('input,textarea')) return;
    if (stunned() && ev.key !== 'p') return;
    const e = hookedEnt(), k = ev.key.toLowerCase();
    if (k === ' '){ ev.preventDefault(); H.cmd(S, 'ack'); }
    else if (k === 'e'){ tryEngage(e); }
    else if (k === 'h'){ if (e) H.cmd(S, 'hold', {uid:e.uid}); }
    else if (k === 'i'){ if (e) H.cmd(S, 'iff', {uid:e.uid}); }
    else if ('12345'.includes(k) && k.length === 1){ declare(e, ['FRD','NEU','UNK','SUS','HOS'][+k - 1]); }
    else if (k === 'tab' || k === 'n'){ ev.preventDefault(); const un = S.ents.filter(x => x.alive && x.trk && x.trk.est && !x.trk.remote && (x.trk.id === 'PND' || x.trk.id === 'UNK')).map(x => x.uid); const list = un.length ? un : H.threatQueue(S).map(x => x.e.uid); if (list.length){ const i = list.indexOf(B.hooked); hook(list[(i + 1) % list.length]); } }
    else if (k === 'v'){ const p = S.plans.find(x => x.state === 'VETO'); if (p) H.cmd(S, 'veto', {pid:p.id}); }
    else if (k === 'u'){ assignCuas(e); }
    else if (k === 'g'){ if (S.thaad){ H.cmd(S, 'seat', {v:S.seat === 'THAAD' ? 'PAT' : 'THAAD'}); onSeat(); } }
    else if (k === 'r'){ $('#zVid').click(); }
    else if (k === 'm'){ const ms = ['MANUAL','SEMI','AUTO']; H.cmd(S, 'mode', {v:ms[(ms.indexOf(S.mode) + 1) % 3]}); }
    else if (k === 'p'){ B.speed = B.speed ? 0 : 1; }
    else if (k === ']'){ B.speed = Math.min(4, (B.speed || .5) * 2); }
    else if (k === '['){ B.speed = B.speed <= 1 ? 1 : B.speed / 2; }
    else if (k === '+' || k === '='){ zoom(1.3); } else if (k === '-'){ zoom(1 / 1.3); }
    else if (k === 't'){ $('#z3d').click(); } else if (k === 'c'){ $('#zCtr').click(); }
    else if (k === 'escape'){ hook(null); setSheet(''); }
    else if (['f1','f2','f3','f4'].includes(k)){ ev.preventDefault(); setPage(['trk','tl','sys','crew'][+k[1] - 1]); }
  });
  window.addEventListener('resize', () => { if (UI.screen === 'brief') briefDraw(); });
}
function zoom(f){ if (!B) return; B.view.s = Math.max(.18, Math.min(14, B.view.s * f)); }
const stunned = () => B && performance.now() < (B.stunUntil || 0);
function onSeat(){ B.wpn = S.seat === 'THAAD' ? 'THAAD' : 'AUTO'; B.cardFor = null; fitView(); updatePanels(true); toast('SEAT', S.seat === 'THAAD' ? 'You have THAAD fire control. The Patriot crew fights on its own below you.' : 'You have the Patriot ECS. The THAAD crew works the upper tier.'); }

// A-scope and elevation strip for the hooked track
function drawDiag(){
  const ca = $('#aScope'), ce = $('#elev'); if (!ca || !ce || ca.offsetParent === null) return;
  const P = pal(), e = hookedEnt(), map = MAP[S.scn.map];
  const src = S.seat === 'THAAD' && S.thaad ? S.thaad : S.bat;
  for (const [cv, fn] of [[ca, drawAscope], [ce, drawElev]]){
    const {W, H:Hh, dpr} = sizeCanvas(cv), ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = P.legacy ? '#020a03' : '#0a1012'; ctx.fillRect(0, 0, W, Hh);
    ctx.strokeStyle = P.grid; ctx.globalAlpha = .6; for (let i = 1; i < 6; i++){ ctx.beginPath(); ctx.moveTo(W * i / 6, 0); ctx.lineTo(W * i / 6, Hh); ctx.stroke(); } for (let i = 1; i < 4; i++){ ctx.beginPath(); ctx.moveTo(0, Hh * i / 4); ctx.lineTo(W, Hh * i / 4); ctx.stroke(); } ctx.globalAlpha = 1;
    ctx.font = `9px ${P.mono}`; ctx.fillStyle = P.faint;
    if (!e){ ctx.fillText(cv === ca ? 'A-SCOPE · HOOK A TRACK' : 'ELEVATION · HOOK A TRACK', 8, 14); continue; }
    fn(ctx, W, Hh, P, e, map, src);
  }
}
function drawAscope(ctx, W, Hh, P, e, map, src){
  const b = H.brgOf(e.x - src.x, e.y - src.y), R = Math.hypot(e.x - src.x, e.y - src.y), Rm = Math.max(40, Math.min(src === S.bat ? 170 : 600, R * 1.4));
  const X = r => r / Rm * W, Y = a => Hh - 6 - a * (Hh - 18);
  const jam = S.ents.some(j => j.alive && j.kind === 'JAM' && Math.abs(H.angDiff(H.brgOf(j.x - src.x, j.y - src.y), b)) < 6);
  const floor = jam ? .32 : .1, faces = src === S.bat ? H.terrainFaces(map, src.x, src.y, b) : [];
  ctx.beginPath(); ctx.moveTo(0, Y(floor));
  const t = performance.now() / 90;
  for (let px = 0; px <= W; px += 2){
    const r = px / W * Rm; let a = floor + Math.abs(Math.sin(px * 12.9898 + t) * 43758.5453 % 1) * (jam ? .18 : .07);
    if (r < 8) a += (8 - r) / 8 * .5;
    for (const f of faces) if (Math.abs(f - r) < Rm / W * 2) a = Math.max(a, .35 + .15 * Math.random());
    for (const o of S.ents) if (o.alive && o.kind !== 'JAM'){ const ob = H.brgOf(o.x - src.x, o.y - src.y), orr = Math.hypot(o.x - src.x, o.y - src.y); if (Math.abs(H.angDiff(ob, b)) < 1.5 && Math.abs(orr - r) < Rm / W * 2.2){ a = Math.max(a, Math.min(.98, .45 + .12 * Math.log10(o.T.rcs * 100) - orr / Rm * .15)); } }
    ctx.lineTo(px, Y(Math.min(1, a)));
  }
  ctx.strokeStyle = P.cyan; ctx.globalAlpha = .9; ctx.stroke(); ctx.globalAlpha = 1;
  ctx.strokeStyle = P.amber; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(R), 4); ctx.lineTo(X(R), Hh - 4); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = P.dim; ctx.fillText(`A-SCOPE · BRG ${pad(Math.round(b) % 360, 3)}° · ${Math.round(Rm)} KM${jam ? ' · NOISE JAMMING' : ''}`, 6, 11);
  ctx.fillStyle = P.amber; ctx.fillText(`${e.trk.num} · ${R.toFixed(0)} KM`, Math.min(W - 70, X(R) + 4), 22);
}
function drawElev(ctx, W, Hh, P, e, map, src){
  const b = H.brgOf(e.x - src.x, e.y - src.y), R = Math.hypot(e.x - src.x, e.y - src.y);
  const ball = !!e.T.ballistic, fut = []; if (ball) for (let dt = 0; dt <= 240; dt += 4){ const p = H.predict(S, e, dt); fut.push([Math.hypot(p.x - src.x, p.y - src.y), p.z]); if (p.end) break; }
  const Rm = Math.max(30, R * 1.25, ...fut.map(f => f[0] * 1.05)), Zm = ball ? Math.max(40, e.z * 1.15, ...fut.map(f => f[1] * 1.1)) : Math.max(2, e.z * 2.2, 1.5);
  const X = r => 6 + r / Rm * (W - 12), Y = z => Hh - 8 - Math.max(0, z) / Zm * (Hh - 22);
  ctx.beginPath(); ctx.moveTo(X(0), Y(0));
  for (let i = 0; i <= 120; i++){ const r = Rm * i / 120, p = H.polar(b, r, src); ctx.lineTo(X(r), Y(Math.max(0, H.heightAt(map, p.x, p.y)) * (ball ? 1 : 1))); }
  ctx.lineTo(X(Rm), Y(0)); ctx.closePath(); ctx.fillStyle = P.legacy ? 'rgba(60,140,70,.35)' : 'rgba(120,128,108,.35)'; ctx.fill();
  const band = (z0, z1, txt, col) => { if (z0 > Zm) return; ctx.fillStyle = col; ctx.globalAlpha = .12; ctx.fillRect(X(0), Y(Math.min(z1, Zm)), W, Y(z0) - Y(Math.min(z1, Zm))); ctx.globalAlpha = .8; ctx.fillText(txt, W - 6 - ctx.measureText(txt).width, Y(Math.min(z1, Zm)) + 10); ctx.globalAlpha = 1; };
  const line = (z, txt, col) => { if (z > Zm) return; ctx.strokeStyle = col; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(z)); ctx.lineTo(W, Y(z)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = col; ctx.fillText(txt, 8, Y(z) - 3); };
  if (ball){ band(12, 20, 'CLUSTER RELEASE BAND', P.red); line(36, 'PATRIOT CEILING', P.dim); if (S.thaad) line(25, 'THAAD FLOOR', P.amber); }
  else { const hz = 0; for (const z of [.1]) line(z, '100 M', P.amber); }
  if (fut.length){ ctx.strokeStyle = P.red; ctx.setLineDash([3, 3]); ctx.beginPath(); fut.forEach((f, i) => i ? ctx.lineTo(X(f[0]), Y(f[1])) : ctx.moveTo(X(f[0]), Y(f[1]))); ctx.stroke(); ctx.setLineDash([]); }
  for (const m of S.ms) if (m.alive && m.uid === e.uid){ const mr = Math.hypot(m.x - src.x, m.y - src.y); ctx.fillStyle = m.tier === 'UT' ? P.amber : '#fff'; ctx.beginPath(); ctx.arc(X(mr), Y(m.z), 2.5, 0, 7); ctx.fill(); if (m.aim){ const ar = Math.hypot(m.aim.x - src.x, m.aim.y - src.y); ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(X(ar) - 3, Y(m.aim.z) - 3); ctx.lineTo(X(ar) + 3, Y(m.aim.z) + 3); ctx.moveTo(X(ar) + 3, Y(m.aim.z) - 3); ctx.lineTo(X(ar) - 3, Y(m.aim.z) + 3); ctx.stroke(); } }
  ctx.fillStyle = idCol(e.trk.id, P); ctx.beginPath(); ctx.arc(X(R), Y(e.z), 3.5, 0, 7); ctx.fill();
  ctx.fillStyle = P.dim; ctx.fillText(`ELEVATION · ${Math.round(Rm)} KM × ${Zm >= 10 ? Math.round(Zm) + ' KM' : (Zm * 1000).toFixed(0) + ' M'}${e.released ? ' · OPENED' : ''}`, 6, 11);
}

// ---------- station pages (2.0) ----------
function setPage(pg){
  if (!B) return;
  B.page = pg; B.h = {};
  $$('#pageKeys [data-pg]').forEach(b => b.classList.toggle('on', b.dataset.pg === pg));
  $$('#pSide .pg').forEach(p => p.hidden = p.dataset.page !== pg);
  renderPage();
}
function setHtml(el, html, k){ if (!el) return; B.h = B.h || {}; if (B.h[k] !== html){ el.innerHTML = html; B.h[k] = html; } }
function renderPage(){ if (B.page === 'tl') renderTimeline(); else if (B.page === 'sys') renderSystem(); else if (B.page === 'crew') renderCrew(); }
function renderTimeline(){
  const W = 90, now = S.t, rows = [], pct = t => Math.max(0, Math.min(100, t / W * 100)).toFixed(1);
  for (const p of S.plans){
    if (p.state === 'DONE') continue;
    const e = S.ents.find(x => x.uid === p.uid); if (!e || !e.alive) continue;
    const a = H.assess(S, e), ms = S.ms.filter(m => m.alive && m.plan === p.id);
    let bars = '';
    for (const m of ms){ const t0 = Math.max(0, m.t0 - now), t1 = m.tEnd - now; bars += `<i class="fly" style="left:${pct(t0)}%;width:${(pct(t1) - pct(t0)).toFixed(1)}%"></i><b class="ka" style="left:${pct(t1)}%"></b>`; }
    if (p.state === 'READY') bars += `<b class="ln" style="left:${pct(Math.max(0, p.fireAt - now))}%"></b>`;
    if (a.dal && isFinite(a.tta)) bars += `<b class="imp" style="left:${pct(a.tta)}%"></b>`;
    let status;
    if (p.state === 'VETO') status = `VETO WINDOW ${Math.ceil(p.vetoT)} s`;
    else if (p.state === 'WAIT'){ const s = H.solve(S, e, p.w); status = `WAITING · ${s.ok ? 'SOLUTION READY' : s.why}`; }
    else if (p.state === 'READY') status = `LAUNCH IN ${Math.max(0, p.fireAt - now).toFixed(0)} s`;
    else status = ms.length ? `${ms.length} AWAY · INTERCEPT IN ${Math.max(0, Math.ceil(ms[0].tEnd - now))} s` : 'KILL ASSESSMENT';
    rows.push(`<div class="tlr${p.tier === 'UT' ? ' ut' : ''}"><div class="tlh"><b>${p.trk}</b><span>${e.T.cls}${e.released ? ' · OPENED' : ''}</span><span>${p.tier === 'UT' ? 'UPPER TIER · ' : ''}${WEAPONS[p.w].name} · ${p.doc} · SALVO ${p.salvo}</span></div><div class="tls">${esc(status)}</div><div class="tlb">${bars}</div><div class="tlf">${a.dal ? esc(a.dal.name) + ' reached in ' + Math.round(a.tta) + ' s' : 'No defended asset threatened'}</div></div>`);
  }
  const axis = `<div class="tlax">${[0, 15, 30, 45, 60, 75, 90].map(t => `<span style="left:${(t / W * 100).toFixed(1)}%">${t}</span>`).join('')}</div>`;
  const key = '<div class="tlkey"><span><b class="ln"></b>launch</span><span><i class="fly"></i>missile flight</span><span><b class="ka"></b>intercept</span><span><b class="imp"></b>threat reaches asset</span></div>';
  setHtml($('#tlPage'), (rows.length ? axis + rows.join('') : '<div class="qempty">No engagements in progress. Each engagement appears here with its launch time, missile flight, intercept point and the moment the threat would reach its asset. If the red tick sits left of the intercept, the shot is too late.</div>') + key, 'tl');
}
function renderSystem(){
  const b = S.bat, on = H.radarOn(S);
  const st = !b.alive ? 'DESTROYED' : b.emcon ? 'SILENT · EMCON' : b.reorient > 0 ? `REORIENTING ${Math.ceil(b.reorient)} s` : b.displace > 0 ? `MARCH ORDER ${Math.ceil(b.displace)} s` : b.epp > 0 ? 'NO POWER' : b.radarFault ? 'RADIATING · DEGRADED' : 'RADIATING';
  const tp = S.radar.trackPct, rng = Math.round(S.radar.searchF * (b.half < 60 ? 125 : 100) * (b.radarFault ? .6 : 1));
  const faults = S.faults.map(f => `<div class="flt${f.fixing ? ' fixing' : ''}"><div class="fh"><b>BIT ${f.code}</b><span>${esc(f.title)}${f.ls ? ' · LS' + f.ls : ''}</span><em>${fmtT(S.t - f.t0)}</em></div><div class="fe">${esc(f.effect)}${f.tries ? ` · ${f.tries} failed attempt${f.tries > 1 ? 's' : ''}` : ''}</div>${f.fixing ? `<div class="fx">${esc(f.fixing.action)} · ${f.fixing.by === 'TCO' ? 'you' : esc(S.tca.name)} · ${Math.max(0, Math.ceil(f.fixing.until - S.t))} s</div>` : `<div class="fa">${H.FIX_ACTIONS.map(a => `<button type="button" data-fix="${f.id}" data-act="${a}">${a}</button>`).join('')}</div>`}</div>`).join('');
  setHtml($('#sysLive'), `<div class="sysg">
    <span class="sl">RADAR</span><span class="sv ${on ? 'ok' : 'bad'}">${st}</span>
    <span class="sl">SECTOR</span><span class="sv"><span class="seg"><button type="button" data-sector="WIDE" class="${b.sector === 'WIDE' ? 'on' : ''}">WIDE ±60°</button><button type="button" data-sector="NARROW" class="${b.sector === 'NARROW' ? 'on' : ''}">NARROW ±30°</button></span></span>
    <span class="sl">RADAR TIME</span><span class="sv"><span class="budget"><i style="width:${100 - tp}%"></i><b style="width:${tp}%"></b></span><small>SEARCH ${100 - tp}% · TRACK ${tp}% · ${S.radar.load} TRACKS · SEARCH RANGE ${rng}%</small></span>
    <span class="sl">EMCON</span><span class="sv"><button type="button" class="tbtn${b.emcon ? ' on' : ''}" data-emcon="1">${b.emcon ? 'SILENT · RADIATE' : 'RADIATING · GO SILENT'}</button></span>
    <span class="sl">POWER</span><span class="sv ${b.epp ? 'bad' : 'ok'}">${b.epp ? 'PRIME POWER FAULT' : 'EPP III ONLINE'}</span>
    <span class="sl">WCC</span><span class="sv ${S.wccSlow ? 'bad' : 'ok'}">${S.wccSlow ? 'DEGRADED · +4 S PER SOLUTION' : 'NOMINAL'}</span>
    <span class="sl">LINKS</span><span class="sv lks">${S.launchers.map(L => `<span class="lk ${L.dead || L.state === 'COMMS' ? 'bad' : 'ok'}">${L.type === 'THAAD' ? L.id : 'LS' + L.id}</span>`).join(' ')}</span>
    <span class="sl">TD NET</span><span class="sv ${S.comms ? 'ok' : 'bad'}">${S.comms ? 'UP' : 'DOWN · AUTONOMOUS OPERATIONS UNDER LAST ROE'}</span>
    <span class="sl">MOPP</span><span class="sv ${S.mopp >= 4 ? 'bad' : 'ok'}">${S.mopp >= 4 ? 'MOPP 4 · MASKED · REACTIONS SLOWER' : 'MOPP ' + S.mopp}</span>
    ${S.thaad ? `<span class="sl">TPY-2</span><span class="sv ${H.thaadOn(S) ? 'ok' : 'bad'}">${!S.thaad.alive ? 'DESTROYED' : S.thaad.emcon ? 'SILENT' : 'RADIATING'} <button type="button" class="tbtn${S.thaad.emcon ? ' on' : ''}" data-tpyemcon="1" ${S.thaad.alive ? '' : 'disabled'}>${S.thaad.emcon ? 'RADIATE' : 'GO SILENT'}</button></span>
    <span class="sl">SEAT</span><span class="sv"><span class="seg"><button type="button" data-seat="PAT" class="${S.seat === 'PAT' ? 'on' : ''}">PATRIOT ECS</button><button type="button" data-seat="THAAD" class="${S.seat === 'THAAD' ? 'on' : ''}">THAAD FIRE CONTROL</button></span><small>G swaps seats. The seat you leave runs on its AI crew.</small></span>
    <span class="sl">LAYER</span><span class="sv"><span class="seg"><button type="button" data-layer="WAIT" class="${S.doctrine.LAYER === 'WAIT' ? 'on' : ''}">WAIT FOR THAAD</button><button type="button" data-layer="CONC" class="${S.doctrine.LAYER !== 'WAIT' ? 'on' : ''}">CONCURRENT</button></span><small>${S.doctrine.LAYER === 'WAIT' ? 'Patriot holds a ballistic shot while THAAD still works it above 25 km.' : 'Patriot fires as soon as it has a solution, even on missiles THAAD is engaging.'}</small></span>` : ''}
    ${S.cuas.length ? `<span class="sl">C-UAS</span><span class="sv"><span class="seg"><button type="button" data-cuasauto="1" class="${S.cuasAuto ? 'on' : ''}">AUTO</button><button type="button" data-cuasauto="0" class="${S.cuasAuto ? '' : 'on'}">ON CALL</button></span><small>${S.cuas.map(c => esc(c.name) + (c.type === 'COY' ? ' ' + c.left + ' left' : ' gun')).join(' · ')} · ${S.st.cuasKills} kills</small></span>` : ''}
  </div><div class="ph"><span>ACTIVE FAULTS · ${S.faults.length}</span></div>${faults || '<div class="qempty">BIT clean. No active faults.</div>'}`, 'sys');
}
function renderCrew(){
  const t = S.tca, c = H.CREW.find(x => x.id === t.id), bar = (v, cls) => `<span class="bar ${cls || ''}"><i style="width:${Math.round(v * 100)}%"></i></span>`;
  setHtml($('#crewPage'), `<div class="crewc"><div class="cn">${esc(t.name)}</div><div class="eyebrow">TACTICAL CONTROL ASSISTANT · MANSTATION 2</div><p>${esc(c.note)}</p>
    <div class="kv2"><span>SKILL</span>${bar(t.skill)}<span>FATIGUE</span>${bar(t.fatigue, 'warn')}<span>EFFECTIVE</span>${bar(H.tcaEff(S))}</div></div>
    <div class="ph"><span>DELEGATED TASKS</span></div>
    <div class="crewc"><label class="dl"><input type="checkbox" data-del="reload" ${t.delegate.reload ? 'checked' : ''}> Reload empty launchers</label>
    <label class="dl"><input type="checkbox" data-del="faults" ${t.delegate.faults ? 'checked' : ''}> Isolate and fix BIT faults</label>
    <p class="eyebrow" style="letter-spacing:.04em">A tired TCA fixes faults slower, picks the wrong procedure more often and misses callouts. Untick a task to do it yourself on the SYSTEM page.</p></div>
    <div class="ph"><span>LATEST FROM THE TCA</span></div><ol class="tcal">${S.log.filter(l => l.who === 'TCA').slice(-8).reverse().map(l => `<li><span>${fmtT(l.t)}</span>${esc(l.text)}</li>`).join('') || '<li>Quiet so far.</li>'}</ol>`, 'crew');
}
const MANUAL = () => `<details class="fman"><summary>FAULT ISOLATION MANUAL · EXTRACT</summary><table>${Object.values(H.FAULTS).map(F => `<tr><td>${F.fam}xx</td><td>${esc(F.title)}</td><td>${esc(F.fix)}</td></tr>`).join('')}</table><p>Read the first digit of the BIT code and apply the matching procedure. A wrong procedure costs 15 seconds. Unfixed faults clear on their own after one to two minutes. Game values, not the real technical manual.</p></details>`;

// ---------- coach ----------

function setupCoach(){
  const tb = S.scn.tutorial && S.scn.tutorial.table, T = tb && HT_TRAIN.TABLES[tb];
  B.U = {hooked:{kinds:new Set(), ent:null}, tilted:false, zoomed:false, end:false};
  B.coach = T ? {table:tb, steps:T.steps, i:0, held:false, prevSpeed:1, objHtml:''} : null;
  $('#coach').hidden = !B.coach; $('#coach').classList.remove('min');
  $$('.hl').forEach(x => x.classList.remove('hl'));
  if (B.coach){ $('#coachTitle').textContent = 'TABLE ' + ROMAN[tb]; showCoach(); }
}
function showCoach(){
  const c = B.coach, st = c.steps[c.i];
  $('#coachStep').textContent = c.steps.length ? `COACH ${c.i + 1}/${c.steps.length}` : 'NO COACH';
  $('#coachText').textContent = st ? st.t : 'Certification run. The coach stays silent; the objective below is all that counts.';
  $('#coachNext').hidden = !(st && st.pause);
  if (st && st.pause){ if (!c.held){ c.prevSpeed = B.speed || 1; } B.speed = 0; c.held = true; }
  $$('.hl').forEach(x => x.classList.remove('hl'));
  if (st && st.el){ const el = $(HT_TRAIN.SEL[st.el] || st.el); if (el) el.classList.add('hl'); }
  renderObjectives(true);
}
function coachNext(){
  const c = B && B.coach; if (!c) return;
  const st = c.steps[c.i];
  if (st && st.pause && c.held){ c.held = false; B.speed = c.prevSpeed || 1; }
  if (c.i < c.steps.length - 1){ c.i++; showCoach(); }
}
function coachTick(){
  const c = B && B.coach; if (!c) return;
  B.U.hooked.ent = hookedEnt();
  if (B.view.W / B.view.s > 320) B.U.zoomed = true;
  const st = c.steps[c.i];
  if (st && !st.pause && !st.last && st.done && st.done(S, B.U)){ AU.tone('order'); coachNext(); }
  renderObjectives();
}
function renderObjectives(force){
  const c = B.coach; if (!c) return;
  const r = HT_TRAIN.evaluate(c.table, S, B.U);
  const html = r.map(o => `<li class="${o.ok ? 'ok' : ''}"><i>${o.ok ? '✓' : '○'}</i><span>${esc(o.t)}${o.live ? ` <em>${esc(o.live)}</em>` : ''}</span></li>`).join('');
  if (force || html !== c.objHtml){ $('#coachObj').innerHTML = html; c.objHtml = html; }
}

// ---------- end, AAR ----------
function tableResult(){
  const tb = S.scn.tutorial && S.scn.tutorial.table; if (!tb) return null;
  const objs = HT_TRAIN.evaluate(tb, S, Object.assign({}, B.U || {hooked:{kinds:new Set()}}, {end:true}));
  return {ok:objs.every(o => o.ok), objs};
}
function endBattle(){
  if (!S) return;
  VO.stop(); AU.stopAmb();
  const sc = S.score, prev = store.p.best[S.scn.id];
  if (!B.rewound && (prev == null || sc.total > prev)) store.p.best[S.scn.id] = sc.total;
  if (!B.rewound && !S.scn.tutorial && store.s.red !== 'scripted') store.d.red = H.learnRed(store.d.red || {}, S);
  const tp = tableResult();
  let unlockedNow = false;
  if (tp && tp.ok){ store.p.tables[S.scn.tutorial.table] = true; if (S.scn.tutorial.table === 8 && !store.p.cert){ store.p.cert = true; unlockedNow = true; } }
  let campRes = null;
  if (B.camp) campRes = campAfter(B.camp, S);
  store.save();
  openAAR(tp, unlockedNow, campRes);
}

let RP = null;
function openAAR(tp, unlockedNow, campRes){
  show('aar');
  const st = S.st, sc = S.score, f = H.findings(S), scn = S.scn;
  const spent = st.spent, kv = st.killVal, fired = st.fired.GEMT + st.fired.MSE + (st.fired.THAAD || 0);
  const nextTable = scn.tutorial && tp && tp.ok ? SCN.find(s => s.tutorial && s.tutorial.table === scn.tutorial.table + 1) : null;
  const verdict = tp ? `<div class="verdict ${tp.ok ? 'pass' : 'fail'}">${tp.ok ? 'Table passed' : 'Table not passed'}</div><ul class="objs">${tp.objs.map(o => `<li class="${o.ok ? 'ok' : 'no'}"><i>${o.ok ? '✓' : '✗'}</i><span>${esc(o.t)}${!o.ok && o.tip ? `<em>${esc(o.tip)}</em>` : ''}</span></li>`).join('')}</ul>` : sc.frat ? '<div class="verdict fail">Relieved of duty</div>' : `<div class="verdict ${sc.total >= 80 ? 'pass' : sc.total >= 60 ? '' : 'fail'}">${sc.total >= 90 ? 'Outstanding watch' : sc.total >= 80 ? 'Assets held' : sc.total >= 60 ? 'Mission accomplished with losses' : 'Defense failed'}</div>`;
  const cat = (l, v, m) => `<div class="cat"><span class="l">${l}</span><span class="v">${v}<small> / ${m}</small></span><span class="bar"><i style="width:${Math.round(v / m * 100)}%"></i></span></div>`;
  $('#aarBody').innerHTML = `
    <div class="aar-top"><div><div class="eyebrow">AFTER ACTION REVIEW · ${esc(scn.bty)} · SEED ${S.seed}</div><h2>${esc(scn.table ? scn.name.split('· ')[1] : scn.name)}</h2><div class="eyebrow" style="letter-spacing:.06em;margin:4px 0 8px">${esc(scn.place)} · ${esc(S.endReason)} · T+${fmtT(S.t)}${B.rewound ? ' · REWOUND FROM T+' + fmtT(S.rewoundAt) + ' · NOT RECORDED' : ''}</div>${verdict}
      ${scn.real ? `<p class="coach-brief real"><b>The record.</b> ${esc(scn.real)}</p>` : ''}
      ${unlockedNow ? '<p class="coach-brief"><b>Crew certified.</b> The campaign and the legacy console are unlocked. Switch consoles in Settings.</p>' : ''}
      ${campRes ? `<p class="coach-brief">${esc(campRes)}</p>` : ''}</div>
      <div class="total">${sc.total}<small> / 100</small></div></div>
    <div class="cats">${cat('ASSET PROTECTION', sc.protect, 40)}${cat('DISCIPLINE', sc.disc, 25)}${cat('ECONOMY', sc.econ, 20)}${cat('BATTERY SURVIVAL', sc.surv, 15)}</div>
    <div class="aar-grid">
      <div class="replay"><h3 class="eyebrow" style="margin:0">REPLAY · DECISION TIMELINE</h3>
        <div class="mapbox" id="rBox"><canvas id="rMap"></canvas><div class="maphint" id="rT">T+00:00</div></div>
        <div class="tl" id="rTl"></div>
        <div class="rctl"><button class="tbtn" type="button" id="rPlay">PLAY</button><input type="range" id="rPos" min="0" max="${S.snaps.length - 1}" value="0" aria-label="Replay position"><div class="seg" id="rSp"><button type="button" data-s="2">2×</button><button type="button" data-s="6" class="on">6×</button><button type="button" data-s="16">16×</button></div><button class="tbtn" type="button" id="rTruth">TRUTH</button></div>
        <div class="go" style="margin-top:0"><button class="btn primary sm" type="button" id="rSeat">Take the seat from here</button><span class="eyebrow" style="letter-spacing:.04em">${B.camp ? 'Campaign battles are ironman: no rewinds.' : scn.tutorial ? 'Rewind is off in the drill tables.' : 'Scrub to any moment, then take the seat and fight on from that exact state.'}</span></div>
        <div class="eyebrow" style="letter-spacing:.06em">TRUTH shows every object, including threats your radar never saw.</div>
      </div>
      <div style="display:grid;gap:18px;align-content:start">
        <div class="find"><h3>Findings</h3>
          ${f.sustain.length ? `<b>Sustain</b><ul>${f.sustain.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${f.improve.length ? `<b>Improve</b><ul>${f.improve.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="rec"><b>Recommendation.</b> ${esc(f.rec)}</div></div>
        <div class="stats"><h3>Battle data</h3><table>
          <tr><td>Missiles fired</td><td>${st.fired.MSE} MSE · ${st.fired.GEMT} GEM-T${st.fired.THAAD ? ' · ' + st.fired.THAAD + ' THAAD' : ''}</td></tr>
          <tr><td>Interceptor and C-UAS cost (game value)</td><td>$${(spent + st.cuasCost).toFixed(1)}M</td></tr>
          <tr><td>Threats destroyed, at their cost</td><td>$${st.killCost.toFixed(1)}M</td></tr>
          <tr><td>Cost exchange</td><td>${fired ? (st.killCost / Math.max(.1, spent + st.cuasCost)).toFixed(2) + ' : 1' : '—'}${st.cuasKills ? ' · C-UAS killed ' + st.cuasKills + ' drones' : ''}</td></tr>
          <tr><td>Misfires · in-flight failures · uncertain kills</td><td>${st.duds} · ${st.flightFail} · ${st.uncertain}</td></tr>
          ${st.clusterRel ? `<tr><td>Cluster warheads opened · hits</td><td>${st.clusterRel} · ${st.clusterHits}</td></tr>` : ''}
          <tr><td>Impacts in populated areas</td><td>${st.popHits}</td></tr>
          <tr><td>Kills / misses</td><td>${st.kills} / ${st.miss}</td></tr>
          <tr><td>Leakers to the DAL</td><td>${st.leak}</td></tr>
          <tr><td>Wasted shots</td><td>${st.wasted} (decoy ${st.waste.decoy} · false ${st.waste.fals} · non-DAL ${st.waste.nondal})</td></tr>
          <tr><td>ROE violations · late ACKs · ID errors</td><td>${st.viol} · ${st.lateAck} · ${st.misId}</td></tr>
          <tr><td>Vetoes / hold-fire saves</td><td>${st.vetoes} / ${st.holdSaves}</td></tr>
        </table></div>
        ${scn.tutorial ? '' : `<div class="find"><h3>Red commander</h3>${S.red.length ? `<ul class="redl">${S.red.map(t => `<li><b>${esc(t.name)}</b>${t.reactive ? (t.used ? ` · fired at T+${fmtT(t.at)}` : ' · never triggered') : ''}<span>${esc(t.why)}</span></li>`).join('')}</ul><p class="eyebrow" style="letter-spacing:.04em">Red updates its picture of you after every battle you finish.</p>` : '<p class="eyebrow">Scripted raid. The red commander is off in Settings.</p>'}</div>`}
        ${scn.tutorial ? '' : '<div class="find" id="aGhost"><h3>Doctrinal ghost</h3><p class="eyebrow">Running a by-the-book crew on the same seed…</p></div>'}
      </div>
    </div>
    <div class="evl"><h3>Event log</h3><ol id="rEv">${S.ev.filter(x => !x.quiet).map(x => `<li data-t="${x.t}" class="${x.bad ? 'bad' : x.good ? 'good' : ''}"><span>${fmtT(x.t)}</span><span>${esc(x.text)}</span></li>`).join('')}</ol></div>
    <div class="go">
      ${nextTable ? `<button class="btn primary" type="button" id="aNext">Next: Table ${ROMAN[nextTable.table]}</button>` : ''}
      ${B.camp ? `<button class="btn primary" type="button" id="aCamp">Campaign</button>` : ''}
      <button class="btn${nextTable || B.camp ? '' : ' primary'}" type="button" id="aRetry">Fight again · same seed</button>
      <button class="btn" type="button" id="aNew">New seed</button>
      <button class="btn" type="button" id="aMenu">Menu</button>
    </div>`;
  const scnRef = scn, brief = B.brief;
  if (nextTable) $('#aNext').onclick = () => openBrief(nextTable);
  if (B.camp) $('#aCamp').onclick = () => campScreen();
  $('#aRetry').onclick = () => { if (B.camp){ campScreen(); return; } openBrief(scnRef); BR.seed = brief.seed; $('#bSeed').value = brief.seed; BR.site = brief.site; BR.ptl = brief.ptl; $('#bSites').querySelectorAll('button').forEach((x, i) => x.classList.toggle('on', i === BR.site)); briefDraw(); };
  $('#aRetry').hidden = !!B.camp;
  $('#aNew').onclick = () => openBrief(scnRef); $('#aNew').hidden = !!B.camp;
  $('#aMenu').onclick = () => openMenu();
  // timeline markers
  const tl = $('#rTl'), T = Math.max(1, S.t), P = pal();
  tl.innerHTML = S.ev.filter(x => ['ENG','KILL','MISS','HIT','VIOL','FRAT','VETO','ORDER','ID','LATE','FAULT'].includes(x.k)).map(x => `<i style="left:${(x.t / T * 100).toFixed(2)}%;background:${x.bad ? P.red : x.good ? P.green : x.k === 'ORDER' ? P.amber : x.k === 'ENG' ? P.cyan : P.dim}" title="${esc(fmtT(x.t) + ' ' + x.text)}"></i>`).join('');
  RP = {i:0, play:false, sp:6, truth:false, acc:0, last:performance.now()};
  $('#rPos').oninput = ev => { RP.i = +ev.target.value; drawReplay(); };
  $('#rPlay').onclick = () => { RP.play = !RP.play; if (RP.play && RP.i >= S.snaps.length - 1) RP.i = 0; $('#rPlay').textContent = RP.play ? 'PAUSE' : 'PLAY'; RP.last = performance.now(); if (RP.play) requestAnimationFrame(replayLoop); };
  $('#rSp').onclick = ev => { const b = ev.target.closest('button'); if (!b) return; RP.sp = +b.dataset.s; $$('#rSp button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#rTruth').onclick = () => { RP.truth = !RP.truth; $('#rTruth').classList.toggle('on', RP.truth); drawReplay(); };
  const seat = $('#rSeat'); seat.disabled = !!B.camp || !!scn.tutorial;
  seat.onclick = () => { const snap = S.snaps[RP.i]; if (!snap) return; RP.play = false; const n = Math.max(1, Math.round(snap.t / H.DT)); const ns = H.rewind(S.scn, S.opts, S.inputs, n); launchBattle(ns, {camp:null, brief:B.brief}); };
  if (!scn.tutorial) setTimeout(() => runGhostAAR(), 80);
  $('#rEv').onclick = ev => { const li = ev.target.closest('li'); if (!li) return; RP.i = Math.max(0, S.snaps.findIndex(s => s.t >= +li.dataset.t) - 2); $('#rPos').value = RP.i; drawReplay(); $('#rBox').scrollIntoView({behavior:'smooth', block:'nearest'}); };
  requestAnimationFrame(drawReplay);
}
function runGhostAAR(){
  const el = $('#aGhost'); if (!el || UI.screen !== 'aar') return;
  const mine = S; let g;
  try { g = H.runGhost(mine.scn, mine.opts); } catch (e) { el.innerHTML = '<h3>Doctrinal ghost</h3><p class="eyebrow">The ghost crew could not run this battle.</p>'; return; }
  if (S !== mine) return;
  const me = {}; for (const x of S.ev) if (x.k === 'ENG' && x.uid) me[x.uid] = {t:x.t, kind:x.kind};
  const div = [];
  for (const [uid, v] of Object.entries(me)) if (!(uid in g.engaged)) div.push({t:v.t, txt:`You engaged a ${(TYPES[v.kind] || {}).name ? TYPES[v.kind].name.toLowerCase() : 'track'} at T+${fmtT(v.t)}. The ghost held fire.`});
  for (const [uid, t] of Object.entries(g.engaged)) if (!(uid in me)) div.push({t, txt:`The ghost engaged a ${(TYPES[g.kinds[uid]] || {}).name ? TYPES[g.kinds[uid]].name.toLowerCase() : 'track'} at T+${fmtT(t)}. You never did.`});
  div.sort((a, b) => a.t - b.t);
  const d = S.score.total - g.score.total, gs = g.st;
  el.innerHTML = `<h3>Doctrinal ghost</h3><p><b>${g.score.total}</b> for a by-the-book crew on the same seed, against your <b>${S.score.total}</b>. ${d > 0 ? 'You beat doctrine.' : d === 0 ? 'You matched doctrine.' : 'Doctrine beat you by ' + (-d) + ' points.'}</p>
    <table class="cmp"><tr><td></td><td>YOU</td><td>GHOST</td></tr><tr><td>Missiles fired</td><td>${S.st.fired.MSE + S.st.fired.GEMT + (S.st.fired.THAAD || 0)}</td><td>${gs.fired.MSE + gs.fired.GEMT + (gs.fired.THAAD || 0)}</td></tr><tr><td>Kills</td><td>${S.st.kills}</td><td>${gs.kills}</td></tr><tr><td>Leakers</td><td>${S.st.leak}</td><td>${gs.leak}</td></tr><tr><td>Wasted shots</td><td>${S.st.wasted}</td><td>${gs.wasted}</td></tr><tr><td>Violations</td><td>${S.st.viol}</td><td>${gs.viol}</td></tr></table>
    ${div.length ? `<b>Where you diverged</b><ul>${div.slice(0, 6).map(x => `<li>${esc(x.txt)}</li>`).join('')}</ul>` : '<p class="eyebrow">Every engagement matched the ghost.</p>'}
    <p class="eyebrow" style="letter-spacing:.04em">The ghost flies semiautomatic, identifies from IFF, routes and altitude behaviour, goes silent when an ARM closes inside 45 km, and lets its TCA handle reloads and faults.</p>`;
}
function replayLoop(now){
  if (!RP || !RP.play || UI.screen !== 'aar') return;
  RP.acc += (now - RP.last) / 1000 * RP.sp; RP.last = now;
  while (RP.acc >= 1){ RP.acc -= 1; RP.i++; }
  if (RP.i >= S.snaps.length - 1){ RP.i = S.snaps.length - 1; RP.play = false; $('#rPlay').textContent = 'PLAY'; }
  $('#rPos').value = RP.i; drawReplay();
  if (RP.play) requestAnimationFrame(replayLoop);
}
function drawReplay(){
  if (!RP || UI.screen !== 'aar') return;
  const snap = S.snaps[RP.i]; if (!snap) return;
  const cv = $('#rMap'), {W, H:Hh, dpr} = sizeCanvas(cv), ctx = cv.getContext('2d');
  const v = {cx:S.bat.x + H.polar(snap.bat.ptl, 40).x, cy:S.bat.y + H.polar(snap.bat.ptl, 40).y, s:Math.min(W, Hh) / 2 / 115, W, H:Hh, tilt:false};
  const hist = {};
  for (let j = Math.max(0, RP.i - 20); j < RP.i; j += 4) for (const e of S.snaps[j].e) if (e[6]) (hist[e[0]] = hist[e[0]] || []).push([e[1], e[2], e[3]]);
  const ents = snap.e.map(e => ({uid:e[0], x:e[1], y:e[2], z:e[3], kind:e[4], truth:e[5], trk:e[6] ? {num:e[6], id:e[7], remote:e[8] === 2, cls:true} : null, vx:e[9], vy:e[10], ball:!!TYPES[e[4]].ballistic, clsLbl:TYPES[e[4]].cls, hist:hist[e[0]]}));
  const evNow = S.ev.filter(x => x.t > snap.t - 1 && x.t <= snap.t && (x.k === 'KILL' || x.k === 'HIT'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScope(ctx, v, {mapKey:S.scn.map, bat:{...snap.bat}, launchers:S.launchers, thaad:S.thaad, cuas:S.cuas, assets:S.assets.map((a, i) => ({...a, hp:snap.hp[i]})), ents, ms:snap.m.map(m => ({x:m[0], y:m[1], z:m[2], own:!!m[3]})), neighbors:S.neighbors, truth:RP.truth, bty:S.scn.bty.split(' ')[0],
    fx:evNow.filter(x => x.x != null).map(x => ({k:'impact', x:x.x, y:x.y, t0:0, dur:2})), scars:[]}, 1);
  $('#rT').textContent = 'T+' + fmtT(snap.t);
}

// ---------- campaign ----------
function campMenuHtml(){
  const can = unlocked();
  const cards = Object.entries(CAMPAIGNS).map(([k, c]) => {
    const st = store.d.camp[k];
    const prog = st && !st.over ? `Battle ${st.idx + 1} of ${c.scenarios.length} · ${st.stock.MSE} MSE · ${st.stock.GEMT} GEM-T${st.stock.THAAD != null ? ' · ' + st.stock.THAAD + ' THAAD' : ''}` : st && st.over ? (st.dead ? 'Last run: relieved of duty' : `Last run complete · ${st.scores.reduce((a, b) => a + b, 0)} points`) : 'Not started';
    return `<div class="scn${can ? '' : ' locked'}" style="cursor:default"><span class="tag">${THEATERS[k].toUpperCase()} · ${c.scenarios.length} BATTLES</span><span class="n">${esc(c.name)}</span><span class="pl">${esc(prog)}</span>
      ${c.inspired ? `<span class="in">${esc(c.inspired)}</span>` : ''}
      <span class="sh">${k === 'ME' ? 'From Al Udeid to Nevatim. Missile stock carries over; resupply convoys arrive between battles, sometimes short.' : k === 'EU' ? 'From Jasionka to Sliač. Decoys, jammers, ARMs and recon drones. Every missile counts across seven battles.' : 'Day 1 to day 21 of a regional war. One national interceptor pool, almost no resupply, partners running dry beside you. The leak rate climbs as the magazine falls.'}</span>
      <span class="sh" style="color:var(--dim)">Ironman: a fratricide ends the deployment.</span>
      <div class="go" style="margin-top:8px">${can ? (st && !st.over ? `<button class="btn primary sm" type="button" data-camp="${k}">Continue</button><button class="btn sm" type="button" data-camp="${k}" data-new="1">Restart</button>` : `<button class="btn primary sm" type="button" data-camp="${k}" data-new="1">Deploy</button>`) : '<span class="eyebrow">Pass Table VIII to unlock</span>'}</div></div>`;
  }).join('');
  return `<p class="mintro">Run a theater as a deployment. Your missile stock persists between battles, your crew gains experience (faster reaction and reloads), and the TD's trust shapes how much resupply you get.</p><div class="scn-grid">${cards}</div>`;
}
function campStart(k, fresh){
  if (fresh || !store.d.camp[k] || store.d.camp[k].over) store.d.camp[k] = {th:k, idx:0, stock:{...CAMPAIGNS[k].stock}, trust:50, xp:0, scores:[], over:false, dead:false, seed:randSeed(), log:[], partners:(CAMPAIGNS[k].partners || []).map(p => ({name:p.name, v:p.start}))};
  store.save(); UI.camp = k; campScreen();
}
function campScreen(){
  const k = UI.camp, st = store.d.camp[k], c = CAMPAIGNS[k]; show('camp');
  const total = st.scores.reduce((a, b) => a + b, 0);
  $('#campBody').innerHTML = `<button class="btn sm" type="button" id="cBack">← Menu</button>
    <div class="eyebrow" style="margin-top:14px">CAMPAIGN · ${THEATERS[k].toUpperCase()}</div><h2>${esc(c.name)}</h2>${c.inspired ? `<div class="insp">${esc(c.inspired)}</div>` : ''}
    <div class="camp-stats"><div><div class="l">PAC-3 MSE STOCK</div><div class="v">${st.stock.MSE}</div></div><div><div class="l">GEM-T STOCK</div><div class="v">${st.stock.GEMT}</div></div>${st.stock.THAAD != null ? `<div><div class="l">THAAD STOCK</div><div class="v">${st.stock.THAAD}</div></div>` : ''}<div><div class="l">TD TRUST</div><div class="v">${st.trust}</div></div><div><div class="l">CREW EXPERIENCE</div><div class="v">${st.xp.toFixed(1)}</div></div><div><div class="l">TOTAL SCORE</div><div class="v">${total}</div></div></div>
    <div class="days">${c.scenarios.map((id, i) => { const s = byId(id); return `<div class="day${i === st.idx && !st.over ? ' cur' : i < st.idx ? ' done' : ''}"><span class="d">DAY ${c.days ? c.days[i] : i * 4 + 1}</span><span><b>${esc(s.name)}</b> · ${esc(s.place)}</span><span class="d">${i < st.scores.length ? st.scores[i] + ' pts' : i === st.idx && !st.over ? 'NEXT' : ''}</span></div>`; }).join('')}</div>
    ${(st.partners || []).length ? `<h3>Theater magazine · partner interceptor stocks</h3><div class="partners">${st.partners.map(p => `<div><span>${esc(p.name)}</span><span class="bar ${p.v < 30 ? 'low' : ''}"><i style="width:${Math.max(0, p.v)}%"></i></span><b>${Math.max(0, Math.round(p.v))}%</b></div>`).join('')}</div><p class="eyebrow" style="letter-spacing:.04em">Estimates shaped on open reporting (JINSA, March 2026). As partners run dry, more of the raid comes your way.</p>` : ''}
    ${theaterMap(k, st)}
    ${st.log.length ? `<p class="coach-brief">${esc(st.log[st.log.length - 1])}</p>` : ''}
    <div class="go">${st.over ? `<span class="verdict ${st.dead ? 'fail' : 'pass'}">${st.dead ? 'Relieved of duty. Deployment over.' : 'Deployment complete.'}</span><button class="btn primary" type="button" id="cAgain">Deploy again</button>` : `<button class="btn primary big" type="button" id="cGo">Brief day ${c.days ? c.days[st.idx] : st.idx * 4 + 1}</button>`}</div>`;
  $('#cBack').onclick = () => openMenu('CAMP');
  if (st.over) $('#cAgain').onclick = () => campStart(k, true);
  else $('#cGo').onclick = () => openBrief(byId(c.scenarios[st.idx]), st);
}
function campAfter(st, Sm){
  const sc = Sm.score.total, rem = H.remaining(Sm), c = CAMPAIGNS[st.th];
  const unused = {MSE:st.stock.MSE - Sm.loaded.MSE, GEMT:st.stock.GEMT - Sm.loaded.GEMT, THAAD:st.stock.THAAD != null ? st.stock.THAAD - Sm.loaded.THAAD : 0};
  st.scores.push(sc);
  st.fatigue = st.fatigue || {}; for (const c of H.CREW){ const f = st.fatigue[c.id] || 0; st.fatigue[c.id] = Math.max(0, Math.min(.8, c.id === Sm.tca.id ? f + .14 : f - .1)); }
  st.xp = Math.min(5, st.xp + (sc >= 80 ? 1 : .5));
  st.trust = Math.max(0, Math.min(100, st.trust + (sc >= 85 ? 8 : sc >= 70 ? 3 : -6) - 5 * Sm.st.viol));
  let msg;
  if (Sm.st.frat){ st.over = true; st.dead = true; msg = 'A protected aircraft went down. The brigade relieved the crew. Deployment over.'; }
  else {
    st.idx++;
    const r = (n => () => { n = (n * 9301 + 49297) % 233280; return n / 233280; })(st.seed + st.idx * 77);
    const late = r() < .2, rs = c.resupply, rr = (k2, lo, hi) => rs ? Math.round(rs[k2][0] + r() * (rs[k2][1] - rs[k2][0])) : Math.round(lo + r() * (hi - lo));
    const addM = late ? 0 : Math.max(0, rr('MSE', 6, 12) + (rs ? 0 : (st.trust >= 70 ? 4 : st.trust < 35 ? -3 : 0)));
    const addG = late ? 0 : rr('GEMT', 2, 6), addT = late || !rs ? 0 : rr('THAAD', 0, 0);
    st.stock = {MSE:Math.max(0, unused.MSE) + rem.MSE + addM, GEMT:Math.max(0, unused.GEMT) + rem.GEMT + addG};
    if (CAMPAIGNS[st.th].stock.THAAD != null) st.stock.THAAD = Math.max(0, unused.THAAD) + rem.THAAD + addT;
    for (const [i, p] of (st.partners || []).entries()){ const P = c.partners[i]; p.v = Math.max(0, p.v - (P.burn[st.idx - 1] || 5)); }
    const tx = st.stock.THAAD != null ? `, ${st.stock.THAAD} THAAD` : '';
    msg = late ? `Resupply delayed. No new missiles. Stock carried forward: ${st.stock.MSE} MSE, ${st.stock.GEMT} GEM-T${tx}.` : `Resupply arrived: ${addM} MSE and ${addG} GEM-T${addT ? ' and ' + addT + ' THAAD' : ''}. Stock now ${st.stock.MSE} MSE, ${st.stock.GEMT} GEM-T${tx}.`;
    if (st.idx >= c.scenarios.length){ st.over = true; msg += ' Deployment complete.'; }
  }
  st.log.push(msg); store.d.camp[st.th] = st;
  return msg;
}

const GULF = [[48.5,30.0],[48.0,29.3],[48.6,28.0],[49.6,27.0],[50.2,26.2],[50.8,25.6],[51.0,26.1],[51.6,25.9],[51.6,24.6],[52.0,24.0],[54.5,24.4],[56.0,25.6],[56.4,26.3],[57.2,25.5],[57.6,26.6],[56.3,27.1],[54.0,26.6],[52.0,27.6],[50.8,28.9],[50.0,30.0]];
const MED = [[33,31.0],[34.2,31.3],[34.9,32.8],[35.5,33.9],[35.9,35.0],[35.9,36.0],[36.2,36.7],[33,37.0]];
const REDSEA = [[33,28.8],[34.6,29.5],[35.0,28.0],[36.4,26.0],[38.0,23.0],[39.0,22.0],[33,22.0]];
const CASP = [[49.0,37.0],[49.0,38.0],[51.0,37.0],[53.9,37.0],[53.9,38.2],[49.0,38.2]];
function theaterMap(k, st){
  if (k !== 'IR') return '';
  const c = CAMPAIGNS[k], P = [[34.9, 31.0, 'Negev'], [36.8, 31.8, 'Azraq'], [51.3, 25.1, 'Al Udeid'], [52.7, 24.1, 'Ruwais']], ir = [51.4, 35.7];
  const X = lon => 30 + (lon - 33) / 25 * 600, Y = lat => 20 + (37.2 - lat) / 15 * 330;
  const sites = {me10:'Ruwais', me12:'Al Udeid', me11:'Azraq', me13:'Negev'};
  const done = c.scenarios.slice(0, st.idx).map(id => sites[id]), cur = !st.over ? sites[c.scenarios[st.idx]] : null;
  return `<h3>Theater</h3><svg class="thmap" viewBox="0 0 660 360" role="img" aria-label="Theater map: Iran and the defended sites">
    <rect x="0" y="0" width="660" height="360" rx="10" class="thbg"/>
    ${[GULF, MED, REDSEA, CASP].map(poly => `<path d="M${poly.map(q => X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1)).join(' L')} Z" class="thsea"/>`).join('')}
    <text x="${X(53)}" y="${Y(33)}" class="thl">IRAN</text><text x="${X(44)}" y="${Y(28)}" class="thl">SAUDI ARABIA</text><text x="${X(43)}" y="${Y(33)}" class="thl">IRAQ</text><text x="${X(50.5)}" y="${Y(27.2)}" class="thw">GULF</text>
    ${P.map(p => `<path d="M${X(ir[0])} ${Y(ir[1])} Q ${(X(ir[0]) + X(p[0])) / 2} ${Math.min(Y(ir[1]), Y(p[1])) - 40} ${X(p[0])} ${Y(p[1])}" class="tharc${cur === p[2] ? ' cur' : ''}"/>`).join('')}
    <circle cx="${X(ir[0])}" cy="${Y(ir[1])}" r="6" class="thr"/><text x="${X(ir[0]) + 10}" y="${Y(ir[1]) + 4}" class="thl">LAUNCH AREAS</text>
    ${P.map(p => `<g><circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${cur === p[2] ? 8 : 6}" class="ths${cur === p[2] ? ' cur' : done.includes(p[2]) ? ' done' : ''}"/><text x="${X(p[0]) + 10}" y="${Y(p[1]) + 4}" class="thn">${p[2]}</text></g>`).join('')}
  </svg>`;
}

// ---------- library ----------
function openLib(){
  show('lib');
  const rows = Object.entries(TYPES).filter(([k]) => k !== 'FALSE').map(([k, t]) => `<tr><td class="nm">${esc(t.name)}</td><td>${esc(t.analog)}</td><td class="num">${t.cls}</td><td>${esc(t.role)}</td><td class="num">${t.ballistic ? Math.round(t.speed * 1000) + ' m/s' : Math.round(t.speed * 1944) + ' kt'}</td><td class="num">${t.truth === 'H' ? Math.round(t.pk.GEMT * 100) + '% / ' + Math.round(t.pk.MSE * 100) + '%' + (t.pk.THAAD ? ' / ' + Math.round(t.pk.THAAD * 100) + '%' : '') : '—'}</td></tr>`).join('');
  const wr = Object.values(WEAPONS).map(w => `<tr><td class="nm">${w.name}</td><td>${esc(w.full)}</td><td>${w.fuze}</td><td class="num">${w.rAir ? w.rAir + ' km' : '—'}</td><td class="num">${w.rTbm} km</td><td class="num">${w.minAlt ? w.minAlt + '–' : ''}${w.maxAlt} km</td><td class="num">$${w.cost}M</td></tr>`).join('');
  const g = [['Tactical Control Officer (TCO)','You. The officer at manstation one in the Engagement Control Station who decides identity and engagements.'],['Tactical Control Assistant (TCA)','Your crewmate at manstation two. Calls tracks, faults and launches.'],['Tactical Director (TD)','The battalion officer who runs the air battle and issues orders.'],['Primary Target Line (PTL)','The centre of the radar’s 120° search sector. Set at emplacement; changing it takes the radar offline.'],['Defended Asset List (DAL)','The prioritized list of what you protect. Priority 1 matters most.'],['Air Defense Warning (ADW)','White: attack unlikely. Yellow: attack probable. Red: attack imminent or under way.'],['Weapons Control Status (WCS)','Hold: self-defense only. Tight: fire only at tracks identified Hostile. Free: fire at anything not identified Friend.'],['Fire control orders','Engage, Hold Fire (stop and destroy missiles in flight), Cease Fire (launch nothing), Cover.'],['Engagement modes','Manual: you approve every shot. Semiautomatic: you identify, the computer engages Hostile DAL threats. Automatic: the computer also identifies, with a veto window.'],['IFF','Mode 4 VALID = friendly military transponder. Mode 3/C = civil squawk and altitude. NO RESP = silent.'],['Shot doctrine','Single shot, Ripple (two missiles 1.5 s apart), or Shoot-Look-Shoot (one missile, assess, fire again).'],['EMCON','Emission control. Silencing the radar defeats anti-radiation missiles and blinds you at the same time.'],['ALT VAR','Altitude variation of a track over the last 15 seconds. Decoys hold a fixed altitude.'],['Remote track','A track passed by another battery over the network. You need your own radar track to fire.']];
  $('#libBody').innerHTML = `<button class="btn sm" type="button" id="lBack">← Menu</button>
    <div class="eyebrow" style="margin-top:14px">ENCYCLOPEDIA</div><h2>Threat library</h2>
    <p class="mintro">Every number below is a game value: rounded, tuned for play, and built only from open sources. Slow movers (drones, helicopters) fly about four times real speed to fit a 10 to 15 minute battle.</p>
    <div class="tblwrap"><table class="lib"><thead><tr><th>CLASS</th><th>REAL-WORLD ANALOG</th><th>SYM</th><th>ROLE</th><th>SPEED</th><th>P(K) GEM-T / MSE / THAAD</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2 style="margin-top:28px">Interceptors</h2>
    <div class="tblwrap"><table class="lib"><thead><tr><th>ROUND</th><th>FULL NAME</th><th>KILL MECHANISM</th><th>RANGE · AIR</th><th>RANGE · TBM</th><th>CEILING</th><th>COST</th></tr></thead><tbody>${wr}</tbody></table></div>
    <p class="mintro" style="margin-top:10px">Launcher loads follow the M903: 12 PAC-3 MSE, 4 GEM-T, or a mix of 6 MSE and 2 GEM-T. The fire unit pairs the AN/MPQ-65 radar with the AN/MSQ-132 Engagement Control Station.</p>
    <h2 style="margin-top:28px">Doctrine and terms</h2>
    <div class="gloss">${g.map(x => `<div><b>${esc(x[0])}</b>${esc(x[1])}</div>`).join('')}</div>
    <h2 style="margin-top:28px">Open sources</h2>
    <ul class="intel"><li><a href="https://en.wikipedia.org/wiki/MIM-104_Patriot" target="_blank" rel="noopener" style="color:var(--cyan)">MIM-104 Patriot (Wikipedia)</a></li><li><a href="https://www.globalsecurity.org/space/library/policy/army/fm/44-85/Appb.htm" target="_blank" rel="noopener" style="color:var(--cyan)">FM 44-85, Appendix B (GlobalSecurity)</a></li><li><a href="https://militaryembedded.com/radar-ew/sensors/sweden-requests-patriot-configuration-3-in-fms-valued-at-3-2-billion" target="_blank" rel="noopener" style="color:var(--cyan)">Sweden Configuration 3+ FMS notification</a></li><li><a href="https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2023/spain-to-secure-2-8-billion-of-us-patriot-configuration-3-modernized-fire-units" target="_blank" rel="noopener" style="color:var(--cyan)">Spain Configuration 3+ and PDB-8 interface</a></li></ul>
    <h2 style="margin-top:28px">Keys</h2>
    <p class="mintro">Space acknowledge · 1–5 identity (Friend, Neutral, Unknown, Suspect, Hostile) · I interrogate · E engage · H hold fire · U counter-drone on the hooked drone · V veto · Tab next threat · M cycle mode · G swap Patriot and THAAD seats · R cycle video (blended, synthetic, raw) · P pause · [ ] speed · + − zoom · T 3D · C centre · Esc unhook.</p>`;
  $('#lBack').onclick = () => openMenu();
}

// ---------- settings ----------
function openSet(){
  show('set');
  const s = store.s, can = unlocked();
  const row = (l, d, ctl) => `<div class="setrow"><div><div class="l">${l}</div><div class="d">${d}</div></div><div>${ctl}</div></div>`;
  const seg = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(o => `<button type="button" data-v="${o[0]}" class="${String(o[0]) === String(cur) ? 'on' : ''}">${o[1]}</button>`).join('')}</div>`;
  $('#setBody').innerHTML = `<button class="btn sm" type="button" id="sBack">← Menu</button><h2 style="margin-top:14px">Settings</h2>
    ${row('Console', can ? 'WMI is the modern Config 3+ display. Legacy is the green phosphor console.' : 'Legacy console unlocks when you pass Table VIII.', seg('setSkin', [['wmi','WMI'], ['legacy', can ? 'LEGACY' : 'LEGACY · LOCKED']], s.skin))}
    ${row('Voice', 'TCA and TD callouts through your browser’s speech engine.', seg('setVoice', [[true,'ON'], [false,'OFF']], s.voice))}
    ${row('Volume', 'Alerts, ambience and voice.', `<input type="range" id="setVol" min="0" max="1" step=".05" value="${s.vol}" style="width:100%;max-width:280px;accent-color:var(--amber)">`)}
    ${row('Radar display', 'Clean is what the operator really sees: a computer-drawn picture with no beam on screen. Beams and Sweep are stylized views: beams shows the phased array hopping its search beam and revisiting tracks; sweep is the rotating beam from earlier versions.', seg('setScan', [['CLEAN','CLEAN'], ['PA','BEAMS'], ['SWEEP','SWEEP']], s.scan || 'CLEAN'))}
    ${row('Track symbols', 'House frames, or filled frames with a class letter in the style of MIL-STD-2525.', seg('setSym', [['house','HOUSE'], ['2525','2525 FILLED']], s.sym || 'house'))}
    ${row('Expert mode', 'ENGAGE fires on tap and confirmation prompts disappear, except ROE warnings.', seg('setExp', [[false,'OFF'], [true,'ON']], s.expert))}
    ${row('Equipment faults', 'How often the radar, launchers and power plant break during a battle.', seg('setDiff', [['off','OFF'], ['normal','NORMAL'], ['hard','HARD']], s.diff))}
    ${row('Default speed', 'Time compression at the start of each battle.', seg('setSpd', [[1,'1×'], [2,'2×']], s.speed))}
    ${row('Red commander', `Adaptive: red studies your habits and plans each raid against them. ${(store.d.red && store.d.red.battles) ? 'Battles studied: ' + store.d.red.battles + '.' : 'No battles studied yet.'}`, seg('setRed', [['adaptive','ADAPTIVE'], ['scripted','SCRIPTED']], s.red || 'adaptive') + ' <button class="btn sm" type="button" id="setRedReset">Wipe red\'s file on you</button>')}
    ${row('Unlock everything', 'Open every table, the campaign and the legacy console without certifying.', seg('setUnl', [[false,'OFF'], [true,'ON']], s.unlockAll))}
    ${row('Reset progress', 'Clears passed tables, best scores and campaigns on this device.', '<button class="btn danger sm" type="button" id="setReset">Reset</button>')}`;
  const bind = (id, key, conv, after) => $('#' + id).querySelectorAll('button').forEach(b => b.onclick = () => { if (id === 'setSkin' && b.dataset.v === 'legacy' && !unlocked()) return; s[key] = conv(b.dataset.v); store.save(); $('#' + id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); after && after(); });
  bind('setSkin', 'skin', v => v, applySkin); bind('setVoice', 'voice', v => v === 'true', () => { if (!s.voice) VO.stop(); });
  bind('setExp', 'expert', v => v === 'true'); bind('setRed', 'red', v => v); bind('setSym', 'sym', v => v); bind('setScan', 'scan', v => v);
  $('#setRedReset').onclick = () => { store.d.red = {}; store.save(); openSet(); }; bind('setDiff', 'diff', v => v); bind('setSpd', 'speed', v => +v); bind('setUnl', 'unlockAll', v => v === 'true', () => { applySkin(); openSet(); });
  $('#setVol').oninput = ev => { s.vol = +ev.target.value; AU.vol(s.vol); store.save(); };
  $('#setReset').onclick = () => modal('Reset progress', '<p>This clears every passed table, best score and campaign on this device.</p>', [{t:'Cancel'}, {t:'Reset', cls:'danger', f:() => { store.d.p = {tables:{}, best:{}, cert:false, plays:0}; store.d.camp = {}; store.save(); applySkin(); openSet(); }}], true);
  $('#sBack').onclick = () => openMenu();
}

// ---------- boot ----------
function boot(){
  applySkin(); VO.init(); wireBattle();
  $('#btnEnter').onclick = () => { AU.init(); AU.tone('order'); openMenu(); };
  $('#menuTabs').onclick = ev => { const b = ev.target.closest('button'); if (b) openMenu(b.dataset.tab); };
  $$('[data-go]').forEach(b => b.onclick = () => b.dataset.go === 'lib' ? openLib() : openSet());
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('#modal').hidden){ $('#modal').hidden = true; } });
  show('title'); titleRAF = requestAnimationFrame(titleAnim);
  try { if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude|anthropic/.test(location.hostname)) navigator.serviceWorker.register('sw.js').catch(() => {}); } catch (e) {}
}
boot();
})();
