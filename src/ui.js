// HOSTILE TRACK — ECS console, rendering, audio, tutorial, campaign and AAR.
(() => {
const {SCN, CAMPAIGNS, THEATERS, TYPES, WEAPONS, MAP} = HT_DATA;
const H = HT_SIM;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad = (n, l = 2) => String(n).padStart(l, '0');
const fmtT = t => `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}`;
const byId = id => SCN.find(s => s.id === id);

// ---------- persistence ----------
const store = {
  d:{s:{skin:'wmi', voice:true, vol:.7, expert:false, diff:'normal', speed:1, unlockAll:false}, p:{tables:{}, best:{}, cert:false, plays:0}, camp:{}},
  load(){ try { const j = JSON.parse(localStorage.getItem('hostiletrack.v1') || 'null'); if (j){ Object.assign(this.d.s, j.s || {}); Object.assign(this.d.p, j.p || {}); this.d.camp = j.camp || {}; } } catch (e) {} },
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

const terrCache = {}, gridCache = {};
function terrainImg(mk){
  const P = pal(), key = mk + (P.legacy ? 'L' : 'W'); if (terrCache[key]) return terrCache[key];
  const map = MAP[mk], N = 400, c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N), hg = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hg[j * N + i] = H.heightAt(map, -200 + i + .5, 200 - j - .5);
  const at = (i, j) => hg[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
  // dark, desaturated tactical map: hillshade + contour lines every 200 m
  const L0 = P.legacy ? [2, 14, 5] : [15, 20, 19], L1 = P.legacy ? [8, 40, 13] : [40, 44, 38], SEA = P.legacy ? [1, 6, 2] : [6, 13, 18], CO = P.legacy ? [40, 150, 55] : [92, 132, 138], CT = P.legacy ? [20, 80, 28] : [58, 70, 62];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const h = at(i, j), o = (j * N + i) * 4;
    if (h < 0){
      const coast = at(i + 1, j) >= 0 || at(i - 1, j) >= 0 || at(i, j + 1) >= 0 || at(i, j - 1) >= 0;
      const col = coast ? CO : SEA, n = ((i * 7 + j * 13) % 5) * .4;
      img.data[o] = col[0] + n; img.data[o + 1] = col[1] + n; img.data[o + 2] = col[2] + n; img.data[o + 3] = 255; continue;
    }
    const dzx = at(i + 1, j) - at(i - 1, j), dzy = at(i, j - 1) - at(i, j + 1);
    const l = Math.max(.45, Math.min(1.5, 1 + (-dzx + dzy) * 2.6));
    const k = Math.min(1, h / 1.6);
    const ci = .45, c0 = Math.floor(h / ci), contour = h > .2 && (c0 !== Math.floor(at(i + 1, j) / ci) || c0 !== Math.floor(at(i, j + 1) / ci));
    const steep = Math.abs(dzx) + Math.abs(dzy) > .18;
    for (let q = 0; q < 3; q++){ const base = Math.min(255, (L0[q] + (L1[q] - L0[q]) * k) * l); img.data[o + q] = contour && !steep ? base * .55 + CT[q] * .45 : base; }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (terrCache[key] = c);
}
function heightGrid(mk){
  if (gridCache[mk]) return gridCache[mk];
  const map = MAP[mk], g = [];
  for (let j = 0; j <= 80; j++){ const row = []; for (let i = 0; i <= 80; i++) row.push(H.heightAt(map, -200 + i * 5, 200 - j * 5)); g.push(row); }
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
function lowLine(map, mk, bx, by, ptl){
  const key = mk + bx + ',' + by + ',' + ptl; if (lowCache[key]) return lowCache[key];
  const pts = []; for (let a = ptl - 60; a <= ptl + 60.01; a += 2){ const r = H.lowAltReach(map, bx, by, a, .1); const p = H.polar(a, r, {x:bx, y:by}); pts.push([p.x, p.y]); }
  return (lowCache[key] = pts);
}

// static layer: terrain, overlays, rings, fan, assets, battery
function drawBase(ctx, v, M){
  const P = pal(), map = MAP[M.mapKey];
  ctx.save();
  ctx.fillStyle = map.landDefault ? (P.legacy ? '#020c04' : '#111614') : P.sea; ctx.fillRect(0, 0, v.W, v.H);
  if (!v.tilt){
    const a = proj(v, -200, 200), img = terrainImg(M.mapKey);
    ctx.imageSmoothingEnabled = true; ctx.globalAlpha = .9; ctx.drawImage(img, a[0], a[1], 400 * v.s, 400 * v.s); ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = P.bg; ctx.fillRect(0, 0, v.W, v.H);
    const g = heightGrid(M.mapKey); ctx.lineWidth = 1; ctx.strokeStyle = P.grid;
    for (let j = 0; j <= 80; j++){ ctx.beginPath(); let st = false; for (let i = 0; i <= 80; i++){ const h = g[j][i], q = proj(v, -200 + i * 5, 200 - j * 5, Math.max(0, h) * 1.2); if (q[1] < -50 || q[1] > v.H + 50){ st = false; continue; } st ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); st = true; } ctx.stroke(); }
    for (let i = 0; i <= 80; i += 2){ ctx.beginPath(); let st = false; for (let j = 0; j <= 80; j++){ const h = g[j][i], q = proj(v, -200 + i * 5, 200 - j * 5, Math.max(0, h) * 1.2); if (q[1] < -50 || q[1] > v.H + 50){ st = false; continue; } st ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); st = true; } ctx.stroke(); }
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
  const B = M.bat;
  ctx.strokeStyle = P.line2; ctx.lineWidth = 1; ctx.font = `10px ${P.mono}`; ctx.fillStyle = P.faint;
  for (const r of [25, 50, 100, 150]){ circleW(ctx, v, B.x, B.y, r); ctx.globalAlpha = .6; ctx.stroke(); ctx.globalAlpha = 1; const q = proj(v, B.x, B.y + r); ctx.fillText(r + '', q[0] + 3, q[1] + 11); }
  if (!v.tilt){
    for (let a = 0; a < 360; a += 10){ const big = a % 30 === 0, p1 = H.polar(a, big ? 150 : 154, B), p2 = H.polar(a, 158, B), q1 = proj(v, p1.x, p1.y), q2 = proj(v, p2.x, p2.y); ctx.beginPath(); ctx.moveTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.strokeStyle = P.line2; ctx.stroke(); if (big){ const p3 = H.polar(a, 166, B), q3 = proj(v, p3.x, p3.y); ctx.textAlign = 'center'; ctx.fillText(pad(a, 3), q3[0], q3[1] + 3); ctx.textAlign = 'left'; } }
  }
  for (const nb of M.neighbors || []){
    const pts = [[nb.x, nb.y]]; for (let a = nb.ptl - 60; a <= nb.ptl + 60.1; a += 4){ const p = H.polar(a, 150, nb); pts.push([p.x, p.y]); } pts.push([nb.x, nb.y]);
    polyline(ctx, v, pts); ctx.setLineDash([4, 6]); ctx.strokeStyle = nb.on ? P.violet : P.faint; ctx.globalAlpha = .55; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const q = proj(v, nb.x, nb.y); ctx.fillStyle = nb.on ? P.violet : P.faint; ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6); ctx.fillText(nb.name + (nb.on ? '' : ' · OFF'), q[0] + 6, q[1] - 6);
  }
  if (M.showFan !== false){
    const ptl = M.ptlPreview != null ? M.ptlPreview : B.ptl;
    const pts = [[B.x, B.y]]; for (let a = ptl - 60; a <= ptl + 60.01; a += 2){ const p = H.polar(a, H.RADAR.rmax, B); pts.push([p.x, p.y]); } pts.push([B.x, B.y]);
    polyline(ctx, v, pts);
    const q0 = proj(v, B.x, B.y), gr = ctx.createRadialGradient(q0[0], q0[1], 0, q0[0], q0[1], H.RADAR.rmax * v.s);
    const on = B.on !== false, cc = P.legacy ? '90,255,130' : '82,205,224';
    gr.addColorStop(0, on ? `rgba(${cc},.10)` : 'rgba(120,120,120,.05)'); gr.addColorStop(1, on ? `rgba(${cc},.025)` : 'rgba(120,120,120,.02)');
    ctx.fillStyle = gr; ctx.fill();
    ctx.strokeStyle = on ? P.cyan : P.faint; ctx.globalAlpha = .5; ctx.stroke(); ctx.globalAlpha = 1;
    const low = lowLine(map, M.mapKey, B.x, B.y, ptl); polyline(ctx, v, low); ctx.setLineDash([3, 4]); ctx.strokeStyle = P.amber; ctx.globalAlpha = .6; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const lp = low[Math.floor(low.length * .8)], lq = proj(v, lp[0], lp[1]); ctx.fillStyle = P.amber; ctx.globalAlpha = .75; ctx.fillText('100 m LIMIT', lq[0] + 4, lq[1] - 3); ctx.globalAlpha = 1;
    const pe = H.polar(ptl, H.RADAR.rmax, B); polyline(ctx, v, [[B.x, B.y], [pe.x, pe.y]]); ctx.setLineDash([10, 6]); ctx.strokeStyle = P.amber; ctx.globalAlpha = .55; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const pq = proj(v, H.polar(ptl, 130, B).x, H.polar(ptl, 130, B).y); ctx.fillStyle = P.amber; ctx.font = `600 11px ${P.mono}`; ctx.fillText('PTL ' + pad(Math.round(ptl) % 360, 3), pq[0] + 6, pq[1]); ctx.font = `10px ${P.mono}`;
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
  for (const L of M.launchers || []){ const lq = proj(v, L.x, L.y); ctx.fillStyle = L.dead ? P.red : P.dim; ctx.fillRect(lq[0] - 2, lq[1] - 2, 4, 4); }
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
  for (const j of M.jammers || []){ const b = H.brgOf(j.x - B.x, j.y - B.y), e = H.polar(b, 170, B); polyline(ctx, v, [[B.x, B.y], [e.x, e.y]]); ctx.strokeStyle = P.red; ctx.globalAlpha = .18 + Math.random() * .12; ctx.lineWidth = Math.max(4, 14 * v.s * .3); ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; ctx.globalAlpha = 1; }
  if (M.showFan !== false && B.on !== false && now){
    const ptl = B.ptl, ph = (now / 2400) % 2, dir = ph < 1 ? 1 : -1, f = ph < 1 ? ph : 2 - ph, sw = ptl - 60 + f * 120;
    const q0 = proj(v, B.x, B.y), sc = P.legacy ? '140,255,150' : '110,225,240';
    for (let k = 14; k >= 0; k--){ // afterglow: wedges fading behind the beam
      const a0 = sw - dir * (k + 1) * 1.4, a1 = sw - dir * k * 1.4;
      if (Math.abs(H.angDiff(a0, ptl)) > 60 || Math.abs(H.angDiff(a1, ptl)) > 60) continue;
      const pa = H.polar(a0, H.RADAR.rmax, B), pb = H.polar(a1, H.RADAR.rmax, B), qa = proj(v, pa.x, pa.y), qb = proj(v, pb.x, pb.y);
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(qa[0], qa[1]); ctx.lineTo(qb[0], qb[1]); ctx.closePath();
      ctx.fillStyle = `rgba(${sc},${(.13 * (1 - k / 15)).toFixed(3)})`; ctx.fill();
    }
    const se = H.polar(sw, H.RADAR.rmax, B), q1 = proj(v, se.x, se.y);
    ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.strokeStyle = `rgba(${sc},.6)`; ctx.lineWidth = 1.3; gl(P.cyan, 6); ctx.stroke(); ng(); ctx.lineWidth = 1;
    if (M.clutter && !v.tilt){ // raw video: returns near the radar and on ridges, painted by the beam and decaying
      const C = M.clutter;
      for (let k = 0; k < 3; k++){ const r = Math.random() ** 2 * 24 + 1, p = H.polar(sw + (Math.random() - .5) * 4, r, B); C.push({x:p.x, y:p.y, t0:now}); }
      for (const rd of MAP[M.mapKey].ridges || []){ const t = Math.random(), x = rd.a[0] + (rd.b[0] - rd.a[0]) * t, y = rd.a[1] + (rd.b[1] - rd.a[1]) * t; const b = H.brgOf(x - B.x, y - B.y), d = Math.hypot(x - B.x, y - B.y); if (d < 100 && Math.abs(H.angDiff(b, sw)) < 3 && Math.abs(H.angDiff(b, ptl)) <= 60) C.push({x:x + (Math.random() - .5) * 2, y:y + (Math.random() - .5) * 2, t0:now}); }
      while (C.length && now - C[0].t0 > 1800) C.shift();
      for (const c of C){ const s = proj(v, c.x, c.y); ctx.fillStyle = `rgba(${sc},${(.5 * (1 - (now - c.t0) / 1800)).toFixed(3)})`; ctx.fillRect(s[0] - .8, s[1] - .8, 1.8, 1.8); }
    }
  }
  const hits = [];
  for (const e of M.ents){
    if (!e.trk){ if (M.truth){ const q = proj(v, e.x, e.y, e.z); ctx.fillStyle = e.truth === 'H' ? P.red : P.faint; ctx.globalAlpha = .45; ctx.beginPath(); ctx.arc(q[0], q[1], 2.5, 0, 7); ctx.fill(); ctx.fillText(e.kind, q[0] + 5, q[1] - 4); ctx.globalAlpha = 1; } continue; }
    const k = e.trk, col = idCol(k.id, P), q = proj(v, e.x, e.y, e.z);
    if (q[0] < -40 || q[0] > v.W + 40 || q[1] < -40 || q[1] > v.H + 40) continue;
    hits.push({uid:e.uid, x:q[0], y:q[1]});
    const al = k.remote ? .55 : 1; ctx.globalAlpha = al;
    if (v.tilt){ const g0 = proj(v, e.x, e.y, 0); ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = col; ctx.globalAlpha = al * .35; ctx.stroke(); ctx.globalAlpha = al; ctx.fillStyle = col; ctx.fillRect(g0[0] - 1, g0[1] - 1, 2, 2); }
    if (e.hist){ ctx.fillStyle = col; e.hist.forEach((h, i) => { const hq = proj(v, h[0], h[1], h[2]); ctx.globalAlpha = al * .5 * (i + 1) / e.hist.length; ctx.fillRect(hq[0] - 1, hq[1] - 1, 2, 2); }); ctx.globalAlpha = al; }
    if (e.impact && k.cls){ const iq = proj(v, e.impact.x, e.impact.y), dal = e.dal; ctx.strokeStyle = dal ? P.red : P.dim; ctx.setLineDash([2, 4]); const g0 = proj(v, e.x, e.y, 0); ctx.beginPath(); ctx.moveTo(g0[0], g0[1]); ctx.lineTo(iq[0], iq[1]); ctx.globalAlpha = .45; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; const r = Math.max(5, 2.5 * v.s * iq[2]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(iq[0], iq[1], r, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(iq[0] - 4, iq[1] - 4); ctx.lineTo(iq[0] + 4, iq[1] + 4); ctx.moveTo(iq[0] + 4, iq[1] - 4); ctx.lineTo(iq[0] - 4, iq[1] + 4); ctx.stroke(); ctx.lineWidth = 1; ctx.globalAlpha = al; }
    const lt = e.ball ? 15 : 60, l2 = proj(v, e.x + e.vx * lt, e.y + e.vy * lt, Math.max(0, e.z + (e.vz || 0) * lt));
    gl(col, 7);
    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(l2[0], l2[1]); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
    const r = 7; ctx.lineWidth = 1.9; if (k.remote || k.id === 'PND') ctx.setLineDash([2, 2]);
    ctx.beginPath();
    if (e.ball){ ctx.moveTo(q[0], q[1] - r); ctx.lineTo(q[0] + r, q[1]); ctx.lineTo(q[0], q[1] + r); ctx.lineTo(q[0] - r, q[1]); ctx.closePath(); }
    else if (k.id === 'HOS' || k.id === 'SUS'){ ctx.moveTo(q[0] - r, q[1] + 1); ctx.lineTo(q[0], q[1] - r); ctx.lineTo(q[0] + r, q[1] + 1); }
    else if (k.id === 'FRD' || k.id === 'ASF'){ ctx.arc(q[0], q[1] + 1, r, Math.PI, 0); }
    else if (k.id === 'NEU'){ ctx.moveTo(q[0] - r, q[1] + 1); ctx.lineTo(q[0] - r, q[1] - r); ctx.lineTo(q[0] + r, q[1] - r); ctx.lineTo(q[0] + r, q[1] + 1); }
    else { ctx.moveTo(q[0] - r, q[1] + 1); ctx.lineTo(q[0] - r, q[1] - r + 3); ctx.quadraticCurveTo(q[0] - r, q[1] - r, q[0] - r + 3, q[1] - r); ctx.lineTo(q[0] + r - 3, q[1] - r); ctx.quadraticCurveTo(q[0] + r, q[1] - r, q[0] + r, q[1] - r + 3); ctx.lineTo(q[0] + r, q[1] + 1); }
    ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.fillStyle = col; ctx.fillRect(q[0] - 1.3, q[1] - 1.3, 2.6, 2.6); ng();
    ctx.font = `600 10.5px ${P.mono}`; ctx.fillText(k.num, q[0] + 9, q[1] - 5);
    ctx.font = `10px ${P.mono}`; ctx.fillStyle = P.dim;
    const altTxt = e.ball ? (e.z.toFixed(0) + 'K') : (e.z < 1 ? Math.round(e.z * 3281) + 'FT' : 'FL' + pad(Math.round(e.z * 32.81), 3));
    ctx.fillText(`${k.cls ? (e.clsLbl || '') : '···'} ${altTxt}${e.stat ? ' ' + e.stat : ''}`, q[0] + 9, q[1] + 7);
    if (k.hold){ ctx.fillStyle = P.cyan; ctx.fillText('HF', q[0] - 22, q[1] + 3); }
    if (e.uid === M.hooked){ ctx.strokeStyle = P.text; ctx.lineWidth = 1.2; const b = 12; ctx.beginPath(); ctx.moveTo(q[0] - b, q[1] - b + 4); ctx.lineTo(q[0] - b, q[1] - b); ctx.lineTo(q[0] - b + 4, q[1] - b); ctx.moveTo(q[0] + b - 4, q[1] - b); ctx.lineTo(q[0] + b, q[1] - b); ctx.lineTo(q[0] + b, q[1] - b + 4); ctx.moveTo(q[0] + b, q[1] + b - 4); ctx.lineTo(q[0] + b, q[1] + b); ctx.lineTo(q[0] + b - 4, q[1] + b); ctx.moveTo(q[0] - b + 4, q[1] + b); ctx.lineTo(q[0] - b, q[1] + b); ctx.lineTo(q[0] - b, q[1] + b - 4); ctx.stroke(); ctx.lineWidth = 1; }
    ctx.globalAlpha = 1;
  }
  for (const m of M.ms || []){
    const q = proj(v, m.x, m.y, m.z);
    if (m.trail && m.trail.length > 1){ ctx.beginPath(); m.trail.forEach((t, i) => { const tq = proj(v, t[0], t[1], t[2]); i ? ctx.lineTo(tq[0], tq[1]) : ctx.moveTo(tq[0], tq[1]); }); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = m.own ? P.red : P.violet; ctx.globalAlpha = .55; ctx.stroke(); ctx.globalAlpha = 1; }
    gl(m.own ? '#fff' : P.violet, 10); ctx.fillStyle = m.own ? '#fff' : P.violet; ctx.beginPath(); ctx.arc(q[0], q[1], 2.3, 0, 7); ctx.fill(); ng();
  }
  for (const fx of M.fx || []){
    const age = (now - fx.t0) / fx.dur; if (age < 0 || age > 1) continue;
    const q = proj(v, fx.x, fx.y, fx.z || 0), col = fx.k === 'kill' ? '#fff' : fx.k === 'impact' ? (fx.harmless ? P.dim : P.red) : fx.k === 'launch' ? P.amber : P.dim;
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
  const intro = menuTab === 'TRN' ? 'Eight crew drill tables at McGregor Range. Each must be passed to open the next. Table VIII certifies your crew, unlocks the campaign and the legacy console.'
    : menuTab === 'ME' ? 'Gulf and Levant. Ballistic salvos from Iran, drone swarms from Yemen, airliners everywhere. Play any scenario, or run them as a campaign with persistent missile stocks.'
    : 'NATO’s eastern flank and Ukraine. Kinzhal and Kalibr, decoys and jammers, anti-radiation missiles and recon drones that call in Iskanders.';
  body.innerHTML = `<p class="mintro">${intro}</p><div class="scn-grid">${list.map((s, i) => {
    const locked = s.table && s.table > 1 && !store.p.tables[s.table - 1] && !store.s.unlockAll;
    const best = store.p.best[s.id];
    const passed = s.table && store.p.tables[s.table];
    return `<button type="button" class="scn${locked ? ' locked' : ''}" data-id="${s.id}" ${locked ? 'aria-disabled="true"' : ''}>
      <span class="st${passed ? ' pass' : ''}">${passed ? 'PASSED' : best != null ? 'BEST ' + best : locked ? 'LOCKED' : ''}</span>
      <span class="tag">${s.table ? 'TABLE ' + ['','I','II','III','IV','V','VI','VII','VIII'][s.table] : s.endgame ? 'ENDGAME · SEEDED' : THEATERS[s.theater].toUpperCase()}</span>
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
  BR = {scn, site:0, ptl:scn.ptl, mode:scn.mode, doctrine:{TBM:'RIPPLE', AIR:'SLS', UAV:'SINGLE'}, seed:randSeed(), camp:camp || null, view:null};
  show('brief');
  const W = s => s.split(' ');
  const ld = scn.launchers.map((L, i) => `<span>LS${i + 1} ${L[0] === 'MSE' ? L[1] + '× MSE' : L[0] === 'GEMT' ? L[2] + '× GEM-T' : L[1] + '× MSE + ' + L[2] + '× GEM-T'}</span>`).join('') + `<span>RESERVE ${scn.reserve.MSE} MSE · ${scn.reserve.GEMT} GEM-T</span>`;
  const campNote = camp ? `<p class="coach-brief">Campaign: launchers load from your stock (${camp.stock.MSE} MSE, ${camp.stock.GEMT} GEM-T). What you do not fire carries to the next battle.</p>` : '';
  const tb = scn.tutorial && scn.tutorial.table, locked = !!scn.lockEmplace;
  const tutNote = tb ? `<h3>How this table passes</h3><ul class="objs" id="bObj"></ul>${tb === 1 ? '<p class="coach-brief">Drag on the map to swing the PTL. Click a site button to move the battery. The checklist updates as you go.</p>' : ''}` : '';
  const lockNote = locked ? `<p class="coach-brief">Range control has emplaced you at ${esc(scn.sites[0].name.split('· ')[1] || 'Site A')}, PTL ${pad(scn.ptl, 3)}°. Emplacement is fixed for this table.</p>` : '';
  $('#briefBody').innerHTML = `<div class="brief-wrap">
   <div>
     <button class="btn sm" type="button" id="bBack">← Back</button>
     <div class="eyebrow" style="margin-top:14px">${scn.table ? 'CREW DRILL · TABLE ' + ['','I','II','III','IV','V','VI','VII','VIII'][scn.table] : THEATERS[scn.theater].toUpperCase() + ' · ' + esc(scn.bty)}</div>
     <h2>${esc(scn.table ? scn.name.split('· ')[1] : scn.name)}</h2>
     <div class="pl">${esc(scn.place)}</div>
     ${scn.inspired ? `<div class="insp">${esc(scn.inspired)}</div>` : ''}
     <h3>Situation</h3>${scn.brief.map(p => `<p>${esc(p)}</p>`).join('')}
     <h3>Intelligence</h3><ul class="intel">${scn.intel.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
     <h3>Defended Asset List</h3>
     <table class="dal"><thead><tr><th>PRI</th><th>ASSET</th><th>BRG / RNG FROM SITE</th></tr></thead><tbody id="bDal"></tbody></table>
     <h3>Rules of engagement</h3>
     <div class="roe"><span>ADW <b class="chip c-${scn.adw}">${scn.adw}</b></span><span>WCS <b class="chip c-${scn.wcs}">${scn.wcs}</b></span><span>TD <b>${esc(scn.td)}</b></span><span>CALL SIGN <b>${esc(scn.bty)}</b></span></div>
     <h3>Load-out</h3><div class="loadout">${ld}</div>
     ${campNote}
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
       <label>DRONE DOCTRINE</label><div class="seg" data-doc="UAV">${['SINGLE','RIPPLE','SLS'].map(m => `<button type="button" data-v="${m}" class="${m === 'SINGLE' ? 'on' : ''}">${m === 'SLS' ? 'SHOOT-LOOK-SHOOT' : m}</button>`).join('')}</div>
       <label>SEED</label><div><input class="seedin" id="bSeed" type="text" inputmode="numeric" value="${BR.seed}" aria-label="Raid seed"> <span class="eyebrow" style="letter-spacing:.06em">Same seed, same raid</span></div>
     </div>
     <div class="go"><button class="btn primary big" type="button" id="bGo">Take the watch</button></div>
   </div></div>`;
  $('#bBack').onclick = () => camp ? campScreen() : openMenu();
  $('#bSites').querySelectorAll('button').forEach(b => b.onclick = () => { BR.site = +b.dataset.i; $('#bSites').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); briefDraw(); });
  $('#bMode').querySelectorAll('button').forEach(b => b.onclick = () => { BR.mode = b.dataset.v; $('#bMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  $$('[data-doc]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { BR.doctrine[g.dataset.doc] = b.dataset.v; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }));
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
  drawScope(ctx, BR.view, {mapKey:scn.map, bat:{x:s.x, y:s.y, ptl:BR.ptl, on:true}, ptlPreview:BR.ptl, assets:scn.assets.map(a => ({...a, hpMax:a.hp, hp:a.hp})), ents:[], neighbors:(scn.neighbors || []).map(n => ({...n, on:true})), sites:scn.sites, siteSel:BR.site, axis:scn.axis, cov:covMap, labelsAlways:true, bty:scn.bty.split(' ')[0]}, 0);
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
  const o = {seed:BR.seed, site:BR.site, ptl:BR.ptl, mode:BR.mode, doctrine:{...BR.doctrine}, difficulty:store.s.diff};
  if (BR.camp){ o.stock = {...BR.camp.stock}; o.xp = BR.camp.xp; }
  S = H.createSim(scn, o);
  B = {view:{cx:S.bat.x, cy:S.bat.y, s:2.2, W:100, H:100, tilt:false}, hooked:null, hits:[], hist:{}, trails:{}, fx:[], scars:[], speed:store.s.speed || 1, acc:0, last:performance.now(), logN:0, panelT:0, wpn:'AUTO', cardFor:null, coach:null, sheet:'', toastT:0, camp:BR.camp, brief:{...BR}, idLog:{}};
  store.p.plays++; store.save();
  show('battle');
  const bt = $('#scr-battle'); bt.dataset.sheet = '';
  $('#log').innerHTML = '';
  $('#sDisp').hidden = !scn.displace;
  setupCoach();
  AU.init(); AU.startAmb();
  VO.stop();
  fitView(); renderLaunchers(true); updatePanels(true);
  cancelAnimationFrame(rafId); rafId = requestAnimationFrame(loop);
}
function fitView(){
  const cv = $('#scope'); const r = cv.getBoundingClientRect(); const m = Math.min(r.width, r.height);
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
  const key = [v.cx.toFixed(2), v.cy.toFixed(2), v.s.toFixed(3), v.tilt, cv.width, cv.height, M.bat.ptl, M.bat.x, M.bat.y, M.bat.on, M.bat.alive, S.assets.map(a => a.hp).join(), S.launchers.map(L => L.dead ? 1 : 0).join(''), S.neighbors.map(n => n.on ? 1 : 0).join(''), B.scars.length, P.legacy].join('|');
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
    const o = {uid:e.uid, x:e.x, y:e.y, z:e.z, vx:e.vx, vy:e.vy, vz:e.vz || 0, kind:e.kind, truth:e.truth, trk:e.trk && e.trk.est ? e.trk : null, ball:!!e.T.ballistic, clsLbl:e.T.cls, hist:B.hist[e.uid]};
    if (o.trk && o.ball){ const a = H.assess(S, e); o.impact = a.impact; o.dal = a.dal; }
    if (o.trk){ const p = H.activePlan(S, e); if (p) o.stat = p.state === 'VETO' ? 'VETO' : p.state === 'GUIDING' ? 'ENG' : p.state === 'WAIT' ? 'PLN' : 'ENG'; }
    ents.push(o);
  }
  const ms = [];
  for (const m of S.ms){ if (!m.alive) continue; const tr = B.trails[m.id] || (B.trails[m.id] = []); const last = tr[tr.length - 1]; if (!last || Math.hypot(last[0] - m.x, last[1] - m.y) > .8) { tr.push([m.x, m.y, m.z]); if (tr.length > 40) tr.shift(); } ms.push({x:m.x, y:m.y, z:m.z, own:m.owner === 'own', trail:tr}); }
  return {mapKey:S.scn.map, bat:{x:S.bat.x, y:S.bat.y, ptl:S.bat.ptl, on:H.radarOn(S), alive:S.bat.alive}, launchers:S.launchers, assets:S.assets, ents, ms, fx:B.fx, scars:B.scars, neighbors:S.neighbors, jammers:S.ents.filter(e => e.alive && e.kind === 'JAM'), hooked:B.hooked, bty:S.scn.bty.split(' ')[0]};
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
  renderQueue(q);
  renderCard();
  renderLaunchers();
}

function renderQueue(q){
  const el = $('#queue');
  const rows = q.slice(0, 14).map(x => {
    const e = x.e, k = e.trk, p = x.plan; let st = '', cls = '';
    if (p){ if (p.state === 'VETO') st = `<button class="veto" type="button" data-veto="${p.id}">VETO ${Math.ceil(p.vetoT)}</button>`; else if (p.state === 'WAIT'){ st = 'WAIT'; cls = 'wait'; } else if (p.state === 'GUIDING' || p.state === 'READY'){ const m = S.ms.find(mm => mm.alive && mm.plan === p.id); st = m ? `AWAY ${Math.max(0, Math.ceil(m.tEnd - S.t))}s` : 'FIRING'; cls = 'away'; } }
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
        <dt>STATUS</dt><dd class="wide" id="cSt"></dd>
      </dl>
      <div class="idrow" id="cIds">${['FRD','NEU','UNK','SUS','HOS'].map((x, i) => `<button type="button" class="id-${x}" data-id="${x}" title="Key ${i + 1}"><span>${x}</span></button>`).join('')}</div>
      <div class="actrow"><button class="tbtn" type="button" id="cIffB">IFF</button><button class="tbtn" type="button" id="cHold">HOLD FIRE</button><div class="seg" id="cW">${['AUTO','GEMT','MSE'].map(w => `<button type="button" data-w="${w}">${w === 'GEMT' ? 'GEM-T' : w}</button>`).join('')}</div></div>
      <button class="engage" type="button" id="cEng"><i></i><span>${store.s.expert ? 'ENGAGE' : 'HOLD TO ENGAGE'}</span></button>
      <div class="eyebrow" id="cMsg" style="letter-spacing:.06em;min-height:1.2em"></div>`;
    $('#cIds').querySelectorAll('button').forEach(b => b.onclick = () => declare(hookedEnt(), b.dataset.id));
    $('#cIffB').onclick = () => { const x = hookedEnt(); if (x) H.playerIff(S, x); };
    $('#cHold').onclick = () => { const x = hookedEnt(); if (x) H.holdFire(S, x); };
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
  for (const [w, id] of [['GEMT', '#cG'], ['MSE', '#cM']]){ const s = H.solve(S, e, w), n = H.rounds(S, w); const el2 = $(id); el2.textContent = n <= 0 ? 'NONE READY' : s.ok ? `IN ENVELOPE · TOF ${Math.round(s.tof)} s · P(K) ${Math.round((e.T.pk[w] || 0) * 100)}%` : s.why; el2.className = 'wide ' + (n > 0 && s.ok ? 'good' : ''); }
  const p = H.activePlan(S, e), st = $('#cSt');
  st.textContent = k.hold ? 'HOLD FIRE' : e.holdOrder ? 'HOLD FIRE ORDERED BY TD' : p ? `${p.state}${p.state === 'VETO' ? ' ' + Math.ceil(p.vetoT) + ' s' : ''} · ${WEAPONS[p.w].name} · ${p.doc} · SALVO ${p.salvo}` : 'NOT ENGAGED';
  st.className = 'wide ' + (k.hold || e.holdOrder ? 'good' : p ? 'bad' : '');
  $('#cIds').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.id === k.id || (k.id === 'PND' && x.dataset.id === 'UNK' && false)));
  $('#cHold').classList.toggle('on', !!k.hold);
  $('#cW').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.w === B.wpn));
  $('#cEng').disabled = !!p || !H.radarOn(S) || k.remote;
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
  const r = H.engage(S, e, {src:'player', wpn:B.wpn});
  if (r.ok){ cardMsg('ENGAGEMENT ORDERED'); return; }
  if (r.viol){
    modal('ROE warning', `<p>Engaging track <b>${e.trk.num}</b> breaks your rules of engagement:</p><ul>${r.viol.map(v => `<li>${esc(v)}</li>`).join('')}</ul><p>The TD will log a violation. A shot at a protected aircraft ends the battle.</p>`,
      [{t:'Cancel'}, {t:'Fire anyway', cls:'danger', f:() => { const r2 = H.engage(S, e, {src:'player', wpn:B.wpn, force:true}); if (!r2.ok) cardMsg(r2.why); }}], true);
    return;
  }
  cardMsg(r.why); AU.tone('fault');
}
function declare(e, id){
  if (!e) return;
  if (id === 'HOS' && e.trk.iff === 'M4 VALID' && !store.s.expert){
    modal('Mode 4 valid', `<p>Track ${e.trk.num} answers Mode 4 valid. That is a friendly transponder. Declare it hostile anyway?</p>`, [{t:'Cancel'}, {t:'Declare hostile', cls:'danger', f:() => H.playerId(S, e, id)}], true);
    return;
  }
  H.playerId(S, e, id); AU.tone('click');
}

function renderLaunchers(force){
  const row = $('#lnchRow'); const parts = [];
  const b = S.bat;
  parts.push(`<div class="ls sys"><div class="lh"><b>RADAR</b><span class="stt ${!b.alive ? 'DEAD' : H.radarOn(S) ? '' : 'MOVE'}">${!b.alive ? 'DOWN' : b.emcon ? 'SILENT' : b.reorient > 0 ? 'REORIENT' : b.displace > 0 ? 'MOVING' : b.epp > 0 ? 'NO POWER' : b.radarFault > 0 ? 'DEGRADED' : 'RADIATING'}</span></div><div>MPQ-65 · PTL ${pad(Math.round(b.ptl) % 360, 3)}</div><div>RESERVE ${S.reserve.MSE} MSE · ${S.reserve.GEMT} GEM-T</div></div>`);
  for (const L of S.launchers){
    const pips = (n, cap, g) => Array.from({length:cap}, (_, i) => `<i class="${g ? 'g ' : ''}${i < n ? 'f' : ''}"></i>`).join('');
    const canR = !L.dead && L.state === 'READY' && ((L.cap.MSE > L.MSE && S.reserve.MSE > 0) || (L.cap.GEMT > L.GEMT && S.reserve.GEMT > 0));
    const stt = L.dead ? 'DEAD' : L.state === 'READY' ? 'READY' : `${L.state} ${Math.ceil(L.timer)}s`;
    parts.push(`<div class="ls${L.dead ? ' dead' : ''}"><div class="lh"><b>LS${L.id}</b><span class="stt ${L.dead ? 'DEAD' : L.state}">${stt}</span></div>
      ${L.cap.MSE ? `<div class="pips"><em>MSE</em>${pips(L.MSE, L.cap.MSE, false)}</div>` : ''}${L.cap.GEMT ? `<div class="pips"><em>GEM</em>${pips(L.GEMT, L.cap.GEMT, true)}</div>` : ''}
      ${canR ? `<button type="button" data-reload="${L.id}">RELOAD</button>` : ''}</div>`);
  }
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
    if (m === 'AUTO' && !B.autoWarned && !store.s.expert){ B.autoWarned = true; modal('Automatic mode', '<p>The computer will declare any silent, closing air track hostile and fire after a five-second veto window. It does not know about corridors or broken transponders. Watch the queue for VETO.</p>', [{t:'Cancel'}, {t:'Go automatic', cls:'danger', f:() => H.setMode(S, 'AUTO')}], true); return; }
    H.setMode(S, m); };
  $('#sSpeed').onclick = ev => { const b = ev.target.closest('button'); if (b && B) B.speed = +b.dataset.s; };
  $('#sEmcon').onclick = () => S && H.setEmcon(S, !S.bat.emcon);
  $('#sPtl').onclick = () => { if (!S) return; const cur = Math.round(S.bat.ptl);
    modal('Reorient PTL', `<p>The radar goes dark for 25 seconds while it slews. Threat axes: ${(S.scn.axis || []).map(a => pad(a, 3) + '°').join(', ')}.</p><p><input id="ptlIn" type="range" min="0" max="359" value="${cur}" style="width:100%;accent-color:var(--amber)"> <b id="ptlV" style="font-family:var(--f-data)">${pad(cur, 3)}°</b></p>`, [{t:'Cancel'}, {t:'Reorient', cls:'primary', f:() => H.reorient(S, +$('#ptlIn').value)}]);
    $('#ptlIn').oninput = () => $('#ptlV').textContent = pad(+$('#ptlIn').value, 3) + '°'; };
  $('#sDisp').onclick = () => { if (!S) return; modal('March order', '<p>The battery goes offline for 50 seconds and re-emplaces at the new site.</p>', [{t:'Cancel'}, ...S.scn.sites.map((s, i) => ({t:s.name, cls:i === S.bat.site ? '' : 'primary', f:() => H.displace(S, i)})).filter((x, i) => i !== S.bat.site)]); };
  $('#sRadio').onclick = () => B && setSheet('radio');
  $('#sEnd').onclick = () => { if (!S) return; const sp = B.speed; B.speed = 0; modal('End the watch', '<p>The battle is scored as it stands now.</p>', [{t:'Keep fighting', f:() => B.speed = sp || 1}, {t:'End watch', cls:'danger', f:() => { S.endAt = S.t; S.endReason = 'Ended by the TCO'; S.abandon = true; B.speed = 1; }}]); };
  $('#btnAck').onclick = () => S && H.ack(S);
  $('#ptabs').onclick = ev => { const b = ev.target.closest('button'); if (b && B) setSheet(b.dataset.p); };
  $$('[data-close]').forEach(b => b.onclick = () => B && setSheet(''));
  $('#queue').addEventListener('pointerdown', ev => { const v = ev.target.closest('[data-veto]'); if (v){ ev.preventDefault(); H.veto(S, +v.dataset.veto); return; } const r = ev.target.closest('[data-uid]'); if (r) hook(+r.dataset.uid); });
  $('#lnchRow').addEventListener('pointerdown', ev => { const b = ev.target.closest('[data-reload]'); if (b){ ev.preventDefault(); H.reload(S, +b.dataset.reload); } });
  $('#zIn').onclick = () => zoom(1.4); $('#zOut').onclick = () => zoom(1 / 1.4);
  $('#zCtr').onclick = () => { if (B){ B.view.cx = S.bat.x; B.view.cy = S.bat.y; } };
  $('#z3d').onclick = () => { if (!B) return; B.view.tilt = !B.view.tilt; if (B.U) B.U.tilted = true; $('#z3d').classList.toggle('on', B.view.tilt); };
  $('#coachNext').onclick = () => coachNext(); $('#coachMin').onclick = () => $('#coach').classList.toggle('min');
  const cv = $('#scope'); const ptrs = new Map(); let dragged = false, pinch0 = 0, s0 = 1;
  cv.addEventListener('pointerdown', ev => { cv.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, {x:ev.clientX, y:ev.clientY, x0:ev.clientX, y0:ev.clientY}); dragged = false; if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); s0 = B.view.s; } });
  cv.addEventListener('pointermove', ev => { const p = ptrs.get(ev.pointerId); if (!p || !B) return; const dx = ev.clientX - p.x, dy = ev.clientY - p.y; p.x = ev.clientX; p.y = ev.clientY;
    if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) B.view.s = Math.max(.25, Math.min(14, s0 * d / pinch0)); dragged = true; return; }
    if (Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) > 6) dragged = true;
    if (dragged){ B.view.cx -= dx / B.view.s; B.view.cy += dy / B.view.s * (B.view.tilt ? 1.6 : 1); } });
  const up = ev => { const p = ptrs.get(ev.pointerId); ptrs.delete(ev.pointerId); if (!B || !p) return; if (!dragged && ptrs.size === 0){ const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top; let best = null, bd = 24; for (const h of B.hits){ const d = Math.hypot(h.x - x, h.y - y); if (d < bd){ bd = d; best = h; } } hook(best ? best.uid : null); } };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointermove', ev => { if (!B || ev.pointerType === 'touch') return; const r = cv.getBoundingClientRect(); B.cursor = {px:ev.clientX - r.left, py:ev.clientY - r.top}; });
  cv.addEventListener('pointerleave', () => { if (B) B.cursor = null; }); cv.addEventListener('pointercancel', ev => ptrs.delete(ev.pointerId));
  cv.addEventListener('wheel', ev => { ev.preventDefault(); if (!B) return; const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top; const w0 = unproj(B.view, mx, my); zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15); if (!B.view.tilt){ const w1 = unproj(B.view, mx, my); B.view.cx += w0.x - w1.x; B.view.cy += w0.y - w1.y; } }, {passive:false});
  document.addEventListener('keydown', ev => {
    if (UI.screen !== 'battle' || !S || !$('#modal').hidden) return;
    if (ev.target.matches('input,textarea')) return;
    const e = hookedEnt(), k = ev.key.toLowerCase();
    if (k === ' '){ ev.preventDefault(); H.ack(S); }
    else if (k === 'e'){ tryEngage(e); }
    else if (k === 'h'){ if (e) H.holdFire(S, e); }
    else if (k === 'i'){ if (e) H.playerIff(S, e); }
    else if ('12345'.includes(k) && k.length === 1){ declare(e, ['FRD','NEU','UNK','SUS','HOS'][+k - 1]); }
    else if (k === 'tab' || k === 'n'){ ev.preventDefault(); const un = S.ents.filter(x => x.alive && x.trk && x.trk.est && !x.trk.remote && (x.trk.id === 'PND' || x.trk.id === 'UNK')).map(x => x.uid); const list = un.length ? un : H.threatQueue(S).map(x => x.e.uid); if (list.length){ const i = list.indexOf(B.hooked); hook(list[(i + 1) % list.length]); } }
    else if (k === 'v'){ const p = S.plans.find(x => x.state === 'VETO'); if (p) H.veto(S, p.id); }
    else if (k === 'm'){ const ms = ['MANUAL','SEMI','AUTO']; H.setMode(S, ms[(ms.indexOf(S.mode) + 1) % 3]); }
    else if (k === 'p'){ B.speed = B.speed ? 0 : 1; }
    else if (k === ']'){ B.speed = Math.min(4, (B.speed || .5) * 2); }
    else if (k === '['){ B.speed = B.speed <= 1 ? 1 : B.speed / 2; }
    else if (k === '+' || k === '='){ zoom(1.3); } else if (k === '-'){ zoom(1 / 1.3); }
    else if (k === 't'){ $('#z3d').click(); } else if (k === 'c'){ $('#zCtr').click(); }
    else if (k === 'escape'){ hook(null); setSheet(''); }
  });
  window.addEventListener('resize', () => { if (UI.screen === 'brief') briefDraw(); });
}
function zoom(f){ if (!B) return; B.view.s = Math.max(.25, Math.min(14, B.view.s * f)); }

// ---------- coach ----------
const ROMAN = ['','I','II','III','IV','V','VI','VII','VIII'];
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
  if (prev == null || sc.total > prev) store.p.best[S.scn.id] = sc.total;
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
  const spent = st.spent, kv = st.killVal, fired = st.fired.GEMT + st.fired.MSE;
  const nextTable = scn.tutorial && tp && tp.ok ? SCN.find(s => s.tutorial && s.tutorial.table === scn.tutorial.table + 1) : null;
  const verdict = tp ? `<div class="verdict ${tp.ok ? 'pass' : 'fail'}">${tp.ok ? 'Table passed' : 'Table not passed'}</div><ul class="objs">${tp.objs.map(o => `<li class="${o.ok ? 'ok' : 'no'}"><i>${o.ok ? '✓' : '✗'}</i><span>${esc(o.t)}${!o.ok && o.tip ? `<em>${esc(o.tip)}</em>` : ''}</span></li>`).join('')}</ul>` : sc.frat ? '<div class="verdict fail">Relieved of duty</div>' : `<div class="verdict ${sc.total >= 80 ? 'pass' : sc.total >= 60 ? '' : 'fail'}">${sc.total >= 90 ? 'Outstanding watch' : sc.total >= 80 ? 'Assets held' : sc.total >= 60 ? 'Mission accomplished with losses' : 'Defense failed'}</div>`;
  const cat = (l, v, m) => `<div class="cat"><span class="l">${l}</span><span class="v">${v}<small> / ${m}</small></span><span class="bar"><i style="width:${Math.round(v / m * 100)}%"></i></span></div>`;
  $('#aarBody').innerHTML = `
    <div class="aar-top"><div><div class="eyebrow">AFTER ACTION REVIEW · ${esc(scn.bty)} · SEED ${S.seed}</div><h2>${esc(scn.table ? scn.name.split('· ')[1] : scn.name)}</h2><div class="eyebrow" style="letter-spacing:.06em;margin:4px 0 8px">${esc(scn.place)} · ${esc(S.endReason)} · T+${fmtT(S.t)}</div>${verdict}
      ${unlockedNow ? '<p class="coach-brief"><b>Crew certified.</b> The campaign and the legacy console are unlocked. Switch consoles in Settings.</p>' : ''}
      ${campRes ? `<p class="coach-brief">${esc(campRes)}</p>` : ''}</div>
      <div class="total">${sc.total}<small> / 100</small></div></div>
    <div class="cats">${cat('ASSET PROTECTION', sc.protect, 40)}${cat('DISCIPLINE', sc.disc, 25)}${cat('ECONOMY', sc.econ, 20)}${cat('BATTERY SURVIVAL', sc.surv, 15)}</div>
    <div class="aar-grid">
      <div class="replay"><h3 class="eyebrow" style="margin:0">REPLAY · DECISION TIMELINE</h3>
        <div class="mapbox" id="rBox"><canvas id="rMap"></canvas><div class="maphint" id="rT">T+00:00</div></div>
        <div class="tl" id="rTl"></div>
        <div class="rctl"><button class="tbtn" type="button" id="rPlay">PLAY</button><input type="range" id="rPos" min="0" max="${S.snaps.length - 1}" value="0" aria-label="Replay position"><div class="seg" id="rSp"><button type="button" data-s="2">2×</button><button type="button" data-s="6" class="on">6×</button><button type="button" data-s="16">16×</button></div><button class="tbtn" type="button" id="rTruth">TRUTH</button></div>
        <div class="eyebrow" style="letter-spacing:.06em">TRUTH shows every object, including threats your radar never saw.</div>
      </div>
      <div style="display:grid;gap:18px;align-content:start">
        <div class="find"><h3>Findings</h3>
          ${f.sustain.length ? `<b>Sustain</b><ul>${f.sustain.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${f.improve.length ? `<b>Improve</b><ul>${f.improve.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <div class="rec"><b>Recommendation.</b> ${esc(f.rec)}</div></div>
        <div class="stats"><h3>Battle data</h3><table>
          <tr><td>Missiles fired</td><td>${st.fired.MSE} MSE · ${st.fired.GEMT} GEM-T</td></tr>
          <tr><td>Interceptor cost (game value)</td><td>$${spent.toFixed(1)}M</td></tr>
          <tr><td>Threat value destroyed</td><td>$${kv.toFixed(1)}M</td></tr>
          <tr><td>Cost exchange</td><td>${fired ? (kv / Math.max(.1, spent)).toFixed(2) + ' : 1' : '—'}</td></tr>
          <tr><td>Kills / misses</td><td>${st.kills} / ${st.miss}</td></tr>
          <tr><td>Leakers to the DAL</td><td>${st.leak}</td></tr>
          <tr><td>Wasted shots</td><td>${st.wasted} (decoy ${st.waste.decoy} · false ${st.waste.fals} · non-DAL ${st.waste.nondal})</td></tr>
          <tr><td>ROE violations · late ACKs · ID errors</td><td>${st.viol} · ${st.lateAck} · ${st.misId}</td></tr>
          <tr><td>Vetoes / hold-fire saves</td><td>${st.vetoes} / ${st.holdSaves}</td></tr>
        </table></div>
      </div>
    </div>
    <div class="evl"><h3>Event log</h3><ol id="rEv">${S.ev.filter(x => !x.quiet).map(x => `<li data-t="${x.t}" class="${x.bad ? 'bad' : x.good ? 'good' : ''}"><span>${fmtT(x.t)}</span><span>${esc(x.text)}</span></li>`).join('')}</ol></div>
    <div class="go">
      ${nextTable ? `<button class="btn primary" type="button" id="aNext">Next: Table ${['','I','II','III','IV','V','VI','VII','VIII'][nextTable.table]}</button>` : ''}
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
  $('#rEv').onclick = ev => { const li = ev.target.closest('li'); if (!li) return; RP.i = Math.max(0, S.snaps.findIndex(s => s.t >= +li.dataset.t) - 2); $('#rPos').value = RP.i; drawReplay(); $('#rBox').scrollIntoView({behavior:'smooth', block:'nearest'}); };
  requestAnimationFrame(drawReplay);
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
  drawScope(ctx, v, {mapKey:S.scn.map, bat:{...snap.bat}, launchers:S.launchers, assets:S.assets.map((a, i) => ({...a, hp:snap.hp[i]})), ents, ms:snap.m.map(m => ({x:m[0], y:m[1], z:m[2], own:!!m[3]})), neighbors:S.neighbors, truth:RP.truth, bty:S.scn.bty.split(' ')[0],
    fx:evNow.filter(x => x.x != null).map(x => ({k:'impact', x:x.x, y:x.y, t0:0, dur:2})), scars:[]}, 1);
  $('#rT').textContent = 'T+' + fmtT(snap.t);
}

// ---------- campaign ----------
function campMenuHtml(){
  const can = unlocked();
  const cards = Object.entries(CAMPAIGNS).map(([k, c]) => {
    const st = store.d.camp[k];
    const prog = st && !st.over ? `Battle ${st.idx + 1} of ${c.scenarios.length} · ${st.stock.MSE} MSE · ${st.stock.GEMT} GEM-T` : st && st.over ? (st.dead ? 'Last run: relieved of duty' : `Last run complete · ${st.scores.reduce((a, b) => a + b, 0)} points`) : 'Not started';
    return `<div class="scn${can ? '' : ' locked'}" style="cursor:default"><span class="tag">${k === 'ME' ? 'MIDDLE EAST' : 'EUROPE'} · ${c.scenarios.length} BATTLES</span><span class="n">${esc(c.name)}</span><span class="pl">${esc(prog)}</span>
      <span class="sh">${k === 'ME' ? 'From Al Udeid to Nevatim. Missile stock carries over; resupply convoys arrive between battles, sometimes short.' : 'From Jasionka to Sliač. Decoys, jammers, ARMs and recon drones. Every missile counts across seven battles.'}</span>
      <span class="sh" style="color:var(--dim)">Ironman: a fratricide ends the deployment.</span>
      <div class="go" style="margin-top:8px">${can ? (st && !st.over ? `<button class="btn primary sm" type="button" data-camp="${k}">Continue</button><button class="btn sm" type="button" data-camp="${k}" data-new="1">Restart</button>` : `<button class="btn primary sm" type="button" data-camp="${k}" data-new="1">Deploy</button>`) : '<span class="eyebrow">Pass Table VIII to unlock</span>'}</div></div>`;
  }).join('');
  return `<p class="mintro">Run a theater as a deployment. Your missile stock persists between battles, your crew gains experience (faster reaction and reloads), and the TD's trust shapes how much resupply you get.</p><div class="scn-grid">${cards}</div>`;
}
function campStart(k, fresh){
  if (fresh || !store.d.camp[k] || store.d.camp[k].over) store.d.camp[k] = {th:k, idx:0, stock:{...CAMPAIGNS[k].stock}, trust:50, xp:0, scores:[], over:false, dead:false, seed:randSeed(), log:[]};
  store.save(); UI.camp = k; campScreen();
}
function campScreen(){
  const k = UI.camp, st = store.d.camp[k], c = CAMPAIGNS[k]; show('camp');
  const total = st.scores.reduce((a, b) => a + b, 0);
  $('#campBody').innerHTML = `<button class="btn sm" type="button" id="cBack">← Menu</button>
    <div class="eyebrow" style="margin-top:14px">CAMPAIGN · ${k === 'ME' ? 'MIDDLE EAST' : 'EUROPE'}</div><h2>${esc(c.name)}</h2>
    <div class="camp-stats"><div><div class="l">PAC-3 MSE STOCK</div><div class="v">${st.stock.MSE}</div></div><div><div class="l">GEM-T STOCK</div><div class="v">${st.stock.GEMT}</div></div><div><div class="l">TD TRUST</div><div class="v">${st.trust}</div></div><div><div class="l">CREW EXPERIENCE</div><div class="v">${st.xp.toFixed(1)}</div></div><div><div class="l">TOTAL SCORE</div><div class="v">${total}</div></div></div>
    <div class="days">${c.scenarios.map((id, i) => { const s = byId(id); return `<div class="day${i === st.idx && !st.over ? ' cur' : i < st.idx ? ' done' : ''}"><span class="d">DAY ${i * 4 + 1}</span><span><b>${esc(s.name)}</b> · ${esc(s.place)}</span><span class="d">${i < st.scores.length ? st.scores[i] + ' pts' : i === st.idx && !st.over ? 'NEXT' : ''}</span></div>`; }).join('')}</div>
    ${st.log.length ? `<p class="coach-brief">${esc(st.log[st.log.length - 1])}</p>` : ''}
    <div class="go">${st.over ? `<span class="verdict ${st.dead ? 'fail' : 'pass'}">${st.dead ? 'Relieved of duty. Deployment over.' : 'Deployment complete.'}</span><button class="btn primary" type="button" id="cAgain">Deploy again</button>` : `<button class="btn primary big" type="button" id="cGo">Brief day ${st.idx * 4 + 1}</button>`}</div>`;
  $('#cBack').onclick = () => openMenu('CAMP');
  if (st.over) $('#cAgain').onclick = () => campStart(k, true);
  else $('#cGo').onclick = () => openBrief(byId(c.scenarios[st.idx]), st);
}
function campAfter(st, Sm){
  const sc = Sm.score.total, rem = H.remaining(Sm), c = CAMPAIGNS[st.th];
  const unused = {MSE:st.stock.MSE - Sm.loaded.MSE, GEMT:st.stock.GEMT - Sm.loaded.GEMT};
  st.scores.push(sc);
  st.xp = Math.min(5, st.xp + (sc >= 80 ? 1 : .5));
  st.trust = Math.max(0, Math.min(100, st.trust + (sc >= 85 ? 8 : sc >= 70 ? 3 : -6) - 5 * Sm.st.viol));
  let msg;
  if (Sm.st.frat){ st.over = true; st.dead = true; msg = 'A protected aircraft went down. The brigade relieved the crew. Deployment over.'; }
  else {
    st.idx++;
    const r = (n => () => { n = (n * 9301 + 49297) % 233280; return n / 233280; })(st.seed + st.idx * 77);
    const late = r() < .2;
    const addM = late ? 0 : Math.max(0, Math.round(6 + r() * 6 + (st.trust >= 70 ? 4 : st.trust < 35 ? -3 : 0)));
    const addG = late ? 0 : Math.round(2 + r() * 4);
    st.stock = {MSE:Math.max(0, unused.MSE) + rem.MSE + addM, GEMT:Math.max(0, unused.GEMT) + rem.GEMT + addG};
    msg = late ? `Resupply convoy delayed. No new missiles. Stock carried forward: ${st.stock.MSE} MSE, ${st.stock.GEMT} GEM-T.` : `Resupply arrived: ${addM} MSE and ${addG} GEM-T. Stock now ${st.stock.MSE} MSE, ${st.stock.GEMT} GEM-T.`;
    if (st.idx >= c.scenarios.length){ st.over = true; msg += ' Deployment complete.'; }
  }
  st.log.push(msg); store.d.camp[st.th] = st;
  return msg;
}

// ---------- library ----------
function openLib(){
  show('lib');
  const rows = Object.entries(TYPES).filter(([k]) => k !== 'FALSE').map(([k, t]) => `<tr><td class="nm">${esc(t.name)}</td><td>${esc(t.analog)}</td><td class="num">${t.cls}</td><td>${esc(t.role)}</td><td class="num">${t.ballistic ? Math.round(t.speed * 1000) + ' m/s' : Math.round(t.speed * 1944) + ' kt'}</td><td class="num">${t.truth === 'H' ? Math.round(t.pk.GEMT * 100) + '% / ' + Math.round(t.pk.MSE * 100) + '%' : '—'}</td></tr>`).join('');
  const wr = Object.values(WEAPONS).map(w => `<tr><td class="nm">${w.name}</td><td>${esc(w.full)}</td><td>${w.fuze}</td><td class="num">${w.rAir} km</td><td class="num">${w.rTbm} km</td><td class="num">${w.maxAlt} km</td><td class="num">$${w.cost}M</td></tr>`).join('');
  const g = [['Tactical Control Officer (TCO)','You. The officer at manstation one in the Engagement Control Station who decides identity and engagements.'],['Tactical Control Assistant (TCA)','Your crewmate at manstation two. Calls tracks, faults and launches.'],['Tactical Director (TD)','The battalion officer who runs the air battle and issues orders.'],['Primary Target Line (PTL)','The centre of the radar’s 120° search sector. Set at emplacement; changing it takes the radar offline.'],['Defended Asset List (DAL)','The prioritized list of what you protect. Priority 1 matters most.'],['Air Defense Warning (ADW)','White: attack unlikely. Yellow: attack probable. Red: attack imminent or under way.'],['Weapons Control Status (WCS)','Hold: self-defense only. Tight: fire only at tracks identified Hostile. Free: fire at anything not identified Friend.'],['Fire control orders','Engage, Hold Fire (stop and destroy missiles in flight), Cease Fire (launch nothing), Cover.'],['Engagement modes','Manual: you approve every shot. Semiautomatic: you identify, the computer engages Hostile DAL threats. Automatic: the computer also identifies, with a veto window.'],['IFF','Mode 4 VALID = friendly military transponder. Mode 3/C = civil squawk and altitude. NO RESP = silent.'],['Shot doctrine','Single shot, Ripple (two missiles 1.5 s apart), or Shoot-Look-Shoot (one missile, assess, fire again).'],['EMCON','Emission control. Silencing the radar defeats anti-radiation missiles and blinds you at the same time.'],['ALT VAR','Altitude variation of a track over the last 15 seconds. Decoys hold a fixed altitude.'],['Remote track','A track passed by another battery over the network. You need your own radar track to fire.']];
  $('#libBody').innerHTML = `<button class="btn sm" type="button" id="lBack">← Menu</button>
    <div class="eyebrow" style="margin-top:14px">ENCYCLOPEDIA</div><h2>Threat library</h2>
    <p class="mintro">Every number below is a game value: rounded, tuned for play, and built only from open sources. Slow movers (drones, helicopters) fly about four times real speed to fit a 10 to 15 minute battle.</p>
    <div class="tblwrap"><table class="lib"><thead><tr><th>CLASS</th><th>REAL-WORLD ANALOG</th><th>SYM</th><th>ROLE</th><th>SPEED</th><th>P(K) GEM-T / MSE</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2 style="margin-top:28px">Interceptors</h2>
    <div class="tblwrap"><table class="lib"><thead><tr><th>ROUND</th><th>FULL NAME</th><th>KILL MECHANISM</th><th>RANGE · AIR</th><th>RANGE · TBM</th><th>CEILING</th><th>COST</th></tr></thead><tbody>${wr}</tbody></table></div>
    <p class="mintro" style="margin-top:10px">Launcher loads follow the M903: 12 PAC-3 MSE, 4 GEM-T, or a mix of 6 MSE and 2 GEM-T. The fire unit pairs the AN/MPQ-65 radar with the AN/MSQ-132 Engagement Control Station.</p>
    <h2 style="margin-top:28px">Doctrine and terms</h2>
    <div class="gloss">${g.map(x => `<div><b>${esc(x[0])}</b>${esc(x[1])}</div>`).join('')}</div>
    <h2 style="margin-top:28px">Open sources</h2>
    <ul class="intel"><li><a href="https://en.wikipedia.org/wiki/MIM-104_Patriot" target="_blank" rel="noopener" style="color:var(--cyan)">MIM-104 Patriot (Wikipedia)</a></li><li><a href="https://www.globalsecurity.org/space/library/policy/army/fm/44-85/Appb.htm" target="_blank" rel="noopener" style="color:var(--cyan)">FM 44-85, Appendix B (GlobalSecurity)</a></li><li><a href="https://militaryembedded.com/radar-ew/sensors/sweden-requests-patriot-configuration-3-in-fms-valued-at-3-2-billion" target="_blank" rel="noopener" style="color:var(--cyan)">Sweden Configuration 3+ FMS notification</a></li><li><a href="https://www.armyrecognition.com/archives/archives-land-defense/land-defense-2023/spain-to-secure-2-8-billion-of-us-patriot-configuration-3-modernized-fire-units" target="_blank" rel="noopener" style="color:var(--cyan)">Spain Configuration 3+ and PDB-8 interface</a></li></ul>
    <h2 style="margin-top:28px">Keys</h2>
    <p class="mintro">Space acknowledge · 1–5 identity (Friend, Neutral, Unknown, Suspect, Hostile) · I interrogate · E engage · H hold fire · V veto · Tab next threat · M cycle mode · P pause · [ ] speed · + − zoom · T 3D · C centre · Esc unhook.</p>`;
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
    ${row('Expert mode', 'ENGAGE fires on tap and confirmation prompts disappear, except ROE warnings.', seg('setExp', [[false,'OFF'], [true,'ON']], s.expert))}
    ${row('Equipment faults', 'How often the radar, launchers and power plant break during a battle.', seg('setDiff', [['off','OFF'], ['normal','NORMAL'], ['hard','HARD']], s.diff))}
    ${row('Default speed', 'Time compression at the start of each battle.', seg('setSpd', [[1,'1×'], [2,'2×']], s.speed))}
    ${row('Unlock everything', 'Open every table, the campaign and the legacy console without certifying.', seg('setUnl', [[false,'OFF'], [true,'ON']], s.unlockAll))}
    ${row('Reset progress', 'Clears passed tables, best scores and campaigns on this device.', '<button class="btn danger sm" type="button" id="setReset">Reset</button>')}`;
  const bind = (id, key, conv, after) => $('#' + id).querySelectorAll('button').forEach(b => b.onclick = () => { if (id === 'setSkin' && b.dataset.v === 'legacy' && !unlocked()) return; s[key] = conv(b.dataset.v); store.save(); $('#' + id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); after && after(); });
  bind('setSkin', 'skin', v => v, applySkin); bind('setVoice', 'voice', v => v === 'true', () => { if (!s.voice) VO.stop(); });
  bind('setExp', 'expert', v => v === 'true'); bind('setDiff', 'diff', v => v); bind('setSpd', 'speed', v => +v); bind('setUnl', 'unlockAll', v => v === 'true', () => { applySkin(); openSet(); });
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
