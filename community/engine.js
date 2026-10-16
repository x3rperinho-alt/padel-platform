// Движок проведения турнира: расписания раундов и таблицы. Чистые функции — без базы и интерфейса.
// Матч: { round, court, teamA: [id, id], teamB: [id, id], scoreA, scoreB, label }

const rnd = () => Math.random();
const pkey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const scored = g => g.scoreA != null && g.scoreB != null;

// ---------- Американо: партнёры меняются, соперники — как можно реже, отдых по очереди ----------
function americano8(ids) {
  const dev = (x, i) => (x == null ? null : (x + i) % 7);
  const lab = { [-1]: ids[0] }; for (let k = 0; k < 7; k++) lab[k] = ids[k + 1];
  const map = n => (n == null ? lab[-1] : lab[n]);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const t1 = [[null, dev(0, i)], [dev(4, i), dev(6, i)]], t2 = [[dev(1, i), dev(5, i)], [dev(2, i), dev(3, i)]];
    out.push([t1, t2].map(([a, b]) => [[map(a[0]), map(a[1])], [map(b[0]), map(b[1])]]));
  }
  return out;
}
export function defaultAmericanoRounds(n, courts) {
  const per = Math.min(Math.floor(n / 4), Math.max(1, courts || 1));
  if (per < 1) return 0;
  if (n % 4 === 0 && per === n / 4) return n - 1;
  return Math.ceil((n * (n - 1) / 2) / (2 * per));
}
export function americanoSchedule(ids, rounds, courts) {
  const n = ids.length, per = Math.min(Math.floor(n / 4), Math.max(1, courts || 1));
  if (n < 4 || per < 1 || rounds < 1) return null;
  if (n === 8 && per === 2 && rounds === 7) return americano8(ids.slice().sort(() => rnd() - 0.5));
  let best = null, bestScore = Infinity;
  for (let attempt = 0; attempt < 120; attempt++) {
    const partner = {}, opp = {}, played = {}; ids.forEach(p => (played[p] = 0));
    const pc = (a, b) => partner[pkey(a, b)] || 0, oc = (a, b) => opp[pkey(a, b)] || 0;
    const sched = [];
    for (let r = 0; r < rounds; r++) {
      const active = ids.slice().sort((a, b) => played[a] - played[b] || rnd() - 0.5).slice(0, per * 4);
      let bestRound = null, bestCost = Infinity;
      for (let k = 0; k < 40; k++) {
        const sh = active.slice().sort(() => rnd() - 0.5); const ms = []; let cost = 0;
        for (let m = 0; m < per; m++) {
          const q = sh.slice(m * 4, m * 4 + 4);
          const splits = [[[q[0], q[1]], [q[2], q[3]]], [[q[0], q[2]], [q[1], q[3]]], [[q[0], q[3]], [q[1], q[2]]]];
          let bs = null, bc = Infinity;
          splits.forEach(s => { const c = (pc(s[0][0], s[0][1]) + pc(s[1][0], s[1][1])) * 10 + [[0, 0], [0, 1], [1, 0], [1, 1]].reduce((acc, [i, j]) => acc + Math.pow(oc(s[0][i], s[1][j]), 2), 0); if (c < bc) { bc = c; bs = s; } });
          ms.push(bs); cost += bc;
        }
        if (cost < bestCost) { bestCost = cost; bestRound = ms; }
      }
      bestRound.forEach(([a, b]) => {
        partner[pkey(a[0], a[1])] = pc(a[0], a[1]) + 1; partner[pkey(b[0], b[1])] = pc(b[0], b[1]) + 1;
        a.forEach(x => b.forEach(y => { opp[pkey(x, y)] = oc(x, y) + 1; })); a.concat(b).forEach(p => played[p]++);
      });
      sched.push(bestRound);
    }
    let score = 0;
    Object.values(partner).forEach(c => { if (c > 1) score += (c - 1) * (c - 1) * 10; });
    const ov = Object.values(opp), mean = ov.reduce((a, b) => a + b, 0) / Math.max(1, ov.length);
    ov.forEach(c => (score += (c - mean) * (c - mean)));
    const pv = Object.values(played); score += (Math.max(...pv) - Math.min(...pv)) * 5;
    if (score < bestScore) { bestScore = score; best = sched; }
  }
  return best;
}

