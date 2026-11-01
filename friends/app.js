import { createDb } from "./db.js";
import { CONFIG } from "./config.js";
import { bootstrap } from "./auth.js";
import { createCourts } from "./courts.js";

const db = createDb(CONFIG);
const BOOT = await bootstrap(db);          // { user: {id, role, name}, data: {...} } — вход + загрузка лиги
const DATA = BOOT.data;
{
  "use strict";

  // ---------------- state ----------------
  const state = {
    tab: "tournaments",
    players: DATA.players || [], clubs: DATA.clubs || [], bookings: DATA.bookings || [],
    tournaments: (DATA.tournaments || []).slice().sort((a,b)=>(a.seq||0)-(b.seq||0)),
    games: DATA.games || [],
    log: DATA.log || [],
    view: { tournament: null, create: false, stat: "leaderboard", h2h: [null,null], formSel: [], dynSel: [] },
    _bkClubOther: false, _bkClubOtherVal: "", _bkClubSel: "", _bkDate: "", _bkTime: "19:00", _bkTimeEnd: "21:00", _bkCourt: "", _bkType: null, _bkEdit: null,
  };
  const CLUB_LIST_DEFAULT = state.clubs;
  // миграция: двухэтапные турниры (linkedTo) — один турнир; деньги этапа 1 переносим в этап 2, этап 1 получает служебное имя
  (function migrateTwoStage() {
    state.tournaments.forEach(s2 => {
      if (!s2.linkedTo) return; const s1 = state.tournaments.find(x => x.id === s2.linkedTo); if (!s1) return;
      const m1 = s1.money || {}, m2 = s2.money || (s2.money = { court: null, prize: { enabled: false, fee: null, places: 3, amounts: [0,0,0] } });
      if (m1.court) { m2.court = (+m2.court || 0) + (+m1.court); m1.court = null; }
      if (m1.prize && m1.prize.enabled && m1.prize.fee && !(m2.prize && m2.prize.enabled)) { m2.prize = m1.prize; }
      if (m1.prize) m1.prize = { enabled: false, fee: null, places: 3, amounts: [0,0,0] };
      if (!/ · этап 1$/.test(s1.name)) s1.name = s2.name + " · этап 1";
    });
  })();

  let art = null;         // artifact capability namespace (null = cannot publish from this view)
  let canWrite = false;   // flips on when the capability resolves, off on not_writer
  let dirty = false, saving = false, saveTimer = null;
  let userCap = null, editorId = null;
  const profileCache = {};
  // ---------------- log ----------------
  function addLog(action) {
    const entry = { t: Date.now(), who: editorId || null, a: action };
    state.log.push(entry); pendingLogs.push(entry);
    if (state.log.length > 300) state.log = state.log.slice(-300);
  }
  function byId(arr, id) { return arr.find(x => x.id === id); }
  function playerName(id) { const p = byId(state.players, id); return p ? p.name : id; }
  function playersActive() { return state.players.filter(p => p.active); }
  // неактивный игрок (убран из лиги): его старые игры остаются в Эло, рейтинге (внизу), зале славы и турнирах,
  // но он не попадает в ачивки, «лучший/худший партнёр», Пары, Встречи и Финансы
  function isActive(id) { const p = byId(state.players, id); return !!(p && p.active); }

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove("show"), 1800);
  }
  function setSync(text) { const el = document.getElementById("syncStatus"); if (el) el.textContent = text; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function uid(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  // ---------------- persistence: Supabase (diff-sync) ----------------
  let pendingLogs = [];
  let reloadTimer = null;
  function stashView() {
    try { sessionStorage.setItem("padel.view", JSON.stringify({ tab: state.tab, view: state.view })); } catch(e) {}
  }
  function restoreView() {
    try {
      const raw = sessionStorage.getItem("padel.view"); if (!raw) return;
      const v = JSON.parse(raw); sessionStorage.removeItem("padel.view");
      if (v.tab) state.tab = v.tab;
      if (v.view) state.view = Object.assign(state.view, v.view);
    } catch(e) {}
  }
  function updateSyncLabel() {
    const el = document.getElementById("syncStatus");
    if (saving) { setSync("сохраняю…"); if (el) el.dataset.state = "saving"; }
    else if (!canWrite) { setSync("просмотр"); if (el) el.dataset.state = "view"; }
    else if (dirty) { setSync("не сохранено"); if (el) el.dataset.state = "dirty"; }
    else { setSync("сохранено"); if (el) el.dataset.state = "saved"; }
    const btn = document.getElementById("saveNow");
    if (btn) btn.style.display = (canWrite && dirty && !saving) ? "inline-block" : "none";
  }
  function commit(delayMs) {
    dirty = true; updateSyncLabel();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, delayMs == null ? 1500 : Math.min(delayMs, 1500));
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    if (!canWrite || saving || !dirty) return;
    saving = true; updateSyncLabel();
    const logsToSend = pendingLogs; pendingLogs = [];
    try {
      await db.sync(state, logsToSend);
      dirty = false;
    } catch (e) {
      pendingLogs = logsToSend.concat(pendingLogs);
      const msg = String(e && e.message || e);
      if (/row-level security|permission|42501/i.test(msg)) { canWrite = false; toast("У вас только просмотр — изменения не сохраняются"); dirty = false; }
      else { toast("Не удалось сохранить, попробую ещё раз"); saveTimer = setTimeout(saveNow, 6000); }
      console.error("sync failed", e);
    } finally { saving = false; updateSyncLabel(); }
  }
  // идёт ввод в поле — экран не перерисовываем (иначе пропадает набранный счёт и прыгает клавиатура)
  const typing = () => { const el = document.activeElement; return !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox","radio","file","button"].includes(el.type))); };
  let pendingReload = false, pendingRender = false;
  function bgRender() { if (typing()) { pendingRender = true; return; } render(); }
  document.addEventListener("focusout", () => setTimeout(() => {
    if (typing()) return;
    if (pendingReload) { pendingReload = false; reloadFromDb(); }
    else if (pendingRender) { pendingRender = false; render(); }
  }, 250));
  async function reloadFromDb() {
    if (typing()) { pendingReload = true; return; }
    if (dirty || saving) { reloadTimer = setTimeout(reloadFromDb, 2000); return; } // свои несохранённые правки важнее
    try {
      const d = await db.loadAll();
      state.players = d.players; state.clubs = d.clubs; state.bookings = d.bookings;
      state.tournaments = d.tournaments.slice().sort((a,b)=>(a.seq||0)-(b.seq||0)); state.games = d.games; state.log = d.log;
      if (typing()) { pendingRender = true; } else render(); loadPublicNames();
    } catch(e) { console.error("reload failed", e); }
  }
  // Публичные имена аккаунтов (как в Телеграме) для привязанных игроков — показываем в скобках рядом с именем в лиге
  async function loadPublicNames() {
    const ids = state.players.map(p => p.userId).filter(id => id && !(id in profileCache));
    if (!ids.length) return;
    try { const m = await db.profileNames(ids); let ch = false; ids.forEach(id => { profileCache[id] = m[id] || ""; if (m[id]) ch = true; }); if (ch) bgRender(); } catch(e) {}
  }
  function publicName(pid) {
    const p = byId(state.players, pid); if (!p || !p.userId) return "";
    const n = profileCache[p.userId] || ""; return n && n !== "?" && n.toLowerCase() !== p.name.toLowerCase() ? n : "";
  }
  function pl(pid) { return `<span class="plink" data-act="open-profile" data-id="${pid}">${esc(playerName(pid))}</span>`; }
  function nameWithPublic(pid) { const n = publicName(pid); return esc(playerName(pid)) + (n ? ` <span class="pub-name">(${esc(n)})</span>` : ""); }
  async function initArtifact() {
    const u = BOOT.user;
    canWrite = !!u && ["owner","admin","editor"].includes(u.role);
    editorId = u ? u.id : null;
    if (u && u.name) profileCache[u.id] = u.name;
    userCap = { profiles: async (ids) => { const m = await db.profileNames(ids); return Object.fromEntries(ids.map(id => [id, { name: m[id] }])); } };
    db.subscribe(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reloadFromDb, 700); });
    const lo = document.getElementById("logoutBtn"); if (lo) lo.onclick = async () => { await db.signOut(); location.reload(); };
    const who = document.getElementById("whoami"); if (who && u) who.textContent = u.name || "";
    updateSyncLabel(); render(); loadPublicNames();
  }
  window.addEventListener("beforeunload", () => { if (dirty) saveNow(); });

  // ---------------- Elo engine ----------------
  const ELO_START = 1500, K = 32;
  function computeElo() {
    const ratings = {}; const history = {};
    state.players.forEach(p => { ratings[p.id] = ELO_START; history[p.id] = [{ i:0, r: ELO_START }]; });
    const games = orderedGames();
    games.forEach((g, idx) => {
      if (g.scoreA == null || g.scoreB == null) return;
      const total = g.scoreA + g.scoreB; if (total <= 0) return;
      const teamARating = avgRating(g.teamA, ratings);
      const teamBRating = avgRating(g.teamB, ratings);
      const eA = 1/(1+Math.pow(10, (teamBRating-teamARating)/400));
      const eB = 1 - eA;
      const sA = g.scoreA/total, sB = g.scoreB/total;
      const deltaA = K*(sA-eA), deltaB = K*(sB-eB);
      g.teamA.forEach(pid => { if (ratings[pid]==null) return; ratings[pid]+=deltaA; history[pid].push({i:idx+1, r:ratings[pid]}); });
      g.teamB.forEach(pid => { if (ratings[pid]==null) return; ratings[pid]+=deltaB; history[pid].push({i:idx+1, r:ratings[pid]}); });
    });
    return { ratings, history };
  }
  // Эло в разрезе одного турнира: рейтинг до его начала, после, дельта и вклад каждого матча
  function eloDetail(tid, alsoIds) {
    const mineIds = new Set([tid].concat(alsoIds || [])); // у этапа 2 — вместе с играми этапа 1
    const ratings = {}; state.players.forEach(p => ratings[p.id] = ELO_START);
    const before = {}, after = {}, perGame = {};
    orderedGames().forEach(g => {
      if (g.scoreA == null || g.scoreB == null) return;
      const total = g.scoreA + g.scoreB; if (total <= 0) return;
      const rA = avgRating(g.teamA, ratings), rB = avgRating(g.teamB, ratings);
      const eA = 1/(1+Math.pow(10, (rB-rA)/400));
      const dA = K*(g.scoreA/total - eA), dB = K*(g.scoreB/total - (1-eA));
      const mine = mineIds.has(g.tournamentId);
      if (mine) {
        g.teamA.concat(g.teamB).forEach(p => { if (!(p in before)) before[p] = ratings[p] != null ? ratings[p] : ELO_START; });
        perGame[g.id] = { dA, dB, rA, rB, eA };
      }
      g.teamA.forEach(p => { if (ratings[p] != null) ratings[p] += dA; });
      g.teamB.forEach(p => { if (ratings[p] != null) ratings[p] += dB; });
      if (mine) g.teamA.concat(g.teamB).forEach(p => { after[p] = ratings[p] != null ? ratings[p] : ELO_START; });
    });
    const delta = {}; Object.keys(before).forEach(p => delta[p] = (after[p] != null ? after[p] : before[p]) - before[p]);
    return { before, after, delta, perGame };
  }
  function fmtDelta(v) { const r = Math.round(v*10)/10; return (r > 0 ? "+" : r < 0 ? "−" : "±") + Math.abs(r).toFixed(1); }
  function eloDetailHtml(t, games, ed) {
    const ids = Object.keys(ed.delta).sort((a,b) => ed.delta[b]-ed.delta[a]);
    const col = v => v >= 0 ? "var(--court)" : "var(--danger)";
    const totals = ids.map(id => `<span class="chip" style="cursor:default;gap:4px;padding:5px 10px;font-size:13px;">${esc(playerName(id))} <span style="color:${col(ed.delta[id])};">${fmtDelta(ed.delta[id])}</span> <span class="tiny">${Math.round(ed.before[id])}→${Math.round(ed.after[id])}</span></span>`).join("");
    const byRound = {}; games.forEach(g => { if (ed.perGame[g.id]) { const k = (g.tournamentId===t.id ? "2" : "1") + "|" + g.round; (byRound[k] = byRound[k]||[]).push(g); } });
    const two = Object.keys(byRound).some(k => k.startsWith("1|"));
    const rows = Object.keys(byRound).sort((a,b) => (a.split("|")[0]-b.split("|")[0]) || (a.split("|")[1]-b.split("|")[1])).map(k => { const [st, r] = k.split("|"); return `
      <div class="tiny" style="margin:10px 0 4px;font-weight:600;">${two ? "Этап " + st + " · " : ""}Раунд ${r}</div>
      ${byRound[k].map(g => { const x = ed.perGame[g.id]; const side = (team, d) => `${team.map(p => esc(playerName(p))).join(" + ")} <strong style="color:${col(d)};">${fmtDelta(d)}</strong>`;
        return `<div class="h2h-game"><div class="row" style="align-items:flex-start;gap:8px;">
          <span style="flex:1;font-size:13.5px;">${side(g.teamA, x.dA)}</span>
          <span style="white-space:nowrap;font-weight:700;">${g.scoreA}:${g.scoreB}</span>
          <span style="flex:1;font-size:13.5px;text-align:right;">${side(g.teamB, x.dB)}</span>
        </div><div class="tiny" style="margin-top:3px;">Корт ${g.court}${g.label ? " · "+esc(g.label) : ""} · средний Эло ${Math.round(x.rA)} vs ${Math.round(x.rB)} · ожидание ${Math.round(x.eA*100)}%:${Math.round((1-x.eA)*100)}%</div></div>`; }).join("")}`; }).join("");
    return `<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px;">
      <div class="row"><h3>Эло за турнир</h3><button class="edit-pen" data-act="elo-detail" data-id="${t.id}" title="скрыть" style="font-size:16px;">✕</button></div>
      <p class="tiny" style="margin:4px 0 8px;">Каждый матч: ±Эло обоим игрокам пары. Внизу матча — средний рейтинг команд перед игрой и ожидаемая доля очков; чем сильнее фаворит, тем меньше он получает за победу и больше теряет за поражение.</p>
      <div class="wrap-tags">${totals}</div>
      ${rows}
    </div>`;
  }
  function avgRating(ids, ratings) {
    const vals = ids.map(id => ratings[id] != null ? ratings[id] : ELO_START);
    return vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
  }
  function orderedGames() {
    const tOrder = {}; state.tournaments.forEach(t => tOrder[t.id] = t.seq || 0);
    return state.games.slice().sort((a,b) => {
      const ta = tOrder[a.tournamentId]||0, tb = tOrder[b.tournamentId]||0;
      if (ta!==tb) return ta-tb;
      if (a.round!==b.round) return a.round-b.round;
      return (a.court||0)-(b.court||0);
    });
  }

  // ---------------- profile / pair stats ----------------
  function computeProfile(pid) {
    let gp=0, w=0, l=0, pf=0, pa=0;
    const partners = {}; // otherId -> {g,w,pf,pa}
    const opponents = {};
    state.games.forEach(g => {
      const inA = g.teamA.includes(pid), inB = g.teamB.includes(pid);
      if (!inA && !inB) return;
      if (g.scoreA==null || g.scoreB==null) return;
      const own = inA ? g.scoreA : g.scoreB;
      const opp = inA ? g.scoreB : g.scoreA;
      gp++; pf+=own; pa+=opp;
      if (g.decided !== false) { if (own>opp) w++; else if (opp>own) l++; }
      const partnerId = (inA ? g.teamA : g.teamB).find(x => x!==pid);
      const oppIds = inA ? g.teamB : g.teamA;
      if (partnerId) {
        const s = partners[partnerId] || {g:0,w:0,pf:0,pa:0};
        s.g++; s.pf+=own; s.pa+=opp; if (g.decided!==false && own>opp) s.w++;
        partners[partnerId]=s;
      }
      oppIds.forEach(oid => {
        const s = opponents[oid] || {g:0,w:0,pf:0,pa:0};
        s.g++; s.pf+=own; s.pa+=opp; if (g.decided!==false && own>opp) s.w++;
        opponents[oid]=s;
      });
    });
    let bestPartner=null, bestPartnerNet=-Infinity, worstOpp=null, worstOppNet=Infinity, worstPartner=null, worstPartnerNet=Infinity;
    Object.entries(partners).filter(([id]) => isActive(id)).forEach(([id,s]) => { const net=(s.pf-s.pa)/s.g; if (net>bestPartnerNet){bestPartnerNet=net; bestPartner=id;} if (net<worstPartnerNet){worstPartnerNet=net; worstPartner=id;} });
    Object.entries(opponents).filter(([id]) => isActive(id)).forEach(([id,s]) => { const net=(s.pf-s.pa)/s.g; if (net<worstOppNet){worstOppNet=net; worstOpp=id;} });
    const d = gp - w - l; // ничьи
    return { gp, w, l, d, pf, pa, diff: pf-pa, winPct: gp? Math.round(w/(w+l||1)*100):0, bestPartner, bestPartnerNet, worstPartner, worstPartnerNet, worstOpp, worstOppNet, partners, opponents };
  }

  function computeAllPairs() {
    const map = {};
    state.games.forEach(g => {
      [g.teamA, g.teamB].forEach((team, idx) => {
        if (team.length!==2) return;
        const key = team.slice().sort().join("|");
        const s = map[key] || {ids: team.slice().sort(), g:0, w:0, l:0, pf:0, pa:0};
        const own = idx===0? g.scoreA : g.scoreB;
        const opp = idx===0? g.scoreB : g.scoreA;
        if (own==null||opp==null) return;
        s.g++; s.pf+=own; s.pa+=opp;
        if (g.decided!==false) { if (own>opp) s.w++; else if (opp>own) s.l++; }
        map[key]=s;
      });
    });
    return Object.values(map).sort((a,b)=> (b.pf-b.pa)/b.g - (a.pf-a.pa)/a.g);
  }

  function headToHead(idA, idB) {
    const asOpp = [], asPartners = [];
    state.games.forEach(g => {
      const aInA=g.teamA.includes(idA), aInB=g.teamB.includes(idA);
      const bInA=g.teamA.includes(idB), bInB=g.teamB.includes(idB);
      if (!(aInA||aInB) || !(bInA||bInB)) return;
      if (aInA && bInB || aInB && bInA) asOpp.push(g);
      else if ((aInA&&bInA)||(aInB&&bInB)) asPartners.push(g);
    });
    return { asOpp, asPartners };
  }

  // ---------------- Americano (8 players) schedule ----------------
  function generateAmericano8(playerIds) {
    if (playerIds.length !== 8) return null;
    const dev = (x,i) => x==null? null : (x+i)%7;
    const base = [];
    for (let i=0;i<7;i++) {
      const t1 = [[null,dev(0,i)],[dev(4,i),dev(6,i)]];
      const t2 = [[dev(1,i),dev(5,i)],[dev(2,i),dev(3,i)]];
      base.push([t1,t2]);
    }
    const lab = {}; lab[-1]=playerIds[0];
    for (let k=0;k<7;k++) lab[k]=playerIds[k+1];
    const map = n => n==null ? lab[-1] : lab[n];
    return base.map(round => round.map(([a,b]) => [[map(a[0]),map(a[1])],[map(b[0]),map(b[1])]]));
  }

  // ---------------- Americano for any N (randomized greedy, fair partners/opponents/sit-outs) ----------------
  function generateAmericanoAny(playerIds, rounds, courts) {
    const n = playerIds.length;
    const perRound = Math.min(Math.floor(n/4), Math.max(1, courts||1));
    if (n < 4 || perRound < 1 || rounds < 1) return null;
    if (n === 8 && perRound === 2 && rounds === 7) return generateAmericano8(playerIds);
    const key = (a,b) => a<b ? a+"|"+b : b+"|"+a;
    let best = null, bestScore = Infinity;
    for (let attempt=0; attempt<120; attempt++) {
      const partner = {}, opp = {}, played = {};
      playerIds.forEach(p => played[p]=0);
      const pc = (a,b) => partner[key(a,b)]||0, oc = (a,b) => opp[key(a,b)]||0;
      const sched = [];
      for (let r=0; r<rounds; r++) {
        const order = playerIds.slice().sort((a,b) => (played[a]-played[b]) || (Math.random()-0.5));
        const active = order.slice(0, perRound*4);
        let bestRound = null, bestCost = Infinity;
        for (let k=0; k<40; k++) {
          const sh = active.slice().sort(() => Math.random()-0.5);
          const matches = []; let cost = 0;
          for (let m=0; m<perRound; m++) {
            const q = sh.slice(m*4, m*4+4);
            const splits = [[[q[0],q[1]],[q[2],q[3]]],[[q[0],q[2]],[q[1],q[3]]],[[q[0],q[3]],[q[1],q[2]]]];
            let bs=null, bc=Infinity;
            splits.forEach(s => {
              const c = (pc(s[0][0],s[0][1]) + pc(s[1][0],s[1][1]))*10
                + [[0,0],[0,1],[1,0],[1,1]].reduce((acc,[i,j]) => acc + Math.pow(oc(s[0][i],s[1][j]),2), 0);
              if (c<bc) { bc=c; bs=s; }
            });
            matches.push(bs); cost += bc;
          }
          if (cost<bestCost) { bestCost=cost; bestRound=matches; }
        }
        bestRound.forEach(([a,b]) => {
          partner[key(a[0],a[1])] = pc(a[0],a[1])+1; partner[key(b[0],b[1])] = pc(b[0],b[1])+1;
          a.forEach(x => b.forEach(y => { opp[key(x,y)] = oc(x,y)+1; }));
          a.concat(b).forEach(p => played[p]++);
        });
        sched.push(bestRound);
      }
      let score = 0;
      Object.values(partner).forEach(c => { if (c>1) score += (c-1)*(c-1)*10; });
      const ov = Object.values(opp); const mean = ov.reduce((a,b)=>a+b,0)/Math.max(1,ov.length);
      ov.forEach(c => score += (c-mean)*(c-mean));
      const pv = Object.values(played); score += (Math.max(...pv)-Math.min(...pv))*5;
      if (score < bestScore) { bestScore = score; best = sched; }
    }
    return best;
  }
  function defaultAmericanoRounds(n, courts) {
    const perRound = Math.min(Math.floor(n/4), Math.max(1, courts||1));
    if (perRound < 1) return 0;
    if (n % 4 === 0 && perRound === n/4) return n-1;
    return Math.ceil((n*(n-1)/2) / (2*perRound));
  }

  // ---------------- round robin (fixed teams) ----------------
  function generateRoundRobinTeams(teams) {
    // teams: array of {id, players:[a,b]}
    const n = teams.length;
    const list = teams.slice();
    if (n % 2 === 1) list.push(null); // bye
    const m = list.length;
    const rounds = [];
    const arr = list.slice();
    for (let r=0;r<m-1;r++) {
      const pairs = [];
      for (let i=0;i<m/2;i++) {
        const a = arr[i], b = arr[m-1-i];
        if (a && b) pairs.push([a,b]);
      }
      rounds.push(pairs);
      arr.splice(1,0,arr.pop());
    }
    return rounds;
  }

  // ---------------- render root ----------------
  function render() {
    document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab===state.tab));
    updateNavAvatar();
    const v = document.getElementById("view");
    if (state.tab==="players") v.innerHTML = viewPlayers();
    else if (state.tab==="bookings") {
      const mode = state.view.bkMode === "free" || state.view.bkMode === "watch" ? state.view.bkMode : "ours";
      const seg = `<div class="seg bk-seg"><button class="${mode==="ours"?"active":""}" data-act="bk-mode" data-val="ours">Наши брони</button><button class="${mode==="free"?"active":""}" data-act="bk-mode" data-val="free">Свободные корты</button><button class="${mode==="watch"?"active":""}" data-act="bk-mode" data-val="watch">🔔 Уведомления</button></div>`;
      v.innerHTML = seg + (mode === "free" ? courts().viewFree() : mode === "watch" ? courts().viewWatch() : viewBookings());
      if (mode !== "ours" && !courts().state.opened) setTimeout(() => courts().open(), 0);
    }
    else if (state.tab==="tournaments") v.innerHTML = viewTournaments();
    else if (state.tab==="stats") v.innerHTML = viewStats();
    else if (state.tab==="profile") v.innerHTML = viewProfileTab();
    attachHandlers();
    if (state.tab==="bookings" && (state.view.bkMode==="free" || state.view.bkMode==="watch")) courts().bind(v);
    else document.body.classList.remove("ct-noscroll");
  }
  // ---------- тема: тёмная по умолчанию, светлая по кнопке в шапке ----------
  function setTheme(t) {
    if (t === "light") document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    const b = document.getElementById("themeBtn"); if (b) { b.textContent = t === "light" ? "☾" : "☀"; b.title = t === "light" ? "тёмная тема" : "светлая тема"; }
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "light" ? "#F2EBE3" : "#0A0A0B";
    const tg = window.Telegram && window.Telegram.WebApp;
    try { if (tg && tg.initData) { tg.setHeaderColor && tg.setHeaderColor(t === "light" ? "#F2EBE3" : "#0A0A0B"); tg.setBackgroundColor && tg.setBackgroundColor(t === "light" ? "#F2EBE3" : "#0A0A0B"); } } catch (e) {}
  }
  (function initTheme() {
    let t = "light"; try { t = localStorage.getItem("padel.theme") === "dark" ? "dark" : "light"; } catch (e) {}  // по умолчанию светлая
    const meta = document.querySelector("header.top .meta");
    if (meta && !document.getElementById("themeBtn")) {
      const b = document.createElement("button"); b.id = "themeBtn"; b.className = "icon-btn"; b.type = "button";
      b.onclick = () => { const n = document.documentElement.dataset.theme === "light" ? "dark" : "light"; try { localStorage.setItem("padel.theme", n); } catch (e) {} setTheme(n); render(); };
      const lo = document.getElementById("logoutBtn"); meta.insertBefore(b, lo || null);
    }
    setTheme(t);
  })();
  let _courts = null;
  function courts() {
    if (!_courts) _courts = createCourts({ db, esc, toast, groupChat: true,
      rerender: () => { if (state.tab==="bookings" && (state.view.bkMode==="free" || state.view.bkMode==="watch")) { const y = window.scrollY; render(); window.scrollTo(0, y); } },
      go: (m) => { state.view.bkMode = m; render(); window.scrollTo(0, 0); } });
    return _courts;
  }

  // ================= PLAYERS =================
  function viewPlayers() {
    const rows = state.players.slice().sort((a,b)=> (b.active-a.active) || a.name.localeCompare(b.name,"ru")).map(p => canWrite && state.view.renamePlayer === p.id ? `
      <div class="link-row" style="gap:8px;">
        <input type="text" id="renameInput" value="${esc(p.name)}" style="flex:1;" maxlength="40">
        <button class="btn sm" data-act="rename-cancel">Отмена</button>
        <button class="btn sm primary" data-act="rename-save" data-id="${p.id}">Сохранить</button>
      </div>` : `
      <div class="link-row p-row">
        <span class="p-row-main" data-act="open-profile" data-id="${p.id}">${avatarHtml(p.id, 36)}<span><span class="p-row-name">${nameWithPublic(p.id)}</span>${p.active?"":' <span class="tiny">(не играет)</span>'}<br><span class="tiny">${playerRankLine(p.id)}</span></span></span>
        <span class="p-row-side">${canWrite? `<button class="edit-pen" data-act="rename-player" data-id="${p.id}" title="переименовать">✎</button><button class="btn sm ${p.active?'':'primary'}" data-act="toggle-player" data-id="${p.id}">${p.active? "Убрать" : "Вернуть"}</button>` : ""}<span class="arrow" data-act="open-profile" data-id="${p.id}">&#8250;</span></span>
      </div>`).join("") || `<div class="empty"><div class="ic">&#128101;</div>нет игроков</div>`;
    return `
      <div class="card">
        <h2>Игроки</h2>
        <p class="tiny">Нажми на игрока — откроется его профиль.${canWrite ? " «Убрать» — не участвует в новых турнирах, история сохраняется." : ""}</p>
        <div style="margin-top:8px;">${rows}</div>
      </div>
      ${canWrite? `<div class="card">
        <h3>Добавить игрока</h3>
        <div class="row" style="margin-top:10px;">
          <input type="text" id="newPlayerName" placeholder="Имя">
          <button class="btn primary" data-act="add-player" style="white-space:nowrap;">+ Добавить</button>
        </div>
      </div>` : ""}
      ${membersCardHtml()}`;
  }

  // ================= АККАУНТЫ И РОЛИ (владелец / админ) =================
  const ROLE_LABEL = { owner: "владелец", admin: "админ", editor: "редактор", player: "игрок", viewer: "зритель" };
  function isAdminUser() { const u = BOOT.user; return !!u && (u.role === "owner" || u.role === "admin"); }
  function membersCardHtml() {
    if (!isAdminUser()) return "";
    const u = BOOT.user;
    if (!state._members) {
      if (!state._membersLoading) { state._membersLoading = true; db.listMembers().then(m => { state._members = m; state._membersLoading = false; render(); }).catch(e => { state._membersLoading = false; state._members = []; toast("Не удалось загрузить участников"); }); }
      return `<div class="card"><h3>Аккаунты и роли</h3><p class="tiny">загружаю…</p></div>`;
    }
    const order = { owner: 0, admin: 1, editor: 2, player: 3, viewer: 4 };
    const ms = state._members.slice().sort((a,b) => (order[a.role]-order[b.role]) || (a.name||"").localeCompare(b.name||"", "ru"));
    const canSet = (m) => m.userId !== u.id && m.role !== "owner" && !(u.role === "admin" && m.role === "admin");
    const roleOpts = (m) => ["admin","editor","player","viewer"].filter(r => u.role === "owner" || r !== "admin")
      .map(r => `<option value="${r}"${m.role===r?" selected":""}>${ROLE_LABEL[r]}</option>`).join("");
    const rows = ms.map(m => `<div class="link-row p-row">
        <span class="p-row-main" style="cursor:default;">${m.playerId ? avatarHtml(m.playerId, 36) : `<span class="avatar ph" style="width:36px;height:36px;">${SILHOUETTE}</span>`}<span><span class="p-row-name">${esc(m.name || "без имени")}${m.userId === u.id ? ' <span class="tiny">(ты)</span>' : ""}</span><br><span class="tiny">${m.playerId && byId(state.players, m.playerId) ? "игрок: " + esc(playerName(m.playerId)) : "не привязан к игроку"}</span></span></span>
        <span class="p-row-side">${canSet(m)
          ? `<select class="role-sel" data-act="set-role" data-id="${m.userId}">${roleOpts(m)}</select><button class="btn sm ghost danger" data-act="remove-member" data-id="${m.userId}" title="убрать из лиги">✕</button>`
          : `<span class="role-tag ${m.role}">${ROLE_LABEL[m.role] || m.role}</span>`}</span>
      </div>`).join("");
    return `<div class="card">
      <h3>Аккаунты и роли</h3>
      <p class="tiny">Кто зашёл в лигу через приложение. <b>Админ</b> — всё, кроме ролей админов; <b>редактор</b> — вносит счёт и создаёт турниры; <b>игрок</b> — смотрит и ведёт свой профиль; <b>зритель</b> — только смотрит.</p>
      <div style="margin-top:8px;">${rows || '<div class="tiny">пока никого</div>'}</div>
    </div>`;
  }
  async function setMemberRole(userId, role) {
    const m = (state._members||[]).find(x => x.userId === userId); if (!m) return;
    const prev = m.role;
    try { await db.setMemberRole(userId, role); m.role = role; toast(`${m.name || "Аккаунт"}: теперь ${ROLE_LABEL[role]}`); }
    catch(e) { m.role = prev; toast("Не удалось: " + (e.message || e)); }
    render();
  }
  async function removeMember(userId) {
    const m = (state._members||[]).find(x => x.userId === userId); if (!m) return;
    if (!confirm(`Убрать ${m.name || "аккаунт"} из лиги? Игрок и его статистика останутся, отвяжется только вход.`)) return;
    try { await db.removeMember(userId); state._members = state._members.filter(x => x.userId !== userId); const p = state.players.find(x => x.userId === userId); if (p) p.userId = null; toast("Убрал из лиги"); }
    catch(e) { toast("Не удалось: " + (e.message || e)); }
    render();
  }

  // ================= BOOKINGS =================
  function viewBookings() {
    const now = new Date();
    const upcoming = state.bookings.slice().sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time))
      .filter(b => (b.date+"T"+(b.timeEnd||b.time||"00:00")) >= now.toISOString().slice(0,16));
    const typeLbl = {street:"уличный", covered:"крытый", indoor:"внутри"};
    const courtsLbl = c => { if (!c) return ""; const n = +c; if (!Number.isFinite(n) || String(c).trim()!==String(n)) return "· корт " + esc(c); const m = n%10, h = n%100; return "· " + n + (m===1 && h!==11 ? " корт" : (m>=2 && m<=4 && (h<10||h>=20)) ? " корта" : " кортов"); };
    const timeLbl = b => esc(b.time||"") + (b.timeEnd ? "–" + esc(b.timeEnd) : "");
    const rows = upcoming.map(b => `
      <div class="card" style="margin-bottom:10px;${state._bkEdit===b.id?'border-color:var(--court);':''}">
        <div class="row">
          <div>
            <h3>${esc(b.club)} ${courtsLbl(b.court)}</h3>
            <p class="tiny">${fmtDate(b.date)} · ${timeLbl(b)} · ${typeLbl[b.type]||b.type}</p>
          </div>
          ${canWrite? `<span style="display:flex;gap:6px;"><button class="btn sm" data-act="edit-booking" data-id="${b.id}">Изменить</button><button class="btn sm danger" data-act="del-booking" data-id="${b.id}">Удалить</button></span>` : ""}
        </div>
      </div>`).join("") || `<div class="empty"><div class="ic">&#128197;</div>броней пока нет</div>`;

    const clubOptions = (state.clubs.length? state.clubs : CLUB_LIST_DEFAULT)
      .map(n => `<option value="${esc(n)}"${state._bkClubSel===n?" selected":""}>${esc(n)}</option>`).join("");

    return `
      <div class="section-head"><h2>Ближайшие брони</h2></div>
      ${rows}

      ${canWrite? `<div class="card" id="bkForm" style="margin-top:16px;${state._bkEdit?'border-color:var(--court);':''}">
        <div class="row"><h3>${state._bkEdit ? "Изменить бронь" : "Добавить бронь"}</h3>${state._bkEdit ? `<button class="btn ghost sm" data-act="cancel-edit-booking">Отмена</button>` : ""}</div>
        <div class="stack" style="margin-top:10px;">
          <label class="field" style="margin-bottom:0;"><span class="lbl">Дата</span><input type="date" id="bkDate" value="${esc(state._bkDate)}"></label>
          <div class="row" style="gap:10px;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">С</span><input type="time" id="bkTime" value="${esc(state._bkTime)}"></label>
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">До</span><input type="time" id="bkTimeEnd" value="${esc(state._bkTimeEnd)}"></label>
          </div>
          <label class="field" style="margin-bottom:0;"><span class="lbl">Клуб</span>
            <select id="bkClub">${clubOptions}<option value="__new__"${state._bkClubSel==="__new__"?" selected":""}>+ Другой клуб…</option></select>
          </label>
          <label class="field" id="bkClubOtherWrap" style="margin-bottom:0;display:${state._bkClubOther? "block":"none"};"><span class="lbl">Название клуба</span><input type="text" id="bkClubOther" placeholder="Введите название" value="${esc(state._bkClubOtherVal||"")}"></label>
          <label class="field" style="margin-bottom:0;"><span class="lbl">Количество кортов</span><input type="number" min="1" max="10" id="bkCourt" placeholder="напр. 2" value="${esc(state._bkCourt)}"></label>
          <div>
            <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Вид корта</span>
            <div class="seg" id="bkType">
              <button type="button" data-val="street">Уличный</button>
              <button type="button" data-val="covered">Крытый</button>
              <button type="button" data-val="indoor">Внутри</button>
            </div>
          </div>
          <button class="btn primary block" data-act="add-booking">${state._bkEdit ? "Сохранить изменения" : "Сохранить бронь"}</button>
        </div>
      </div>` : ""}`;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso+"T00:00:00");
    return d.toLocaleDateString("ru-RU", { day:"numeric", month:"long", weekday:"short" });
  }

  // ================= TOURNAMENTS =================
  function viewTournaments() {
    if (state.view.tournament) return viewTournamentDetail(state.view.tournament);
    if (state.view.create === "choose") return viewCreateChooser();
    if (state.view.create === "friendly") return viewFriendlyCreate();
    if (state.view.create) return viewTournamentCreate();
    const rows = allEvents().slice().reverse().map(t => {
      if (isFriendly(t)) return friendlyTileHtml(t);
      const gs = linkedParent(t) ? stageGames(t) : state.games.filter(g=>g.tournamentId===t.id);
      const gcount = gs.filter(g=>g.scoreA!=null).length;
      const total = gs.length;
      const st = total>0 && gcount===total ? "done" : gcount>0 ? "live" : "planned";
      const stLabel = { done: "завершён", live: "текущий", planned: "запланирован" }[st];
      return `<div class="tile t-tile" data-act="open-tournament" data-id="${t.id}">
        <div class="t-tile-main"><div class="t-tile-name">${esc(t.name)}</div><div class="tiny">${fmtDate(t.date)} · ${tLabel(t)}</div></div>
        <div class="t-tile-side"><span class="t-status ${st}"><i></i>${stLabel}</span><span class="arrow">&#8250;</span></div>
      </div>`;
    }).join("") || `<div class="card"><div class="empty"><div class="ic">&#127934;</div>турниров и матчей ещё нет</div></div>`;
    return `
      <div class="section-head"><h2>Турниры</h2>${canWrite? `<button class="btn primary sm" data-act="new-tournament">+ Создать</button>` : ""}</div>
      <div class="stack">${rows}</div>`;
  }

  // ================= PHRASE OF THE DAY =================
  function buildQuotes() {
    const q = [];
    if (!state.games.length) return ["Пока пусто. Первый турнир — первые легенды."];
    const A = computeAchievements();
    const N = playerName;
    const seqs = playerSeqs();
    const { ratings } = computeElo();
    const played = state.players.filter(p => p.active && (seqs[p.id]||[]).length);
    const st = {}; played.forEach(p => st[p.id] = streakInfo(seqs[p.id]));
    const holder = name => { const t = A.titles.concat(A.anti).find(x => x.name===name); return t && t.holders.length ? t.holders : null; };
    const king = holder("Король"); if (king) q.push(`👑 ${king[0].label} на троне с ${king[0].sub}. Кто-нибудь вообще собирается это менять?`);
    played.forEach(p => {
      const s = st[p.id];
      if (s.curL>=5) q.push(`🥶 ${N(p.id)}: ${s.curL} поражений подряд. Это уже не полоса, это образ жизни.`);
      else if (s.curL>=3) q.push(`🧊 ${N(p.id)} проиграл ${s.curL} подряд. Говорят, дно — это когда уже некуда, кроме как вверх.`);
      if (s.curW>=4) q.push(`🔥 ${N(p.id)} выиграл ${s.curW} подряд. Кто его остановит? Сетка не считается.`);
      else if (s.curW>=3) q.push(`🔥 У ${N(p.id)} ${s.curW} победы подряд. Партнёры, занимайте очередь.`);
    });
    const ttl = {}; A.titles.forEach(t => t.holders.forEach(h => { ttl[h.label] = (ttl[h.label]||0)+1; }));
    Object.entries(ttl).filter(([k,v]) => v>=3 && !k.includes(" + ")).forEach(([k,v]) => q.push(`🏅 У ${k} сразу ${v} титулов. Остальным предлагается номинация «участник».`));
    const anti = {}; A.anti.forEach(t => t.holders.forEach(h => { anti[h.label] = (anti[h.label]||0)+1; }));
    Object.entries(anti).filter(([k,v]) => v>=2 && !k.includes(" + ")).forEach(([k,v]) => q.push(`🙈 ${k} собрал ${v} антититула. Коллекционер, но не тот.`));
    const tox = holder("Токсичная пара"); if (tox) q.push(`🧯 ${tox[0].label} — ${tox[0].sub}. Может, просто не ставить их вместе?`);
    const ideal = holder("Идеальная пара"); if (ideal) q.push(`🤝 ${ideal[0].label}: ${ideal[0].sub}. Химия, которую не объяснить.`);
    const unlucky = holder("Невезучий"); if (unlucky) q.push(`🎲 ${unlucky[0].label}: ${unlucky[0].sub}. Одно очко — а сколько боли.`);
    const clutch = holder("Клатч"); if (clutch) q.push(`⚡ ${clutch[0].label} — ${clutch[0].sub}. Нервы из стали, или просто везёт.`);
    const spoon = holder("Деревянная ложка"); if (spoon) q.push(`🥄 ${spoon[0].label} закрыл последний турнир снизу. В следующий раз — только вверх.`);
    const champ = holder("Чемпион"); if (champ) q.push(`🏆 Действующий чемпион — ${champ[0].label}. Корона жмёт? Скоро проверим.`);
    const rocket = holder("Ракета"); if (rocket) q.push(`🚀 ${rocket[0].label} прибавил ${rocket[0].sub} за турнир. Кто-то тренируется втайне.`);
    const sorted = played.slice().sort((a,b) => (ratings[b.id]||1500)-(ratings[a.id]||1500));
    if (sorted.length>=2) { const d = Math.round((ratings[sorted[0].id]||1500)-(ratings[sorted[1].id]||1500)); q.push(`📊 Между ${N(sorted[0].id)} и ${N(sorted[1].id)} всего ${d} Эло. Один вечер решает всё.`); }
    const bal = played.filter(p => { const s=seqs[p.id]; const w=s.filter(r=>r.win).length, l=s.filter(r=>r.loss).length; return s.length>=10 && w===l; });
    bal.forEach(p => q.push(`⚖️ ${N(p.id)} — ровно 50% побед. Идеальный баланс, как Танос завещал.`));
    const upcoming = state.bookings.filter(b => b.date >= new Date().toISOString().slice(0,10)).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
    if (upcoming) q.push(`📅 Ближайшая игра: ${fmtDate(upcoming.date)} в ${upcoming.time}, ${upcoming.club}. Ракетки не забыть.`);
    q.push("🎾 Падел — это как теннис, только с оправданием «стенка помешала».");
    q.push("🍋 Если проиграл — виноват партнёр. Если выиграл — заслуга твоя. Так работает статистика.");
    q.push("💡 Совет дня: лоб — это не только часть головы.");
    q.push("🧠 Тактика на сегодня: попасть в корт. Остальное приложится.");
    q.push("🍺 Третий сет всегда играется в баре.");
    return q;
  }
  function quoteBannerHtml() {
    let quotes;
    try { quotes = buildQuotes(); } catch(e) { return ""; }
    if (!quotes.length) return "";
    const day = Math.floor(Date.now()/86400000);
    const idx = ((day + (state.view.quoteShift||0)) % quotes.length + quotes.length) % quotes.length;
    return `<div class="card quote"><div class="row" style="align-items:flex-start;gap:8px;">
      <div><div class="tiny" style="margin-bottom:3px;">Фраза дня</div><div class="quote-text">${esc(quotes[idx])}</div></div>
      <button class="btn ghost sm" data-act="next-quote" title="ещё одна" style="flex:0 0 auto;">↻</button>
    </div></div>`;
  }
  // ---- форматы турниров: ключ → название + описание (показывается по кнопке ⓘ) ----
  const FORMATS = [
    { key: "americano", label: "Американо", desc: "Индивидуальный зачёт: каждый раунд пары перемешиваются, партнёр не повторяется (а соперники — как можно реже). Все играют одинаковое число матчей, при 5–7, 9–11 участниках по очереди отдыхают. Очки каждого матча идут в личную копилку обоих игроков пары — побеждает тот, кто набрал больше всего очков за турнир. Лучше всего подходит для 8 человек на 2 кортах: 7 раундов, и каждый сыграет с каждым в паре ровно один раз." },
    { key: "roundrobin", label: "TeamAmericano", desc: "То же самое, что Americano, но играют постоянные пары. Записался с другом — играешь весь турнир с ним, состав вашей команды не меняется. Зачёт командный: побеждает пара, набравшая больше всех очков.\n\nПо расписанию каждая команда играет со всеми остальными командами (round-robin или его укороченная версия — зависит от количества команд и кортов). Счёт каждого матча идёт в общую копилку пары.\n\nФормат для тех, кто хочет именно «свою команду» — например, готовится к парному турниру с конкретным напарником и хочет сыграться вместе.\n\nВ отличие от обычного Американо здесь меньше «социалки» (партнёр всегда один), зато больше тактики: вы с напарником можете прорабатывать связки, привыкать к стилю друг друга и расти как пара." },
    { key: "playoff", label: "Плей-офф", desc: "Турнир на вылет для 4 пар: два полуфинала, затем автоматически создаются финал (победители) и матч за 3-е место (проигравшие). Быстрый формат — всего 2 раунда, зато с настоящей развязкой." },
    { key: "two", label: "Американо → SwissCourt", desc: "Один турнир из двух этапов. Этап 1 — Американо: пары перемешиваются по расписанию, все играют одинаковое число матчей, набирается стартовая таблица. Этап 2 — SwissCourt: пары каждого раунда собираются по текущей общей таблице так, чтобы матчи были максимально равными. Таблица, W-D-L, Эло, призовой фонд и рекорды — общие за оба этапа; в статистике это один турнир.\n\nПервый раунд этапа 2 собирается кнопкой «Сгенерировать пары на основе этапа 1», когда счета первого этапа внесены." },
    { key: "swiss", label: "SwissCourt", desc: "Формат на основе швейцарской системы: пары и соперники каждый раунд подбираются алгоритмом так, чтобы матчи были максимально равными, а состав твоих напарников за турнир — максимально разным.\n\nИндивидуальный зачёт, как в Американо: сумма набранных очков за все матчи. Победа 14:7 даёт больше, чем 11:10 — формат учитывает не только сам факт победы, но и её разницу. Количество раундов организатор выбирает сам, матч играется до 21 очка. Нужно ровно 4 игрока на корт (8, 12, 16… участников).\n\nКак алгоритм собирает раунд? После каждого раунда берётся текущая таблица (очки, при равенстве — Buchholz, сумма очков соперников). Алгоритм перебирает возможные расклады и выбирает тот, где в каждом матче суммы очков двух команд максимально близки — сильный играет в паре со слабым против такой же сбалансированной пары, а не сильные против слабых. Повторы напарников и соперников при этом по возможности разводятся. В 1-м раунде таблицы ещё нет, поэтому баланс считается по Эло лиги.\n\nВажно: корты не имеют веса. Победа 21:15 на Корте 1 и такая же победа на Корте 3 приносят одинаковые 21 очко. Первый корт — это просто «где сейчас лидеры», а не премия к счёту.\n\nГлавное отличие — лимит повторов задаёт организатор. Параметр cap: cap = 1 — с каждым напарником максимум один матч за турнир, максимальная социальность. cap = 2 — до двух матчей с одним напарником (по умолчанию). cap = 3 — до трёх: алгоритму проще балансировать составы, чуть точнее итоговая таблица." },
  ];
  // ---- TeamAmericano (fixed pairs) helpers ----
  function teamTable(t, games) {
    // порядок пар: очки → победы → личные встречи (победы, затем разница) → общая разница
    const key = p => p.slice().sort().join("|");
    const map = {};
    const mk = players => ({ players: players.slice(), k: key(players), pts:0, pa:0, w:0, l:0, d:0, gp:0, h2h:{} });
    (t.teams||[]).forEach(tm => { map[key(tm.players)] = mk(tm.players); });
    games.forEach(g => {
      if (g.scoreA==null || g.scoreB==null) return;
      [[g.teamA, g.teamB, g.scoreA, g.scoreB],[g.teamB, g.teamA, g.scoreB, g.scoreA]].forEach(([team, opp, own, oppS]) => {
        const k = key(team); const r = map[k] || (map[k] = mk(team));
        r.pts += own; r.pa += oppS; r.gp++;
        if (g.decided!==false) { if (own>oppS) r.w++; else if (oppS>own) r.l++; }
        if (own===oppS) r.d++;
        const h = r.h2h[key(opp)] || (r.h2h[key(opp)] = { w:0, diff:0 });
        if (g.decided!==false && own>oppS) h.w++;
        h.diff += own - oppS;
      });
    });
    const base = (a,b) => (b.pts-a.pts) || (b.w-a.w);
    const rows = Object.values(map).sort(base);
    const out = [];
    for (let i = 0; i < rows.length; ) {
      let j = i; while (j+1 < rows.length && !base(rows[i], rows[j+1])) j++;
      const grp = rows.slice(i, j+1);
      if (grp.length > 1) {
        const ks = new Set(grp.map(r => r.k));
        grp.forEach(r => { r.hw = 0; r.hd = 0; Object.entries(r.h2h).forEach(([k,v]) => { if (ks.has(k)) { r.hw += v.w; r.hd += v.diff; } }); });
        grp.sort((a,b) => (b.hw-a.hw) || (b.hd-a.hd) || ((b.pts-b.pa)-(a.pts-a.pa)));
      }
      out.push(...grp); i = j+1;
    }
    const same = (a,b) => !base(a,b) && (a.hw||0)===(b.hw||0) && (a.hd||0)===(b.hd||0) && (a.pts-a.pa)===(b.pts-b.pa);
    out.forEach((r,i) => {
      const p = out[i-1], nx = out[i+1];
      r.place = p && same(p,r) ? p.place : i+1;
      // чем решилось место относительно соседа с теми же очками
      const nb = (p && !base(p,r)) ? p : (nx && !base(r,nx)) ? nx : null;
      r.tb = !nb ? "" : r.w!==nb.w ? "wins" : (r.hw||0)!==(nb.hw||0) || (r.hd||0)!==(nb.hd||0) ? "h2h" : (r.pts-r.pa)!==(nb.pts-nb.pa) ? "diff" : "tie";
    });
    return out;
  }
  function plural(n, one, few, many) { const m = n%10, h = n%100; return n + " " + (m===1 && h!==11 ? one : (m>=2 && m<=4 && (h<10||h>=20)) ? few : many); }
  function teamRoundsPlan(teamsCount, courts) {
    // полный круг: каждая команда с каждой; матчи раунда делятся по кортам
    if (teamsCount < 2) return 0;
    const perRound = Math.floor(teamsCount/2), rounds = teamsCount % 2 ? teamsCount : teamsCount-1;
    return rounds * Math.ceil(perRound / Math.max(1, courts||1));
  }
  // ---- SwissCourt engine ----
  // ---- связанные этапы: турнир-продолжение (linkedTo) считает таблицу вместе с первым этапом ----
  function linkedParent(t) { return t && t.linkedTo ? byId(state.tournaments, t.linkedTo) : null; }
  function linkedChild(t) { return state.tournaments.find(x => x.linkedTo === t.id) || null; }
  function linkedGames(t) { const p = linkedParent(t); return p ? state.games.filter(g => g.tournamentId === p.id) : []; }
  function stageGames(t) { return linkedGames(t).concat(state.games.filter(g => g.tournamentId === t.id)); }
  function swissStats(t, games) {
    const ids = (t.participantIds || []).slice();
    const pts = {}, bh = {}, gp = {}, wins = {}, draws = {}, diff = {}, partner = {}, opp = {};
    ids.forEach(id => { pts[id] = 0; bh[id] = 0; gp[id] = 0; wins[id] = 0; draws[id] = 0; diff[id] = 0; });
    const key = (a,b) => a<b ? a+"|"+b : b+"|"+a;
    games.forEach(g => {
      if (g.scoreA!=null && g.scoreB!=null) {
        g.teamA.forEach(p => { pts[p]=(pts[p]||0)+g.scoreA; gp[p]=(gp[p]||0)+1; diff[p]=(diff[p]||0)+g.scoreA-g.scoreB; if (g.decided!==false && g.scoreA>g.scoreB) wins[p]=(wins[p]||0)+1; });
        g.teamB.forEach(p => { pts[p]=(pts[p]||0)+g.scoreB; gp[p]=(gp[p]||0)+1; diff[p]=(diff[p]||0)+g.scoreB-g.scoreA; if (g.decided!==false && g.scoreB>g.scoreA) wins[p]=(wins[p]||0)+1; });
        if (g.scoreA===g.scoreB) g.teamA.concat(g.teamB).forEach(p => { draws[p]=(draws[p]||0)+1; });
      }
      partner[key(g.teamA[0],g.teamA[1])] = (partner[key(g.teamA[0],g.teamA[1])]||0)+1;
      partner[key(g.teamB[0],g.teamB[1])] = (partner[key(g.teamB[0],g.teamB[1])]||0)+1;
      g.teamA.forEach(x => g.teamB.forEach(y => { opp[key(x,y)] = (opp[key(x,y)]||0)+1; }));
    });
    games.forEach(g => {
      if (g.scoreA==null || g.scoreB==null) return;
      g.teamA.forEach(p => g.teamB.forEach(o => { bh[p]=(bh[p]||0)+(pts[o]||0); }));
      g.teamB.forEach(p => g.teamA.forEach(o => { bh[p]=(bh[p]||0)+(pts[o]||0); }));
    });
    const pc = (a,b) => partner[key(a,b)]||0, oc = (a,b) => opp[key(a,b)]||0;
    return { ids, pts, bh, gp, wins, draws, diff, pc, oc };
  }
  function swissOrder(t, games) {
    const s = swissStats(t, games);
    const { ratings } = computeElo();
    const rnd = {}; s.ids.forEach(id => rnd[id] = Math.random());
    const played = games.some(g => g.scoreA!=null && g.scoreB!=null);
    const order = s.ids.slice().sort((a,b) => played
      ? (s.pts[b]-s.pts[a]) || (s.bh[b]-s.bh[a]) || (rnd[a]-rnd[b])
      : (rnd[a]-rnd[b]));
    return { order, s, ratings, played };
  }
  function generateSwissRound(t, games) {
    const cap = t.swissCap || 2;
    // Продолжение: таблица (очки, Buchholz) — по обоим этапам; повторы напарников/соперников для cap — только по этому этапу.
    // В этапе 1 (Американо) каждый уже сыграл с каждым, и если считать его, cap запрещает почти всё и ломает баланс.
    const own = games;
    games = linkedGames(t).concat(games);
    const { order, s, ratings, played } = swissOrder(t, games);
    if (linkedParent(t)) { const so = swissStats(t, own); s.pc = so.pc; s.oc = so.oc; }
    const n = order.length; if (n < 4 || n % 4) return null;
    // Сила игрока: очки в текущей таблице; в 1-м раунде (таблицы ещё нет) — Эло лиги в сопоставимом масштабе.
    const strength = id => played ? (s.pts[id]||0) : ((ratings[id]||1500)-1500)/10;
    // Цель: максимально РАВНЫЕ матчи — суммы силы двух команд в каждом матче как можно ближе.
    // Жёстко: повтор напарника сверх cap запрещён (штраф 1000). Мягко: повторы напарника/соперника в пределах cap.
    const matchCost = (A, B) => {
      let c = Math.abs(strength(A[0])+strength(A[1]) - strength(B[0])-strength(B[1]));
      [A,B].forEach(p => { const k = s.pc(p[0],p[1]); c += k >= cap ? 1000 : k*4; });
      A.forEach(x => B.forEach(y => { c += s.oc(x,y) * 1.5; }));
      return c;
    };
    let best = null, bestCost = Infinity;
    const consider = (matches) => {
      let c = 0; for (const m of matches) { c += matchCost(m[0], m[1]); if (c >= bestCost) return; }
      c += Math.random()*1e-6; // случайный выбор среди равных
      if (c < bestCost) { bestCost = c; best = matches.map(m => [m[0].slice(), m[1].slice()]); }
    };
    if (n <= 12) {
      // полный перебор: все разбиения на пары, затем все способы свести пары в матчи
      const ids = order.slice();
      const pairsAcc = [];
      const groupPairs = (rest, acc) => {
        if (!rest.length) { consider(acc); return; }
        const a = rest[0];
        for (let i=1;i<rest.length;i++) { acc.push([a, rest[i]]); groupPairs(rest.slice(1,i).concat(rest.slice(i+1)), acc); acc.pop(); }
      };
      const makePairs = (rest) => {
        if (!rest.length) { groupPairs(pairsAcc.slice(), []); return; }
        const a = rest[0];
        for (let i=1;i<rest.length;i++) {
          if (s.pc(a, rest[i]) >= cap && n >= 8) continue; // отсекаем заведомо запрещённые пары (ускорение)
          pairsAcc.push([a, rest[i]]); makePairs(rest.slice(1,i).concat(rest.slice(i+1))); pairsAcc.pop();
        }
      };
      makePairs(ids);
      if (!best) { // всё упёрлось в cap — разрешаем превышение, но с штрафом
        const makePairsAny = (rest) => {
          if (!rest.length) { groupPairs(pairsAcc.slice(), []); return; }
          const a = rest[0];
          for (let i=1;i<rest.length;i++) { pairsAcc.push([a, rest[i]]); makePairsAny(rest.slice(1,i).concat(rest.slice(i+1))); pairsAcc.pop(); }
        };
        makePairsAny(ids);
      }
    } else {
      // много игроков: старт «сильный + слабый» в каждой команде, затем локальный поиск обменами игроков
      const sorted = order.slice().sort((a,b) => strength(b)-strength(a));
      const teams = []; while (sorted.length) teams.push([sorted.shift(), sorted.pop()]);
      teams.sort((a,b) => (strength(b[0])+strength(b[1])) - (strength(a[0])+strength(a[1])));
      let matches = []; for (let i=0;i<teams.length;i+=2) matches.push([teams[i], teams[i+1]]);
      const total = ms => ms.reduce((a,m) => a + matchCost(m[0], m[1]), 0);
      let cur = total(matches);
      const slots = []; matches.forEach((m,mi) => [0,1].forEach(ti => [0,1].forEach(pi => slots.push([mi,ti,pi]))));
      for (let pass=0; pass<200; pass++) {
        let improved = false;
        for (let i=0;i<slots.length;i++) for (let j=i+1;j<slots.length;j++) {
          const [m1,t1,p1] = slots[i], [m2,t2,p2] = slots[j];
          const tmp = matches[m1][t1][p1]; matches[m1][t1][p1] = matches[m2][t2][p2]; matches[m2][t2][p2] = tmp;
          const c = total(matches);
          if (c < cur - 1e-9) { cur = c; improved = true; }
          else { matches[m2][t2][p2] = matches[m1][t1][p1]; matches[m1][t1][p1] = tmp; }
        }
        if (!improved) break;
      }
      best = matches;
    }
    // корты: матч с самыми сильными — на Корт 1 (чисто косметика)
    best.sort((x,y) => (strength(y[0][0])+strength(y[0][1])+strength(y[1][0])+strength(y[1][1])) - (strength(x[0][0])+strength(x[0][1])+strength(x[1][0])+strength(x[1][1])));
    return best;
  }
  function swissNextRound(tid) {
    const t = byId(state.tournaments, tid); if (!t || t.format!=="swiss") return;
    const games = state.games.filter(g => g.tournamentId===tid);
    const last = games.length ? Math.max(...games.map(g=>g.round)) : 0;
    if (games.some(g => g.round===last && (g.scoreA==null || g.scoreB==null))) { toast("Сначала внесите все счета раунда " + last); return; }
    const round = last + 1;
    if (round === 1 && linkedParent(t)) {
      const pg = linkedGames(t);
      const unscored = pg.filter(g => g.scoreA==null || g.scoreB==null).length;
      if (!pg.length || unscored === pg.length) { toast("Сначала внесите счета этапа 1 — «" + linkedParent(t).name + "»"); return; }
      if (unscored && !confirm("В этапе 1 ещё не внесены счета " + plural(unscored, "игры", "игр", "игр") + ". Собрать пары по текущей таблице этапа 1?")) return;
    }
    const matches = generateSwissRound(t, games);
    if (!matches) { toast("Нужно число участников, кратное 4"); return; }
    matches.forEach((m, i) => state.games.push({ id: tid+"-r"+round+"-c"+(i+1), tournamentId: tid, round, court: i+1, teamA: m[0], teamB: m[1], scoreA: null, scoreB: null, decided: false }));
    if (round > (t.rounds||0)) t.rounds = round;
    addLog("SwissCourt «" + t.name + "»: собран раунд " + round);
    toast("Раунд " + round + " собран по таблице");
    render(); commit(1500);
  }
  function swissControlsHtml(t, games) {
    const last = games.length ? Math.max(...games.map(g=>g.round)) : 0;
    const planned = t.rounds || last;
    const lastDone = !games.some(g => g.round===last && (g.scoreA==null || g.scoreB==null));
    const lastEmpty = last>0 && games.filter(g=>g.round===last).every(g=>g.scoreA==null && g.scoreB==null);
    const parent = linkedParent(t);
    if (parent && last === 0) {
      const pg = linkedGames(t);
      const scored = pg.filter(g => g.scoreA!=null && g.scoreB!=null).length;
      const ready = pg.length > 0 && scored === pg.length;
      return `
        <div class="card" style="margin-top:14px;border-color:var(--ball);">
          <h3>Пары этапа 2</h3>
          <p class="tiny">Раунд 1 собирается по итоговой таблице этапа 1 — «${esc(parent.name)}». Внесено счетов: ${scored} из ${pg.length}${ready ? " · всё готово" : scored ? " · можно собрать по текущей таблице" : " · сначала внесите счета этапа 1"}.</p>
          <button class="btn primary" data-act="swiss-next-round" data-id="${t.id}" style="margin-top:8px;width:100%;" ${scored ? "" : "disabled"}>Сгенерировать пары на основе этапа 1</button>
        </div>`;
    }
    return `
      <div class="card" style="margin-top:14px;">
        <div class="row">
          <div>
            <h3>Раунды SwissCourt</h3>
            <p class="tiny">Сыграно ${last} из ${planned} · cap ${t.swissCap||2}${last < planned ? (lastDone ? " · можно собирать следующий" : " · внесите все счета раунда " + last) : " · все раунды сыграны"}</p>
          </div>
          <button class="btn primary sm" data-act="swiss-next-round" data-id="${t.id}" style="white-space:nowrap;" ${lastDone ? "" : "disabled"}>${last < planned ? "+ Раунд " + (last+1) : "+ Доп. раунд"}</button>
        </div>
        ${lastEmpty && (last > 1 || parent) ? `<button class="btn ghost sm danger" data-act="remove-round" data-id="${t.id}" style="margin-top:6px;">Убрать раунд ${last} (без счёта)${last===1 && parent ? " — пересобрать по этапу 1" : ""}</button>` : ""}
      </div>`;
  }
  function formatInfo(f) { return FORMATS.find(x => x.key === f) || null; }
  function formatLabel(f) { const fi = formatInfo(f); return fi ? fi.label : f; }
  function tLabel(t) { return isFriendly(t) ? "Товарищеский матч" : linkedParent(t) ? formatLabel("two") : formatLabel(t.format); }
  function tFormatKey(t) { return linkedParent(t) ? "two" : t.format; }
  function formatInfoHtml(f) {
    const fi = formatInfo(f); if (!fi || !fi.desc) return "";
    return `<div class="card" style="background:var(--surface-2);margin:10px 0 0;padding:10px 12px;"><div class="row" style="align-items:flex-start;"><div><strong>${esc(fi.label)}</strong><p class="tiny" style="margin:4px 0 0;color:var(--ink-2);font-size:13.5px;line-height:1.4;white-space:pre-line;">${esc(fi.desc)}</p></div><button class="edit-pen" data-act="format-info" data-val="" title="скрыть" style="font-size:16px;">✕</button></div></div>`;
  }

  // ================= ТОВАРИЩЕСКИЙ МАТЧ =================
  // Хранится как турнир с format "friendly": 2 пары, 1 матч (очки) или сеты (геймы, добавляются по ходу игры).
  // В Эло, историю матчей и статистику игр идёт как обычно; в титулы, места и рейтинг турниров — нет.
  function isFriendly(t) { return !!t && t.format === "friendly"; }
  function friendlyResult(t) {
    const games = state.games.filter(g => g.tournamentId === t.id).sort((a,b) => a.round - b.round);
    const sets = t.scoringMode === "tennis", n = sets ? ((t.settings||{}).sets || 1) : 1, need = n >= 3 && n % 2 ? Math.floor(n/2) + 1 : n;
    let a = 0, b = 0; const played = games.filter(g => g.scoreA != null && g.scoreB != null);
    played.forEach(g => { if (sets) { if (g.scoreA > g.scoreB) a++; else if (g.scoreB > g.scoreA) b++; } else { a += g.scoreA; b += g.scoreB; } });
    const done = played.length > 0 && (sets ? (a >= need || b >= need || played.length >= n) : played.length === games.length);
    return { games, sets, n, need, a, b, done, winner: done ? (a > b ? 0 : b > a ? 1 : null) : null };
  }
  function ensureFriendlyProgress(tid) {
    const t = byId(state.tournaments, tid); if (!isFriendly(t) || t.scoringMode !== "tennis") return false;
    const r = friendlyResult(t), last = r.games[r.games.length - 1];
    const decided = r.a >= r.need || r.b >= r.need;
    let changed = false;
    if (decided) { // матч решён — несыгранные сеты не нужны
      const extra = r.games.filter(g => g.scoreA == null && g.scoreB == null && g.round > 1);
      if (extra.length) { state.games = state.games.filter(g => !extra.includes(g)); changed = true; }
    } else if (last && last.scoreA != null && last.scoreB != null && r.games.length < r.n && r.games.every(g => g.scoreA != null && g.scoreB != null)) {
      const k = r.games.length + 1, tm = t.teams || [];
      state.games.push({ id: t.id + "-r" + k + "-c1", tournamentId: t.id, round: k, court: 1, teamA: tm[0].players.slice(), teamB: tm[1].players.slice(), scoreA: null, scoreB: null, decided: false, label: "Сет " + k });
      changed = true;
    }
    if (changed) addLog("Товарищеский «" + t.name + "»: " + (decided ? "матч решён, лишние сеты убраны" : "добавлен сет " + (r.games.length + 1)));
    return changed;
  }
  function friendlyTileHtml(t) {
    const r = friendlyResult(t), tm = t.teams || [];
    const st = r.done ? "done" : r.games.some(g => g.scoreA != null) ? "live" : "planned";
    const names = i => (tm[i] ? tm[i].players.map(p => esc(playerName(p))).join(" + ") : "");
    return `<div class="tile t-tile fr-tile" data-act="open-tournament" data-id="${t.id}">
      <div class="t-tile-main"><div class="t-tile-name"><span class="fr-tag">🤝 матч</span> ${esc(t.name)}</div>
        <div class="tiny">${fmtDate(t.date)} · ${names(0)} <b>vs</b> ${names(1)}</div></div>
      <div class="t-tile-side">${st !== "planned" ? `<span class="fr-score ${st}">${r.a}:${r.b}</span>` : `<span class="t-status planned"><i></i>запланирован</span>`}<span class="arrow">&#8250;</span></div>
    </div>`;
  }
  function viewCreateChooser() {
    return `
      <div class="section-head"><h2>Создать</h2><button class="btn ghost" data-act="cancel-create">Отмена</button></div>
      <div class="stack">
        <button class="card kind-card" data-act="create-kind" data-val="tournament"><span class="kind-ic">🏆</span><span><b>Турнир</b><small>Американо, SwissCourt, плей-офф и другие форматы — таблица, места, титулы</small></span><span class="hist-chev">›</span></button>
        <button class="card kind-card" data-act="create-kind" data-val="friendly"><span class="kind-ic">🤝</span><span><b>Товарищеский матч</b><small>Одна игра пара на пару: до X очков, всего X очков или по сетам</small></span><span class="hist-chev">›</span></button>
      </div>`;
  }
  function fDraft() {
    return state._fDraft || (state._fDraft = { name: "Товарищеский матч", date: new Date().toISOString().slice(0,10), players: [], pairing: null, mode: "sets", target: 21, sets: 3, setGames: 6, court: "", prizeEnabled: false, fee: "" });
  }
  function fRead() {
    const d = fDraft(), g = id => document.getElementById(id);
    if (g("fName")) d.name = g("fName").value; if (g("fDate")) d.date = g("fDate").value;
    if (g("fTarget")) d.target = g("fTarget").value; if (g("fCourt")) d.court = g("fCourt").value; if (g("fFee")) d.fee = g("fFee").value;
  }
  function fPairings(ids) { return ids.length === 4 ? [[[ids[0], ids[1]], [ids[2], ids[3]]], [[ids[0], ids[2]], [ids[1], ids[3]]], [[ids[0], ids[3]], [ids[1], ids[2]]]] : []; }
  function fBalanced(ids) {
    const { ratings } = computeElo(), R = id => ratings[id] || ELO_START, opts = fPairings(ids);
    let best = 0, bd = Infinity; opts.forEach((o, i) => { const d = Math.abs(R(o[0][0]) + R(o[0][1]) - R(o[1][0]) - R(o[1][1])); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function viewFriendlyCreate() {
    const d = fDraft(), active = playersActive();
    const { ratings } = computeElo(), R = id => Math.round(ratings[id] || ELO_START);
    if (d.players.length === 4 && d.pairing == null) d.pairing = fBalanced(d.players);
    const opts = fPairings(d.players), bal = d.players.length === 4 ? fBalanced(d.players) : -1;
    const pairLbl = o => `${o.map(p => p.map(x => esc(playerName(x))).join(" + ")).join(" <b>vs</b> ")}`;
    const ok = d.name.trim() && d.date && d.players.length === 4 && d.pairing != null && (d.mode === "sets" || +d.target > 0);
    return `
      <div class="section-head"><h2>Товарищеский матч</h2><button class="btn ghost" data-act="cancel-create">Отмена</button></div>
      <div class="card stack">
        <label class="field" style="margin-bottom:0;"><span class="lbl">Название</span><input type="text" id="fName" value="${esc(d.name)}"></label>
        <label class="field" style="margin-bottom:0;"><span class="lbl">Дата</span><input type="date" id="fDate" value="${esc(d.date)}"></label>
      </div>
      <div class="card">
        <h3>Участники <span class="tiny">(${d.players.length} из 4)</span></h3>
        <div class="wrap-tags" style="margin-top:10px;">${active.map(p => `<span class="chip ${d.players.includes(p.id) ? "active" : ""}" data-act="f-player" data-id="${p.id}">${esc(p.name)}</span>`).join("")}</div>
        ${d.players.length === 4 ? `<span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:14px 0 8px;">Пары</span>
        <div class="stack" style="gap:8px;">${opts.map((o, i) => `<button class="fr-pair ${d.pairing === i ? "on" : ""}" data-act="f-pair" data-val="${i}"><span>${pairLbl(o)}</span><span class="tiny">${R(o[0][0]) + R(o[0][1])} : ${R(o[1][0]) + R(o[1][1])}${i === bal ? " · ⚖️ ровнее всего" : ""}</span></button>`).join("")}</div>`
        : `<p class="tiny" style="margin:10px 0 0;">Выбери 4 игроков — 2 на 2.</p>`}
      </div>
      <div class="card">
        <h3>Формат</h3>
        <div class="seg" style="margin-top:10px;">
          <button class="${d.mode === "race" ? "active" : ""}" data-act="f-mode" data-val="race">До X очков</button>
          <button class="${d.mode === "fixed" ? "active" : ""}" data-act="f-mode" data-val="fixed">Всего X очков</button>
          <button class="${d.mode === "sets" ? "active" : ""}" data-act="f-mode" data-val="sets">Классика: сеты</button>
        </div>
        ${d.mode === "sets" ? `
          <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:14px 0 6px;">Сетов</span>
          <div class="seg">${[[1,"1 сет"],[2,"2 сета"],[3,"до 2 побед"],[5,"до 3 побед"]].map(([v,l]) => `<button class="${d.sets === v ? "active" : ""}" data-act="f-sets" data-val="${v}">${l}</button>`).join("")}</div>
          <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin:12px 0 6px;">Геймов в сете</span>
          <div class="seg">${[4,6].map(v => `<button class="${d.setGames === v ? "active" : ""}" data-act="f-games" data-val="${v}">до ${v}</button>`).join("")}</div>
          <p class="tiny" style="margin:8px 0 0;">Как в теннисе: сет до ${d.setGames} геймов с разницей в 2, при ${d.setGames}:${d.setGames} — тай-брейк (${d.setGames + 1}:${d.setGames}). ${d.sets >= 3 ? `Матч до ${Math.floor(d.sets/2) + 1} выигранных сетов — следующий сет появится сам, лишние не понадобятся.` : d.sets === 2 ? "Играется ровно 2 сета, 1:1 — ничья." : ""}</p>`
        : `<label class="field" style="margin:12px 0 0;"><span class="lbl">${d.mode === "race" ? "Играем до (очков)" : "Всего очков в матче"}</span><input type="number" id="fTarget" min="1" max="99" value="${esc(d.target)}"></label>
          <p class="tiny" style="margin:8px 0 0;">${d.mode === "race" ? "Побеждает пара, первой набравшая X очков." : "Разыгрывается ровно X очков — счёт второй пары подставится сам."}</p>`}
      </div>
      <div class="card">
        <h3>Финансы <span class="tiny">(можно заполнить позже)</span></h3>
        <div class="stack" style="margin-top:10px;">
          <label class="field" style="margin-bottom:0;"><span class="lbl">Корты — с человека, ${CUR}</span><input type="number" min="0" id="fCourt" value="${esc(d.court)}" placeholder="напр. 300"></label>
          <div class="seg"><button class="${!d.prizeEnabled ? "active" : ""}" data-act="f-prize" data-val="0">Без фонда</button><button class="${d.prizeEnabled ? "active" : ""}" data-act="f-prize" data-val="1">С призовым фондом</button></div>
          ${d.prizeEnabled ? `<label class="field" style="margin-bottom:0;"><span class="lbl">Взнос с человека, ${CUR}</span><input type="number" min="0" id="fFee" value="${esc(d.fee)}" placeholder="напр. 100"></label>
          <p class="tiny" style="margin:0;">Фонд = взнос × 4 игрока. Его забирает пара-победитель (пополам), при ничьей взнос возвращается всем.</p>` : ""}
        </div>
      </div>
      <button class="btn primary block" data-act="f-create" ${ok ? "" : "disabled"}>Создать матч</button>`;
  }
  function createFriendly() {
    fRead(); const d = fDraft();
    if (!d.name.trim() || !d.date || d.players.length !== 4 || d.pairing == null) { toast("Заполни название, дату и 4 игроков"); return; }
    if (d.mode !== "sets" && !(+d.target > 0)) { toast("Укажи X"); return; }
    const o = fPairings(d.players)[d.pairing];
    const id = uid("t"), seq = Math.max(0, ...state.tournaments.map(t => t.seq || 0)) + 1, sets = d.mode === "sets";
    const fee = d.fee === "" ? null : Math.max(0, +d.fee);
    const t = { id, seq, name: d.name.trim(), date: d.date, status: "scheduled", format: "friendly", courts: 1, participantIds: d.players.slice(),
      teams: [{ id: "team0", players: o[0] }, { id: "team1", players: o[1] }],
      scoringType: sets ? "games" : "points", scoringMode: sets ? "tennis" : d.mode, scoringTarget: sets ? d.setGames : +d.target, scoringMinutes: null,
      settings: sets ? { kind: "friendly", sets: d.sets } : { kind: "friendly" },
      money: { court: d.court === "" ? null : Math.max(0, +d.court), prize: { enabled: !!d.prizeEnabled, fee, places: 1, amounts: [(fee || 0) * 4] } } };
    state.tournaments.push(t);
    state.games.push({ id: id + "-r1-c1", tournamentId: id, round: 1, court: 1, teamA: o[0].slice(), teamB: o[1].slice(), scoreA: null, scoreB: null, decided: false, label: sets ? "Сет 1" : "Матч" });
    addLog("Создал товарищеский матч «" + t.name + "» (" + scoringLabel(t) + ")");
    commit(1500); state._fDraft = null; state.view.create = false; state.view.tournament = id; toast("Матч создан"); render();
  }
  function viewFriendlyDetail(t) {
    const r = friendlyResult(t), tm = t.teams || [];
    const side = i => `<div class="fr-side ${r.winner === i ? "win" : ""}">${(tm[i] ? tm[i].players : []).map(p => `<div class="fr-pl">${avatarHtml(p, 34)}<span>${esc(playerName(p))}</span></div>`).join("")}</div>`;
    const status = r.done ? (r.winner == null ? "Ничья" : "Победа: " + tm[r.winner].players.map(p => esc(playerName(p))).join(" + ")) : r.games.some(g => g.scoreA != null) ? "Идёт игра" : "Ещё не начался";
    const setLine = r.sets ? r.games.filter(g => g.scoreA != null && g.scoreB != null).map(g => `${g.scoreA}:${g.scoreB}`).join(" · ") : "";
    const tid = t.id;
    return `
      <div class="section-head" style="margin-bottom:4px;"><button class="btn ghost sm" data-act="close-tournament" style="padding-left:0;">‹ Турниры</button></div>
      <h2 style="font-size:24px;line-height:1.15;margin:0 0 4px;">${esc(t.name)}</h2>
      <p class="tiny">${fmtDate(t.date)} · 🤝 товарищеский · ${scoringLabel(t)}</p>
      <div class="card fr-board">
        ${side(0)}
        <div class="fr-mid"><div class="fr-big">${r.a}<span>:</span>${r.b}</div><div class="tiny">${r.sets ? "по сетам" : "очки"}</div>${setLine ? `<div class="fr-sets">${setLine}</div>` : ""}</div>
        ${side(1)}
      </div>
      <p class="fr-status ${r.done ? "done" : ""}">${status}</p>
      <h3 style="margin:16px 0 8px;">${r.sets ? "Сеты" : "Счёт"}</h3>
      ${r.games.map(g => matchHtml(g, t)).join("")}
      ${r.sets && !r.done ? `<p class="tiny" style="margin:4px 2px 0;">Внеси счёт сета — следующий появится сам${r.n >= 3 ? `, пока одна из пар не выиграет ${r.need}` : ""}.</p>` : ""}
      ${financeCardHtml(t)}
      ${canWrite ? (state.view.confirmDelete === tid ? `
        <div class="card" style="border-color:var(--danger);margin-top:18px;">
          <h3 style="color:var(--danger);">Удалить «${esc(t.name)}»?</h3>
          <p class="tiny">Матч исчезнет из статистики и Эло. Отменить будет нельзя.</p>
          <div class="row" style="margin-top:10px;gap:8px;"><button class="btn block" data-act="delete-cancel">Отмена</button><button class="btn block danger" data-act="delete-confirm" data-id="${tid}" style="border-color:var(--danger);">Да, удалить</button></div>
        </div>` : `<div style="margin-top:18px;text-align:center;"><button class="btn ghost sm danger" data-act="delete-ask" data-id="${tid}">Удалить матч…</button></div>`) : ""}`;
  }

  function viewTournamentCreate() {
    const active = playersActive();
    const st = state._createDraft || (state._createDraft = {
      name: "Турнир " + (leagueTournaments().length+1),
      date: "", courts: 2,
      participants: [],
      format: null,
      teams: [],
      scoringType: null, scoringMode: null, scoringTarget: "", scoringMinutes: 20,
      court: "", prizeEnabled: false, fee: "", places: 3, split: PRESETS[3].slice(),
    });
    const chips = active.map(p => `<span class="chip ${st.participants.includes(p.id)?'active':''}" data-act="toggle-participant" data-id="${p.id}">${esc(p.name)}</span>`).join("");

    let teamsBlock = "";
    if (st.format === "roundrobin" || st.format === "playoff") {
      const unassigned = st.participants.filter(pid => !st.teams.some(t=>t.players.includes(pid)));
      teamsBlock = `
        <div class="card" style="background:var(--surface-2);">
          <div class="row"><h3>Пары (команды)</h3>${st.participants.length>=4 && st.participants.length%2===0 && unassigned.length>=2 ? `<button class="btn sm" data-act="balance-teams">⚖️ ${st.teams.length ? "Добрать по Эло" : "По Эло"}</button>` : ""}</div>
          <p class="tiny">Соберите пары вручную или нажмите «По Эло». Можно задать 1–2 пары руками и нажать «Добрать по Эло» — ваши пары останутся, остальные подберутся так, чтобы суммы Эло всех пар были максимально ровными.</p>
          ${(() => { const { ratings } = computeElo(); return st.teams.map((t,i)=>`<div class="row" style="padding:6px 0;"><span>${esc(playerName(t.players[0]))} + ${esc(playerName(t.players[1]))} <span class="tiny">Σ ${Math.round((ratings[t.players[0]]||1500)+(ratings[t.players[1]]||1500))}</span></span><button class="btn sm danger" data-act="remove-team" data-idx="${i}">✕</button></div>`).join(""); })()}
          ${unassigned.length>=2 ? `
            <div class="row" style="gap:8px;margin-top:8px;">
              <select id="teamP1">${unassigned.map(id=>`<option value="${id}">${esc(playerName(id))}</option>`).join("")}</select>
              <select id="teamP2">${unassigned.slice().reverse().map(id=>`<option value="${id}">${esc(playerName(id))}</option>`).join("")}</select>
              <button class="btn sm" data-act="add-team">+</button>
            </div>` : (unassigned.length===1? `<p class="tiny">Остался без пары: ${esc(playerName(unassigned[0]))}</p>` : "")}
        </div>`;
    }

    const scoringTypeSeg = ["points","games","time"].map(v => `<button type="button" data-act="set-scoring-type" data-val="${v}" class="${st.scoringType===v?'active':''}">${v==="points"?"Очки":v==="games"?"Геймы":"По времени"}</button>`).join("");

    let scoringDetail = "";
    if (st.scoringType==="points" || st.scoringType==="games") {
      const unit = st.scoringType==="points"?"очков":"геймов";
      scoringDetail = `
        <div class="seg" id="scoringMode" style="margin-top:10px;">
          <button type="button" data-val="race" class="${st.scoringMode==='race'?'active':''}">До X ${unit}</button>
          <button type="button" data-val="fixed" class="${st.scoringMode==='fixed'?'active':''}">Всего ${unit}</button>
          ${st.scoringType==="games" ? `<button type="button" data-val="tennis" class="${st.scoringMode==='tennis'?'active':''}">Теннисный сет</button>` : ""}
        </div>
        ${st.scoringMode==="tennis" ? `<p class="tiny" style="margin-top:8px;">Сет до 6 геймов; при 5:5 — до 7; при 6:6 — тай-брейк, итог 7:6.</p>`
          : st.scoringMode ? `<label class="field" style="margin-top:10px;"><span class="lbl">Значение X</span><input type="number" id="scoringTarget" min="1" max="99" value="${esc(st.scoringTarget)}"></label>` : ""}`;
    } else if (st.scoringType==="time") {
      scoringDetail = `<label class="field" style="margin-top:10px;"><span class="lbl">Минут на матч/раунд (5–60)</span><input type="number" id="scoringMinutes" min="5" max="60" value="${st.scoringMinutes}"></label>`;
    }

    const canGenerate = canGenerateDraft(st);

    return `
      <div class="section-head"><h2>Новый турнир</h2><button class="btn ghost" data-act="cancel-create">Отмена</button></div>
      <div class="card stack">
        <label class="field" style="margin-bottom:0;"><span class="lbl">Название</span><input type="text" id="tName" value="${esc(st.name)}"></label>
        <div class="row" style="gap:10px;">
          <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Дата</span><input type="date" id="tDate" value="${st.date}"></label>
          <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Кортов</span><input type="number" id="tCourts" min="1" max="4" value="${st.courts}"></label>
        </div>
      </div>

      <div class="card">
        <h3>Участники <span class="tiny">(${st.participants.length} выбрано)</span></h3>
        <div class="wrap-tags" style="margin-top:10px;">${chips}</div>
      </div>

      <div class="card">
        <h3>Формат</h3>
        <div class="wrap-tags" id="tFormat" style="margin-top:10px;">
          ${FORMATS.map(f => `<span class="chip ${st.format===f.key?'active':''}" data-val="${f.key}">${esc(f.label)}${f.desc ? ` <button type="button" class="fmt-info${state.view.formatInfo===f.key?' on':''}" data-act="format-info" data-val="${f.key}" title="что это за формат">i</button>` : ""}</span>`).join("")}
        </div>
        ${state.view.formatInfo ? formatInfoHtml(state.view.formatInfo) : ""}
        ${st.format==="americano" ? `
          <div class="row" style="gap:10px;margin-top:10px;align-items:flex-end;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Раундов</span><input type="number" id="tRounds" min="1" max="30" value="${st.rounds ?? defaultAmericanoRounds(st.participants.length, st.courts)}"></label>
            <p class="tiny" style="flex:2;margin:0 0 8px;">${st.participants.length>=4 ? `${Math.min(Math.floor(st.participants.length/4), st.courts)} ${st.participants.length>=8 && st.courts>=2 ? "матча" : "матч"} в раунде${st.participants.length % 4 ? ", " + (st.participants.length % 4) + " отдыхают" : ""}. Каждый играет с каждым в паре ≈ ${defaultAmericanoRounds(st.participants.length, st.courts)} раундов.` : "Нужно минимум 4 участника."}</p>
          </div>`:""}
        ${st.format==="roundrobin" ? `
          <div class="row" style="gap:10px;margin-top:10px;align-items:flex-end;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Раундов</span><input type="number" id="tRounds" min="1" max="40" value="${st.rounds ?? teamRoundsPlan(st.teams.length, st.courts)}"></label>
            <p class="tiny" style="flex:2;margin:0 0 8px;">${st.teams.length>=2 ? `Полный круг: ${plural(teamRoundsPlan(st.teams.length, st.courts), "раунд", "раунда", "раундов")} (${plural(st.teams.length, "команда", "команды", "команд")}, ${plural(Math.min(st.courts, Math.floor(st.teams.length/2)), "матч", "матча", "матчей")} в раунде). Меньше — укороченная версия, больше — второй и следующие круги. Раунды можно добавлять и потом.` : "Соберите минимум 2 пары ниже."}</p>
          </div>`:""}
        ${st.format==="two" ? `
          <div class="row" style="gap:10px;margin-top:10px;align-items:flex-end;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Раундов · этап 1</span><input type="number" id="tRounds1" min="1" max="30" value="${st.rounds1 ?? defaultAmericanoRounds(st.participants.length, Math.max(1, Math.floor(st.participants.length/4)))}"></label>
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Раундов · этап 2</span><input type="number" id="tRounds" min="1" max="20" value="${st.rounds ?? 5}"></label>
            <div style="flex:1.4;">
              <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">cap</span>
              <div class="seg" id="swissCap">${[1,2,3].map(k => `<button type="button" data-val="${k}" class="${(st.swissCap||2)===k?'active':''}">${k}</button>`).join("")}</div>
            </div>
          </div>
          <p class="tiny" style="margin:8px 0 0;">${st.participants.length>=4 && st.participants.length%4===0
            ? `${st.participants.length/4} ${st.participants.length/4===1?"корт":st.participants.length/4<5?"корта":"кортов"}. Этап 1 (Американо) создастся сразу по расписанию. Этап 2 (SwissCourt) — раунды собираются внутри турнира кнопкой, первый — по таблице этапа 1. Таблица, Эло, призовой и рекорды общие.`
            : `Нужно число участников, кратное 4 (сейчас ${st.participants.length}).`}</p>`:""}
        ${st.format==="swiss" ? `
          <div class="row" style="gap:10px;margin-top:10px;align-items:flex-end;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Раундов</span><input type="number" id="tRounds" min="1" max="20" value="${st.rounds ?? 5}"></label>
            <div style="flex:2;">
              <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Лимит повторов напарника (cap)</span>
              <div class="seg" id="swissCap">${[1,2,3].map(k => `<button type="button" data-val="${k}" class="${(st.swissCap||2)===k?'active':''}">${k}</button>`).join("")}</div>
            </div>
          </div>
          <p class="tiny" style="margin:8px 0 0;">${st.participants.length>=4 && st.participants.length%4===0
            ? `${st.participants.length/4} ${st.participants.length/4===1?"корт":st.participants.length/4<5?"корта":"кортов"}, по 4 игрока на корт. ${st.linkedTo ? "Раунды собираются внутри турнира кнопкой — 1-й по таблице этапа 1, следующие по общей таблице." : "Сейчас создастся только 1-й раунд — следующие собираются по таблице после ввода всех счётов."}`
            : `Нужно число участников, кратное 4 (сейчас ${st.participants.length}).`}</p>
          <label class="field" style="margin:10px 0 0;"><span class="lbl">Продолжение турнира (общая таблица и призовой)</span>
            <select id="tLinked"><option value="">— отдельный турнир —</option>${state.tournaments.slice().reverse().filter(x => !linkedChild(x) && !x.linkedTo).map(x => `<option value="${x.id}"${st.linkedTo===x.id?" selected":""}>${esc(x.name)} · ${fmtDate(x.date)}</option>`).join("")}</select>
          </label>
          ${st.linkedTo ? `<p class="tiny" style="margin:6px 0 0;">Стартовая таблица — по итогам «${esc((byId(state.tournaments, st.linkedTo)||{}).name||"")}». 1-й раунд сразу не собирается: внутри турнира будет кнопка «Сгенерировать пары на основе этапа 1» — нажмёте, когда внесёте счета этапа 1. Участники подставлены оттуда. Взнос вводите общий за оба этапа — фонд считается здесь.</p>` : ""}`:""}
      </div>

      ${teamsBlock}

      <div class="card">
        <h3>Система очков</h3>
        <div class="seg" style="margin-top:10px;">${scoringTypeSeg}</div>
        ${scoringDetail}
      </div>

      <div class="card">
        <h3>Финансы <span class="tiny">(можно заполнить позже)</span></h3>
        <div class="stack" style="margin-top:10px;">
          <label class="field" style="margin-bottom:0;"><span class="lbl">Корты — с человека, ${CUR}</span><input type="number" min="0" id="cCourt" value="${esc(st.court)}" placeholder="напр. 250"></label>
          <div class="seg" id="cPrize"><button type="button" data-val="0" class="${!st.prizeEnabled?'active':''}">Без фонда</button><button type="button" data-val="1" class="${st.prizeEnabled?'active':''}">С призовым фондом</button></div>
          ${st.prizeEnabled ? `
          <label class="field" style="margin-bottom:0;"><span class="lbl">Взнос с человека, ${CUR}</span><input type="number" min="0" id="cFee" value="${esc(st.fee)}" placeholder="напр. 100"></label>
          <div><span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Призовых мест</span>
            <div class="seg" id="cPlaces">${[1,2,3,4].map(k => `<button type="button" data-val="${k}" class="${st.places===k?'active':''}">${k}</button>`).join("")}</div></div>
          ${(() => {
            const pool = (+st.fee || 0) * st.participants.length;
            if (!st.amountsTouched || !Array.isArray(st.amounts) || st.amounts.length !== st.places) st.amounts = defaultAmounts(pool, st.places);
            const sum = st.amounts.reduce((a,b)=>a+(+b||0),0);
            return `
          <p class="tiny" style="margin:0;">Фонд: ${st.fee ? fmtMoney(+st.fee) + " × " + st.participants.length + " чел = " + fmtMoney(pool) : "введите взнос"}</p>
          <div class="row" style="gap:8px;align-items:flex-end;">${Array.from({length: st.places}, (_, i) => `<label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">${i+1} место, ${CUR}</span><input type="number" min="0" step="10" data-camt="${i}" value="${st.amounts[i] ?? ""}"></label>`).join("")}</div>
          <p class="tiny" style="${sum===pool?'':'color:var(--danger);'}">Распределено ${fmtMoney(sum)} из ${fmtMoney(pool)}${sum===pool ? "" : sum<pool ? " — осталось "+fmtMoney(pool-sum) : " — перебор "+fmtMoney(sum-pool)}</p>`; })()}` : ""}
        </div>
      </div>

      <button class="btn primary block" data-act="generate-tournament" ${canGenerate?"":"disabled"}>Сгенерировать расписание</button>
    `;
  }

  function canGenerateDraft(st) {
    return !!(st.name && st.date && st.participants.length>=4 && st.format &&
      (st.format==="americano" ? st.participants.length>=4 : (st.format==="swiss" || st.format==="two") ? st.participants.length%4===0 : st.teams.length*2===st.participants.length && st.teams.length>=2) &&
      st.scoringType && (st.scoringType==="time" || st.scoringMode==="tennis" || (st.scoringMode && st.scoringTarget)));
  }
  function refreshGenerateBtn() {
    const btn = document.querySelector('[data-act="generate-tournament"]');
    if (btn) btn.disabled = !canGenerateDraft(getDraft());
  }
  function tournamentEditHtml(t) {
    const e = state._editT && state._editT.id === t.id ? state._editT : (state._editT = {
      id: t.id, name: t.name, date: t.date || "",
      scoringType: t.scoringType || (t.scoringSystem === "points-race" ? "points" : "points"),
      scoringMode: t.scoringMode || (t.scoringSystem === "points-race" ? "race" : "race"),
      scoringTarget: t.scoringTarget || t.target || "",
      scoringMinutes: t.scoringMinutes || 20,
      rounds: t.rounds || "", swissCap: t.swissCap || 2,
    });
    const unit = e.scoringType==="points" ? "очков" : "геймов";
    return `
      <div class="card" style="border-color:var(--court);margin:6px 0 12px;">
        <div class="row"><h3>Редактирование турнира</h3><button class="edit-pen" data-act="edit-tournament" data-id="${t.id}" title="закрыть" style="font-size:16px;">✕</button></div>
        <div class="stack" style="margin-top:10px;">
          <div class="row" style="gap:10px;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Название</span><input type="text" id="etName" value="${esc(e.name)}"></label>
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Дата</span><input type="date" id="etDate" value="${esc(e.date)}"></label>
          </div>
          <div>
            <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Система очков</span>
            <div class="seg" id="etType">${["points","games","time"].map(v => `<button type="button" data-val="${v}" class="${e.scoringType===v?'active':''}">${v==="points"?"Очки":v==="games"?"Геймы":"По времени"}</button>`).join("")}</div>
          </div>
          ${e.scoringType==="time" ? `<label class="field" style="margin-bottom:0;"><span class="lbl">Минут на матч/раунд</span><input type="number" id="etMinutes" min="5" max="60" value="${e.scoringMinutes}"></label>` : `
          <div class="seg" id="etMode">
            <button type="button" data-val="race" class="${e.scoringMode==='race'?'active':''}">До X ${unit}</button>
            <button type="button" data-val="fixed" class="${e.scoringMode==='fixed'?'active':''}">Всего ${unit}</button>
            ${e.scoringType==="games" ? `<button type="button" data-val="tennis" class="${e.scoringMode==='tennis'?'active':''}">Теннисный сет</button>` : ""}
          </div>
          ${e.scoringMode==="tennis" ? `<p class="tiny" style="margin:0;">Сет до 6 геймов; при 5:5 — до 7; при 6:6 — тай-брейк.</p>` : `<label class="field" style="margin-bottom:0;"><span class="lbl">Значение X</span><input type="number" id="etTarget" min="1" max="99" value="${esc(e.scoringTarget)}"></label>`}`}
          ${t.format==="swiss" ? `
          <div class="row" style="gap:10px;align-items:flex-end;">
            <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">Раундов (план)</span><input type="number" id="etRounds" min="1" max="20" value="${esc(e.rounds)}"></label>
            <div style="flex:2;"><span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Лимит повторов напарника (cap)</span>
              <div class="seg" id="etCap">${[1,2,3].map(k => `<button type="button" data-val="${k}" class="${e.swissCap===k?'active':''}">${k}</button>`).join("")}</div></div>
          </div>` : t.format==="roundrobin" ? `<label class="field" style="margin-bottom:0;"><span class="lbl">Раундов (план)</span><input type="number" id="etRounds" min="1" max="40" value="${esc(e.rounds)}"></label>` : ""}
          <p class="tiny" style="margin:0;">Меняются только настройки${linkedParent(t) ? " (для обоих этапов)" : ""}. Уже внесённые счета, пары и раунды остаются как есть; «до X» влияет на подпись и на будущие раунды, а не пересчитывает сыгранное.</p>
          <div class="row" style="gap:8px;">
            <button class="btn block" data-act="edit-tournament" data-id="${t.id}">Отмена</button>
            <button class="btn block primary" data-act="edit-tournament-save" data-id="${t.id}">Сохранить</button>
          </div>
        </div>
      </div>`;
  }
  function saveTournamentEdit(tid) {
    const t = byId(state.tournaments, tid); const e = state._editT; if (!t || !e || e.id !== tid) return;
    const name = (document.getElementById("etName")||{}).value; const date = (document.getElementById("etDate")||{}).value;
    const tgt = document.getElementById("etTarget"); const mins = document.getElementById("etMinutes"); const rounds = document.getElementById("etRounds");
    if (name != null) e.name = name.trim(); if (date != null) e.date = date;
    if (tgt) e.scoringTarget = tgt.value; if (mins) e.scoringMinutes = +mins.value; if (rounds) e.rounds = rounds.value;
    if (!e.name) { toast("Название не может быть пустым"); return; }
    if (e.scoringType !== "time" && e.scoringMode !== "tennis" && !(+e.scoringTarget > 0)) { toast("Укажите значение X"); return; }
    const changes = [];
    const par = linkedParent(t);
    if (e.name !== t.name) { changes.push("название «" + t.name + "» → «" + e.name + "»"); t.name = e.name; if (par) par.name = e.name + " · этап 1"; }
    if (e.date && e.date !== t.date) { changes.push("дата " + t.date + " → " + e.date); t.date = e.date; if (par) par.date = e.date; }
    const before = scoringLabel(t);
    [t].concat(par ? [par] : []).forEach(x => {
      x.scoringType = e.scoringType; x.scoringMode = e.scoringType==="time" ? null : e.scoringMode;
      x.scoringTarget = e.scoringType==="time" ? null : (e.scoringMode==="tennis" ? 6 : +e.scoringTarget);
      x.scoringMinutes = e.scoringType==="time" ? (+e.scoringMinutes || 20) : null;
      delete x.scoringSystem; delete x.target; // старый формат хранения
    });
    const after = scoringLabel(t); if (before !== after) changes.push("система очков: " + before + " → " + after);
    if (t.format==="swiss" || t.format==="roundrobin") { const r = +e.rounds; if (r > 0 && r !== t.rounds) { changes.push("раундов " + (t.rounds||"—") + " → " + r); t.rounds = r; } }
    if (t.format==="swiss" && e.swissCap !== t.swissCap) { changes.push("cap " + (t.swissCap||2) + " → " + e.swissCap); t.swissCap = e.swissCap; }
    if (changes.length) { addLog("Турнир «" + t.name + "»: " + changes.join("; ")); commit(1500); toast("Сохранено"); } else toast("Без изменений");
    state.view.editT = null; state._editT = null; render();
  }
  function viewTournamentDetail(tid) {
    let t = byId(state.tournaments, tid);
    if (!t) { state.view.tournament=null; return viewTournaments(); }
    if (linkedChild(t)) { t = linkedChild(t); tid = t.id; state.view.tournament = tid; }
    if (isFriendly(t)) return viewFriendlyDetail(t);
    const games = state.games.filter(g=>g.tournamentId===tid).sort((a,b)=> a.round-b.round || a.court-b.court);
    const byRound = {};
    games.forEach(g => { (byRound[g.round] = byRound[g.round]||[]).push(g); });

    const isSwiss = t.format==="swiss";
    const isTeam = t.format==="roundrobin" && (t.teams||[]).length>=2;
    const parent = linkedParent(t), child = linkedChild(t);
    const sw = isSwiss ? swissStats(t, stageGames(t)) : null;
    const own = isSwiss && parent ? swissStats(t, games) : null; // очки только этого этапа (для расшифровки)
    const standings = isSwiss ? rankedForPrizes(t).map(r => ({ id: r.id, pf: sw.pts[r.id]||0 })) : computeStandings(games);
    const ed = eloDetail(tid, parent ? [parent.id] : []);
    const wlc = {}; // победы-ничьи-поражения; у этапа 2 — вместе с этапом 1
    (isSwiss ? stageGames(t) : games).forEach(g => { if (g.scoreA==null || g.scoreB==null) return;
      const rec = p => (wlc[p] = wlc[p]||{w:0,d:0,l:0});
      if (g.scoreA===g.scoreB) { g.teamA.concat(g.teamB).forEach(p => rec(p).d++); return; }
      const win = g.scoreA>g.scoreB ? g.teamA : g.teamB, lose = g.scoreA>g.scoreB ? g.teamB : g.teamA;
      win.forEach(p => rec(p).w++); lose.forEach(p => rec(p).l++); });
    const wl = id => { const r = wlc[id]||{w:0,d:0,l:0}; return `${r.w}-${r.d}-${r.l}`; };
    const dCell = id => (id in ed.delta) ? `<span style="color:${ed.delta[id]>=0?'var(--court)':'var(--danger)'};">${fmtDelta(ed.delta[id])}</span>` : "—";
    const hasElo = Object.keys(ed.perGame).length > 0;
    const standingsRows = isTeam ? `<table class="tbl">
      <tr><th></th><th>Пара</th><th title="победы-ничьи-поражения">W-D-L</th><th>Очки</th><th>+/−</th></tr>
      ${teamTable(t, games).map((r,i) => `<tr>
        <td><span class="pos-badge ${r.place===1?'gold':''}">${r.place}</span>${r.tb==="h2h" ? `<div class="tiny" title="место решила личная встреча" style="font-size:10px;white-space:nowrap;">⚔ л/в</div>` : ""}</td>
        <td style="white-space:normal;">${pl(r.players[0])}${hasElo ? ` <span class="tiny">${dCell(r.players[0])}</span>` : ""} + ${pl(r.players[1])}${hasElo ? ` <span class="tiny">${dCell(r.players[1])}</span>` : ""}</td>
        <td>${r.w}-${r.d}-${r.l}</td><td class="lb-elo">${r.pts}</td><td class="tiny">${(r.pts-r.pa)>=0?"+":""}${r.pts-r.pa}</td>
      </tr>`).join("")}
    </table><p class="tiny" style="margin:6px 0 0;">При равенстве очков: победы → личные встречи → разница.</p>` : `<table class="tbl">
      <tr><th></th><th>Игрок</th><th>Очки</th><th title="победы-ничьи-поражения">W-D-L</th>${hasElo ? `<th title="изменение Эло за турнир">Эло</th>` : ""}${isSwiss ? `<th title="Buchholz — сумма очков соперников">Bh</th>` : ""}</tr>
      ${standings.map((s,i) => `<tr>
        <td><span class="pos-badge ${i===0?'gold':''}">${i+1}</span></td>
        <td>${pl(s.id)}</td>
        <td><span class="lb-elo">${s.pf}</span>${own ? ` <span class="tiny">(${(sw.pts[s.id]||0)-(own.pts[s.id]||0)}+${own.pts[s.id]||0})</span>` : ""}</td>
        <td>${wl(s.id)}</td>
        ${hasElo ? `<td class="tiny" style="font-size:13px;">${dCell(s.id)}</td>` : ""}
        ${isSwiss ? `<td class="tiny" style="font-size:13px;">${sw.bh[s.id]||0}</td>` : ""}
      </tr>`).join("")}
    </table>`;
    const eloPanel = state.view.eloDetail === tid ? eloDetailHtml(t, isSwiss ? stageGames(t) : games, ed) : "";
    const allG = isSwiss ? stageGames(t) : games;
    const anyScored = allG.some(g => g.scoreA!=null && g.scoreB!=null);
    const finished = allG.length > 0 && allG.every(g => g.scoreA!=null && g.scoreB!=null); // все игры внесены — турнир прошёл
    const factsPanel = state.view.tFacts === tid && !finished ? tournamentFactsHtml(t, allG, ed) : "";
    const stageNote = "";
    const p1Games = parent ? state.games.filter(g=>g.tournamentId===parent.id).sort((a,b)=> a.round-b.round || a.court-b.court) : [];
    // турнир идёт: как в приложении сообщества — вкладки «Матчи | Таблица»
    const running = !finished && (allG.length > 0 || p1Games.length > 0), liveTab = state.view.liveTab === "t" ? "t" : "m";
    const p1ByRound = {}; p1Games.forEach(g => { (p1ByRound[g.round] = p1ByRound[g.round]||[]).push(g); });
    const p1Done = p1Games.length && p1Games.every(g => g.scoreA!=null && g.scoreB!=null);
    const stage1Html = parent ? `
      <div class="section-head" style="margin:18px 0 6px;"><h2 style="font-size:17px;">Этап 1 · Американо</h2><span class="tiny">${p1Games.filter(g=>g.scoreA!=null).length}/${p1Games.length} игр${p1Done ? " · сыгран" : ""}</span></div>
      ${Object.keys(p1ByRound).sort((a,b)=>a-b).map(r => `
      <h3 style="margin:12px 0 8px;">Раунд ${r}</h3>
      ${p1ByRound[r].map(g => matchHtml(g, parent)).join("")}`).join("")}
      <div class="section-head" style="margin:18px 0 6px;"><h2 style="font-size:17px;">Этап 2 · SwissCourt</h2><span class="tiny">${games.filter(g=>g.scoreA!=null).length}/${games.length} игр</span></div>` : "";
    const roundsHtml = stage1Html + Object.keys(byRound).sort((a,b)=>a-b).map(r => `
      <h3 style="margin:${parent ? "12px" : "16px"} 0 8px;">Раунд ${r}${t.format==="swiss" ? ` <span class="tiny" style="font-weight:400;">${+r===1 ? (parent ? "· пары по таблице этапа 1" : "· баланс по Эло") : "· пары собраны по " + (parent ? "общей " : "") + "таблице после раунда " + (r-1)}</span>` : ""}</h3>
      ${byRound[r].map(g => matchHtml(g, t)).join("")}
    `).join("");

    return `
      <div class="section-head" style="margin-bottom:4px;"><button class="btn ghost sm" data-act="close-tournament" style="padding-left:0;">‹ Турниры</button>${canWrite ? `<button class="btn sm${state.view.editT===tid?' primary':''}" data-act="edit-tournament" data-id="${tid}">Редактировать</button>` : ""}</div>
      <h2 style="font-size:24px;line-height:1.15;margin:0 0 4px;">${esc(t.name)}</h2>
      <p class="tiny">${fmtDate(t.date)} · ${tLabel(t)}${formatInfo(tFormatKey(t)) && formatInfo(tFormatKey(t)).desc ? ` <button type="button" class="fmt-info${state.view.formatInfo===tFormatKey(t)?' on':''}" data-act="format-info" data-val="${tFormatKey(t)}" title="что это за формат">i</button>` : ""} · ${scoringLabel(t)}</p>
      ${state.view.formatInfo === tFormatKey(t) ? formatInfoHtml(tFormatKey(t)) : ""}
      ${stageNote}
      ${canWrite && state.view.editT === tid ? tournamentEditHtml(t) : ""}

      ${running ? `<div class="seg live-tabs"><button class="${liveTab==="m"?"active":""}" data-act="live-tab" data-val="m">Матчи</button><button class="${liveTab==="t"?"active":""}" data-act="live-tab" data-val="t">Таблица</button></div>` : ""}
      ${running && liveTab === "m" ? "" : `<div class="card">
        <h3>Таблица</h3>
        <div class="toolbar">
          ${anyScored && !finished ? `<button class="btn sm${state.view.tFacts===tid?' primary':''}" data-act="t-facts" data-id="${tid}" title="интересное за турнир">Факты</button>` : ""}
          ${Object.keys(ed.perGame).length ? `<button class="btn sm${state.view.eloDetail===tid?' primary':''}" data-act="elo-detail" data-id="${tid}" title="сколько Эло дал каждый матч">Эло</button>` : ""}
          ${canWrite ? `<button class="btn sm" data-act="copy-summary" data-id="${tid}">Итоги в чат</button><button class="btn sm" data-act="table-png" data-id="${tid}">PNG</button>` : ""}
        </div>
        <div style="margin-top:6px;">${standingsRows}</div>
        ${Object.keys(ed.perGame).length ? `<p class="tiny" style="margin:6px 0 0;">Эло — изменение за этот турнир по сравнению с рейтингом до его начала${isSwiss ? "; Bh — Buchholz, сумма очков соперников" : ""}${own ? "; в скобках — очки этап 1 + этап 2" : ""}.</p>` : ""}
        ${eloPanel}
        ${factsPanel}
      </div>`}
      ${finished ? `<div class="card"><h3>Статистика турнира</h3>${linkedParent(t) ? `<p class="tiny" style="margin:4px 0 0;">По обоим этапам вместе.</p>` : ""}<div style="margin-top:8px;">${factsListHtml(gameFacts(allG, ed))}</div></div>` : ""}

      ${finished ? `<button class="rounds-toggle ${state.view.roundsOpen === tid ? "open" : ""}" data-act="toggle-rounds" data-id="${tid}">${state.view.roundsOpen === tid ? "Скрыть раунды" : `Посмотреть раунды · ${Object.keys(byRound).length + (parent ? Object.keys(p1ByRound).length : 0)}`}<span class="chev">›</span></button>` : ""}
      ${!finished ? (running && liveTab === "t" ? "" : roundStripHtml(t, games, parent, p1Games)) : state.view.roundsOpen === tid ? roundsHtml : ""}

      ${financeCardHtml(t)}

      ${canWrite && t.format==="roundrobin" && (t.teams||[]).length>=2 ? roundControlsHtml(t, games) : ""}
      ${canWrite && isSwiss ? swissControlsHtml(t, games) : ""}

      ${canWrite ? (state.view.confirmDelete === tid ? `
        <div class="card" style="border-color:var(--danger);margin-top:18px;">
          <h3 style="color:var(--danger);">Удалить «${esc(t.name)}»?</h3>
          <p class="tiny">Турнир и все его ${(parent ? stageGames(t) : games).length} игр${parent ? " (оба этапа)" : ""} исчезнут из статистики. Отменить будет нельзя.</p>
          <div class="row" style="margin-top:10px;gap:8px;">
            <button class="btn block" data-act="delete-cancel">Отмена</button>
            <button class="btn block danger" data-act="delete-confirm" data-id="${tid}" style="border-color:var(--danger);">Да, удалить</button>
          </div>
        </div>` : `
        <div style="margin-top:18px;text-align:center;">
          <button class="btn ghost sm danger" data-act="delete-ask" data-id="${tid}">Удалить турнир…</button>
        </div>`) : ""}
    `;
  }
  // ================= FINANCE =================
  const CUR = "грн";
  const PRESETS = { 1:[100], 2:[60,40], 3:[50,30,20], 4:[40,30,20,10], 5:[35,25,20,12,8] };
  function moneyOf(t) {
    if (!t.money) t.money = { court: null, prize: { enabled: false, fee: null, places: 3, split: PRESETS[3].slice() } };
    if (!t.money.prize) t.money.prize = { enabled: false, fee: null, places: 3, split: PRESETS[3].slice() };
    return t.money;
  }
  function tournamentParticipants(t) {
    const tb = tournamentTable(t.id);
    return tb.order.length ? tb.order : (t.participantIds || []);
  }
  function isPairFormat(t) { return (t.format==="roundrobin" || t.format==="playoff" || t.format==="friendly") && (t.teams||[]).length>=2; }
  function pairStandings(t) {
    // командные форматы: место у пары, оба партнёра делят его
    const games = state.games.filter(g => g.tournamentId===t.id);
    let rows = teamTable(t, games).filter(r => r.gp > 0);
    if (isFriendly(t)) {
      // товарищеский: сначала выигранные сеты/матчи, потом очки (геймы); ничья — одно место на двоих
      rows.sort((a,b) => (b.w-a.w) || (b.pts-a.pts));
      rows.forEach((r,i) => { r.place = i && rows[i-1].w===r.w && rows[i-1].pts===r.pts ? rows[i-1].place : i+1; });
      return rows;
    }
    if (t.format==="playoff") {
      const fin = games.find(g => g.round===2 && g.label==="Финал"), third = games.find(g => g.round===2 && g.label!=="Финал");
      const done = g => g && g.scoreA!=null && g.scoreB!=null && g.scoreA!==g.scoreB;
      if (done(fin)) {
        const k = p => p.slice().sort().join("|");
        const order = [fin.scoreA>fin.scoreB ? fin.teamA : fin.teamB, fin.scoreA>fin.scoreB ? fin.teamB : fin.teamA];
        if (done(third)) order.push(third.scoreA>third.scoreB ? third.teamA : third.teamB, third.scoreA>third.scoreB ? third.teamB : third.teamA);
        const ks = order.map(k);
        const top = ks.map(x => rows.find(r => r.k===x)).filter(Boolean);
        const rest = rows.filter(r => !ks.includes(r.k));
        top.forEach((r,i) => { r.place = i+1; }); rest.forEach(r => { r.place = top.length+1; });
        rows = top.concat(rest);
      }
    }
    return rows;
  }
  function champions(t) { return rankedForPrizes(t).filter(r => r.place===1).map(r => r.id); }
  function rankedForPrizes(t) {
    // каждый элемент: { id, key, place, n } — place общий у равных/у партнёров, n — сколько мест (игроков или пар)
    if (isPairFormat(t)) {
      const rows = pairStandings(t);
      if (rows.length) {
        const out = [];
        rows.forEach(r => r.players.forEach(id => out.push({ id, key: "pair" + r.place, place: r.place, n: rows.length })));
        return out;
      }
    }
    const withPlace = arr => arr.map((x,i) => Object.assign(x, { place: i+1, n: arr.length }));
    // by points, then wins, then point diff (as in the tournament table)
    const tb = tournamentTable(t.id);
    const diff = {};
    tb.games.forEach(g => { g.teamA.forEach(p => diff[p]=(diff[p]||0)+g.scoreA-g.scoreB); g.teamB.forEach(p => diff[p]=(diff[p]||0)+g.scoreB-g.scoreA); });
    if (t.format === "swiss") {
      // SwissCourt: очки → Buchholz → победы → разница; у продолжения — общая таблица с первым этапом
      const sw = swissStats(t, stageGames(t));
      const order = Object.keys(sw.gp).filter(id => sw.gp[id] > 0);
      return withPlace(order.sort((a,b) => (sw.pts[b]-sw.pts[a]) || ((sw.bh[b]||0)-(sw.bh[a]||0)) || ((sw.wins[b]||0)-(sw.wins[a]||0)) || ((sw.diff[b]||0)-(sw.diff[a]||0)))
        .map(id => ({ id, key: [sw.pts[id], sw.bh[id]||0, sw.wins[id]||0, sw.diff[id]||0].join("|") })));
    }
    return withPlace(tb.order.slice().sort((a,b) => (tb.pts[b]-tb.pts[a]) || ((tb.wins[b]||0)-(tb.wins[a]||0)) || ((diff[b]||0)-(diff[a]||0)))
      .map(id => ({ id, key: [tb.pts[id], tb.wins[id]||0, diff[id]||0].join("|") })));
  }
  function prizePool(t) { const pr = moneyOf(t).prize; return pr.enabled && pr.fee ? (+pr.fee) * tournamentParticipants(t).length : 0; }
  function defaultAmounts(pool, places) {
    // стартовое распределение в гривнах (по пресету %), округлено до 10, остаток — первому месту
    const pct = (PRESETS[places] || PRESETS[3]).slice(0, places);
    const a = pct.map(x => Math.round(pool * x / 100 / 10) * 10);
    a[0] += pool - a.reduce((x,y)=>x+y, 0);
    return a;
  }
  function prizeAmounts(t) {
    // суммы по местам в гривнах; старые турниры хранили проценты — переводим
    const pr = moneyOf(t).prize; const pool = prizePool(t); const places = pr.places || 1;
    if (Array.isArray(pr.amounts) && pr.amounts.length) return Array.from({ length: places }, (_, i) => Math.max(0, +pr.amounts[i] || 0));
    const split = (pr.split || PRESETS[places] || []).slice(0, places);
    return split.map(x => Math.round(pool * (+x || 0) / 100));
  }
  function prizePayouts(t) {
    // returns { pool, amounts, payouts: [{place, to, ids:[..], total, each}] }
    const pr = moneyOf(t).prize;
    if (!pr.enabled || !pr.fee) return { pool: 0, amounts: [], payouts: [] };
    const pool = prizePool(t);
    const amounts = prizeAmounts(t);
    const ranked = rankedForPrizes(t);
    const per = isPairFormat(t) && ranked.length && ranked[0].key.startsWith("pair") ? 2 : 1; // в парных форматах приз — на пару
    const payouts = [];
    let i = 0, u = 0; // i — индекс игрока, u — индекс призового места (игрок или пара)
    while (i < ranked.length && u < amounts.length) {
      let j = i; while (j+1 < ranked.length && ranked[j+1].key === ranked[i].key) j++;
      const ids = ranked.slice(i, j+1).map(r => r.id);
      const units = Math.max(1, Math.round(ids.length / per));
      const total = amounts.slice(u, u+units).reduce((a,b)=>a+b, 0);
      payouts.push({ place: u+1, to: u+units, ids, total, each: Math.round(total / ids.length) });
      i = j+1; u += units;
    }
    return { pool, amounts, payouts };
  }
  function playerFinance(pid) {
    let courts = 0, fees = 0, won = 0, tournaments = 0;
    state.tournaments.forEach(t => {
      const parts = tournamentParticipants(t);
      if (!parts.includes(pid)) return;
      tournaments++;
      const m = moneyOf(t);
      if (m.court) courts += +m.court;
      if (m.prize.enabled && m.prize.fee) fees += +m.prize.fee;
      prizePayouts(t).payouts.forEach(p => { if (p.ids.includes(pid)) won += p.each; });
    });
    return { courts, fees, won, net: won - fees, total: won - fees - courts, tournaments };
  }
  function fmtMoney(v) { return (v<0?"−":"") + Math.abs(Math.round(v)).toLocaleString("ru-RU") + " " + CUR; }
  function financeCardHtml(t) {
    const m = moneyOf(t); const pr = m.prize;
    const n = tournamentParticipants(t).length;
    const { pool, amounts, payouts } = prizePayouts(t);
    const sumAmt = amounts.reduce((a,b)=>a+b,0);
    const view = `
      <div class="stack" style="margin-top:8px;">
        <div class="row"><span class="muted">Корты</span><strong>${m.court ? fmtMoney(m.court)+" с человека · "+n+" чел = "+fmtMoney(m.court*n) : "—"}</strong></div>
        <div class="row"><span class="muted">Призовой фонд</span><strong>${pr.enabled && pr.fee ? fmtMoney(pr.fee)+" × "+n+" = "+fmtMoney(pool) : "без фонда"}</strong></div>
        ${payouts.map(p => `<div class="row"><span class="muted">${p.place===p.to ? p.place+" место" : p.place+"–"+p.to+" места"} · ${fmtMoney(p.total)}</span><strong>${p.ids.map(id => esc(playerName(id))).join(", ")} — ${fmtMoney(p.each)}${p.ids.length>1?" каждому":""}</strong></div>`).join("")}
      </div>`;
    if (!canWrite) return `<div class="card" style="margin-top:14px;"><h3>Финансы</h3>${view}</div>`;
    const placesSeg = [1,2,3,4].map(k => `<button type="button" data-val="${k}" class="${pr.places===k?'active':''}">${k}</button>`).join("");
    const splitInputs = pr.enabled ? Array.from({length: pr.places||1}, (_, i) => `
      <label class="field" style="flex:1;margin-bottom:0;"><span class="lbl">${i+1} место, ${CUR}</span><input type="number" min="0" step="10" data-fin="amt" data-idx="${i}" value="${amounts[i] ?? ""}"></label>`).join("") : "";
    return `
      <div class="card" style="margin-top:14px;">
        <h3>Финансы</h3>
        ${view}
        <div class="stack" style="margin-top:12px;border-top:1px dashed var(--line);padding-top:12px;">
          <label class="field" style="margin-bottom:0;"><span class="lbl">Корты — с человека, ${CUR}</span><input type="number" min="0" data-fin="court" value="${m.court ?? ""}" placeholder="напр. 250"></label>
          <div>
            <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Призовой фонд</span>
            <div class="seg" id="finPrize"><button type="button" data-val="0" class="${!pr.enabled?'active':''}">Без фонда</button><button type="button" data-val="1" class="${pr.enabled?'active':''}">С фондом</button></div>
          </div>
          ${pr.enabled ? `
          <label class="field" style="margin-bottom:0;"><span class="lbl">Взнос с человека, ${CUR}</span><input type="number" min="0" data-fin="fee" value="${pr.fee ?? ""}" placeholder="напр. 100"></label>
          <div>
            <span class="lbl" style="display:block;font-size:13px;font-weight:600;color:var(--ink-2);margin-bottom:6px;">Призовых мест</span>
            <div class="seg" id="finPlaces">${placesSeg}</div>
          </div>
          <div class="row" style="gap:8px;align-items:flex-end;">${splitInputs}</div>
          <p class="tiny" style="${sumAmt===pool?'':'color:var(--danger);'}">Распределено ${fmtMoney(sumAmt)} из ${fmtMoney(pool)}${sumAmt===pool ? "" : sumAmt<pool ? " — осталось "+fmtMoney(pool-sumAmt) : " — перебор "+fmtMoney(sumAmt-pool)}</p>` : ""}
        </div>
      </div>`;
  }
  function setFinance(t, patch) { Object.assign(moneyOf(t), patch); addLog("Финансы «" + t.name + "»: корты " + (patch.court==null?"—":patch.court)); commit(2000); render(); }
  // ---- раунды полосой, как в приложении сообщества: номера раундов сверху, на экране — один текущий раунд ----
  function roundStripHtml(t, games, parent, p1Games) {
    const ent = [];
    const grp = (gs, stage1, tt) => { const by = {}; gs.forEach(g => (by[g.round] = by[g.round] || []).push(g));
      Object.keys(by).sort((a,b)=>a-b).forEach(r => ent.push({ key: (stage1 ? "1·" : "") + r, r: +r, label: (stage1 ? "Э1·" : "") + r, games: by[r].slice().sort((a,b)=>a.court-b.court), t: tt, stage1 })); };
    if (parent) grp(p1Games, true, parent);
    grp(games, false, t);
    if (!ent.length) return "";
    const sc = g => g.scoreA!=null && g.scoreB!=null, done = e => e.games.every(sc);
    const lr = state.view.liveRound;
    let ci = lr && lr.tid === t.id && lr.n === ent.length ? ent.findIndex(e => e.key === lr.key) : -1;
    // только что внесли счёт — остаёмся на этом раунде (покажем кнопку «к следующему»), иначе — первый незаполненный
    if (ci < 0 && state.view.lastScoredGid) ci = ent.findIndex(e => e.games.some(g => g.id === state.view.lastScoredGid));
    if (ci < 0) { ci = ent.findIndex(e => !done(e)); if (ci < 0) ci = ent.length - 1; }
    const cur = ent[ci];
    const maxR = games.length ? Math.max(...games.map(g=>g.round)) : 0;
    const planned = t.format==="swiss" ? Math.max(t.rounds||0, maxR) : maxR;
    const chips = ent.map((e,i) => `<span class="chip sm rnd-chip ${i===ci?"active":""} ${done(e)?"done":""}" data-act="live-round" data-id="${t.id}" data-val="${e.key}" data-n="${ent.length}">${e.label}${done(e)?" ✓":""}</span>`).join("")
      + Array.from({ length: Math.max(0, planned - maxR) }, (_,i) => `<span class="chip sm rnd-chip future">${maxR+i+1}</span>`).join("");
    const inR = new Set(cur.games.flatMap(g => g.teamA.concat(g.teamB)));
    const tt = cur.t, team = (tt.format==="roundrobin" || tt.format==="playoff") && (tt.teams||[]).length>=2;
    const rest = team ? tt.teams.map(x=>x.players).filter(p => !inR.has(p[0])).map(p => esc(playerName(p[0]))+" + "+esc(playerName(p[1])))
      : (tt.participantIds||[]).filter(id => !inR.has(id)).map(id => esc(playerName(id)));
    const swissNote = !cur.stage1 && t.format==="swiss" ? ` <span class="tiny" style="font-weight:400;">${cur.r===1 ? (parent ? "· пары по таблице этапа 1" : "· баланс по Эло") : "· пары по " + (parent ? "общей " : "") + "таблице после раунда " + (cur.r-1)}</span>` : "";
    let ctl = "";
    if (canWrite) {
      if (done(cur) && ci < ent.length-1) ctl = `<button class="btn primary block" data-act="live-round" data-id="${t.id}" data-val="${ent[ci+1].key}" data-n="${ent.length}">${ent[ci+1].stage1 === cur.stage1 ? "Перейти к раунду " + ent[ci+1].r : "Перейти к этапу 2"} ▸</button>`;
      else if (!done(cur)) ctl = `<p class="tiny" style="text-align:center;margin:4px 0;">Внесите счёт всех матчей раунда ${cur.r}${ci === ent.length-1 && t.format==="swiss" && maxR < planned ? " — потом соберём раунд " + (maxR+1) : ""}</p>`;
      else if (t.format==="swiss" && maxR < planned) ctl = `<p class="tiny" style="text-align:center;margin:4px 0;">Раунд ${cur.r} заполнен — соберите следующий кнопкой «+ Раунд» ниже</p>`;
      else ctl = `<div class="all-done">🏁 Все раунды сыграны</div>`;
    }
    return `
      <div class="chips-scroll rnd-chips">${chips}</div>
      <h3 style="margin:6px 0 8px;">${cur.stage1 ? "Этап 1 · " : parent ? "Этап 2 · " : ""}Раунд ${cur.r}${planned > 1 && !cur.stage1 ? ` <span class="tiny" style="font-weight:400;">/ ${planned}</span>` : ""}${swissNote}</h3>
      ${cur.games.map(g => matchHtml(g, cur.t)).join("")}
      ${rest.length ? `<p class="tiny rest-line">💤 Отдыхают: ${rest.join(", ")}</p>` : ""}
      ${ctl ? `<div style="margin:12px 0;">${ctl}</div>` : ""}`;
  }
  function roundControlsHtml(t, games) {
    const teams = t.teams.map(x => x.players.slice().sort().join("|"));
    const counts = pairPlayCounts(t, games);
    const totalPairs = teams.length*(teams.length-1)/2;
    const unplayed = Object.values(counts).filter(c => c===0).length;
    const lastRound = games.length ? Math.max(...games.map(g=>g.round)) : 0;
    const lastEmpty = lastRound>0 && games.filter(g=>g.round===lastRound).every(g=>g.scoreA==null && g.scoreB==null);
    return `
      <div class="card" style="margin-top:14px;">
        <div class="row">
          <div>
            <h3>Раунды</h3>
            <p class="tiny">${unplayed>0 ? `Ещё не встречались: ${unplayed} из ${totalPairs} пар` : "Все пары уже встречались — следующие раунды пойдут по второму кругу"}</p>
          </div>
          <button class="btn primary sm" data-act="add-round" data-id="${t.id}" style="white-space:nowrap;">+ Раунд</button>
        </div>
        ${lastEmpty ? `<button class="btn ghost sm danger" data-act="remove-round" data-id="${t.id}" style="margin-top:6px;">Убрать раунд ${lastRound} (без счёта)</button>` : ""}
      </div>`;
  }
  function pairPlayCounts(t, games) {
    const key = (a,b) => [a,b].sort().join("~");
    const tk = t.teams.map(x => x.players.slice().sort().join("|"));
    const counts = {};
    for (let i=0;i<tk.length;i++) for (let j=i+1;j<tk.length;j++) counts[key(tk[i],tk[j])] = 0;
    games.forEach(g => {
      const ka = g.teamA.slice().sort().join("|"), kb = g.teamB.slice().sort().join("|");
      const k = key(ka,kb); if (k in counts) counts[k]++;
    });
    return counts;
  }
  function nextRoundPairings(t, games) {
    // greedy: pairs that met least often first; ties -> teams with fewer games; disjoint teams per round; up to `courts` matches
    const teams = t.teams.map(x => ({ key: x.players.slice().sort().join("|"), players: x.players }));
    const counts = pairPlayCounts(t, games);
    const played = {}; teams.forEach(tm => played[tm.key] = 0);
    games.forEach(g => { const ka=g.teamA.slice().sort().join("|"), kb=g.teamB.slice().sort().join("|"); if (ka in played) played[ka]++; if (kb in played) played[kb]++; });
    const cands = [];
    for (let i=0;i<teams.length;i++) for (let j=i+1;j<teams.length;j++) {
      const k = [teams[i].key, teams[j].key].sort().join("~");
      cands.push({ a: teams[i], b: teams[j], met: counts[k]||0, load: played[teams[i].key]+played[teams[j].key], r: Math.random() });
    }
    cands.sort((x,y) => x.met-y.met || x.load-y.load || x.r-y.r);
    const used = new Set(), picked = [];
    const maxMatches = Math.min(Math.floor(teams.length/2), t.courts||2);
    for (const c of cands) {
      if (picked.length>=maxMatches) break;
      if (used.has(c.a.key) || used.has(c.b.key)) continue;
      used.add(c.a.key); used.add(c.b.key); picked.push([c.a.players, c.b.players]);
    }
    return picked;
  }
  function addRound(tid) {
    const t = byId(state.tournaments, tid); if (!t || !(t.teams||[]).length) return;
    const games = state.games.filter(g=>g.tournamentId===tid);
    const round = (games.length ? Math.max(...games.map(g=>g.round)) : 0) + 1;
    const pairs = nextRoundPairings(t, games);
    if (!pairs.length) { toast("Не удалось составить раунд"); return; }
    pairs.forEach((p, i) => state.games.push({ id: tid+"-r"+round+"-c"+(i+1), tournamentId: tid, round, court: i+1, teamA: p[0], teamB: p[1], scoreA: null, scoreB: null, decided: false }));
    addLog("Добавил раунд " + round + " в «" + t.name + "»");
    toast("Раунд " + round + " добавлен");
    render(); commit(1500);
  }
  function removeLastRound(tid) {
    const games = state.games.filter(g=>g.tournamentId===tid);
    if (!games.length) return;
    const last = Math.max(...games.map(g=>g.round));
    if (!games.filter(g=>g.round===last).every(g=>g.scoreA==null && g.scoreB==null)) { toast("В раунде уже есть счёт"); return; }
    state.games = state.games.filter(g => !(g.tournamentId===tid && g.round===last));
    addLog("Убрал раунд " + last + " из «" + (byId(state.tournaments,tid)||{}).name + "»");
    toast("Раунд " + last + " убран");
    render(); commit(1500);
  }
  function tournamentSummaryText(t) {
    const tb = tournamentTable(t.id);
    const ranked = rankedForPrizes(t);
    const lines = [`🎾 ${t.name} — итоги`, fmtDate(t.date) + " · " + tLabel(t) + (scoringLabel(t) ? " · " + scoringLabel(t) : ""), ""];
    const medal = i => i===0 ? "🥇" : i===1 ? "🥈" : i===2 ? "🥉" : (i+1)+".";
    const ed = eloDetail(t.id, linkedParent(t) ? [linkedParent(t).id] : []); const dl = id => (id in ed.delta) ? ", Эло " + fmtDelta(ed.delta[id]) : "";
    if (isPairFormat(t) && pairStandings(t).length) pairStandings(t).forEach(r => lines.push(`${medal(r.place-1)} ${playerName(r.players[0])} + ${playerName(r.players[1])} — ${r.pts} очк., ${r.w}-${r.d}-${r.l}`));
    else if (t.format==="swiss") { const sw = swissStats(t, stageGames(t)); if (linkedParent(t)) lines.splice(1, 0, "Американо → SwissCourt · итог по двум этапам"); ranked.forEach((r, i) => lines.push(`${medal(i)} ${playerName(r.id)} — ${sw.pts[r.id]||0} очк., ${sw.wins[r.id]||0}-${sw.draws[r.id]||0}-${(sw.gp[r.id]||0)-(sw.wins[r.id]||0)-(sw.draws[r.id]||0)}${dl(r.id)}`)); }
    else ranked.forEach((r, i) => lines.push(`${medal(i)} ${playerName(r.id)} — ${tb.pts[r.id]} очк., ${tb.wdl(r.id)}${dl(r.id)}`));
    const pp = prizePayouts(t);
    if (pp.payouts.length) { lines.push("", `💰 Призовой фонд ${fmtMoney(pp.pool)}:`); pp.payouts.forEach(p => lines.push(`${p.place===p.to ? p.place : p.place+"–"+p.to} место: ${p.ids.map(playerName).join(", ")} — ${fmtMoney(p.each)}`)); }
    // у продолжения разгром/упорная — по обоим этапам вместе (как и таблица)
    const pool = linkedParent(t) ? stageGames(t).filter(g => g.scoreA!=null && g.scoreB!=null) : tb.games;
    const decided = pool.filter(g => g.decided!==false);
    if (decided.length) {
      const dom = q => Math.abs(q.scoreA-q.scoreB)/(q.scoreA+q.scoreB);
      const g = decided.slice().sort((x,y)=>dom(y)-dom(x))[0];
      const w = g.scoreA>g.scoreB?g.teamA:g.teamB, l = g.scoreA>g.scoreB?g.teamB:g.teamA;
      lines.push("", `🩸 Разгром дня: ${playerName(w[0])} + ${playerName(w[1])} ${Math.max(g.scoreA,g.scoreB)}:${Math.min(g.scoreA,g.scoreB)} ${playerName(l[0])} + ${playerName(l[1])}`);
      const tight = decided.slice().sort((x,y)=>Math.abs(x.scoreA-x.scoreB)-Math.abs(y.scoreA-y.scoreB))[0];
      if (tight && tight !== g) lines.push(`🫀 Самая упорная: ${playerName(tight.teamA[0])} + ${playerName(tight.teamA[1])} ${tight.scoreA}:${tight.scoreB} ${playerName(tight.teamB[0])} + ${playerName(tight.teamB[1])}`);
    }
    return lines.join("\n");
  }
  async function tablePng(t) {
    const tb = tournamentTable(t.id);
    const ranked = isPairFormat(t) && pairStandings(t).length
      ? pairStandings(t).map(r => ({ place: r.place, name: playerName(r.players[0]) + " + " + playerName(r.players[1]), pts: r.pts, wl: r.w + "-" + r.d + "-" + r.l }))
      : t.format==="swiss" ? (() => { const sw = swissStats(t, stageGames(t)); return rankedForPrizes(t).map(r => ({ name: playerName(r.id), pts: sw.pts[r.id]||0, wl: (sw.wins[r.id]||0) + "-" + (sw.draws[r.id]||0) + "-" + ((sw.gp[r.id]||0)-(sw.wins[r.id]||0)-(sw.draws[r.id]||0)) })); })()
      : rankedForPrizes(t).map(r => ({ name: playerName(r.id), pts: tb.pts[r.id], wl: tb.wdl(r.id) }));
    const W = 720, rowH = 46, top = 120, H = top + rowH*ranked.length + 40;
    const c = document.createElement("canvas"); c.width = W*2; c.height = H*2;
    const x = c.getContext("2d"); x.scale(2,2);
    x.fillStyle = "#0A0A0B"; x.fillRect(0,0,W,H);
    x.fillStyle = "#FF7A1A"; x.beginPath(); x.arc(34, 40, 9, 0, Math.PI*2); x.fill();
    x.fillStyle = "#F4F1EC"; x.font = "800 24px 'Unbounded', 'Manrope', sans-serif"; x.fillText(t.name, 54, 50);
    x.fillStyle = "#B5B0A8"; x.font = "500 15px Manrope, Arial, sans-serif"; x.fillText(fmtDate(t.date) + "  ·  " + tLabel(t) + (scoringLabel(t) ? "  ·  " + scoringLabel(t) : ""), 54, 74);
    x.fillStyle = "#78746E"; x.font = "600 12px Manrope, Arial, sans-serif";
    x.fillText("МЕСТО", 28, top-14); x.fillText("ИГРОК", 90, top-14); x.textAlign = "right"; x.fillText("ОЧКИ", W-140, top-14); x.fillText("W-D-L", W-40, top-14); x.textAlign = "left";
    ranked.forEach((r, i) => {
      const y = top + i*rowH;
      x.fillStyle = i%2 ? "#141417" : "#101013"; x.fillRect(16, y, W-32, rowH);
      const pl = r.place || i+1;
      x.fillStyle = pl===1 ? "#FF7A1A" : "#1C1C20"; x.beginPath(); x.arc(44, y+rowH/2, 14, 0, Math.PI*2); x.fill();
      x.fillStyle = pl===1 ? "#0A0A0B" : "#B5B0A8"; x.font = "700 14px Manrope, Arial, sans-serif"; x.textAlign = "center"; x.fillText(String(pl), 44, y+rowH/2+5); x.textAlign = "left";
      x.fillStyle = "#F4F1EC"; x.font = "600 15px 'Unbounded', 'Manrope', sans-serif"; x.fillText(r.name, 90, y+rowH/2+7);
      x.textAlign = "right"; x.font = "700 17px 'Unbounded', 'Manrope', sans-serif"; x.fillText(String(r.pts), W-140, y+rowH/2+7);
      x.fillStyle = "#B5B0A8"; x.font = "500 15px Manrope, Arial, sans-serif"; x.fillText(r.wl, W-40, y+rowH/2+6); x.textAlign = "left";
    });
    x.fillStyle = "#78746E"; x.font = "500 12px Manrope, Arial, sans-serif"; x.fillText("Padel Club", 28, H-14);
    const filename = (t.name || "tournament").replace(/[^\wа-яА-ЯёЁ\- ]+/g, "").trim().replace(/\s+/g, "_") + ".png";
    const blob = await new Promise(res => c.toBlob(res, "image/png"));
    try {
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000); toast("Картинка скачана");
    } catch(e) { toast("Не удалось сохранить картинку"); }
  }
  function ensurePlayoffProgress(tid) {
    const t = byId(state.tournaments, tid); if (!t || t.format!=="playoff") return false;
    const games = state.games.filter(g => g.tournamentId===tid);
    const semis = games.filter(g => g.round===1);
    if (semis.length !== 2 || !semis.every(g => g.decided)) return false;
    const w = g => g.scoreA>g.scoreB ? g.teamA : g.teamB, l = g => g.scoreA>g.scoreB ? g.teamB : g.teamA;
    const [s1, s2] = semis.slice().sort((a,b)=>a.court-b.court);
    const want = [
      { id: tid+"-r2-c1", round: 2, court: 1, teamA: w(s1), teamB: w(s2), label: "Финал" },
      { id: tid+"-r2-c2", round: 2, court: 2, teamA: l(s1), teamB: l(s2), label: "Матч за 3-е место" },
    ];
    let changed = false;
    want.forEach(wg => {
      const ex = games.find(g => g.id===wg.id);
      if (!ex) { state.games.push(Object.assign({ tournamentId: tid, scoreA: null, scoreB: null, decided: false }, wg)); changed = true; }
      else if (ex.scoreA==null && ex.scoreB==null && (ex.teamA.join()!==wg.teamA.join() || ex.teamB.join()!==wg.teamB.join())) { ex.teamA = wg.teamA; ex.teamB = wg.teamB; changed = true; }
    });
    if (changed) { addLog("Плей-офф «" + t.name + "»: сформированы финал и матч за 3-е место"); toast("Финал и матч за 3-е место готовы"); }
    return changed;
  }
  function scoringLabel(t) {
    if (!t.scoringType && t.scoringSystem === "points-race" && t.target) return "до " + t.target + " очков";
    if (!t.scoringType) return "";
    if (t.scoringType==="time") return "по времени · " + (t.scoringMinutes||"?") + " мин";
    if (isFriendly(t) && t.scoringMode==="tennis") { const n = (t.settings||{}).sets || 1; return (n >= 3 && n % 2 ? "до " + (Math.floor(n/2)+1) + " побед в сетах" : plural(n, "сет", "сета", "сетов")) + " · сет до " + (t.scoringTarget||6) + " геймов"; }
    if (t.scoringMode==="tennis") return "теннисный сет";
    const unit = t.scoringType==="points"?"очков":"геймов";
    return (t.scoringMode==="race"? "до ":"всего ") + (t.scoringTarget||"?") + " " + unit;
  }
  function matchHtml(g, t) {
    const a = g.scoreA, b = g.scoreB;
    const winA = a!=null && b!=null && a>b, winB = a!=null && b!=null && b>a;
    if (canWrite && state.view.editGame === g.id) {
      const pool = Array.from(new Set((t.participantIds||[]).concat(g.teamA, g.teamB)));
      const sel = (side, idx) => `<select data-edit-side="${side}" data-edit-idx="${idx}">${pool.map(id => `<option value="${id}"${(side==="A"?g.teamA:g.teamB)[idx]===id?" selected":""}>${esc(playerName(id))}</option>`).join("")}</select>`;
      return `
      <div class="match" style="border:1.5px solid var(--court);">
        <div class="court-lbl">Корт ${g.court}${g.label ? " · "+esc(g.label) : ""} · правка пар</div>
        <div class="row" style="gap:8px;align-items:stretch;">
          <div class="stack" style="flex:1;gap:6px;">${sel("A",0)}${sel("A",1)}</div>
          <span class="muted" style="align-self:center;">vs</span>
          <div class="stack" style="flex:1;gap:6px;">${sel("B",0)}${sel("B",1)}</div>
        </div>
        <div class="row" style="margin-top:8px;gap:8px;">
          <button class="btn sm block" data-act="edit-game-cancel">Отмена</button>
          <button class="btn sm block primary" data-act="edit-game-save" data-gid="${g.id}">Сохранить</button>
        </div>
      </div>`;
    }
    return `
      <div class="match">
        <div class="court-lbl">Корт ${g.court}${g.label ? " · "+esc(g.label) : ""}${canWrite ? ` <button class="edit-pen" data-act="edit-game" data-gid="${g.id}" title="поменять состав">✎</button>` : ""}${canWrite ? `<button type="button" class="sc-ok ${a!=null&&b!=null?"saved":""}" data-act="score-ok" data-gid="${g.id}" aria-label="сохранить счёт">✓</button>` : ""}</div>
        <div class="mrow">
          <div class="pair ${winA?'winner':''}">${pl(g.teamA[0])}<small>${pl(g.teamA[1])}</small></div>
          <div class="score">
            <input type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" min="0" max="99" data-act="score" data-gid="${g.id}" data-side="A" value="${a==null?"":a}"${canWrite?"":" disabled"}>
            <span class="colon">:</span>
            <input type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" min="0" max="99" data-act="score" data-gid="${g.id}" data-side="B" value="${b==null?"":b}"${canWrite?"":" disabled"}>
          </div>
          <div class="pair right ${winB?'winner':''}">${pl(g.teamB[0])}<small>${pl(g.teamB[1])}</small></div>
        </div>
      </div>`;
  }
  function computeStandings(games) {
    const totals = {};
    games.forEach(g => {
      if (g.scoreA==null||g.scoreB==null) return;
      g.teamA.forEach(pid => totals[pid]=(totals[pid]||0)+g.scoreA);
      g.teamB.forEach(pid => totals[pid]=(totals[pid]||0)+g.scoreB);
    });
    return Object.entries(totals).map(([id,pf])=>({id,pf})).sort((a,b)=>b.pf-a.pf);
  }

  // ================= STATS =================
  function viewStats() {
    // «Журнал» — только владельцу (редактору): там имена профилей Claude тех, кто вносил правки
    if (state.view.stat === "log" && !canWrite) state.view.stat = "leaderboard";
    const sub = state.view.stat;
    if (sub === "badges" || sub === "profile" || sub === "heatmap") state.view.stat = "leaderboard";
    // В лиге друзей финансы видят все (в коммьюнити — только админы, там свой интерфейс); журнал — только редакторам
    const tabs = [["leaderboard","Рейтинг"],["hall","Зал славы"],["h2h","Встречи"],["pairs","Пары"],["dyn","По турнирам"],["money","Финансы"]].concat(canWrite ? [["log","Журнал"]] : []);
    const cur = state.view.stat;
    const segHtml = `<div class="chips-scroll stat-tabs">${tabs.map(([k,l])=>`<span class="chip sm ${cur===k?'active':''}" data-act="stat-tab" data-val="${k}">${l}</span>`).join("")}</div>`;
    let body = "";
    if (sub==="leaderboard") body = statLeaderboard();
    else if (sub==="h2h") body = statH2H();
    else if (sub==="pairs") body = statPairs();
    else if (sub==="form") body = statForm();
    else if (sub==="hall") body = statHall();
    else if (sub==="money") body = statMoney();
    else if (sub==="dyn") body = statDynamics();
    else if (sub==="log" && canWrite) body = statLog();
    return `<div class="section-head"><h2>Статистика</h2></div>${segHtml}${body}`;
  }

  function statLeaderboard() {
    if (!state.games.length) return `<div class="empty"><div class="ic">&#128202;</div>нет сыгранных игр</div>`;
    const { ratings } = computeElo();
    const sort = state.view.lbSort || (state.view.lbSort = { key: "elo", dir: -1 });
    const val = (r, key) => key==="elo" ? Math.round(r.elo) : key==="wdl" ? (r.prof.w - r.prof.l) * 1000 + r.prof.w : key==="w" ? r.prof.w
      : key==="pf" ? r.prof.pf : key==="pa" ? r.prof.pa : key==="diff" ? r.prof.diff : key==="gp" ? r.prof.gp : key==="pct" ? r.prof.winPct : r.p.name;
    const base = (a,b) => // базовый порядок (как в рейтинге по умолчанию): Эло → разница → баланс побед → очки
        (Math.round(b.elo) - Math.round(a.elo)) || (b.prof.diff - a.prof.diff) || ((b.prof.w - b.prof.l) - (a.prof.w - a.prof.l)) || (b.prof.pf - a.prof.pf);
    const all = state.players.map(p => ({ p, elo: ratings[p.id]||1500, prof: computeProfile(p.id) }))
      .filter(r => r.prof.gp>0).sort((a,b) => {
        const va = val(a, sort.key), vb = val(b, sort.key);
        if (typeof va === "string") return va.localeCompare(vb, "ru") * sort.dir || base(a,b);
        return (va !== vb) ? (va - vb) * sort.dir : base(a,b);
      });
    const active = all.filter(r => r.p.active), inactive = all.filter(r => !r.p.active);
    // оранжевым подсвечивается столбец, по которому сейчас отсортировано
    const hl = key => sort.key === key ? ' class="lb-hl"' : "";
    const row = (r, i) => `<tr>
          <td>${i==null? "" : `<span class="pos-badge ${i===0?'gold':''}">${i+1}</span>`}</td>
          <td class="lb-name${sort.key==="name"?" lb-hl":""}"><span class="lb-p" data-act="open-profile" data-id="${r.p.id}">${avatarHtml(r.p.id, 30)}<span class="plink">${esc(r.p.name)}</span></span>${streakTag(r.p.id)}</td>
          <td${hl("elo")}>${Math.round(r.elo)}</td>
          <td${hl("wdl")}>${r.prof.w}-${r.prof.d}-${r.prof.l}</td>
          <td${hl("gp")}>${r.prof.gp}</td>
          <td${hl("pct")}>${r.prof.winPct}%</td>
          <td class="pts${sort.key==="pf"?" lb-hl":""}"><span>${r.prof.pf}</span> : <span>${r.prof.pa}</span></td>
          <td${hl("diff")}><strong>${r.prof.diff>=0?"+":""}${r.prof.diff}</strong></td>
        </tr>`;
    const th = (key, label, title) => `<th class="sortable ${sort.key===key?'on':''}" data-act="lb-sort" data-key="${key}"${title ? ` title="${title}"` : ""}>${label}<span class="arr">${sort.key===key ? (sort.dir<0?"▼":"▲") : "⇅"}</span></th>`;
    return `<div class="card">
      <p class="tiny" style="margin:0 0 8px;">Нажмите на заголовок, чтобы отсортировать; ещё раз — в обратном порядке. По умолчанию — по Эло.</p>
      <table class="tbl">
        <tr><th></th>${th("name","Игрок")}${th("elo","Эло")}${th("wdl","W-D-L","победы-ничьи-поражения · сортировка по балансу побед")}${th("gp","Игр")}${th("pct","Win%","процент побед")}${th("pf","Очки за : против","сортировка по набранным очкам")}${th("diff","+/−")}</tr>
        ${active.map(row).join("")}
      </table>
    </div>
    ${inactive.length? `<div class="card" style="opacity:.75;">
      <h3>Не играют</h3>
      <p class="tiny">Результаты сохранены, в новых турнирах не участвуют</p>
      <table class="tbl" style="margin-top:6px;">
        ${inactive.map(r => row(r, null)).join("")}
      </table>
    </div>` : ""}`;
  }

  // Кнопка «Профиль» внизу: вместо иконки — фото игрока (или силуэт), пока он привязан к аккаунту
  function updateNavAvatar() {
    const ic = document.querySelector('nav.tabs button[data-tab="profile"] .ic'); if (!ic) return;
    const pid = myPlayerId(); const p = pid && byId(state.players, pid);
    const key = p && p.avatar ? "img:" + p.avatar.length + ":" + p.avatar.slice(-24) : "ph";
    if (ic.dataset.key === key) return;
    ic.dataset.key = key;
    ic.innerHTML = p && p.avatar ? `<span class="nav-avatar"><img src="${p.avatar}" alt=""></span>` : `<span class="nav-avatar ph">${SILHOUETTE}</span>`;
  }
  // ================= ПРОФИЛЬ =================
  function myPlayerId() { return BOOT.user && BOOT.user.playerId; }
  const SILHOUETTE = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="12"/><path d="M8 60c2-14 12-22 24-22s22 8 24 22z"/></svg>`;
  function initials(name) { return (name||"?").trim().split(/\s+/).slice(0,2).map(w => w[0]).join("").toUpperCase(); }
  function avatarHtml(pid, size) {
    const p = byId(state.players, pid); const sz = size || 44;
    if (p && p.avatar) return `<span class="avatar" style="width:${sz}px;height:${sz}px;"><img src="${p.avatar}" alt=""></span>`;
    return `<span class="avatar ph" style="width:${sz}px;height:${sz}px;">${SILHOUETTE}</span>`;
  }
  function leagueBoard() {
    const { ratings } = computeElo();
    return { ratings, board: state.players.filter(p => computeProfile(p.id).gp > 0 && p.active).sort((a,b) => (ratings[b.id]||1500)-(ratings[a.id]||1500)) };
  }
  function playerRankLine(pid) {
    const { ratings, board } = leagueBoard(); const i = board.findIndex(p => p.id === pid);
    return i >= 0 ? `#${i+1} · Эло ${Math.round(ratings[pid]||1500)}` : "ещё не играл";
  }
  function canEditProfile(pid) { return canWrite || (pid && pid === myPlayerId()); }
  function openProfile(pid) {
    state.view.profileBack = state.tab === "profile" ? state.view.profileBack : state.tab;
    state.view.profilePid = pid; state.view.profileEdit = false; state._pf = null;
    state.tab = "profile"; window.scrollTo(0, 0); render();
  }
  function viewProfileTab() {
    const my = myPlayerId();
    const pid = state.view.profilePid || my;
    const u = BOOT.user || {};
    const viewingOther = !!state.view.profilePid; // открыли из рейтинга/турнира/списка — показываем «Назад», даже если это свой профиль
    if (!pid || !byId(state.players, pid)) {
      state.view.profilePid = null;
      const free = state.players.filter(p => !p.userId || p.userId === u.id);
      return `
        <div class="section-head"><h2>Профиль</h2></div>
        <div class="card">
          <h3>Кто ты в этой лиге?</h3>
          <p class="tiny" style="margin:6px 0 12px;">Выбери себя из списка игроков — профиль привяжется к твоему аккаунту. Поменять потом можно.</p>
          <div class="wrap-tags">${free.map(p => `<span class="chip" data-act="claim-player" data-id="${p.id}">${esc(p.name)}</span>`).join("") || `<span class="tiny">все игроки уже заняты — попроси организатора</span>`}</div>
          ${state.players.some(p => p.userId && p.userId !== u.id) ? `<p class="tiny" style="margin:10px 0 0;">Не в списке: ${state.players.filter(p => p.userId && p.userId !== u.id).map(p => esc(p.name)).join(", ")} — уже привязаны к другим аккаунтам.</p>` : ""}
        </div>
        ${accountCardHtml()}`;
    }
    const head = viewingOther
      ? `<div class="section-head"><button class="btn ghost sm back" data-act="profile-back">‹ Назад</button><h2 style="flex:1;text-align:right;">Профиль</h2></div>`
      : `<div class="section-head"><h2>Профиль</h2>${my ? `<button class="btn ghost sm" data-act="claim-player" data-id="">Это не я</button>` : ""}</div>`;
    const isMine = pid === my;
    return `
      ${head}
      ${state.view.profileEdit && canEditProfile(pid) ? profileEditHtml(pid) : profileHeroHtml(pid)}
      ${profileBadgesHtml(pid)}
      ${profileTournamentsHtml(pid)}
      ${profileMatchesHtml(pid)}
      ${profileBodyHtml(pid)}
      ${isMine ? accountCardHtml() : ""}`;
  }
  // изменение Эло каждого матча (тот же расчёт, что в computeElo)
  function gameEloDeltas() {
    const ratings = {}; state.players.forEach(p => ratings[p.id] = ELO_START); const out = {};
    orderedGames().forEach(g => {
      if (g.scoreA == null || g.scoreB == null) return;
      const total = g.scoreA + g.scoreB; if (total <= 0) return;
      const eA = 1/(1+Math.pow(10, (avgRating(g.teamB, ratings)-avgRating(g.teamA, ratings))/400));
      const dA = K*(g.scoreA/total - eA), dB = K*(g.scoreB/total - (1-eA));
      g.teamA.forEach(p => { if (ratings[p] != null) ratings[p] += dA; });
      g.teamB.forEach(p => { if (ratings[p] != null) ratings[p] += dB; });
      out[g.id] = { dA, dB, after: Object.fromEntries(g.teamA.concat(g.teamB).map(p => [p, ratings[p]])) };
    });
    return out;
  }
  function profileMatchesHtml(pid) {
    const games = orderedGames().filter(g => g.scoreA != null && g.scoreB != null && (g.teamA.includes(pid) || g.teamB.includes(pid))).reverse();
    if (!games.length) return "";
    const open = state.view.histOpen === pid, n = state.view.histN || 10;
    const head = `<button class="card hist-toggle ${open ? "open" : ""}" data-act="hist-toggle" data-id="${pid}"><span><b>История матчей</b><span class="tiny">${plural(games.length, "матч", "матча", "матчей")}</span></span><span class="hist-chev">›</span></button>`;
    if (!open) return head;
    const el = gameEloDeltas(), T = id => byId(state.tournaments, id);
    const rows = games.slice(0, n).map(g => {
      const mineA = g.teamA.includes(pid), my = mineA ? g.teamA : g.teamB, op = mineA ? g.teamB : g.teamA;
      const ms = mineA ? g.scoreA : g.scoreB, os = mineA ? g.scoreB : g.scoreA, res = ms > os ? "w" : ms < os ? "l" : "d";
      const partner = my.filter(x => x !== pid), e = el[g.id], d = e ? (mineA ? e.dA : e.dB) : 0, after = e && e.after[pid];
      const t = T(g.tournamentId);
      return `<div class="hist-row ${res}">
        <div class="hist-score" title="${res === "w" ? "победа" : res === "l" ? "поражение" : "ничья"}"><b>${ms}:${os}</b><small>${res === "w" ? "W" : res === "l" ? "L" : "D"}</small></div>
        <div class="hist-main">
          <div class="hist-teams"><span>${partner.length ? "с <b>" + partner.map(x => esc(playerName(x))).join(" + ") + "</b>" : "<b>один</b>"}</span><span class="tiny">против ${op.map(x => esc(playerName(x))).join(" + ")}</span></div>
          <div class="tiny">${t ? esc(t.name.replace(/ · этап 1$/, "")) + " · " + fmtDate(t.date) : ""}${g.label ? " · " + esc(g.label) : g.round ? " · раунд " + g.round : ""}</div>
        </div>
        <div class="hist-elo"><b class="${d >= 0 ? "up" : "down"}">${fmtDelta(d)}</b>${after != null ? `<small>${Math.round(after)}</small>` : ""}</div>
      </div>`;
    }).join("");
    return head.replace("</button>", "</button>") + `<div class="card hist-list">${rows}
      ${games.length > n ? `<button class="btn block" data-act="hist-more" style="margin-top:10px;">Показать ещё ${Math.min(10, games.length - n)}</button>` : ""}</div>`;
  }
  function accountCardHtml() {
    const u = BOOT.user || {};
    return `<div class="card">
      <h3>Аккаунт</h3>
      <div class="stack" style="margin-top:8px;">
        <div class="row"><span class="muted">Имя в журнале</span><span style="display:flex;gap:6px;align-items:center;"><input type="text" id="dispName" value="${esc(u.name||"")}" style="width:150px;padding:7px 10px;font-size:14px;"><button class="btn sm" data-act="save-name">Сохранить</button></span></div>
        <div class="row"><span class="muted">Роль в лиге</span><strong>${({owner:"владелец",admin:"админ",editor:"редактор",player:"игрок",viewer:"зритель"})[u.role] || u.role || "—"}</strong></div>
        <p class="tiny" style="margin:0;">Один аккаунт работает во всех лигах, где ты есть; рейтинг и статистика у каждой лиги свои.</p>
      </div>
    </div>`;
  }
  function profileHeroHtml(pid) {
    const { ratings, board } = leagueBoard();
    const prof = computeProfile(pid);
    const rank = board.findIndex(p => p.id === pid);
    const ts = leagueTournaments().filter(t => tournamentTable(t.id).order.includes(pid));
    const places = ts.map(t => { const x = rankedForPrizes(t).find(x => x.id === pid); return { t, place: x ? x.place : 0, n: x ? x.n : 0 }; });
    const podium = places.filter(p => p.place >= 1 && p.place <= 3).length, wins = places.filter(p => p.place === 1).length;
    const s = streakInfo(playerSeqs()[pid]||[]);
    const p = byId(state.players, pid);
    return `
      <div class="card hero">
        <div class="hero-top">
          <div class="hero-id">${avatarHtml(pid, 64)}<div><div class="hero-name">${esc(playerName(pid))}${publicName(pid) ? ` <span class="pub-name">(${esc(publicName(pid))})</span>` : ""}</div><div class="tiny">${rank >= 0 ? `#${rank+1} в лиге из ${board.length}` : "ещё не играл"}${p && !p.active ? " · не играет" : ""}</div>${canEditProfile(pid) ? `<button class="btn ghost sm" style="margin-top:6px;" data-act="profile-edit" data-id="${pid}">✎ Редактировать</button>` : ""}</div></div>
          <div class="hero-elo"><span>${Math.round(ratings[pid]||1500)}</span><small>Эло</small></div>
        </div>
        <div class="hero-grid">
          <div><strong>${prof.gp}</strong><span>игр</span></div>
          <div><strong>${prof.w}-${prof.d}-${prof.l}</strong><span>W-D-L</span></div>
          <div><strong>${prof.winPct}%</strong><span>побед</span></div>
          <div><strong>${wins}</strong><span>титулов</span></div>
          <div><strong>${podium}</strong><span>подиумов</span></div>
          <div><strong>${s.curW>=2 ? "🔥 "+s.curW : s.curL>=2 ? "🥶 "+s.curL : "—"}</strong><span>серия</span></div>
        </div>
      </div>`;
  }
  function profileTournamentsHtml(pid) {
    const ts = leagueTournaments().filter(t => tournamentTable(t.id).order.includes(pid));
    const places = ts.map(t => { const x = rankedForPrizes(t).find(x => x.id === pid); return { t, place: x ? x.place : 0, n: x ? x.n : 0 }; });
    if (!places.length) return "";
    const open = state.view.ptOpen === pid;
    const head = `<button class="card hist-toggle ${open ? "open" : ""}" data-act="pt-toggle" data-id="${pid}"><span><b>Турниры</b><span class="tiny">${plural(places.length, "турнир", "турнира", "турниров")}</span></span><span class="hist-chev">›</span></button>`;
    if (!open) return head;
    return head + `<div class="card"><div class="stack">${places.slice().reverse().map(p => `<div class="row" style="cursor:pointer;" data-act="open-tournament-tab" data-id="${p.t.id}"><div><div>${esc(p.t.name)}</div><div class="tiny">${fmtDate(p.t.date)} · ${tLabel(p.t)}</div></div><div style="white-space:nowrap;">${p.place===1?"🥇 ":p.place===2?"🥈 ":p.place===3?"🥉 ":""}<strong>${p.place}</strong><span class="tiny">/${p.n}</span></div></div>`).join("")}</div></div>`;
  }

  function profileEditHtml(pid) {
    const p = byId(state.players, pid);
    const pf = state._pf || (state._pf = { name: p.name, avatar: undefined });
    const av = pf.avatar === undefined ? p.avatar : pf.avatar;
    const preview = av ? `<span class="avatar" style="width:88px;height:88px;"><img src="${av}" alt=""></span>` : `<span class="avatar ph" style="width:88px;height:88px;">${SILHOUETTE}</span>`;
    return `
      <div class="card hero">
        <div class="pf-edit">
          <label class="pf-avatar-pick" title="выбрать фото">${preview}<input type="file" id="pfPhoto" accept="image/*" hidden><span class="pf-cam">📷</span></label>
          <div class="pf-fields">
            <label class="field"><span class="lbl">Имя</span><input type="text" id="pfName" value="${esc(pf.name)}" maxlength="40"></label>
            <div class="pf-actions">
              <button class="btn sm" data-act="pf-photo">${av ? "Сменить фото" : "Добавить фото"}</button>
              ${av ? `<button class="btn sm ghost" data-act="pf-photo-clear">Убрать фото</button>` : ""}
            </div>
          </div>
        </div>
        <p class="tiny" style="margin:10px 0 0;">Фото обрежется в квадрат и ужмётся — хранится только маленькая картинка.</p>
        <div class="pf-actions" style="margin-top:12px;justify-content:flex-end;">
          <button class="btn sm" data-act="pf-cancel">Отмена</button>
          <button class="btn sm primary" data-act="pf-save" data-id="${pid}">Сохранить</button>
        </div>
      </div>`;
  }
  function readAvatarFile(file) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const S = 256, c = document.createElement("canvas"); c.width = S; c.height = S;
        const x = c.getContext("2d"); const m = Math.min(img.naturalWidth, img.naturalHeight);
        x.drawImage(img, (img.naturalWidth-m)/2, (img.naturalHeight-m)/2, m, m, 0, 0, S, S);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", .82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
      img.src = url;
    });
  }
  async function saveProfileEdit(pid) {
    const p = byId(state.players, pid); const inp = document.getElementById("pfName"); if (!p || !inp) return;
    const name = inp.value.trim();
    if (!name) { toast("Имя не может быть пустым"); return; }
    if (state.players.some(x => x.id !== pid && x.name.toLowerCase() === name.toLowerCase())) { toast("Такое имя уже есть"); return; }
    const pf = state._pf || {}; const avatar = pf.avatar === undefined ? (p.avatar || null) : pf.avatar;
    if (canWrite) {
      if (name !== p.name) addLog("Переименовал игрока: " + p.name + " → " + name);
      if ((avatar||null) !== (p.avatar||null)) addLog((avatar ? "Обновил фото: " : "Убрал фото: ") + name);
      p.name = name; p.avatar = avatar; commit(500);
    } else if (pid === myPlayerId()) {
      try { await db.updateMyProfile(name, avatar); } catch(e) { toast(/taken/.test(String(e.message)) ? "Такое имя уже есть" : "Не удалось сохранить: " + e.message); return; }
      p.name = name; p.avatar = avatar;
    } else return;
    state.view.profileEdit = false; state._pf = null; toast("Профиль сохранён"); render();
  }
  function profileBodyHtml(pid) {
    const { ratings } = computeElo();
    const prof = computeProfile(pid);
    const { bestWin, worstLoss } = extremeGames(pid);
    return `
      <div class="card">
        <div class="stack">
          <div class="row"><span class="muted">Очки за / против</span><strong>${prof.pf} : ${prof.pa} <span class="tiny">${prof.diff>=0?"+":""}${prof.diff}</span></strong></div>
          <div class="row"><span class="muted">Лучший партнёр</span><strong>${prof.bestPartner? esc(playerName(prof.bestPartner)) + ` <span class="tiny">${(prof.bestPartnerNet>=0?"+":"")+prof.bestPartnerNet.toFixed(1)}/игру</span>` : "—"}</strong></div>
          <div class="row"><span class="muted">Заклятый партнёр</span><strong>${prof.worstPartner && prof.worstPartner!==prof.bestPartner ? esc(playerName(prof.worstPartner)) + ` <span class="tiny">${(prof.worstPartnerNet>=0?"+":"")+prof.worstPartnerNet.toFixed(1)}/игру</span>` : "—"}</strong></div>
          <div class="row"><span class="muted">Самый неудобный соперник</span><strong>${prof.worstOpp? esc(playerName(prof.worstOpp)) : "—"}</strong></div>
          ${extremeHtml("Самая разгромная победа", bestWin, pid)}
          ${extremeHtml("Самое разгромное поражение", worstLoss, pid)}
        </div>
      </div>
      ${profileMoneyHtml(pid)}`;
  }
  function profileMoneyHtml(pid) {
    const f = playerFinance(pid);
    if (!f.courts && !f.fees && !f.won) return "";
    const sign = v => `<strong style="color:${v>0?'var(--court)':v<0?'var(--danger)':'inherit'}">${v>0?"+":""}${fmtMoney(v)}</strong>`;
    return `<div class="card"><h3>Деньги</h3>
      <div class="stack" style="margin-top:10px;">
        <div class="row"><span class="muted">Оплачено за корты</span><strong>${fmtMoney(f.courts)}</strong></div>
        <div class="row"><span class="muted">Взносы в призовой</span><strong>${fmtMoney(f.fees)}</strong></div>
        <div class="row"><span class="muted">Выиграно призов</span><strong>${fmtMoney(f.won)}</strong></div>
        <div class="row"><span class="muted">Итог по призовому</span>${sign(f.net)}</div>
        <div class="row"><span class="muted">Итог с учётом кортов</span>${sign(f.total)}</div>
      </div></div>`;
  }

  function extremeGames(pid) {
    let bestWin = null, worstLoss = null, bestM = 0, worstM = 0;
    orderedGames().forEach(g => {
      if (g.scoreA==null || g.scoreB==null || g.decided===false) return;
      const inA = g.teamA.includes(pid), inB = g.teamB.includes(pid);
      if (!inA && !inB) return;
      const own = inA ? g.scoreA : g.scoreB, opp = inA ? g.scoreB : g.scoreA;
      const m = own - opp;
      if (m > bestM) { bestM = m; bestWin = g; }
      if (m < worstM) { worstM = m; worstLoss = g; }
    });
    return { bestWin, worstLoss };
  }
  function extremeHtml(label, g, pid) {
    if (!g) return `<div><span class="muted">${label}</span><div class="tiny">пока нет</div></div>`;
    const inA = g.teamA.includes(pid);
    const own = inA ? g.teamA : g.teamB, opp = inA ? g.teamB : g.teamA;
    const so = inA ? g.scoreA : g.scoreB, sp = inA ? g.scoreB : g.scoreA;
    const partner = own.find(x => x !== pid);
    const t = byId(state.tournaments, g.tournamentId);
    return `<div class="row" style="align-items:flex-start;">
      <div>
        <span class="muted">${label}</span>
        <div class="tiny">партнёр: ${esc(playerName(partner))} · соперники: ${esc(playerName(opp[0]))} + ${esc(playerName(opp[1]))}</div>
        <div class="tiny">${esc(t ? t.name : "")} · раунд ${g.round}</div>
      </div>
      <strong style="white-space:nowrap;">${so} : ${sp}</strong>
    </div>`;
  }
  // ================= ACHIEVEMENTS ENGINE =================
  function playerSeqs() {
    const seqs = {}; state.players.forEach(p => seqs[p.id] = []);
    orderedGames().forEach(g => {
      if (g.scoreA==null || g.scoreB==null) return;
      [["A", g.teamA, g.scoreA, g.scoreB], ["B", g.teamB, g.scoreB, g.scoreA]].forEach(([s, team, own, opp]) => {
        team.forEach(pid => { if (seqs[pid]) seqs[pid].push({ g, own, opp, win: g.decided!==false && own>opp, loss: g.decided!==false && opp>own }); });
      });
    });
    return seqs;
  }
  function streakInfo(seq) {
    let bestW=0, bestL=0, curW=0, curL=0, bestWEnd=null, bestLEnd=null;
    seq.forEach(r => {
      if (r.win) { curW++; curL=0; if (curW>bestW) { bestW=curW; bestWEnd=r.g; } }
      else if (r.loss) { curL++; curW=0; if (curL>bestL) { bestL=curL; bestLEnd=r.g; } }
    });
    return { bestW, bestL, curW, curL, bestWEnd, bestLEnd };
  }
  function streakTag(pid) {
    const s = streakInfo(playerSeqs()[pid]||[]);
    if (s.curW>=3) return ` <span class="tiny" title="серия побед">🔥${s.curW}</span>`;
    if (s.curL>=3) return ` <span class="tiny" title="серия поражений">🥶${s.curL}</span>`;
    return "";
  }
  function gameLabel(g) { const t = byId(state.tournaments, g.tournamentId); return (t ? t.name : "") + " · р." + g.round; }
  function eloByTournament() {
    // rating of every player after each tournament (chronological)
    const ratings = {}; state.players.forEach(p => ratings[p.id] = ELO_START);
    const out = {};
    const games = orderedGames();
    state.tournaments.forEach(t => {
      games.filter(g => g.tournamentId===t.id && g.scoreA!=null && g.scoreB!=null).forEach(g => {
        const total = g.scoreA+g.scoreB; if (total<=0) return;
        const rA = avgRating(g.teamA, ratings), rB = avgRating(g.teamB, ratings);
        const eA = 1/(1+Math.pow(10,(rB-rA)/400));
        const dA = K*(g.scoreA/total - eA), dB = K*(g.scoreB/total - (1-eA));
        g.teamA.forEach(p => { if (ratings[p]!=null) ratings[p]+=dA; });
        g.teamB.forEach(p => { if (ratings[p]!=null) ratings[p]+=dB; });
      });
      out[t.id] = Object.assign({}, ratings);
    });
    return out;
  }
  // «Логические» турниры: двухэтапный (Американо → SwissCourt) считается одним турниром, итог — по этапу 2 (общая таблица).
  // турниры (без товарищеских матчей — они не дают титулов и мест); allEvents — всё вместе для списка и финансов
  function leagueTournaments() { return state.tournaments.filter(t => !linkedChild(t) && !isFriendly(t)); }
  function allEvents() { return state.tournaments.filter(t => !linkedChild(t)); }
  function tournamentTable(tid) {
    const t = byId(state.tournaments, tid);
    const src = t && linkedParent(t) ? stageGames(t) : state.games.filter(g => g.tournamentId===tid);
    const games = src.filter(g => g.scoreA!=null && g.scoreB!=null);
    const pts = {}, wins = {}, gp = {}, draws = {};
    games.forEach(g => {
      g.teamA.forEach(p => { pts[p]=(pts[p]||0)+g.scoreA; gp[p]=(gp[p]||0)+1; if (g.decided!==false && g.scoreA>g.scoreB) wins[p]=(wins[p]||0)+1; });
      g.teamB.forEach(p => { pts[p]=(pts[p]||0)+g.scoreB; gp[p]=(gp[p]||0)+1; if (g.decided!==false && g.scoreB>g.scoreA) wins[p]=(wins[p]||0)+1; });
      if (g.scoreA===g.scoreB) g.teamA.concat(g.teamB).forEach(p => { draws[p]=(draws[p]||0)+1; });
    });
    const order = Object.keys(pts).sort((a,b) => pts[b]-pts[a]);
    const wdl = id => `${wins[id]||0}-${draws[id]||0}-${(gp[id]||0)-(wins[id]||0)-(draws[id]||0)}`;
    return { pts, wins, draws, gp, order, games, wdl };
  }
  function computeAchievements() {
    const seqs = playerSeqs();
    const allP = state.players.filter(p => (seqs[p.id]||[]).length>0).map(p => p.id); // все, кто играл — для рекордов зала славы
    const played = allP.filter(isActive);                                                // ачивки и титулы — только активные
    const N = id => playerName(id);
    const titles = [], anti = [], personal = {}, milestones = {}, records = [];
    played.forEach(id => { personal[id]=[]; milestones[id]=[]; });
    const addP = (id, icon, name, desc) => personal[id] && personal[id].push({icon,name,desc});
    const addM = (id, icon, name, desc) => milestones[id] && milestones[id].push({icon,name,desc});
    const top = (arr, key, dir, min) => {
      const list = arr.filter(x => x.v!=null && (min==null || x.n>=min));
      if (!list.length) return [];
      const best = dir>0 ? Math.max(...list.map(x=>x.v)) : Math.min(...list.map(x=>x.v));
      return list.filter(x => x.v===best);
    };
    const title = (arr, icon, name, desc, fmt) => arr.push({icon, name, desc, holders: fmt});
    const holders = (list, lbl) => list.map(x => ({ label: x.label || N(x.id), sub: lbl(x) }));

    // --- Эло / король
    const { ratings } = computeElo();
    const eloList = played.map(id => ({id, v: Math.round(ratings[id]||1500), n: 1}));
    title(titles, "👑", "Король", "1-е место в Эло", holders(top(eloList,"v",1), x=>x.v+" Эло"));

    // --- серии
    const st = {}; allP.forEach(id => st[id] = streakInfo(seqs[id]));
    title(titles, "🔥", "Серия", "самая длинная серия побед за всё время", holders(top(played.map(id=>({id, v: st[id].bestW, n:1})),"v",1), x => x.v+" подряд"));
    title(anti, "🧊", "Заморозка", "самая длинная текущая серия поражений", holders(top(played.map(id=>({id, v: st[id].curL, n:1})),"v",1).filter(x=>x.v>=2), x => x.v+" подряд"));

    const avg = played.map(id => { const s=seqs[id]; const n=s.length; return { id, n, pf: s.reduce((a,r)=>a+r.own,0)/n, pa: s.reduce((a,r)=>a+r.opp,0)/n }; });

    // --- пары (3+ игр)
    const pairsAll = computeAllPairs().filter(p => p.g>=3).map(p => ({ id: p.ids.join("|"), label: N(p.ids[0])+" + "+N(p.ids[1]), v: +((p.pf-p.pa)/p.g).toFixed(1), n: p.g, w: p.w, l: p.l, ids: p.ids }));
    const pairs = pairsAll.filter(p => p.ids.every(isActive));
    title(titles, "🤝", "Идеальная пара", "лучший net/игру среди пар с 3+ играми", holders(top(pairs,"v",1), x => (x.v>=0?"+":"")+x.v+" за игру · "+x.w+"-"+x.l));
    title(anti, "🧯", "Токсичная пара", "худший net/игру среди пар с 3+ играми", holders(top(pairs,"v",-1), x => (x.v>=0?"+":"")+x.v+" за игру · "+x.w+"-"+x.l));

    // --- турниры: чемпион, ложка, ракета
    const ts = leagueTournaments().filter(t => tournamentTable(t.id).order.length);
    const last = ts[ts.length-1];
    const tables = {}; ts.forEach(t => tables[t.id] = tournamentTable(t.id));
    if (last) {
      const tb = tables[last.id];
      const rk = rankedForPrizes(last), lastPl = Math.max(...rk.map(r => r.place));
      title(titles, "🏆", "Чемпион", "победитель последнего турнира", holders(rk.filter(r => r.place===1 && isActive(r.id)).map(r => ({ id: r.id, v: tb.pts[r.id] })), x => x.v+" очков · "+last.name));
      title(anti, "🥄", "Деревянная ложка", "последнее место в последнем турнире", holders(rk.filter(r => r.place===lastPl && lastPl>1 && isActive(r.id)).map(r => ({ id: r.id, v: tb.pts[r.id] })), x => x.v+" очков · "+last.name));
    }
    const ebt = eloByTournament();
    if (ts.length>=2) {
      const prev = ts[ts.length-2];
      const gains = tables[last.id].order.filter(isActive).map(id => ({ id, v: Math.round((ebt[last.id][id]||1500) - (ebt[prev.id][id]||1500)), n:1 }));
      title(titles, "🚀", "Ракета", "наибольший рост Эло за последний турнир", holders(top(gains,"v",1), x => (x.v>=0?"+":"")+x.v+" Эло"));
    }

    // --- разгром
    const decided = orderedGames().filter(g => g.scoreA!=null && g.scoreB!=null && g.decided!==false);
    const decidedAct = decided.filter(g => (g.scoreA>g.scoreB ? g.teamA : g.teamB).every(isActive)); // титул — только активным победителям
    if (decidedAct.length) {
      const dom = g => Math.abs(g.scoreA-g.scoreB)/(g.scoreA+g.scoreB);
      const maxM = Math.max(...decidedAct.map(dom));
      const bigs = decidedAct.filter(g => dom(g)===maxM);
      title(titles, "🩸", "Мясник", "крупнейший разгром лиги (по доле выигранных очков)", bigs.map(g => { const w = g.scoreA>g.scoreB ? g.teamA : g.teamB; const l = g.scoreA>g.scoreB ? g.teamB : g.teamA; return { label: N(w[0])+" + "+N(w[1]), sub: Math.max(g.scoreA,g.scoreB)+":"+Math.min(g.scoreA,g.scoreB)+" против "+N(l[0])+" + "+N(l[1])+" · "+gameLabel(g) }; }));
    }

    // --- клатч / невезучий
    const one = played.map(id => ({ id, w: seqs[id].filter(r=>r.own-r.opp===1).length, l: seqs[id].filter(r=>r.opp-r.own===1).length }));
    title(titles, "⚡", "Клатч", "больше всех побед в одно очко", holders(top(one.map(x=>({id:x.id, v:x.w, n:1})),"v",1).filter(x=>x.v>0), x => x.v+" побед в 1 очко"));
    title(anti, "🎲", "Невезучий", "больше всех поражений в одно очко", holders(top(one.map(x=>({id:x.id, v:x.l, n:1})),"v",1).filter(x=>x.v>0), x => x.v+" поражений в 1 очко"));

    // --- стартер / финишер (первый и последний раунд каждого турнира)
    const lastRound = {}; state.tournaments.forEach(t => { const gs = state.games.filter(g=>g.tournamentId===t.id); lastRound[t.id] = gs.length ? Math.max(...gs.map(g=>g.round)) : 0; });
    const rr = (pick) => played.map(id => { const rs = seqs[id].filter(r => pick(r.g)); const w = rs.filter(r=>r.win).length, l = rs.filter(r=>r.loss).length; return { id, v: w-l, n: rs.length, w, l }; });
    const stage1 = new Set(state.tournaments.filter(t => linkedChild(t)).map(t => t.id)), stage2 = new Set(state.tournaments.filter(t => linkedParent(t)).map(t => t.id));
    const first = rr(g => g.round===1 && !stage2.has(g.tournamentId)), lastR = rr(g => g.round===lastRound[g.tournamentId] && !stage1.has(g.tournamentId));
    title(titles, "🎯", "Стартер", "лучший баланс в первых раундах (2+ игр)", holders(top(first,"v",1,2), x => x.w+"-"+x.l+" в 1-х раундах"));
    title(anti, "😴", "Долго запрягает", "худший баланс в первых раундах (2+ игр)", holders(top(first,"v",-1,2), x => x.w+"-"+x.l+" в 1-х раундах"));
    title(titles, "🏁", "Финишер", "лучший баланс в последних раундах (2+ игр)", holders(top(lastR,"v",1,2), x => x.w+"-"+x.l+" в последних раундах"));
    title(anti, "🫠", "Сдулся", "худший баланс в последних раундах (2+ игр)", holders(top(lastR,"v",-1,2), x => x.w+"-"+x.l+" в последних раундах"));

    // --- личные
    played.forEach(id => {
      const s = seqs[id], si = st[id];
      if (si.curW>=3) addP(id, "🔥", "В огне", si.curW+" победы подряд прямо сейчас");
      if (si.curL>=3) addP(id, "🥶", "Чёрная полоса", si.curL+" поражений подряд прямо сейчас");
      // камбэк: в одном турнире 3+ поражений подряд, затем победа
      let run=0, lastT=null, cb=null;
      s.forEach(r => { if (r.g.tournamentId!==lastT) { run=0; lastT=r.g.tournamentId; } if (r.loss) run++; else if (r.win) { if (run>=3) cb = r.g; run=0; } });
      if (cb) addP(id, "🔄", "Камбэк", "победа после 3+ поражений подряд · "+gameLabel(cb));
      // непобедимый в паре
      const unb = computeAllPairs().filter(p => p.ids.includes(id) && p.ids.every(isActive) && p.g>=3 && p.l===0);
      if (unb.length) addP(id, "💪", "Непобедимый в паре", unb.map(p => "с "+N(p.ids.find(x=>x!==id))+" "+p.w+"-0").join(", "));
      // качели
      let alt=1, bestAlt=1;
      for (let i=1;i<s.length;i++) { const a=s[i-1], b=s[i]; if ((a.win&&b.loss)||(a.loss&&b.win)) { alt++; bestAlt=Math.max(bestAlt,alt); } else alt=1; }
      if (bestAlt>=5) addP(id, "🎢", "Качели", bestAlt+" игр подряд победа/поражение по очереди");
      // ноль
      ts.forEach(t => { const tb = tables[t.id]; if ((tb.gp[id]||0)>=3 && !(tb.wins[id]||0)) addP(id, "🚫", "Ноль", "турнир без побед · "+t.name); });
      // сбалансированный
      const w = s.filter(r=>r.win).length, l = s.filter(r=>r.loss).length;
      if (s.length>=10 && w===l) addP(id, "⚖️", "Сбалансированный", "ровно "+w+"-"+l);
    });

    // --- рекорды (зал славы)
    const rec = (icon, name, list, sub) => records.push({icon, name, list, sub});
    if (decided.length) {
      const dom = g => Math.abs(g.scoreA-g.scoreB)/(g.scoreA+g.scoreB);
      const maxM = Math.max(...decided.map(dom));
      rec("🩸", "Крупнейший разгром", decided.filter(g=>dom(g)===maxM).map(g => { const w = g.scoreA>g.scoreB?g.teamA:g.teamB, l = g.scoreA>g.scoreB?g.teamB:g.teamA; return { label: N(w[0])+" + "+N(w[1])+"  "+Math.max(g.scoreA,g.scoreB)+":"+Math.min(g.scoreA,g.scoreB)+"  "+N(l[0])+" + "+N(l[1]), sub: gameLabel(g) }; }));
      const minM = Math.min(...decided.map(g => Math.abs(g.scoreA-g.scoreB)));
      rec("🫀", "Самые упорные игры", decided.filter(g=>Math.abs(g.scoreA-g.scoreB)===minM).slice(0,6).map(g => ({ label: N(g.teamA[0])+" + "+N(g.teamA[1])+"  "+g.scoreA+":"+g.scoreB+"  "+N(g.teamB[0])+" + "+N(g.teamB[1]), sub: gameLabel(g) })));
    }
    rec("🔥", "Самая длинная серия побед", holders(top(allP.map(id=>({id, v: st[id].bestW, n:1})),"v",1), x => x.v+" подряд"+(st[x.id].bestWEnd? " · до "+gameLabel(st[x.id].bestWEnd):"")));
    rec("🧊", "Самая длинная серия поражений", holders(top(allP.map(id=>({id, v: st[id].bestL, n:1})),"v",1), x => x.v+" подряд"+(st[x.id].bestLEnd? " · до "+gameLabel(st[x.id].bestLEnd):"")));
    rec("🤝", "Лучшая пара", holders(top(pairsAll,"v",1), x => (x.v>=0?"+":"")+x.v+" за игру · "+x.w+"-"+x.l+" · "+x.n+" игр"));
    rec("🧯", "Худшая пара", holders(top(pairsAll,"v",-1), x => (x.v>=0?"+":"")+x.v+" за игру · "+x.w+"-"+x.l+" · "+x.n+" игр"));
    const bestTour = []; ts.forEach(t => tables[t.id].order.forEach(id => bestTour.push({id, v: tables[t.id].pts[id], t})));
    rec("💯", "Самый результативный турнир", holders(top(bestTour,"v",1), x => x.v+" очков · "+x.t.name));
    if (ts.length>=2) {
      const gains = [];
      for (let i=1;i<ts.length;i++) tables[ts[i].id].order.forEach(id => gains.push({ id, v: Math.round((ebt[ts[i].id][id]||1500)-(ebt[ts[i-1].id][id]||1500)), t: ts[i] }));
      rec("🚀", "Самый большой скачок Эло за турнир", holders(top(gains,"v",1), x => "+"+x.v+" · "+x.t.name));
      rec("📉", "Самое большое падение Эло за турнир", holders(top(gains,"v",-1), x => x.v+" · "+x.t.name));
    }
    const totals = allP.map(id => ({ id, w: seqs[id].filter(r=>r.win).length, pf: seqs[id].reduce((a,r)=>a+r.own,0) }));
    rec("🏆", "Больше всех побед", holders(top(totals.map(x=>({id:x.id, v:x.w, n:1})),"v",1), x => x.v+" побед"));
    rec("🎯", "Больше всех очков", holders(top(totals.map(x=>({id:x.id, v:x.pf, n:1})),"v",1), x => x.v+" очков"));
    rec("👑", "Чемпионы турниров", ts.map(t => { const c = champions(t); return { label: c.map(N).join(" + "), sub: t.name+" · "+(tables[t.id].pts[c[0]]||0)+" очков" }; }));

    return { titles, anti, personal, milestones, records, last, tables };
  }
  function badgeRow(b) {
    const hs = b.holders && b.holders.length ? b.holders.map(h => `<div class="badge-holder"><strong>${esc(h.label)}</strong><span class="tiny">${esc(h.sub||"")}</span></div>`).join("") : `<div class="tiny">пока никто</div>`;
    return `<div class="badge">
      <div class="badge-ic">${b.icon}</div>
      <div class="badge-body"><div class="badge-name">${esc(b.name)}</div><div class="tiny">${esc(b.desc)}</div>${hs}</div>
    </div>`;
  }
  // Значки ачивок — линейные иконки (не смайлики). Ключ — название ачивки.
  const BI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const BADGE_ICON = {
    "Король": BI('<path d="M3 18h18M4 17l-1-9 5 4 4-7 4 7 5-4-1 9z"/>'),
    "Серия": BI('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-6 1-9z"/>'),
    "Идеальная пара": BI('<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>'),
    "Чемпион": BI('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6"/>'),
    "Ракета": BI('<path d="M14 4c3 0 6 3 6 6l-8 8-4-4z"/><path d="M8 14l-4 1 3-5M10 16l-1 4 5-3M15 9h.01"/>'),
    "Мясник": BI('<path d="M4 20l4-4M8 16l8-8 4 4-8 8H8z"/><path d="M14 6l4 4"/>'),
    "Клатч": BI('<path d="M13 2L5 14h6l-1 8 9-13h-6z"/>'),
    "Стартер": BI('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    "Финишер": BI('<path d="M5 21V4h12l-2 4 2 4H5"/>'),
    "Заморозка": BI('<path d="M12 3v18M4 7l16 10M4 17L20 7M12 3l-2 2M12 3l2 2M12 21l-2-2M12 21l2-2"/>'),
    "Токсичная пара": BI('<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/><path d="M4 4l16 16"/>'),
    "Деревянная ложка": BI('<ellipse cx="9" cy="8" rx="5" ry="5.5"/><path d="M12 12l7 8"/>'),
    "Невезучий": BI('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8.5" cy="15.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/>'),
    "Долго запрягает": BI('<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>'),
    "Сдулся": BI('<path d="M3 17l5-6 4 4 4-6 5 7"/><path d="M15 9h6v6"/>'),
    "В огне": BI('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-6 1-9z"/><path d="M4 5l1 2M20 5l-1 2"/>'),
    "Чёрная полоса": BI('<path d="M7 15a4 4 0 0 1 1-7.9A5 5 0 0 1 17.5 9 3.5 3.5 0 0 1 17 15H7z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>'),
    "Камбэк": BI('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>'),
    "Непобедимый в паре": BI('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    "Качели": BI('<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>'),
    "Ноль": BI('<circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/>'),
    "Сбалансированный": BI('<path d="M12 3v18M4 21h16M12 6l-6 7h12z"/><path d="M3 13a3 3 0 0 0 6 0M15 13a3 3 0 0 0 6 0"/>'),
  };
  function profileBadgesHtml(pid) {
    if (!state.games.length) return "";
    const A = computeAchievements();
    const mine = h => h.label===playerName(pid) || h.label.includes(playerName(pid)+" +") || h.label.includes("+ "+playerName(pid));
    const list = A.titles.filter(t => t.holders.some(mine)).map(b => ({ ...b, kind: "title", sub: (b.holders.find(mine)||{}).sub }))
      .concat(A.anti.filter(t => t.holders.some(mine)).map(b => ({ ...b, kind: "anti", sub: (b.holders.find(mine)||{}).sub })))
      .concat((A.personal[pid]||[]).map(b => ({ ...b, kind: b.name==="Чёрная полоса"||b.name==="Ноль" ? "anti" : "personal" })));
    const open = state.view.badgesOpen === pid;
    const body = !list.length ? `<p class="tiny" style="margin:10px 0 0;">Пока ничего — ачивки живые и появляются сами по результатам.</p>`
      : `<div class="badge-grid">${list.map(b => `<div class="bdg ${b.kind}" title="${esc(b.desc)}">
          <div class="bdg-ic">${BADGE_ICON[b.name] || `<span>${b.icon}</span>`}</div>
          <div class="bdg-name">${esc(b.name)}</div>
          <div class="bdg-desc">${esc(b.sub || b.desc)}</div>
        </div>`).join("")}</div>`;
    return `<div class="card bdg-card ${open?'open':''}">
      <div class="row bdg-head" data-act="toggle-badges" data-id="${pid}"><h3>Ачивки <span class="tiny">· ${list.length}</span></h3><span class="chev">›</span></div>
      ${open ? body : ""}
    </div>`;
  }

  // ================= ФАКТЫ ТУРНИРА / ЛИГИ =================
  function gameFacts(games, ed, minPairGames) {
    // games — сыгранные игры (счёт внесён); ed — eloDetail для «Ракеты» (может быть null)
    const N = playerName;
    const played = games.filter(g => g.scoreA!=null && g.scoreB!=null);
    const decided = played.filter(g => g.scoreA!==g.scoreB);
    const out = [];
    const add = (icon, name, label, sub) => out.push({ icon, name, lines: Array.isArray(label) ? label : [{ label, sub }] });
    const line = g => `${N(g.teamA[0])} + ${N(g.teamA[1])}  ${g.scoreA}:${g.scoreB}  ${N(g.teamB[0])} + ${N(g.teamB[1])}`;
    const where = g => { const t = byId(state.tournaments, g.tournamentId); return (t ? t.name + " · " : "") + "раунд " + g.round; };
    if (!played.length) return out;
    if (decided.length) {
      const dom = g => Math.abs(g.scoreA-g.scoreB)/(g.scoreA+g.scoreB);
      const maxDom = Math.max(...decided.map(dom));
      const bigs = decided.filter(g => Math.abs(dom(g)-maxDom) < 1e-9);
      const wl = g => { const w = g.scoreA>g.scoreB ? g.teamA : g.teamB, l = g.scoreA>g.scoreB ? g.teamB : g.teamA; return `${N(w[0])} + ${N(w[1])} ${Math.max(g.scoreA,g.scoreB)}:${Math.min(g.scoreA,g.scoreB)} ${N(l[0])} + ${N(l[1])}`; };
      add("🩸", bigs.length>1 ? "Разгромы" : "Разгром", bigs.map(g => ({ label: wl(g), sub: where(g) })));
      const minDiff = Math.min(...decided.map(g => Math.abs(g.scoreA-g.scoreB)));
      const tights = decided.filter(g => Math.abs(g.scoreA-g.scoreB)===minDiff && !bigs.includes(g));
      if (tights.length) add("🫀", tights.length>1 ? "Самые упорные" : "Самая упорная", tights.slice(0, 8).map(g => ({ label: line(g), sub: where(g) })).concat(tights.length>8 ? [{ label: "… и ещё " + (tights.length-8), sub: "" }] : []));
    }
    const draws = played.filter(g => g.scoreA===g.scoreB);
    if (draws.length) add("🤝", draws.length===1 ? "Ничья" : plural(draws.length, "ничья", "ничьи", "ничьих"), draws.slice(0, 6).map(g => ({ label: line(g), sub: where(g) })).concat(draws.length>6 ? [{ label: "… и ещё " + (draws.length-6), sub: "" }] : []));
    const tot = g => g.scoreA+g.scoreB;
    const maxTot = Math.max(...played.map(tot));
    if (played.some(g => tot(g) !== maxTot)) { const hots = played.filter(g => tot(g)===maxTot); add("🔥", hots.length>1 ? "Самые результативные" : "Самая результативная", hots.slice(0, 6).map(g => ({ label: line(g), sub: plural(tot(g), "очко", "очка", "очков") + " · " + where(g) }))); }
    // пары
    const pm = {};
    played.forEach(g => [[g.teamA,g.scoreA,g.scoreB],[g.teamB,g.scoreB,g.scoreA]].forEach(([tm,own,opp]) => { const k = tm.slice().sort().join("|"); const r = pm[k] || (pm[k] = { ids: tm.slice().sort(), g:0, w:0, l:0, pf:0, pa:0 }); r.g++; r.pf+=own; r.pa+=opp; if (own>opp) r.w++; else if (opp>own) r.l++; }));
    const pairs = Object.values(pm).filter(r => r.g >= (minPairGames || 1)); // любая пара, даже сыгравшая один матч
    if (pairs.length >= 2) {
      const net = r => (r.pf-r.pa)/r.g;
      const maxNet = Math.max(...pairs.map(net)), minNet = Math.min(...pairs.map(net));
      const bps = pairs.filter(r => Math.abs(net(r)-maxNet) < 1e-9), wps = pairs.filter(r => Math.abs(net(r)-minNet) < 1e-9);
      const pl = r => `${N(r.ids[0])} + ${N(r.ids[1])}`;
      const ps = r => `${r.w}-${r.g-r.w-r.l}-${r.l} · ${(r.pf-r.pa)>=0?"+":""}${r.pf-r.pa} за ${plural(r.g, "игру", "игры", "игр")} (${net(r)>=0?"+":""}${net(r).toFixed(1)} за игру)`;
      add("🤝", bps.length>1 ? "Лучшие пары" : "Лучшая пара", bps.map(r => ({ label: pl(r), sub: ps(r) })));
      if (maxNet !== minNet) add("🧯", wps.length>1 ? "Худшие пары" : "Худшая пара", wps.map(r => ({ label: pl(r), sub: ps(r) })));
    }
    // игроки
    const st = {};
    played.forEach(g => [[g.teamA,g.scoreA,g.scoreB],[g.teamB,g.scoreB,g.scoreA]].forEach(([tm,own,opp]) => tm.forEach(p => { const r = st[p] || (st[p] = { gp:0, w:0, l:0, pf:0, pa:0, one:0, oneL:0 }); r.gp++; r.pf+=own; r.pa+=opp; if (own>opp) r.w++; else if (opp>own) r.l++; if (own-opp===1) r.one++; if (opp-own===1) r.oneL++; })));
    const ids = Object.keys(st);
    const top = (f, dir) => { const v = ids.map(id => ({ id, v: f(st[id]) })); const best = dir>0 ? Math.max(...v.map(x=>x.v)) : Math.min(...v.map(x=>x.v)); return v.filter(x => x.v===best); };
    const names = l => l.map(x => N(x.id)).join(", ");
    if (ids.length >= 2) {
      const cl = top(r => r.one, 1); if (cl[0].v > 0) add("⚡", "Клатч", names(cl), plural(cl[0].v, "победа", "победы", "побед") + " в одно очко");
      const un = top(r => r.oneL, 1); if (un[0].v > 0) add("🎲", "Невезучий", names(un), plural(un[0].v, "поражение", "поражения", "поражений") + " в одно очко");
      const perfect = ids.filter(id => st[id].l===0); if (perfect.length) add("🪖", "Без поражений", perfect.map(id => N(id) + " (" + st[id].w + "-" + (st[id].gp-st[id].w-st[id].l) + "-0)").join(", "), "ни одного проигрыша");
      const zero = ids.filter(id => st[id].w===0); if (zero.length) add("🚫", "Ноль", zero.map(id => N(id) + " (0-" + (st[id].gp-st[id].w-st[id].l) + "-" + st[id].l + ")").join(", "), "ни одной победы");
    }
    // серии внутри турнира (по порядку раунд/корт)
    const ord = played.slice().sort((a,b) => (a.round-b.round) || ((a.court||0)-(b.court||0)));
    const streak = {}; const bestStreak = {};
    ord.forEach(g => { if (g.scoreA===g.scoreB) { g.teamA.concat(g.teamB).forEach(p => streak[p]=0); return; } const w = g.scoreA>g.scoreB ? g.teamA : g.teamB, l = g.scoreA>g.scoreB ? g.teamB : g.teamA; w.forEach(p => { streak[p]=(streak[p]||0)+1; bestStreak[p]=Math.max(bestStreak[p]||0, streak[p]); }); l.forEach(p => streak[p]=0); });
    const bsv = Object.values(bestStreak); if (bsv.length && Math.max(...bsv) >= 3) { const m = Math.max(...bsv); add("🔥", "Серия", Object.keys(bestStreak).filter(p => bestStreak[p]===m).map(N).join(", "), plural(m, "победа", "победы", "побед") + " подряд"); }
    // камбэк: 2+ поражения подряд, потом победа — и финиш в топ-3 не считаем, просто факт
    // Ракета / якорь по Эло
    if (ed && Object.keys(ed.delta).length >= 2) {
      const ds = Object.keys(ed.delta).sort((a,b) => ed.delta[b]-ed.delta[a]);
      add("🚀", "Ракета", N(ds[0]), fmtDelta(ed.delta[ds[0]]) + " Эло за турнир");
      add("⚓", "Якорь", N(ds[ds.length-1]), fmtDelta(ed.delta[ds[ds.length-1]]) + " Эло за турнир");
    }
    return out;
  }
  function factsListHtml(list) {
    if (!list.length) return `<div class="tiny">пока нечего рассказать — внесите счета</div>`;
    return `<div class="badge-list">${list.map(f => `<div class="badge"><div class="badge-ic">${f.icon}</div><div class="badge-body"><div class="badge-name">${esc(f.name)}</div>${f.lines.map((ln, i) => `<div style="${i ? "margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);" : ""}"><div style="font-size:14.5px;margin-top:2px;">${esc(ln.label)}</div>${ln.sub ? `<div class="tiny">${esc(ln.sub)}</div>` : ""}</div>`).join("")}</div></div>`).join("")}</div>`;
  }
  function tournamentFactsHtml(t, games, ed) {
    const list = gameFacts(games, ed);
    return `<div style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px;">
      <div class="row"><h3>Интересное</h3><button class="edit-pen" data-act="t-facts" data-id="${t.id}" title="скрыть" style="font-size:16px;">✕</button></div>
      ${linkedParent(t) ? `<p class="tiny" style="margin:4px 0 8px;">По обоим этапам вместе.</p>` : ""}
      ${factsListHtml(list)}
    </div>`;
  }
  function leagueFactsHtml() {
    const played = state.games.filter(g => g.scoreA!=null && g.scoreB!=null);
    if (!played.length) return "";
    const N = playerName;
    const ts = leagueTournaments().filter(t => tournamentTable(t.id).order.length);
    const totalPts = played.reduce((a,g)=>a+g.scoreA+g.scoreB,0);
    const facts = [];
    const add = (icon, name, label, sub) => facts.push({ icon, name, lines: [{ label, sub }] });
    add("📚", "История лиги", `${plural(ts.length, "турнир", "турнира", "турниров")}, ${plural(played.length, "игра", "игры", "игр")}, ${totalPts.toLocaleString("ru-RU")} очков`, ts.length ? `с ${fmtDate(ts[0].date)}` : "");
    const ord = orderedGames().filter(g => g.scoreA!=null && g.scoreB!=null);
    if (ord.length) {
      // первый раунд первого турнира шёл на нескольких кортах одновременно — показываем все его матчи
      const f0 = ord[0], first = ord.filter(g => g.tournamentId === f0.tournamentId && g.round === f0.round);
      facts.push({ icon: "🥇", name: first.length > 1 ? "Первые игры лиги" : "Первая игра лиги", lines: first.map(f => { const w = f.scoreA>f.scoreB ? f.teamA : f.teamB;
        return { label: `${N(f.teamA[0])} + ${N(f.teamA[1])}  ${f.scoreA}:${f.scoreB}  ${N(f.teamB[0])} + ${N(f.teamB[1])}`, sub: (first.length > 1 ? `корт ${f.court || 1} · ` : "") + (f.scoreA!==f.scoreB ? "победа — " + N(w[0]) + " + " + N(w[1]) : "ничья") }; }) });
    }
    // чемпионы: кто чаще всех выигрывал турниры
    const champs = {}; ts.forEach(t => champions(t).forEach(id => champs[id] = (champs[id]||0)+1));
    const cs = Object.entries(champs).sort((a,b)=>b[1]-a[1]);
    if (cs.length) add("👑", "Больше всех титулов", cs.filter(x=>x[1]===cs[0][1]).map(x=>N(x[0])).join(", "), plural(cs[0][1], "победа", "победы", "побед") + " в турнирах из " + ts.length);
    // подиумы
    const pod = {}; ts.forEach(t => rankedForPrizes(t).filter(r => r.place<=3).forEach(r => pod[r.id]=(pod[r.id]||0)+1));
    const ps = Object.entries(pod).sort((a,b)=>b[1]-a[1]);
    if (ps.length && ts.length>=2) add("🏅", "Чаще всех на подиуме", ps.filter(x=>x[1]===ps[0][1]).map(x=>N(x[0])).join(", "), plural(ps[0][1], "раз", "раза", "раз") + " в тройке из " + ts.length);
    // самый частый напарник / самая частая пара
    const pc = {}; played.forEach(g => [g.teamA, g.teamB].forEach(tm => { const k = tm.slice().sort().join("|"); pc[k]=(pc[k]||0)+1; }));
    const pcs = Object.entries(pc).sort((a,b)=>b[1]-a[1]);
    if (pcs.length) { const ids = pcs[0][0].split("|"); add("👯", "Самая частая пара", N(ids[0]) + " + " + N(ids[1]), plural(pcs[0][1], "игра", "игры", "игр") + " вместе"); }
    // самый популярный счёт
    const sc = {}; played.forEach(g => { const k = Math.max(g.scoreA,g.scoreB)+":"+Math.min(g.scoreA,g.scoreB); sc[k]=(sc[k]||0)+1; });
    const scs = Object.entries(sc).sort((a,b)=>b[1]-a[1]);
    if (scs.length && scs[0][1] >= 3) add("🎯", "Самый частый счёт", scs[0][0], plural(scs[0][1], "раз", "раза", "раз"));
    // средняя разница
    const dec = played.filter(g=>g.scoreA!==g.scoreB);
    if (dec.length) add("📏", "Средняя разница в счёте", (dec.reduce((a,g)=>a+Math.abs(g.scoreA-g.scoreB),0)/dec.length).toFixed(1) + " очка", `${plural(dec.filter(g=>Math.abs(g.scoreA-g.scoreB)<=2).length, "игра", "игры", "игр")} решились в 1–2 очка`);
    // кто играл со всеми
    const partners = {}; played.forEach(g => [g.teamA, g.teamB].forEach(tm => { (partners[tm[0]] = partners[tm[0]]||new Set()).add(tm[1]); (partners[tm[1]] = partners[tm[1]]||new Set()).add(tm[0]); }));
    const pl = Object.entries(partners).map(([id,s]) => ({ id, n: s.size })).sort((a,b)=>b.n-a.n);
    const plTop = pl.filter(x=>x.n===pl[0].n);
    if (pl.length && plTop.length <= 3) add("🌐", "Больше всех разных напарников", plTop.map(x=>N(x.id)).join(", "), plural(pl[0].n, "напарник", "напарника", "напарников"));
    // самый результативный турнир (очков на игру)
    if (ts.length>=2) { const per = ts.map(t => { const gs = tournamentTable(t.id).games; return { t, v: gs.length ? gs.reduce((a,g)=>a+g.scoreA+g.scoreB,0)/gs.length : 0 }; }).sort((a,b)=>b.v-a.v)[0]; add("🎪", "Самый результативный турнир", per.t.name, per.v.toFixed(1) + " очка за игру"); }
    return `<div class="card"><h3>Факты лиги</h3>${factsListHtml(facts)}</div>`;
  }
  function statHall() {
    if (!state.games.length) return `<div class="empty">нет сыгранных игр</div>`;
    const A = computeAchievements();
    const allTime = gameFacts(state.games, null, 1);
    const dup = new Set(["Крупнейший разгром", "Самые упорные игры", "Лучшая пара", "Худшая пара", "Самая длинная серия побед"]);
    const records = A.records.filter(r => !dup.has(r.name));
    const ts = leagueTournaments().filter(t => tournamentTable(t.id).order.length).slice().reverse();
    const open = state.view.hallOpen || (state.view.hallOpen = {});
    const perT = ts.map(t => {
      const games = t.format==="swiss" && linkedParent(t) ? stageGames(t) : state.games.filter(g => g.tournamentId===t.id);
      const ed = eloDetail(t.id, linkedParent(t) ? [linkedParent(t).id] : []);
      const r = rankedForPrizes(t);
      return `<div class="card" style="padding:10px 12px;">
        <div class="row" data-act="hall-toggle" data-id="${t.id}" style="cursor:pointer;">
          <div><strong>${esc(t.name)}</strong><div class="tiny">${fmtDate(t.date)} · ${tLabel(t)}${r.length ? " · 🥇 " + esc(champions(t).map(playerName).join(" + ")) : ""}</div></div>
          <span class="tiny">${open[t.id] ? "▴" : "▾"}</span>
        </div>
        ${open[t.id] ? `<div style="margin-top:8px;">${linkedParent(t) ? `<p class="tiny" style="margin:0 0 6px;">По обоим этапам вместе.</p>` : ""}${factsListHtml(gameFacts(games, ed))}</div>` : ""}
      </div>`;
    }).join("");
    return leagueFactsHtml()
      + `<div class="card"><h3>За всю историю</h3><p class="tiny" style="margin:4px 0 6px;">Все игры лиги. Если рекорд повторили — показаны все.</p>${factsListHtml(allTime)}</div>`
      + `<div class="card"><h3>Рекорды лиги</h3><div class="badge-list">${records.map(r => badgeRow({icon:r.icon, name:r.name, desc:"", holders:r.list})).join("")}</div></div>`
      + `<div class="section-head" style="margin-top:6px;"><h2 style="font-size:17px;">По турнирам</h2></div>${perT}`;
  }
  function statMoney() {
    const rows = state.players.filter(p => p.active).map(p => ({ p, f: playerFinance(p.id) })).filter(r => r.f.tournaments>0)
      .sort((a,b) => b.f.total - a.f.total);
    const any = rows.some(r => r.f.courts || r.f.fees || r.f.won);
    if (!any) return `<div class="empty"><div class="ic">&#128176;</div>${canWrite ? "Финансы ещё не заполнены — откройте турнир и укажите оплату за корты и призовой фонд" : "Финансы ещё не заполнены"}</div>`;
    const sign = v => `<strong style="color:${v>0?'var(--court)':v<0?'var(--danger)':'inherit'}">${v>0?"+":""}${fmtMoney(v)}</strong>`;
    const tot = rows.reduce((a,r) => ({ courts: a.courts+r.f.courts, fees: a.fees+r.f.fees, won: a.won+r.f.won }), {courts:0,fees:0,won:0});
    return `<div class="card">
      <p class="tiny" style="margin:0 0 8px;">Итог = призы − взносы − корты. По призовому = призы − взносы.</p>
      <table class="tbl">
        <tr><th>Игрок</th><th>Корты</th><th>Взносы</th><th>Призы</th><th>По призовому</th><th>Итог</th></tr>
        ${rows.map(r => `<tr><td>${esc(r.p.name)}</td><td>${fmtMoney(r.f.courts)}</td><td>${fmtMoney(r.f.fees)}</td><td>${fmtMoney(r.f.won)}</td><td>${sign(r.f.net)}</td><td>${sign(r.f.total)}</td></tr>`).join("")}
        <tr><td><strong>Всего</strong></td><td><strong>${fmtMoney(tot.courts)}</strong></td><td><strong>${fmtMoney(tot.fees)}</strong></td><td><strong>${fmtMoney(tot.won)}</strong></td><td></td><td></td></tr>
      </table>
    </div>
    <div class="card"><h3>По турнирам</h3><div class="stack" style="margin-top:8px;">${allEvents().map(t => {
      const m = moneyOf(t), n = tournamentParticipants(t).length, pp = prizePayouts(t);
      return `<div class="row" style="align-items:flex-start;"><div><strong>${esc(t.name)}</strong><div class="tiny">${m.court ? "корты "+fmtMoney(m.court)+" × "+n : "корты не указаны"} · ${m.prize.enabled && m.prize.fee ? "фонд "+fmtMoney(pp.pool) : "без фонда"}</div>
        ${pp.payouts.map(p => `<div class="tiny">${p.place===p.to ? p.place : p.place+"–"+p.to} место: ${p.ids.map(id=>esc(playerName(id))).join(", ")} — ${fmtMoney(p.each)}</div>`).join("")}</div></div>`;
    }).join("")}</div></div>`;
  }
  function statDynamics() {
    const ts = leagueTournaments().filter(t => tournamentTable(t.id).order.length);
    if (ts.length < 2) return `<div class="empty">Нужно минимум 2 турнира</div>`;
    const places = {}; // pid -> [{ti, place, n}]
    ts.forEach((t, ti) => { const r = rankedForPrizes(t); r.forEach(x => { (places[x.id] = places[x.id]||[]).push({ ti, place: x.place, n: x.n }); }); });
    const played = state.players.filter(p => places[p.id]);
    const sel = state.view.dynSel.length ? state.view.dynSel : played.filter(p=>p.active).slice(0,4).map(p=>p.id);
    const chips = played.map(p => `<span class="chip ${sel.includes(p.id)?'active':''}" data-act="toggle-dyn" data-id="${p.id}" style="font-size:12.5px;padding:5px 10px;">${esc(p.name)}</span>`).join("");
    const colors = ["#FF7A1A","var(--ink)","#FF5C5C","#8E8A84","#FFB05C","#3BB2A0","#C96BFF","#5CA8FF"];
    const maxN = Math.max(...ts.map(t => (rankedForPrizes(t)[0]||{n:1}).n));
    const W=340, H=180, padL=26, padR=14, padT=12, padB=24;
    const x = ti => padL + (W-padL-padR) * (ts.length===1 ? 0.5 : ti/(ts.length-1));
    const y = pl => padT + (H-padT-padB) * (pl-1)/Math.max(1, maxN-1);
    const grid = Array.from({length:maxN}, (_,i)=>i+1).map(pl => `<line x1="${padL}" y1="${y(pl)}" x2="${W-padR}" y2="${y(pl)}" stroke="var(--line)" stroke-width="0.6"/><text x="${padL-6}" y="${y(pl)+3.5}" font-size="9" text-anchor="end" fill="var(--ink-3)">${pl}</text>`).join("");
    const xl = ts.map((t,ti) => `<text x="${x(ti)}" y="${H-8}" font-size="9" text-anchor="middle" fill="var(--ink-3)">Т${ti+1}</text>`).join("");
    const lines = sel.map((id,ci) => {
      const pts = (places[id]||[]).map(h => `${x(h.ti)},${y(h.place)}`).join(" ");
      const dots = (places[id]||[]).map(h => `<circle cx="${x(h.ti)}" cy="${y(h.place)}" r="3" fill="${colors[ci%colors.length]}"/>`).join("");
      return `<polyline points="${pts}" fill="none" stroke="${colors[ci%colors.length]}" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
    }).join("");
    const legend = sel.map((id,ci)=>`<span class="tiny" style="display:inline-flex;align-items:center;gap:5px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:3px;background:${colors[ci%colors.length]};display:inline-block;"></span>${esc(playerName(id))}</span>`).join("");
    const rows = played.map(p => `<tr><td>${esc(p.name)}</td>${ts.map((t,ti) => { const h = (places[p.id]||[]).find(z=>z.ti===ti); return `<td>${h ? (h.place===1?"🥇 ":h.place===2?"🥈 ":h.place===3?"🥉 ":"") + h.place + "<span class='tiny'>/"+h.n+"</span>" : "—"}</td>`; }).join("")}</tr>`).join("");
    return `
      <div class="card"><p class="tiny" style="margin:0 0 8px;">Место в каждом турнире</p><table class="tbl"><tr><th>Игрок</th>${ts.map((t,ti)=>`<th title="${esc(t.name)}">Т${ti+1}</th>`).join("")}</tr>${rows}</table></div>
      <p class="tiny">${ts.map((t,ti)=>`Т${ti+1} — ${esc(t.name)}`).join(" · ")}</p>`;
  }
  function statLog() {
    const items = state.log.slice().reverse().slice(0, 150);
    if (!items.length) return `<div class="empty"><div class="ic">&#128221;</div>Пока пусто — здесь будет история правок</div>`;
    const ids = Array.from(new Set(items.map(i => i.who).filter(Boolean))).filter(id => !(id in profileCache));
    if (ids.length && userCap && userCap.profiles) {
      ids.forEach(id => profileCache[id] = "");
      userCap.profiles(ids).then(ps => { let ch=false; ids.forEach(id => { const n = ps && ps[id] && ps[id].name; if (n) { profileCache[id] = n; ch=true; } }); if (ch && state.view.stat==="log") render(); }).catch(()=>{});
    }
    const who = i => i.who ? (profileCache[i.who] || "редактор") : "редактор";
    const fmt = t => { const d = new Date(t); return d.toLocaleDateString("ru-RU", {day:"numeric", month:"short"}) + " " + d.toLocaleTimeString("ru-RU", {hour:"2-digit", minute:"2-digit"}); };
    return `<div class="card"><p class="tiny" style="margin:0 0 8px;">Последние ${items.length} изменений</p>
      ${items.map(i => `<div class="log-row"><span class="tiny">${fmt(i.t)} · ${esc(who(i))}</span><div>${esc(i.a)}</div></div>`).join("")}
    </div>`;
  }
  function copyText(text) {
    const done = () => toast("Скопировано — вставьте в чат");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); done(); } catch(e) { toast("Не удалось скопировать"); }
    document.body.removeChild(ta);
  }
  function statH2H() {
    const act = state.players.filter(p => p.active), ids = act.map(p => p.id);
    if (!state.view.h2h[0] || !ids.includes(state.view.h2h[0])) state.view.h2h[0] = ids[0] || null;
    if (!state.view.h2h[1] || !ids.includes(state.view.h2h[1]) || state.view.h2h[1] === state.view.h2h[0]) state.view.h2h[1] = ids.find(id => id !== state.view.h2h[0]) || null;
    const [a,b] = state.view.h2h;
    const options = pid0 => act.map(p=>`<option value="${p.id}" ${p.id===pid0?'selected':''}>${esc(p.name)}</option>`).join("");
    let body = "";
    if (a && b && a!==b) {
      const { asOpp, asPartners } = headToHead(a,b);
      const open = state.view.h2hOpen || (state.view.h2hOpen = { opp:false, partner:false });
      const tname = g => { const t = byId(state.tournaments, g.tournamentId); return (t ? t.name : "") + " · раунд " + g.round; };
      const sideOf = (g, pid) => g.teamA.includes(pid) ? "A" : "B";
      const summary = (games, pid) => {
        let w=0, l=0, pf=0, pa=0;
        games.forEach(g => {
          const own = sideOf(g,pid)==="A" ? g.scoreA : g.scoreB, opp = sideOf(g,pid)==="A" ? g.scoreB : g.scoreA;
          pf+=own; pa+=opp;
          if (g.decided!==false) { if (own>opp) w++; else if (opp>own) l++; }
        });
        return { w, l, d: games.length-w-l, diff: pf-pa, pf, pa };
      };
      const gameRow = (g, pid) => {
        const s = sideOf(g,pid);
        const own = s==="A" ? g.teamA : g.teamB, opp = s==="A" ? g.teamB : g.teamA;
        const so = s==="A" ? g.scoreA : g.scoreB, sp = s==="A" ? g.scoreB : g.scoreA;
        const won = g.decided!==false && so>sp, lost = g.decided!==false && sp>so;
        return `<div class="h2h-game">
          <div class="tiny">${esc(tname(g))}${g.decided===false ? " · не доиграна" : ""}</div>
          <div class="mrow">
            <div class="pair ${won?'winner':''}">${esc(playerName(own[0]))}<small>${esc(playerName(own[1]))}</small></div>
            <div class="sc">${so} : ${sp}</div>
            <div class="pair right ${lost?'winner':''}">${esc(playerName(opp[0]))}<small>${esc(playerName(opp[1]))}</small></div>
          </div>
        </div>`;
      };
      const sOpp = summary(asOpp, a), sPar = summary(asPartners, a);
      const stat = (label, val) => `<div class="h2h-stat"><span class="tiny">${label}</span><strong>${val}</strong></div>`;
      const block = (title, games, s, key, btnLabel) => `
        <div class="card">
          <h3>${title}</h3>
          <div class="h2h-stats">
            ${stat("Игр", games.length)}
            ${stat("W-D-L", s.w + "-" + s.d + "-" + s.l)}
            ${stat("Очки", s.pf + " : " + s.pa)}
            ${stat("Разница", (s.diff>=0?"+":"") + s.diff)}
          </div>
          ${games.length ? `<button class="btn ghost sm" data-act="h2h-toggle" data-key="${key}" style="margin-top:6px;">${open[key] ? "Скрыть" : btnLabel} ${open[key] ? "▴" : "▾"}</button>` : ""}
          ${open[key] ? `<div style="margin-top:8px;">${orderedGamesOf(games).map(g => gameRow(g, a)).join("")}</div>` : ""}
        </div>`;
      body = block("Как соперники", asOpp, sOpp, "opp", "История соперничества")
           + block("Как партнёры", asPartners, sPar, "partner", "История союзничества");
      body += `<p class="tiny" style="margin-top:4px;">W-D-L и разница — с точки зрения ${esc(playerName(a))}</p>`;
    } else {
      body = `<div class="empty"><div class="ic">&#129309;</div>выберите двух разных игроков</div>`;
    }
    return `
      <div class="row" style="gap:10px;">
        <select id="h2hA">${options(a)}</select>
        <span class="muted">vs</span>
        <select id="h2hB">${options(b)}</select>
      </div>
      <div style="margin-top:12px;">${body}</div>`;
  }
  function orderedGamesOf(games) {
    const order = orderedGames().map(g => g.id);
    return games.slice().sort((x,y) => order.indexOf(x.id) - order.indexOf(y.id));
  }
  function sumGames(games, pid) {
    let pf=0, pa=0;
    games.forEach(g => {
      const inA = g.teamA.includes(pid);
      pf += inA? g.scoreA : g.scoreB; pa += inA? g.scoreB : g.scoreA;
    });
    return {pf,pa};
  }

  function statPairs() {
    const pairs = computeAllPairs().filter(p => p.ids.every(isActive));
    if (!pairs.length) return `<div class="empty">нет данных</div>`;
    const sort = state.view.pairSort || (state.view.pairSort = { key: "net", dir: -1 });
    const val = (s, key) => key==="g" ? s.g : key==="wl" ? (s.w - s.l) * 1000 + s.w : key==="net" ? (s.pf-s.pa)/s.g
      : (playerName(s.ids[0]) + " " + playerName(s.ids[1]));
    const sorted = pairs.slice().sort((a,b) => {
      const va = val(a, sort.key), vb = val(b, sort.key);
      if (typeof va === "string") return va.localeCompare(vb, "ru") * sort.dir;
      if (va !== vb) return (va - vb) * sort.dir;
      return b.g - a.g;
    });
    const th = (key, label) => `<th class="sortable ${sort.key===key?'on':''}" data-act="pair-sort" data-key="${key}">${label}<span class="arr">${sort.key===key ? (sort.dir<0?"▼":"▲") : "⇅"}</span></th>`;
    return `<div class="card">
      <p class="tiny" style="margin:0 0 8px;">Нажмите на заголовок, чтобы отсортировать; ещё раз — в обратном порядке</p>
      <table class="tbl">
      <tr>${th("pair","Пара")}${th("g","Игр")}${th("wl","W-D-L")}${th("net","Net/игру")}</tr>
      ${sorted.map(s => `<tr>
        <td>${esc(playerName(s.ids[0]))} + ${esc(playerName(s.ids[1]))}</td>
        <td>${s.g}</td><td>${s.w}-${s.g-s.w-s.l}-${s.l}</td>
        <td><strong>${((s.pf-s.pa)/s.g)>=0?"+":""}${((s.pf-s.pa)/s.g).toFixed(1)}</strong></td>
      </tr>`).join("")}
    </table></div>`;
  }

  function statHeatmap() {
    const ps = state.players.filter(p => state.games.some(g => g.teamA.includes(p.id)||g.teamB.includes(p.id)));
    if (ps.length < 2) return `<div class="empty">мало данных</div>`;
    const cell = (rowId, colId) => {
      if (rowId===colId) return `<td class="self">—</td>`;
      const { asOpp } = headToHead(rowId, colId);
      if (!asOpp.length) return `<td style="color:var(--ink-3);">·</td>`;
      let w=0,total=0;
      asOpp.forEach(g => { const inA=g.teamA.includes(rowId); const own=inA?g.scoreA:g.scoreB, opp=inA?g.scoreB:g.scoreA; if (own>opp) w++; total++; });
      const pct = Math.round(w/total*100);
      const col = heatColor(pct);
      return `<td style="background:${col.bg};color:${col.fg};" title="${pct}%">${pct}</td>`;
    };
    return `<div style="overflow-x:auto;"><table class="hm-table">
      <tr><th></th>${ps.map(p=>`<th>${esc(p.name)}</th>`).join("")}</tr>
      ${ps.map(rp => `<tr><th class="rowlbl">${esc(rp.name)}</th>${ps.map(cp=>cell(rp.id,cp.id)).join("")}</tr>`).join("")}
    </table></div>
    <p class="tiny" style="margin-top:10px;">% побед игрока из строки против игрока из столбца (как соперники).</p>`;
  }
  function heatColor(pct) {
    // 0% -> court blue, 50% -> neutral surface, 100% -> ball lime
    const t = pct/100;
    function mix(c1,c2,f){ return c1.map((v,i)=>Math.round(v+(c2[i]-v)*f)); }
    const blue=[40,40,46], neutral=[110,106,100], lime=[255,122,26];
    let rgb = t<0.5 ? mix(blue,neutral,t/0.5) : mix(neutral,lime,(t-0.5)/0.5);
    const fg = pct>=70 ? "#0A0A0B" : "#F4F1EC";
    return { bg: `rgb(${rgb.join(",")})`, fg };
  }

  function statForm() {
    const { history } = computeElo();
    const sel = state.view.formSel.length? state.view.formSel : state.players.filter(p=>p.active).slice(0,3).map(p=>p.id);
    const chips = state.players.map(p => `<span class="chip ${sel.includes(p.id)?'active':''}" data-act="toggle-form" data-id="${p.id}" style="font-size:12.5px;padding:5px 10px;">${esc(p.name)}</span>`).join("");
    const colors = ["#FF7A1A","var(--ink)","#FF5C5C","#8E8A84","#FFB05C","#3BB2A0","#C96BFF","#5CA8FF"];
    const maxI = Math.max(1, ...sel.map(id => (history[id]||[]).length-1));
    const allR = sel.flatMap(id => (history[id]||[]).map(h=>h.r));
    const minR = Math.min(1300, ...allR), maxR = Math.max(1700, ...allR);
    const W=340,H=160,pad=8;
    const x = i => pad + (W-2*pad)*i/maxI;
    const y = r => H-pad - (H-2*pad)*(r-minR)/(maxR-minR||1);
    const lines = sel.map((id,ci) => {
      const pts = (history[id]||[]).map(h => `${x(h.i)},${y(h.r)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${colors[ci%colors.length]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join("");
    const legend = sel.map((id,ci)=>`<span class="tiny" style="display:inline-flex;align-items:center;gap:5px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:3px;background:${colors[ci%colors.length]};display:inline-block;"></span>${esc(playerName(id))}</span>`).join("");
    return `
      <div class="wrap-tags" style="margin-bottom:10px;">${chips}</div>
      <div class="card">
        <svg class="formchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}</svg>
        <div style="margin-top:8px;">${legend}</div>
      </div>`;
  }

  // ---------------- event handling ----------------
  function attachHandlers() {
    document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => { state.tab=b.dataset.tab; state.view.create=false; state.view.tournament=null; if (b.dataset.tab === "profile") { state.view.profilePid = null; state.view.profileEdit = false; state._pf = null; } render(); });

    const v = document.getElementById("view");
    v.querySelectorAll("[data-act]").forEach(el => {
      const act = el.dataset.act;
      if (act==="toggle-player") el.onclick = () => togglePlayer(el.dataset.id);
      else if (act==="add-player") el.onclick = addPlayer;
      else if (act==="set-role") el.onchange = () => setMemberRole(el.dataset.id, el.value);
      else if (act==="remove-member") el.onclick = () => removeMember(el.dataset.id);
      else if (act==="toggle-badges") el.onclick = () => { state.view.badgesOpen = state.view.badgesOpen === el.dataset.id ? null : el.dataset.id; render(); };
      else if (act==="open-profile") el.onclick = (ev) => { ev.stopPropagation(); openProfile(el.dataset.id); };
      else if (act==="profile-back") el.onclick = () => { const back = state.view.profileBack || "players"; state.view.profilePid = null; state.view.profileEdit = false; state._pf = null; state.tab = back === "profile" ? "players" : back; render(); };
      else if (act==="profile-edit") el.onclick = () => { if (!canEditProfile(el.dataset.id)) return; state.view.profileEdit = true; state._pf = null; render(); const i = document.getElementById("pfName"); if (i) i.focus(); };
      else if (act==="pf-cancel") el.onclick = () => { state.view.profileEdit = false; state._pf = null; render(); };
      else if (act==="pf-save") el.onclick = () => saveProfileEdit(el.dataset.id);
      else if (act==="pf-photo") el.onclick = () => { const f = document.getElementById("pfPhoto"); if (f) f.click(); };
      else if (act==="pf-photo-clear") el.onclick = () => { const n = document.getElementById("pfName"); if (state._pf && n) state._pf.name = n.value; (state._pf || (state._pf = {})).avatar = null; render(); };
      else if (act==="claim-player") el.onclick = async () => { try { await db.claimPlayer(el.dataset.id || null); BOOT.user.playerId = el.dataset.id || null; const d = await db.loadAll(); state.players = d.players; toast(el.dataset.id ? "Профиль привязан" : "Привязка снята"); render(); } catch(e) { toast(/claimed/.test(String(e.message)) ? "Этот игрок уже занят" : "Не удалось: " + e.message); } };
      else if (act==="save-name") el.onclick = async () => { const v = (document.getElementById("dispName")||{}).value; const name = (v||"").trim(); if (!name) return; try { await db.setDisplayName(name); BOOT.user.name = name; profileCache[BOOT.user.id] = name; const w = document.getElementById("whoami"); if (w) w.textContent = name; toast("Имя сохранено"); } catch(e) { toast("Не удалось сохранить имя"); } };
      else if (act==="open-tournament-tab") el.onclick = () => { state.tab = "tournaments"; state.view.tournament = el.dataset.id; state.view.create = false; render(); };
      else if (act==="rename-player") el.onclick = () => { state.view.renamePlayer = el.dataset.id; render(); const i = document.getElementById("renameInput"); if (i) { i.focus(); i.select(); } };
      else if (act==="rename-cancel") el.onclick = () => { state.view.renamePlayer = null; render(); };
      else if (act==="rename-save") el.onclick = () => renamePlayer(el.dataset.id);
      else if (act==="del-booking") el.onclick = () => delBooking(el.dataset.id);
      else if (act==="edit-booking") el.onclick = () => startEditBooking(el.dataset.id);
      else if (act==="cancel-edit-booking") el.onclick = () => { resetBookingForm(); render(); };
      else if (act==="add-booking") el.onclick = addBooking;
      else if (act==="pt-toggle") el.onclick = () => { state.view.ptOpen = state.view.ptOpen === el.dataset.id ? null : el.dataset.id; render(); };
      else if (act==="hist-toggle") el.onclick = () => { state.view.histOpen = state.view.histOpen === el.dataset.id ? null : el.dataset.id; state.view.histN = 10; render(); };
      else if (act==="hist-more") el.onclick = () => { state.view.histN = (state.view.histN || 10) + 10; render(); };
      else if (act==="bk-mode") el.onclick = () => { const m = el.dataset.val; const cur = state.view.bkMode || "ours"; if (cur === m) return; state.view.bkMode = m; if (m !== "ours" && !courts().state.opened) courts().open(); else render(); };
      else if (act==="new-tournament") el.onclick = () => { state.view.create="choose"; state._createDraft=null; state._fDraft=null; render(); };
      else if (act==="create-kind") el.onclick = () => { state.view.create = el.dataset.val === "friendly" ? "friendly" : true; render(); window.scrollTo(0,0); };
      else if (act==="f-player") el.onclick = () => { fRead(); const d = fDraft(), id = el.dataset.id; if (d.players.includes(id)) d.players = d.players.filter(x => x !== id); else if (d.players.length < 4) d.players.push(id); else { toast("Максимум 4 игрока"); return; } d.pairing = null; render(); };
      else if (act==="f-pair") el.onclick = () => { fRead(); fDraft().pairing = +el.dataset.val; render(); };
      else if (act==="f-mode") el.onclick = () => { fRead(); const d = fDraft(); d.mode = el.dataset.val; if (d.mode==="race" && !d.target) d.target = 21; if (d.mode==="fixed" && !d.target) d.target = 24; render(); };
      else if (act==="f-sets") el.onclick = () => { fRead(); fDraft().sets = +el.dataset.val; render(); };
      else if (act==="f-games") el.onclick = () => { fRead(); fDraft().setGames = +el.dataset.val; render(); };
      else if (act==="f-prize") el.onclick = () => { fRead(); fDraft().prizeEnabled = el.dataset.val === "1"; render(); };
      else if (act==="f-create") el.onclick = createFriendly;
      else if (act==="cancel-create") el.onclick = () => { state.view.create=false; render(); };
      else if (act==="toggle-rounds") el.onclick = () => { state.view.roundsOpen = state.view.roundsOpen === el.dataset.id ? null : el.dataset.id; render(); };
      else if (act==="open-tournament") el.onclick = () => { state.view.tournament = el.dataset.id; state.view.liveRound = null; state.view.lastScoredGid = null; render(); };
      else if (act==="close-tournament") el.onclick = () => { state.view.tournament = null; render(); };
      else if (act==="delete-ask") el.onclick = () => { state.view.confirmDelete = el.dataset.id; render(); };
      else if (act==="delete-cancel") el.onclick = () => { state.view.confirmDelete = null; render(); };
      else if (act==="delete-confirm") el.onclick = () => deleteTournament(el.dataset.id);
      else if (act==="add-round") el.onclick = () => addRound(el.dataset.id);
      else if (act==="remove-round") el.onclick = () => removeLastRound(el.dataset.id);
      else if (act==="swiss-next-round") el.onclick = () => swissNextRound(el.dataset.id);
      else if (act==="edit-tournament") el.onclick = () => { state.view.editT = state.view.editT === el.dataset.id ? null : el.dataset.id; state._editT = null; render(); };
      else if (act==="edit-tournament-save") el.onclick = () => saveTournamentEdit(el.dataset.id);
      else if (act==="elo-detail") el.onclick = () => { state.view.eloDetail = state.view.eloDetail === el.dataset.id ? null : el.dataset.id; if (state.view.eloDetail) state.view.tFacts = null; render(); };
      else if (act==="hall-toggle") el.onclick = () => { const o = state.view.hallOpen || (state.view.hallOpen = {}); o[el.dataset.id] = !o[el.dataset.id]; render(); };
      else if (act==="t-facts") el.onclick = () => { state.view.tFacts = state.view.tFacts === el.dataset.id ? null : el.dataset.id; if (state.view.tFacts) state.view.eloDetail = null; render(); };
      else if (act==="toggle-participant") el.onclick = () => toggleParticipant(el.dataset.id);
      else if (act==="add-team") el.onclick = addTeam;
      else if (act==="remove-team") el.onclick = () => removeTeam(+el.dataset.idx);
      else if (act==="balance-teams") el.onclick = balanceTeams;
      else if (act==="edit-game") el.onclick = () => { state.view.editGame = el.dataset.gid; render(); };
      else if (act==="edit-game-cancel") el.onclick = () => { state.view.editGame = null; render(); };
      else if (act==="edit-game-save") el.onclick = () => saveGameTeams(el.dataset.gid);
      else if (act==="generate-tournament") el.onclick = generateTournament;
      else if (act==="stat-tab") el.onclick = () => { state.view.stat = el.dataset.val; render(); };
      else if (act==="copy-text") el.onclick = () => copyText(el.dataset.text);
      else if (act==="copy-summary") el.onclick = () => { const t = byId(state.tournaments, el.dataset.id); if (t) copyText(tournamentSummaryText(t)); };
      else if (act==="table-png") el.onclick = () => { const t = byId(state.tournaments, el.dataset.id); if (t) tablePng(t); };
      else if (act==="next-quote") el.onclick = () => { state.view.quoteShift = (state.view.quoteShift||0)+1; render(); };
      else if (act==="h2h-toggle") el.onclick = () => { const o = state.view.h2hOpen || (state.view.h2hOpen = {}); o[el.dataset.key] = !o[el.dataset.key]; render(); };
      else if (act==="lb-sort") el.onclick = () => {
        const s = state.view.lbSort || (state.view.lbSort = { key: "elo", dir: -1 });
        if (s.key === el.dataset.key) s.dir = -s.dir; else { s.key = el.dataset.key; s.dir = el.dataset.key === "name" ? 1 : -1; }
        render();
      };
      else if (act==="pair-sort") el.onclick = () => {
        const s = state.view.pairSort || (state.view.pairSort = { key: "net", dir: -1 });
        if (s.key === el.dataset.key) s.dir = -s.dir; else { s.key = el.dataset.key; s.dir = el.dataset.key === "pair" ? 1 : -1; }
        render();
      };
      else if (act==="toggle-form") el.onclick = () => { toggleInArr(state.view.formSel, el.dataset.id); render(); };
      else if (act==="toggle-dyn") el.onclick = () => { toggleInArr(state.view.dynSel, el.dataset.id); render(); };
      else if (act==="live-tab") el.onclick = () => { state.view.liveTab = el.dataset.val; render(); };
      else if (act==="live-round") el.onclick = () => { state.view.liveRound = { tid: el.dataset.id, key: el.dataset.val, n: +el.dataset.n }; state.view.lastScoredGid = null; render();
        if (el.tagName === "BUTTON") { const c = document.querySelector(".rnd-chips"); if (c) c.scrollIntoView({ block: "start", behavior: "smooth" }); } };
      else if (act==="score") {
        const other = () => el.closest(".match")?.querySelector(`input[data-act="score"][data-side="${el.dataset.side === "A" ? "B" : "A"}"]`);
        el.onchange = () => { saveScore(el.dataset.gid, el.dataset.side, el.value); const o = other(); if (o && o.dataset.auto) saveScore(el.dataset.gid, o.dataset.side, o.value); };
        el.oninput = () => { const ok = el.closest(".match")?.querySelector(".sc-ok"); if (ok) { ok.classList.add("dirty"); ok.classList.remove("saved"); }
          // «всего X очков/геймов»: второе число считается само (пока его не трогали руками)
          delete el.dataset.auto; const g = state.games.find(x => x.id === el.dataset.gid), t = g && byId(state.tournaments, g.tournamentId), o = other();
          if (!t || !o || t.scoringMode !== "fixed" || t.scoringType === "time" || !(+t.scoringTarget > 0) || el.value === "") return;
          if (o.value === "" || o.dataset.auto) { const val = +t.scoringTarget - parseInt(el.value, 10); if (val >= 0 && val <= 99) { o.value = val; o.dataset.auto = "1"; } } };
        // Enter / «Готово» — к следующему пустому полю, иначе закрыть клавиатуру
        el.onkeydown = e => { if (e.key !== "Enter") return; e.preventDefault(); const all = [...document.querySelectorAll('input[data-act="score"]')], i = all.indexOf(el);
          const nx = all.slice(i + 1).find(x => x.value === ""); if (nx) nx.focus(); else el.blur(); };
      }
      else if (act==="score-ok") {
        // нажатие не отнимает фокус до сохранения: сначала читаем обе цифры, сохраняем, потом закрываем клавиатуру
        el.onpointerdown = e => e.preventDefault();
        el.onclick = () => saveMatchScores(el.dataset.gid, true);
      }
    });

    const fmt = document.getElementById("tFormat");
    if (fmt) fmt.querySelectorAll(".chip[data-val]").forEach(b => b.onclick = (ev) => {
      if (ev.target.closest(".fmt-info")) return;
      const d = getDraft(); d.format = b.dataset.val; d.teams=[];
      if (d.format==="swiss" && !d.scoringType) { d.scoringType="points"; d.scoringMode="race"; d.scoringTarget=21; } // по умолчанию матч до 21 очка
      if (d.format==="two" && !d.scoringType) { d.scoringType="points"; d.scoringMode="fixed"; d.scoringTarget=16; } // два этапа за вечер — «всего 16»
      render();
    });
    const tLinked = document.getElementById("tLinked");
    if (tLinked) tLinked.onchange = () => {
      const d = getDraft(); d.linkedTo = tLinked.value || null;
      const src = d.linkedTo ? byId(state.tournaments, d.linkedTo) : null;
      if (src) {
        d.participants = (src.participantIds||[]).slice(); d.teams = [];
        const tgt = src.scoringTarget || src.target; if (tgt && src.scoringType!=="time") { d.scoringType = src.scoringType || "points"; d.scoringMode = src.scoringMode || "race"; d.scoringTarget = tgt; }
        if (!d.name || /^Турнир \d+$/.test(d.name)) d.name = src.name.replace(/\s*\(.*$/, "") + " · этап 2";
      }
      render();
    };
    const swCap = document.getElementById("swissCap");
    if (swCap) swCap.querySelectorAll("button").forEach(b => b.onclick = () => { getDraft().swissCap = +b.dataset.val; render(); });
    v.querySelectorAll('[data-act="format-info"]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); state.view.formatInfo = (b.dataset.val && state.view.formatInfo !== b.dataset.val) ? b.dataset.val : null; render(); });
    v.querySelectorAll('[data-act="set-scoring-type"]').forEach(b => b.onclick = () => { const d=getDraft(); d.scoringType=b.dataset.val; d.scoringMode=null; d.scoringTarget=""; render(); });
    const smode = document.getElementById("scoringMode");
    if (smode) smode.querySelectorAll("button").forEach(b => b.onclick = () => { getDraft().scoringMode=b.dataset.val; render(); });
    const btype = document.getElementById("bkType");
    if (btype) btype.querySelectorAll("button").forEach(b => { b.classList.toggle("active", state._bkType===b.dataset.val); b.onclick = () => { state._bkType=b.dataset.val; render(); }; });
    const bkDate = document.getElementById("bkDate"); if (bkDate) bkDate.oninput = () => { state._bkDate = bkDate.value; };
    const bkTime = document.getElementById("bkTime"); if (bkTime) bkTime.oninput = () => { state._bkTime = bkTime.value; };
    const bkTimeEnd = document.getElementById("bkTimeEnd"); if (bkTimeEnd) bkTimeEnd.oninput = () => { state._bkTimeEnd = bkTimeEnd.value; };
    const bkCourt = document.getElementById("bkCourt"); if (bkCourt) bkCourt.oninput = () => { state._bkCourt = bkCourt.value; };
    const bkClub = document.getElementById("bkClub");
    if (bkClub) bkClub.onchange = () => { state._bkClubSel = bkClub.value; state._bkClubOther = bkClub.value === "__new__"; render(); };
    const bkClubOther = document.getElementById("bkClubOther");
    if (bkClubOther) bkClubOther.oninput = () => { state._bkClubOtherVal = bkClubOther.value; };

    const cCourt = document.getElementById("cCourt"); if (cCourt) cCourt.oninput = () => { getDraft().court = cCourt.value; };
    const cFee = document.getElementById("cFee"); if (cFee) { cFee.onchange = () => { const d=getDraft(); d.fee = cFee.value; d.amountsTouched = false; render(); }; cFee.oninput = () => { getDraft().fee = cFee.value; }; }
    const cPrize = document.getElementById("cPrize"); if (cPrize) cPrize.querySelectorAll("button").forEach(b => b.onclick = () => { getDraft().prizeEnabled = b.dataset.val==="1"; render(); });
    const cPlaces = document.getElementById("cPlaces"); if (cPlaces) cPlaces.querySelectorAll("button").forEach(b => b.onclick = () => { const d=getDraft(); d.places = +b.dataset.val; d.amountsTouched = false; render(); });
    v.querySelectorAll('[data-camt]').forEach(el => el.onchange = () => { const d=getDraft(); d.amounts = (d.amounts||[]).slice(); d.amounts[+el.dataset.camt] = el.value===""?0:Math.max(0,+el.value); d.amountsTouched = true; render(); });
    const tName = document.getElementById("tName"); if (tName) tName.oninput = () => { getDraft().name = tName.value; refreshGenerateBtn(); };
    const tDate = document.getElementById("tDate"); if (tDate) tDate.oninput = () => { getDraft().date = tDate.value; refreshGenerateBtn(); };
    const tCourts = document.getElementById("tCourts"); if (tCourts) tCourts.oninput = () => { getDraft().courts = +tCourts.value; };
    const tRounds = document.getElementById("tRounds"); if (tRounds) tRounds.oninput = () => { getDraft().rounds = +tRounds.value; };
    const tRounds1 = document.getElementById("tRounds1"); if (tRounds1) tRounds1.oninput = () => { getDraft().rounds1 = +tRounds1.value; };
    const sTarget = document.getElementById("scoringTarget"); if (sTarget) sTarget.oninput = () => { getDraft().scoringTarget = sTarget.value; refreshGenerateBtn(); };
    const sMin = document.getElementById("scoringMinutes"); if (sMin) sMin.oninput = () => { getDraft().scoringMinutes = +sMin.value; refreshGenerateBtn(); };

    const pfPhoto = document.getElementById("pfPhoto");
    if (pfPhoto) pfPhoto.onchange = async () => { const f = pfPhoto.files && pfPhoto.files[0]; if (!f) return; try { const n = document.getElementById("pfName"); if (state._pf && n) state._pf.name = n.value; (state._pf || (state._pf = {})).avatar = await readAvatarFile(f); render(); } catch(e) { toast("Не удалось прочитать фото"); } };
    const h2hA = document.getElementById("h2hA"); if (h2hA) h2hA.onchange = () => { state.view.h2h[0]=h2hA.value; render(); };
    const h2hB = document.getElementById("h2hB"); if (h2hB) h2hB.onchange = () => { state.view.h2h[1]=h2hB.value; render(); };
    const et = state._editT;
    if (et && state.view.editT === et.id) {
      const keep = () => { const n = document.getElementById("etName"), d = document.getElementById("etDate"), tg = document.getElementById("etTarget"), mn = document.getElementById("etMinutes"), r = document.getElementById("etRounds"); if (n) et.name = n.value; if (d) et.date = d.value; if (tg) et.scoringTarget = tg.value; if (mn) et.scoringMinutes = +mn.value; if (r) et.rounds = r.value; };
      const etType = document.getElementById("etType"); if (etType) etType.querySelectorAll("button").forEach(b => b.onclick = () => { keep(); et.scoringType = b.dataset.val; if (et.scoringMode === "tennis" && et.scoringType !== "games") et.scoringMode = "race"; render(); });
      const etMode = document.getElementById("etMode"); if (etMode) etMode.querySelectorAll("button").forEach(b => b.onclick = () => { keep(); et.scoringMode = b.dataset.val; render(); });
      const etCap = document.getElementById("etCap"); if (etCap) etCap.querySelectorAll("button").forEach(b => b.onclick = () => { keep(); et.swissCap = +b.dataset.val; render(); });
    }
    const finT = state.view.tournament ? byId(state.tournaments, state.view.tournament) : null;
    if (finT) {
      v.querySelectorAll('[data-fin="court"]').forEach(el => el.onchange = () => setFinance(finT, { court: el.value==="" ? null : Math.max(0, +el.value) }));
      v.querySelectorAll('[data-fin="fee"]').forEach(el => el.onchange = () => {
        const pr = moneyOf(finT).prize; const oldPool = prizePool(finT); const oldAmts = prizeAmounts(finT);
        pr.fee = el.value==="" ? null : Math.max(0, +el.value);
        const newPool = prizePool(finT);
        // пересчитываем суммы пропорционально новому фонду (или по пресету, если раньше было пусто)
        if (newPool > 0) { if (oldPool > 0 && oldAmts.some(x=>x>0)) { pr.amounts = oldAmts.map(x => Math.round(x * newPool / oldPool / 10) * 10); pr.amounts[0] += newPool - pr.amounts.reduce((a,b)=>a+b,0); } else pr.amounts = defaultAmounts(newPool, pr.places||3); }
        addLog("Финансы «" + finT.name + "»: взнос " + (el.value||"—")); commit(2000); render();
      });
      v.querySelectorAll('[data-fin="amt"]').forEach(el => el.onchange = () => { const pr = moneyOf(finT).prize; pr.amounts = prizeAmounts(finT); pr.amounts[+el.dataset.idx] = el.value==="" ? 0 : Math.max(0, +el.value); addLog("Финансы «" + finT.name + "»: " + (+el.dataset.idx+1) + " место " + (el.value||0) + " " + CUR); commit(2000); render(); });
      const fp = document.getElementById("finPrize"); if (fp) fp.querySelectorAll("button").forEach(b => b.onclick = () => { const pr = moneyOf(finT).prize; pr.enabled = b.dataset.val==="1"; if (pr.enabled && !(pr.amounts||[]).length && prizePool(finT)>0) pr.amounts = defaultAmounts(prizePool(finT), pr.places||3); commit(2000); render(); });
      const fpl = document.getElementById("finPlaces"); if (fpl) fpl.querySelectorAll("button").forEach(b => b.onclick = () => { const pr = moneyOf(finT).prize; pr.places = +b.dataset.val; pr.amounts = defaultAmounts(prizePool(finT), pr.places); commit(2000); render(); });
    }
    const rn = document.getElementById("renameInput");
    if (rn) rn.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); renamePlayer(state.view.renamePlayer); } else if (e.key === "Escape") { state.view.renamePlayer = null; render(); } };
    const saveBtn = document.getElementById("saveNow"); if (saveBtn) saveBtn.onclick = saveNow;
    updateSyncLabel();
  }
  function toggleInArr(arr, id) { const i=arr.indexOf(id); if (i>=0) arr.splice(i,1); else arr.push(id); }
  function getDraft() { return state._createDraft || (state._createDraft = {}); }

  // ---- actions ----
  function togglePlayer(id) {
    const p = byId(state.players, id); if (!p) return;
    p.active = !p.active;
    addLog((p.active ? "Вернул игрока " : "Убрал игрока ") + p.name);
    commit(1500);
    render();
  }
  function renamePlayer(id) {
    const p = byId(state.players, id); const inp = document.getElementById("renameInput"); if (!p || !inp) return;
    const name = inp.value.trim();
    if (!name) { toast("Имя не может быть пустым"); return; }
    if (state.players.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) { toast("Такое имя уже есть"); return; }
    if (name !== p.name) { addLog("Переименовал игрока: " + p.name + " → " + name); p.name = name; commit(1500); toast("Переименовано"); }
    state.view.renamePlayer = null; render();
  }
  function addPlayer() {
    const inp = document.getElementById("newPlayerName");
    const name = inp.value.trim(); if (!name) return;
    const id = uid("p");
    const p = {id, name, active:true};
    state.players.push(p);
    inp.value = "";
    addLog("Добавил игрока " + name);
    commit(1500);
    render();
  }
  function resetBookingForm() {
    state._bkEdit = null; state._bkType = null; state._bkDate = ""; state._bkCourt = ""; state._bkTime = "19:00"; state._bkTimeEnd = "21:00";
    state._bkClubOther = false; state._bkClubOtherVal = ""; state._bkClubSel = "";
  }
  function startEditBooking(id) {
    const b = byId(state.bookings, id); if (!b) return;
    state._bkEdit = id; state._bkDate = b.date || ""; state._bkTime = b.time || "19:00"; state._bkTimeEnd = b.timeEnd || ""; state._bkCourt = b.court != null ? String(b.court) : ""; state._bkType = b.type || null;
    const known = (state.clubs.length ? state.clubs : CLUB_LIST_DEFAULT).includes(b.club);
    state._bkClubSel = known ? b.club : "__new__"; state._bkClubOther = !known; state._bkClubOtherVal = known ? "" : (b.club || "");
    render();
    const f = document.getElementById("bkForm"); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function addBooking() {
    const date = state._bkDate, time = state._bkTime, timeEnd = state._bkTimeEnd;
    const clubSel = document.getElementById("bkClub");
    let club = clubSel.value;
    if (club === "__new__") club = (document.getElementById("bkClubOther")?.value || "").trim();
    const court = String(state._bkCourt||"").trim();
    const type = state._bkType;
    if (!date || !club || !type) { toast("Заполните дату, клуб и вид корта"); return; }
    if (timeEnd && time && timeEnd <= time) { toast("Время «до» должно быть позже «с»"); return; }
    if (state._bkEdit) {
      const b = byId(state.bookings, state._bkEdit);
      if (b) { Object.assign(b, { date, time, timeEnd, club, court, type }); addLog("Изменил бронь: " + club + " " + date + " " + time + (timeEnd ? "–"+timeEnd : "")); toast("Бронь обновлена"); }
    } else {
      const id = uid("bk");
      state.bookings.push({ id, date, time, timeEnd, club, court, type });
      addLog("Добавил бронь: " + club + " " + date + " " + time + (timeEnd ? "–"+timeEnd : ""));
      toast("Бронь добавлена");
    }
    commit(1500);
    resetBookingForm();
    render();
  }
  function delBooking(id) {
    const b = byId(state.bookings, id);
    state.bookings = state.bookings.filter(b=>b.id!==id);
    addLog("Удалил бронь" + (b ? ": " + b.club + " " + b.date : ""));
    commit(1500);
    render();
  }
  function toggleParticipant(id) {
    const d = getDraft();
    toggleInArr(d.participants, id);
    d.teams = d.teams.filter(t => t.players.every(pid => d.participants.includes(pid)));
    render();
  }
  function addTeam() {
    const p1 = document.getElementById("teamP1").value, p2 = document.getElementById("teamP2").value;
    if (!p1 || !p2 || p1===p2) return;
    getDraft().teams.push({players:[p1,p2]});
    render();
  }
  function removeTeam(idx) { getDraft().teams.splice(idx,1); render(); }
  const PAIR_RULES = [["egor","sergei"],["egor","mikhail"]]; // пары, которые автоподбор по Эло не собирает (вручную — можно)
  const pairAllowed = (a, b) => !PAIR_RULES.some(r => (r[0]===a && r[1]===b) || (r[0]===b && r[1]===a));
  function balanceTeams() {
    // Пары, собранные вручную, остаются как есть; остальных участников добираем так, чтобы суммы Эло ВСЕХ пар были максимально ровными
    const d = getDraft();
    const fixed = (d.teams||[]).filter(t => t.players.every(pid => d.participants.includes(pid))).map(t => t.players.slice());
    const taken = new Set(fixed.flat());
    const ids = d.participants.filter(pid => !taken.has(pid));
    if (d.participants.length < 4 || d.participants.length % 2) { toast("Нужно чётное число участников"); return; }
    if (!ids.length) { toast("Все уже в парах — уберите пару, чтобы пересобрать"); return; }
    if (ids.length % 2) { toast("Без пары остаётся нечётное число игроков"); return; }
    const { ratings } = computeElo();
    const r = id => ratings[id] || 1500;
    let best = null, bestVar = Infinity;
    const evalM = (m) => { const all = fixed.concat(m); const sums = all.map(p => r(p[0])+r(p[1])); const mean = sums.reduce((a,b)=>a+b,0)/sums.length; return sums.reduce((a,s)=>a+(s-mean)*(s-mean),0); };
    if (ids.length <= 12) {
      const rec = (rest, acc) => {
        if (!rest.length) { const v = evalM(acc); if (v < bestVar) { bestVar = v; best = acc.map(p => p.slice()); } return; }
        const a = rest[0];
        for (let i=1;i<rest.length;i++) { if (!pairAllowed(a, rest[i])) continue; acc.push([a, rest[i]]); rec(rest.slice(1,i).concat(rest.slice(i+1)), acc); acc.pop(); }
      };
      rec(ids, []);
    } else {
      const sorted = ids.slice().sort((a,b) => r(b)-r(a)); best = [];
      while (sorted.length) { const a = sorted.shift(); let j = sorted.length-1; while (j>0 && !pairAllowed(a, sorted[j])) j--; best.push([a, sorted.splice(j,1)[0]]); }
    }
    if (!best) { toast("Не удалось собрать пары"); return; }
    d.teams = fixed.concat(best).map(p => ({ players: p }));
    toast(fixed.length ? `Ваши ${plural(fixed.length, "пара оставлена", "пары оставлены", "пар оставлено")}, остальные добраны по Эло` : "Пары подобраны по Эло");
    render();
  }

  function deleteTournament(id) {
    const t = byId(state.tournaments, id); if (!t) return;
    const ids = [id]; const par = linkedParent(t); if (par) ids.push(par.id); const ch = linkedChild(t); if (ch) ids.push(ch.id);
    state.tournaments = state.tournaments.filter(x => !ids.includes(x.id));
    state.games = state.games.filter(g => !ids.includes(g.tournamentId));
    state.view.confirmDelete = null;
    state.view.tournament = null;
    addLog("Удалил турнир «" + t.name + "»");
    toast("Турнир удалён");
    render();
    commit(1500);
  }
  function generateTournament() {
    const d = getDraft();
    const id = uid("t");
    const seq = (Math.max(0, ...state.tournaments.map(t=>t.seq||0))) + 1;
    let scheduleGames = [];

    if (d.format === "americano") {
      const nR = +(d.rounds ?? defaultAmericanoRounds(d.participants.length, d.courts)) || defaultAmericanoRounds(d.participants.length, d.courts);
      const rounds = generateAmericanoAny(d.participants, nR, d.courts);
      if (!rounds) { toast("Американо: нужно минимум 4 участника"); return; }
      rounds.forEach((round, ri) => round.forEach((game, gi) => {
        scheduleGames.push({ id: id+"-r"+(ri+1)+"-c"+(gi+1), tournamentId:id, round:ri+1, court:gi+1, teamA:game[0], teamB:game[1], scoreA:null, scoreB:null, decided:false });
      }));
    } else if (d.format === "roundrobin") {
      const teams = d.teams.map((t,i)=>({id:"team"+i, players:t.players}));
      const rounds = generateRoundRobinTeams(teams);
      const perRound = Math.max(1, d.courts||1);
      const chunks = []; // матчи раунда делим по количеству кортов
      rounds.forEach(round => { for (let i=0;i<round.length;i+=perRound) chunks.push(round.slice(i, i+perRound)); });
      const want = +d.rounds > 0 ? +d.rounds : chunks.length;
      // раундов больше, чем в одном круге — идём по второму, третьему кругу (та же сетка, пары на кортах меняются местами)
      const sched = []; let circle = 0;
      while (sched.length < want) { chunks.forEach(c => { if (sched.length < want) sched.push(circle % 2 ? c.map(m => [m[1], m[0]]) : c); }); circle++; if (!chunks.length) break; }
      sched.forEach((round, ri) => round.forEach((pair, gi) => {
        scheduleGames.push({ id: id+"-r"+(ri+1)+"-c"+(gi+1), tournamentId:id, round:ri+1, court:gi+1, teamA:pair[0].players, teamB:pair[1].players, scoreA:null, scoreB:null, decided:false });
      }));
    } else if (d.format === "two") {
      if (d.participants.length < 4 || d.participants.length % 4) { toast("Нужно число участников, кратное 4"); return; }
      const courts = d.participants.length / 4;
      const nR = +d.rounds1 || defaultAmericanoRounds(d.participants.length, courts);
      const rounds = generateAmericanoAny(d.participants, nR, courts);
      if (!rounds) { toast("Не удалось собрать этап 1"); return; }
      const id1 = uid("t");
      const money0 = { court: null, prize: { enabled: false, fee: null, places: 3, amounts: [0,0,0] } };
      const scoring = { scoringType: d.scoringType, scoringMode: d.scoringMode, scoringTarget: d.scoringMode==="tennis" ? 6 : (d.scoringTarget? +d.scoringTarget : null), scoringMinutes: d.scoringType==="time"? d.scoringMinutes : null };
      const s1 = Object.assign({ id: id1, seq, name: d.name + " · этап 1", date: d.date, status: "scheduled", format: "americano", courts, participantIds: d.participants.slice(), teams: [], rounds: nR, money: money0 }, scoring);
      const s2 = Object.assign({ id, seq: seq+1, name: d.name, date: d.date, status: "scheduled", format: "swiss", courts, participantIds: d.participants.slice(), teams: [], rounds: +d.rounds || 5, swissCap: d.swissCap || 2, linkedTo: id1,
        money: { court: d.court==="" ? null : Math.max(0,+d.court), prize: { enabled: !!d.prizeEnabled, fee: d.fee==="" ? null : Math.max(0,+d.fee), places: d.places||3, amounts: (d.amounts && d.amounts.length===(d.places||3)) ? d.amounts.map(x=>+x||0) : defaultAmounts((+d.fee||0)*d.participants.length, d.places||3) } } }, scoring);
      rounds.forEach((round, ri) => round.forEach((game, gi) => {
        scheduleGames.push({ id: id1+"-r"+(ri+1)+"-c"+(gi+1), tournamentId:id1, round:ri+1, court:gi+1, teamA:game[0], teamB:game[1], scoreA:null, scoreB:null, decided:false });
      }));
      state.tournaments.push(s1, s2);
      state.games.push(...scheduleGames);
      addLog("Создал турнир «" + d.name + "» (Американо → SwissCourt, этап 1: " + scheduleGames.length + " игр)");
      commit(1500); state._createDraft = null; state.view.create = false; state.view.tournament = id; toast("Турнир создан"); render();
      return;
    } else if (d.format === "swiss") {
      if (d.participants.length < 4 || d.participants.length % 4) { toast("SwissCourt: нужно число участников, кратное 4"); return; }
      d.courts = d.participants.length / 4;
      if (d.linkedTo) {
        // этап 2: 1-й раунд не собираем сразу — его собирает кнопка «Сгенерировать на основе этапа 1», когда счета этапа 1 внесены
      } else {
        const draftT = { participantIds: d.participants, swissCap: d.swissCap || 2, linkedTo: null };
        const matches = generateSwissRound(draftT, []);
        if (!matches) { toast("Не удалось собрать 1-й раунд"); return; }
        matches.forEach((m, i) => scheduleGames.push({ id: id+"-r1-c"+(i+1), tournamentId:id, round:1, court:i+1, teamA:m[0], teamB:m[1], scoreA:null, scoreB:null, decided:false }));
      }
    } else if (d.format === "playoff") {
      if (d.teams.length !== 4) { toast("Плей-офф пока поддерживает ровно 4 команды"); return; }
      const t = d.teams;
      scheduleGames.push({ id:id+"-r1-c1", tournamentId:id, round:1, court:1, teamA:t[0].players, teamB:t[1].players, scoreA:null, scoreB:null, decided:false, label:"Полуфинал 1" });
      scheduleGames.push({ id:id+"-r1-c2", tournamentId:id, round:1, court:2, teamA:t[2].players, teamB:t[3].players, scoreA:null, scoreB:null, decided:false, label:"Полуфинал 2" });
      // финал и матч за 3-е место создаются автоматически, когда оба полуфинала сыграны (ensurePlayoffProgress)
    }

    const tournament = {
      id, seq, name: d.name, date: d.date, status: "scheduled",
      format: d.format, courts: d.courts, participantIds: d.participants,
      scoringType: d.scoringType, scoringMode: d.scoringMode, scoringTarget: d.scoringMode==="tennis" ? 6 : (d.scoringTarget? +d.scoringTarget : null),
      scoringMinutes: d.scoringType==="time"? d.scoringMinutes : null,
      teams: d.teams,
      rounds: d.format==="swiss" ? (+d.rounds || 5) : undefined,
      swissCap: d.format==="swiss" ? (d.swissCap || 2) : undefined,
      linkedTo: d.format==="swiss" && d.linkedTo ? d.linkedTo : undefined,
      money: { court: d.court==="" ? null : Math.max(0,+d.court), prize: { enabled: !!d.prizeEnabled, fee: d.fee==="" ? null : Math.max(0,+d.fee), places: d.places||3, amounts: (d.amounts && d.amounts.length===(d.places||3)) ? d.amounts.map(x=>+x||0) : defaultAmounts((+d.fee||0)*d.participants.length, d.places||3) } },
    };
    state.tournaments.push(tournament);
    state.games.push(...scheduleGames);
    addLog("Создал турнир «" + tournament.name + "» (" + formatLabel(d.format) + ", " + scheduleGames.length + " игр)");
    commit(1500);
    state._createDraft = null;
    state.view.create = false;
    state.view.tournament = id;
    toast("Турнир создан");
    render();
  }

  function saveGameTeams(gid) {
    const g = state.games.find(x=>x.id===gid); if (!g) return;
    const m = document.querySelector('[data-act="edit-game-save"][data-gid="' + gid + '"]')?.closest(".match"); if (!m) return;
    const pick = (side, idx) => m.querySelector(`[data-edit-side="${side}"][data-edit-idx="${idx}"]`).value;
    const A = [pick("A",0), pick("A",1)], B = [pick("B",0), pick("B",1)];
    if (new Set(A.concat(B)).size !== 4) { toast("Один игрок выбран дважды"); return; }
    const before = playerName(g.teamA[0])+"+"+playerName(g.teamA[1])+" vs "+playerName(g.teamB[0])+"+"+playerName(g.teamB[1]);
    g.teamA = A; g.teamB = B;
    addLog("Состав " + gameLabel(g) + ": " + before + " → " + playerName(A[0])+"+"+playerName(A[1])+" vs "+playerName(B[0])+"+"+playerName(B[1]));
    state.view.editGame = null;
    toast("Состав изменён");
    render(); commit(1500);
  }
  // сохранить обе цифры матча сразу (кнопка ✓)
  function saveMatchScores(gid, closeKb) {
    const m = document.querySelector('.sc-ok[data-gid="' + gid + '"]')?.closest(".match"); if (!m) return;
    const ia = m.querySelector('input[data-side="A"]'), ib = m.querySelector('input[data-side="B"]');
    if (ia && ib && ((ia.value === "") !== (ib.value === ""))) { toast("Впиши счёт обеих пар"); (ia.value === "" ? ia : ib).focus(); return; }
    if (ia) saveScore(gid, "A", ia.value); if (ib) saveScore(gid, "B", ib.value);
    const ok = m.querySelector(".sc-ok"); if (ok) { ok.classList.remove("dirty"); ok.classList.toggle("saved", !!(ia && ia.value !== "")); }
    if (closeKb && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    saveNow();
  }
  function saveScore(gid, side, val) {
    const g = state.games.find(x=>x.id===gid); if (!g) return;
    const v = val===""? null : Math.min(99, Math.max(0, parseInt(val,10)));
    state.view.lastScoredGid = gid;
    const roundGames = () => state.games.filter(x => x.tournamentId===g.tournamentId && x.round===g.round), full = () => roundGames().every(x => x.scoreA!=null && x.scoreB!=null);
    const wasFull = full();
    const before = (g.scoreA==null?"—":g.scoreA) + ":" + (g.scoreB==null?"—":g.scoreB);
    if (side==="A") g.scoreA = Number.isNaN(v)?null:v; else g.scoreB = Number.isNaN(v)?null:v;
    g.decided = g.scoreA!=null && g.scoreB!=null && g.scoreA!==g.scoreB;
    const after = (g.scoreA==null?"—":g.scoreA) + ":" + (g.scoreB==null?"—":g.scoreB);
    if (before !== after) addLog("Счёт " + gameLabel(g) + " " + playerName(g.teamA[0]) + "+" + playerName(g.teamA[1]) + " vs " + playerName(g.teamB[0]) + "+" + playerName(g.teamB[1]) + ": " + before + " → " + after);
    if (ensurePlayoffProgress(g.tournamentId)) { render(); commit(3000); return; }
    if (ensureFriendlyProgress(g.tournamentId)) { render(); commit(3000); return; }
    // re-render only the two pair labels (winner highlight) so typing the other score is not interrupted
    const m = document.querySelector('[data-gid="' + gid + '"]')?.closest(".match");
    if (m) {
      const a = g.scoreA, b = g.scoreB;
      const pairs = m.querySelectorAll(".pair");
      if (pairs[0]) pairs[0].classList.toggle("winner", a!=null && b!=null && a>b);
      if (pairs[1]) pairs[1].classList.toggle("winner", a!=null && b!=null && b>a);
    }
    commit(6000);
    if (!wasFull && full()) { const ft = byId(state.tournaments, g.tournamentId); toast(isFriendly(ft) ? (g.label && g.label !== "Матч" ? g.label + " записан ✓" : "Счёт записан ✓") : "Раунд " + g.round + " заполнен ✓"); bgRender(); } // покажет кнопку следующего раунда, когда закроется клавиатура
  }

  // ---------------- boot ----------------
  restoreView();
  render();
  initArtifact();
}
