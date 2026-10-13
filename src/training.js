// HOSTILE TRACK — crew drill tables: objectives (live checklist + pass criteria) and coach steps.
// Objective check(S, U) runs during the brief (S = null, U.cover set), live, and at the end (U.end = true).
// U: {cover, hooked:{kinds:Set, ent}, tilted, viewKm, end}
const HT_TRAIN = (() => {
const air = e => !e.T.ballistic && e.kind !== 'FALSE' && e.kind !== 'ARM';
const everTracked = (S, tag) => S && S.ents.filter(e => e.tag === tag).every(e => e.everTrk) && S.ents.some(e => e.tag === tag);
const fired = S => S.st.fired.MSE + S.st.fired.GEMT;
const idScore = S => { let ok = 0, bad = 0, n = 0; for (const x of Object.values(S.idLog || {})){ n++; const right = (x.truth === 'F' && x.id === 'FRD') || (x.truth === 'N' && x.id === 'NEU') || (x.truth === 'H' && (x.id === 'HOS' || x.id === 'SUS')); if (right) ok++; if ((x.id === 'HOS' || x.id === 'SUS') && x.truth !== 'H') bad++; } return {ok, bad, n}; };
const hooked = (U, k) => U && U.hooked && U.hooked.kinds.has(k);
const cur = U => U && U.hooked && U.hooked.ent;
const acksDone = (S, n) => S.acks.filter(a => a.done).length >= n;
const engCount = S => S.ev.filter(x => x.k === 'ENG').length;
const modeUsed = (S, m) => S.mode === m || S.ev.some(x => x.k === 'MODE' && x.text.endsWith(m));
const SEL = {scope:'#scope', card:'#card', ids:'#cIds', eng:'#cEng', mode:'#sMode', ack:'#btnAck', zout:'#zOut', z3d:'#z3d', lnch:'#pLnch', clock:'#sClock', counts:'#sMse'};

const TABLES = {
  1:{
    objectives:[
      {t:'Every defended asset inside the fan', check:(S, U) => (U.cover || S.cover).assets.every(x => x.ok), tip:'Swing the PTL until all three asset rings turn green.'},
      {t:'Both threat axes (060°, 100°) inside the fan', check:(S, U) => (U.cover || S.cover).axis.every(x => x.ok), tip:'The red threat marks must sit inside the fan, ideally near its centre.'},
      {t:'Low-altitude reach of 40 km or more on both axes', check:(S, U) => (U.cover || S.cover).axis.every(x => x.reach >= 40), tip:'Site C sits behind Round Hill: low targets stay hidden until they are on top of you. Pick A or B.'},
      {t:'Both target drones detected', check:(S) => !!S && everTracked(S, 'drone1') && everTracked(S, 'drone2'), tip:'If a drone never appeared, your fan or your site hid it.'},
    ],
    steps:[
      {pause:true, t:'This is your emplacement on the live scope. The cyan fan is the 120° sector the radar searches. The dashed amber line is the 100 m limit: low targets beyond it are below the horizon or behind terrain. Two target drones will now fly in low from 060° and 100°.'},
      {t:'Watch the fan for two amber symbols. They appear when they cross the 100 m line. If your line sits close to the battery, they appear very late or never.', done:S => everTracked(S, 'drone1') && everTracked(S, 'drone2'), el:'scope'},
      {t:'Both drones detected. Tap one and read RNG on the track card: that is how much warning your emplacement buys you. The table ends when they land.', last:true},
    ]},
  2:{
    objectives:[
      {t:'Hook an airliner', check:(S, U) => hooked(U, 'CIV')},
      {t:'Hook a friendly fighter', check:(S, U) => hooked(U, 'FRD')},
      {t:'Zoom out to see the 150 km ring', check:(S, U) => U && U.zoomed},
      {t:'Tilt the scope into 3D', check:(S, U) => U && U.tilted},
      {t:'Hook the medevac helicopter', check:(S, U) => hooked(U, 'MED')},
      {t:'Hook the silent target drone', check:(S, U) => hooked(U, 'OWA')},
    ],
    steps:[
      {pause:true, t:'Your scope, north up. The cyan triangle is your radar. Grey squares are defended assets, numbered by priority. Rings mark 25, 50, 100 and 150 km from the radar. The cyan fan is the radar’s search sector; the dashed amber line is where a target at 100 m drops out of sight.', el:'scope'},
      {pause:true, t:'Each symbol is a track. Its frame shows identity: cyan arc = friend, green half-square = neutral (civil), amber rounded frame = unknown, red chevron = hostile, diamond = ballistic missile. The line in front is one minute of flight; the fading dots behind are where it has been.'},
      {t:'Tap any track to hook it. Brackets close around it and the TRACK DATA panel fills in.', done:(S, U) => !!cur(U), el:'scope'},
      {pause:true, t:'The track card. BRG and RNG are bearing and range from your radar. ALT is altitude, SPD speed in knots, HDG heading. IFF is the transponder answer. THREAT names the defended asset it is heading for. The GEM-T and MSE lines say whether each missile could reach it right now.', el:'card'},
      {t:'Hook an airliner on J-66, the green dashed airway east of you. Its IFF line shows a Mode 3 squawk and a flight level.', done:(S, U) => hooked(U, 'CIV')},
      {t:'Hook a friendly fighter on the Holloman Lane, the cyan band from the northeast. Its IFF reads M4 VALID.', done:(S, U) => hooked(U, 'FRD')},
      {t:'Zoom out with − (button or key) until the 150 km ring fits on the scope.', done:(S, U) => U.zoomed, el:'zout'},
      {t:'Press 3D. The scope tilts: altitude becomes height and thin drop lines mark each track’s ground position. Press 3D again to flatten it.', done:(S, U) => U.tilted, el:'z3d'},
      {t:'Hook the medevac helicopter flying low from the east toward Range Control. ALT reads in feet; it is slow and close to the ground.', done:(S, U) => hooked(U, 'MED')},
      {t:'A silent target drone is inbound from the east. Hook it and read NO RESP on the IFF line. That is what an unknown looks like before you decide.', done:(S, U) => hooked(U, 'OWA')},
      {t:'Table II complete. Press END to see the review, or keep watching the traffic.', last:true},
    ]},
  3:{
    objectives:[
      {t:'At least 10 of 12 air tracks identified correctly', check:(S, U) => !!S && (U.end ? idScore(S).ok >= 10 : idScore(S).n >= 12), live:S => `${idScore(S).n}/12 declared`, tip:'Work the ladder: IFF, then route (airway or lane), then behaviour.'},
      {t:'No Hostile call on a friend or an airliner', check:S => !!S && idScore(S).bad === 0, tip:'A dead transponder inside the Holloman Lane is a friend. A 7600 squawk is an airliner with a radio failure.'},
    ],
    steps:[
      {pause:true, t:'The ID ladder. 1 · IFF: M4 VALID = friend; a Mode 3 squawk = airliner. 2 · Route: airliners fly J-66, friendly fighters fly the Holloman Lane. 3 · Behaviour: silent, from the east, outside every lane, heading for your assets = hostile.'},
      {pause:true, t:'Hook a track, then press 1 Friend, 2 Neutral, 3 Unknown, 4 Suspect or 5 Hostile, or use the ID buttons on the track card. Unknown is a fair holding answer; you can change any ID later. Tab jumps to the next unidentified track.', el:'ids'},
      {t:'Declare your first track.', done:S => idScore(S).n >= 1, el:'ids'},
      {t:'Keep going: hook each new track as it appears and declare it. Watch the checklist count.', done:S => idScore(S).n >= 6},
      {t:'An airliner squawking 7600 will leave J-66 and head for the Fuel Point. 7600 means radio failure. An emergency is not an attack: declare it Neutral.', done:S => Object.values(S.idLog || {}).some(x => x.dev && x.id === 'NEU')},
      {t:'Viper 2 answers NO RESP but flies the Holloman Lane at fighter speed. Press I to re-interrogate (dead transponders sometimes answer), then declare it Friend.', done:S => Object.values(S.idLog || {}).some(x => x.tag === 'viper' && x.truth === 'F' && x.iffFail && x.id === 'FRD')},
      {t:'Identify the rest. The table ends when the last target lands or leaves.', last:true},
    ]},
  4:{
    objectives:[
      {t:'Target declared Hostile', check:S => !!S && Object.values(S.idLog || {}).some(x => x.tag === 'target' && x.id === 'HOS'), tip:'Under Weapons Tight, the Hostile declaration is your authority to fire.'},
      {t:'Target killed with a single missile', check:(S, U) => !!S && S.st.kills >= 1 && fired(S) === 1, tip:'Your air doctrine fires one missile, then looks. Do not engage twice.'},
      {t:'No ROE violations', check:S => !S || S.st.viol === 0, tip:'Declare Hostile first, then engage.'},
    ],
    steps:[
      {pause:true, t:'Every manual shot follows five steps: hook, identify, check the envelope, engage, watch the kill assessment. A target aircraft will cross from 080° toward Range Control.'},
      {t:'Wait for the target to appear from 080°. It shows as an amber unknown.', done:S => S.ents.some(e => e.tag === 'target' && e.trk && e.trk.est)},
      {t:'Hook it: tap the symbol, or press Tab.', done:(S, U) => { const e = cur(U); return e && e.tag === 'target'; }},
      {t:'Declare it HOSTILE: press 5 or tap HOS. The symbol turns into a red chevron.', done:S => Object.values(S.idLog || {}).some(x => x.tag === 'target' && x.id === 'HOS'), el:'ids'},
      {t:'Read the GEM-T line: OUT OF RANGE or IN ENVELOPE. Now press and hold ENGAGE for half a second, or press E. If it is still out of range, the shot waits and fires the moment the target crosses the envelope edge.', done:S => engCount(S) >= 1, el:'eng'},
      {t:'Engagement accepted. The radar guides the missile all the way out. Watch for the kill assessment.', done:S => S.st.kills >= 1},
      {t:'Kill confirmed: one target, one missile. Table IV complete.', last:true},
    ]},
  5:{
    objectives:[
      {t:'No ballistic missile reaches the DAL', check:(S, U) => !S ? true : S.st.leak === 0, tip:'Engage red-marker missiles early, as soon as they enter the PAC-3 envelope.'},
      {t:'No missile spent on the grey-marker TBM', check:S => !S || S.st.waste.nondal === 0, tip:'A grey impact marker lands in open ground. Let it fall.'},
    ],
    steps:[
      {pause:true, t:'Ballistic missiles are declared Hostile automatically. The computer draws each predicted impact point with a dashed line to it: RED = it lands on a defended asset, GREY = open desert. Your job is triage.'},
      {pause:true, t:'Two ways to fight. MANUAL: hook each red-marker missile and engage; the computer picks PAC-3 MSE. SEMIAUTO: the computer engages every Hostile track that threatens the DAL and ignores grey markers. Pick with the MAN / SEMI switch at the top.', el:'mode'},
      {t:'Ballistic launch warning, threat axis 090°. Hook the first missile when it appears, or switch to SEMI.', done:(S, U) => S.mode !== 'MANUAL' || (cur(U) && cur(U).T.ballistic)},
      {t:'Engage every red marker. Leave the grey one alone. Ripple doctrine fires two PAC-3 per target.', done:S => S.ents.filter(e => e.kind === 'SRBM').length >= 4 && !S.ents.some(e => e.kind === 'SRBM' && e.alive)},
      {t:'Salvo over. Table V complete.', last:true},
    ]},
  6:{
    objectives:[
      {t:'Every order acknowledged within 15 seconds', check:(S, U) => !S ? true : S.st.lateAck === 0 && (!U.end || S.acks.every(a => a.done)), live:S => `${S.acks.filter(a => a.done).length}/${S.acks.length} acknowledged`, tip:'Press Space or ACK the moment HAMMER speaks.'},
      {t:'No ROE violations', check:S => !S || S.st.viol === 0, tip:'Hold Fire means never engage that track; Cease Fire means launch nothing.'},
      {t:'No drone reaches the DAL', check:S => !S || S.st.leak === 0, tip:'After Weapons Tight, declare the drones Hostile; after Weapons Free, engage them.'},
    ],
    steps:[
      {pause:true, t:'HAMMER, the Tactical Director, runs the air battle. Every call is an order. Acknowledge each one within 15 seconds with the ACK button or the Space bar. Orders also appear in the radio log on the left.', el:'ack'},
      {t:'First order incoming. Acknowledge it.', done:S => acksDone(S, 1), el:'ack'},
      {t:'HOLD FIRE on Viper flight: Viper 1 has no Mode 4 but is friendly. Acknowledge. Hook Viper 1 and you will see HOLD FIRE ORDERED on its status line. Never engage it.', done:S => acksDone(S, 2), el:'ack'},
      {t:'ADW Red, Weapons Tight. You may fire only at tracks you declare Hostile. Acknowledge, then declare the target drones Hostile as they appear.', done:S => acksDone(S, 3), el:'ack'},
      {t:'CEASE FIRE: launch nothing until HAMMER lifts it in about 25 seconds. Acknowledge.', done:S => acksDone(S, 4), el:'ack'},
      {t:'Weapons Free on the drones. Acknowledge, then kill them before they reach the DAL. SEMIAUTO will engage any drone you have declared Hostile.', done:S => acksDone(S, 5), el:'ack'},
      {t:'Keep the drones off the DAL. The table ends when the last one is down.', last:true},
    ]},
  7:{
    objectives:[
      {t:'Fight in SEMIAUTO', check:S => !!S && modeUsed(S, 'SEMI'), tip:'Switch MAN to SEMI at the top of the console.'},
      {t:'No threat reaches the DAL', check:S => !S || S.st.leak === 0, tip:'Declare drones and cruise missiles Hostile early so the computer has time to shoot.'},
      {t:'Fire 16 missiles or fewer', check:S => !S || fired(S) <= 16, live:S => `${fired(S)} fired`, tip:'Leave the grey-marker missile alone and keep GEM-T on drones; a PAC-3 on a drone is a wasted round.'},
    ],
    steps:[
      {pause:true, t:'Eighteen missiles, sixteen to spend. In SEMIAUTO you identify and the computer shoots in threat order. Ballistic tracks are declared automatically; drones and cruise missiles need you.'},
      {t:'Switch to SEMI now.', done:S => S.mode === 'SEMI', el:'mode'},
      {t:'Declare each drone and cruise missile HOSTILE as it firms up: Tab to hook the next unknown, 5 to declare. Watch the queue on the right.', done:S => engCount(S) >= 1},
      {t:'Watch the MSE and GEM-T counters at the top right. Sixteen fired is your ceiling.', el:'counts', last:true},
    ]},
  8:{objectives:[{t:'Score 85 or better', check:(S, U) => !S ? true : U.end ? S.score && S.score.total >= 85 : true, tip:'Review the findings: each one names the habit that cost points.'}], steps:[]},
};

function evaluate(table, S, U){
  const T = TABLES[table]; if (!T) return null;
  return T.objectives.map(o => ({t:o.t, ok:!!o.check(S, U || {}), live:typeof o.live === 'function' && S ? o.live(S) : '', tip:o.tip || ''}));
}
return {TABLES, evaluate, SEL};
})();
if (typeof module !== 'undefined') module.exports = HT_TRAIN;