// ---------- кто отдыхает в раунде: меньше всего отдыхал → играет ----------
function pickActive(ids, games, need) {
  const gp = {}; ids.forEach(id => (gp[id] = 0));
  games.forEach(g => g.teamA.concat(g.teamB).forEach(id => { if (id in gp) gp[id]++; }));
  const r = {}; ids.forEach(id => (r[id] = rnd()));
  return ids.slice().sort((a, b) => gp[a] - gp[b] || r[a] - r[b]).slice(0, need);
}

// ---------- личная таблица ----------
export function playerTable(ids, games) {
  const row = {}; const R = id => (row[id] = row[id] || { id, pts: 0, pa: 0, w: 0, l: 0, d: 0, g: 0 });
  ids.forEach(R);
  games.filter(scored).forEach(g => [[g.teamA, g.scoreA, g.scoreB], [g.teamB, g.scoreB, g.scoreA]].forEach(([tm, own, opp]) => tm.forEach(id => {
    const r = R(id); r.g++; r.pts += own; r.pa += opp; if (own > opp) r.w++; else if (own < opp) r.l++; else r.d++;
  })));
  return Object.values(row).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.pts - b.pa) - (a.pts - a.pa));
}

// ---------- Мексикано: 1-й раунд по силе, дальше по таблице; в четвёрке 1+4 против 2+3 ----------
export function mexicanoRound(ids, games, courts, strength) {
  const per = Math.min(Math.floor(ids.length / 4), Math.max(1, courts || 1)); if (per < 1) return null;
  const active = pickActive(ids, games, per * 4);
  const tb = playerTable(ids, games), pos = {}; tb.forEach((r, i) => (pos[r.id] = i));
  const anyScore = games.some(scored);
  const order = active.slice().sort((a, b) => anyScore ? pos[a] - pos[b] || strength(b) - strength(a) : strength(b) - strength(a));
  const out = [];
  for (let i = 0; i < per; i++) { const q = order.slice(i * 4, i * 4 + 4); out.push([[q[0], q[3]], [q[1], q[2]]]); }
  return out;
}

// ---------- SwissCourt: максимально равные матчи по текущей таблице, повторы партнёров ограничены (cap) ----------
export function swissRound(ids, games, courts, strength0, cap) {
  cap = cap || 2;
  const per = Math.min(Math.floor(ids.length / 4), Math.max(1, courts || 1)); if (per < 1) return null;
  const active = pickActive(ids, games, per * 4);
  const pts = {}; ids.forEach(id => (pts[id] = 0));
  const partner = {}, opp = {};
  games.forEach(g => {
    if (scored(g)) { g.teamA.forEach(p => (pts[p] = (pts[p] || 0) + g.scoreA)); g.teamB.forEach(p => (pts[p] = (pts[p] || 0) + g.scoreB)); }
    partner[pkey(g.teamA[0], g.teamA[1])] = (partner[pkey(g.teamA[0], g.teamA[1])] || 0) + 1;
    partner[pkey(g.teamB[0], g.teamB[1])] = (partner[pkey(g.teamB[0], g.teamB[1])] || 0) + 1;
    g.teamA.forEach(x => g.teamB.forEach(y => (opp[pkey(x, y)] = (opp[pkey(x, y)] || 0) + 1)));
  });
  const played = games.some(scored);
  const st = id => (played ? pts[id] || 0 : strength0(id));
  const pc = (a, b) => partner[pkey(a, b)] || 0, oc = (a, b) => opp[pkey(a, b)] || 0;
  const cost = (A, B) => { let c = Math.abs(st(A[0]) + st(A[1]) - st(B[0]) - st(B[1])); [A, B].forEach(p => { const k = pc(p[0], p[1]); c += k >= cap ? 1000 : k * 4; }); A.forEach(x => B.forEach(y => (c += oc(x, y) * 1.5))); return c; };
  const total = ms => ms.reduce((a, m) => a + cost(m[0], m[1]), 0);
  // старт: «сильный + слабый», затем улучшаем обменами игроков; несколько попыток со случайным стартом
  let best = null, bestC = Infinity;
  for (let att = 0; att < 12; att++) {
    const sorted = active.slice().sort((a, b) => st(b) - st(a) || (att ? rnd() - 0.5 : 0));
    if (att) for (let i = 0; i < sorted.length - 1; i++) if (rnd() < 0.3) { const x = sorted[i]; sorted[i] = sorted[i + 1]; sorted[i + 1] = x; }
    const teams = []; while (sorted.length) teams.push([sorted.shift(), sorted.pop()]);
    teams.sort((a, b) => st(b[0]) + st(b[1]) - st(a[0]) - st(a[1]));
    const ms = []; for (let i = 0; i < teams.length; i += 2) ms.push([teams[i], teams[i + 1]]);
    let cur = total(ms);
    const slots = []; ms.forEach((m, mi) => [0, 1].forEach(ti => [0, 1].forEach(pi => slots.push([mi, ti, pi]))));
    for (let pass = 0; pass < 60; pass++) {
      let imp = false;
      for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
        const [m1, t1, p1] = slots[i], [m2, t2, p2] = slots[j];
        const tmp = ms[m1][t1][p1]; ms[m1][t1][p1] = ms[m2][t2][p2]; ms[m2][t2][p2] = tmp;
        const c = total(ms); if (c < cur - 1e-9) { cur = c; imp = true; } else { ms[m2][t2][p2] = ms[m1][t1][p1]; ms[m1][t1][p1] = tmp; }
      }
      if (!imp) break;
    }
    if (cur < bestC) { bestC = cur; best = ms.map(m => [m[0].slice(), m[1].slice()]); }
  }
  const sum = m => st(m[0][0]) + st(m[0][1]) + st(m[1][0]) + st(m[1][1]);
  return best.sort((x, y) => sum(y) - sum(x)); // самые сильные — на корт 1 (косметика)
}

// ---------- постоянные пары ----------
// из списка игроков — пары «сильный + слабый»; shuffle — слегка перемешать, чтобы получить другой вариант
export function balanceTeams(ids, strength, shuffle) {
  const s = ids.slice().sort((a, b) => strength(b) - strength(a));
  if (shuffle) for (let i = 0; i < s.length - 1; i++) if (rnd() < 0.45) { const j = Math.min(s.length - 1, i + 1 + Math.floor(rnd() * 2)); const x = s[i]; s[i] = s[j]; s[j] = x; }
  const out = []; while (s.length >= 2) out.push([s.shift(), s.pop()]);
  return out;
}
// круговой: каждая пара с каждой; матчи раунда, которые не влезли на корты, уходят в следующий подраунд
export function roundRobinSchedule(teams, courts) {
  const list = teams.slice(); if (list.length < 2) return null;
  if (list.length % 2) list.push(null);
  const m = list.length, arr = list.slice(), c = Math.max(1, courts || 1), queue = [];
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) { const a = arr[i], b = arr[m - 1 - i]; if (a && b) queue.push([a, b]); }
    arr.splice(1, 0, arr.pop());
  }
  // раскладываем по раундам плотно: в раунд берём первые по очереди матчи, где обе пары свободны, пока есть корты
  const out = [];
  while (queue.length) {
    const busy = new Set(), rd = [];
    for (let i = 0; i < queue.length && rd.length < c; ) {
      const [a, b] = queue[i], ka = a.join("|"), kb = b.join("|");
      if (!busy.has(ka) && !busy.has(kb)) { rd.push(queue.splice(i, 1)[0]); busy.add(ka); busy.add(kb); } else i++;
    }
    out.push(rd);
  }
  return out;
}
export function teamTable(teams, games) {
  const key = tm => tm.slice().sort().join("|");
  const map = {}; teams.forEach(tm => (map[key(tm)] = { players: tm.slice(), pts: 0, pa: 0, w: 0, l: 0, d: 0, g: 0 }));
  games.filter(scored).forEach(g => [[g.teamA, g.scoreA, g.scoreB], [g.teamB, g.scoreB, g.scoreA]].forEach(([tm, own, opp]) => {
    const r = map[key(tm)] || (map[key(tm)] = { players: tm.slice(), pts: 0, pa: 0, w: 0, l: 0, d: 0, g: 0 });
    r.g++; r.pts += own; r.pa += opp; if (own > opp) r.w++; else if (own < opp) r.l++; else r.d++;
  }));
  return Object.values(map).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.pts - b.pa) - (a.pts - a.pa));
}

// ---------- плей-офф: 2/4/8/16 пар, посев по силе (1 — последняя, 2 — предпоследняя…), матч за 3-е место ----------
export const isBracket = n => [2, 4, 8, 16].includes(n);
const stageLabel = n => (n === 2 ? "final" : n === 4 ? "semi" : n === 8 ? "quarter" : "eighth");
function seedOrder(n) { let s = [1]; while (s.length < n) { const m = s.length * 2 + 1; s = s.flatMap(x => [x, m - x]); } return s; }
export function playoffFirst(teams) { // teams уже отсортированы по силе
  const n = teams.length; if (!isBracket(n)) return null;
  const so = seedOrder(n), ms = [];
  for (let i = 0; i < n; i += 2) ms.push({ teamA: teams[so[i] - 1], teamB: teams[so[i + 1] - 1], label: stageLabel(n) });
  return ms;
}
const winner = g => (g.scoreA > g.scoreB ? g.teamA : g.teamB), loser = g => (g.scoreA > g.scoreB ? g.teamB : g.teamA);
// следующий этап, когда текущий полностью сыгран (ничьих в плей-офф нет)
export function playoffNext(games) {
  if (!games.length) return null;
  const last = Math.max(...games.map(g => g.round)), cur = games.filter(g => g.round === last && g.label !== "third").sort((a, b) => a.court - b.court);
  if (!cur.length || cur.some(g => !scored(g) || g.scoreA === g.scoreB)) return null;
  if (cur.length === 1) return null; // финал сыгран
  const ms = [];
  for (let i = 0; i < cur.length; i += 2) ms.push({ teamA: winner(cur[i]), teamB: winner(cur[i + 1]), label: stageLabel(cur.length) });
  if (cur.length === 2) ms.push({ teamA: loser(cur[0]), teamB: loser(cur[1]), label: "third" });
  return ms;
}
// итоговые места плей-офф: финал → 1/2, за 3-е → 3/4, дальше — по этапу вылета и очкам
export function playoffPlaces(teams, games) {
  const key = tm => tm.slice().sort().join("|");
  const tt = teamTable(teams, games), place = {};
  const fin = games.find(g => g.label === "final"), th = games.find(g => g.label === "third");
  if (fin && scored(fin) && fin.scoreA !== fin.scoreB) { place[key(winner(fin))] = 1; place[key(loser(fin))] = 2; }
  if (th && scored(th) && th.scoreA !== th.scoreB) { place[key(winner(th))] = 3; place[key(loser(th))] = 4; }
  const outRound = {}; games.filter(g => scored(g) && g.scoreA !== g.scoreB && g.label !== "third").forEach(g => (outRound[key(loser(g))] = g.round));
  return tt.map(r => ({ ...r, place: place[key(r.players)] || null, out: outRound[key(r.players)] || 99 }))
    .sort((a, b) => (a.place || 99) - (b.place || 99) || b.out - a.out || b.pts - a.pts);
}
