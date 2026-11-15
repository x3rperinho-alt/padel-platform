// Движок проведения турнира: расписания раундов и таблицы. Чистые функции — без базы и интерфейса.
// Матч: { round, court, teamA: [id, id], teamB: [id, id], scoreA, scoreB, label }

const rnd = () => Math.random();
const pkey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const scored = g => g.scoreA != null && g.scoreB != null;

// ---------- Американо ----------
// Если все играют каждый раунд и игроков 8/12/16/20/24 — готовая «вист»-схема: за n−1 раундов каждый с каждым
// ровно 1 раз в паре и ровно 2 раза друг против друга. Раундов больше — следующий круг (новая случайная расстановка).
// Иначе (есть отдыхающие, другое число игроков, неполный круг) — оптимизация «отжигом»: партнёры не повторяются,
// соперники распределены как можно ровнее, игры и отдых — поровну, без отдыха два раунда подряд.
export function defaultAmericanoRounds(n, courts) {
  const per = Math.min(Math.floor(n / 4), Math.max(1, courts || 1));
  if (per < 1) return 0;
  if (n % 4 === 0 && per === n / 4) return n - 1;
  return Math.ceil((n * (n - 1) / 2) / (2 * per));
}
// Американо: честное расписание. Оптимизация «отжигом» по всему расписанию:
//  партнёры — как можно реже повторяются, соперники — поровну со всеми, игры — поровну (отдых по очереди, не два раза подряд).
// history — уже сыгранные/созданные матчи (для «+ раунд»): учитываются в счётчиках, но не меняются.
export function americanoOpt(ids, rounds, courts, history, init) {
  const n = ids.length, per = Math.min(Math.floor(n / 4), Math.max(1, courts || 1));
  if (n < 4 || per < 1 || rounds < 1) return null;
  const idx = {}; ids.forEach((id, i) => idx[id] = i);
  const WP = 60, WO = 25, WG = 400, WC = 60;
  const P0 = new Int32Array(n * n), O0 = new Int32Array(n * n), G0 = new Int32Array(n); let lastRest0 = null;
  const hist = (history || []).filter(g => g.teamA.concat(g.teamB).every(x => x in idx));
  hist.forEach(g => { const a = g.teamA.map(x => idx[x]), b = g.teamB.map(x => idx[x]);
    P0[a[0] * n + a[1]]++; P0[a[1] * n + a[0]]++; P0[b[0] * n + b[1]]++; P0[b[1] * n + b[0]]++;
    a.forEach(x => b.forEach(y => { O0[x * n + y]++; O0[y * n + x]++; })); a.concat(b).forEach(p => G0[p]++); });
  if (hist.length) { const mr = Math.max(...hist.map(g => g.round)); const inLast = new Set(hist.filter(g => g.round === mr).flatMap(g => g.teamA.concat(g.teamB)).map(x => idx[x])); lastRest0 = new Uint8Array(n); for (let p = 0; p < n; p++) lastRest0[p] = inLast.has(p) ? 0 : 1; }
  const S = per * 4;
  let best = null, bestCost = Infinity;
  const tries = n >= 20 ? 2 : 3, iters = Math.min(900000, 15000 * rounds * per + 40000);
  for (let tr = 0; tr < tries; tr++) {
    const P = P0.slice(), O = O0.slice(), G = G0.slice();
    // начальное: отдыхают те, кто меньше всего отдыхал
    const R = [], played = G0.slice();
    if (init && tr === 0) init.forEach(rd => { const play = rd.flat(2).map(x => idx[x]), set = new Set(play); R.push(play.concat(Array.from({ length: n }, (_, i) => i).filter(i => !set.has(i)))); });
    for (let r = R.length; r < rounds; r++) {
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => played[a] - played[b] || rnd() - .5);
      const play = order.slice(0, S).sort(() => rnd() - .5), rest = order.slice(S);
      play.forEach(p => played[p]++); R.push(play.concat(rest));
    }
    let cost = 0;
    const sq = (arr, k, d, w) => { const c = arr[k]; arr[k] = c + d; return w * ((c + d) * (c + d) - c * c); };
    const pairD = (a, b, d) => { const c1 = sq(P, a * n + b, d, WP); P[b * n + a] += d; return c1; };
    const oppD = (a, b, d) => { const c1 = sq(O, a * n + b, d, WO); O[b * n + a] += d; return c1; };
    const matchD = (row, m, d) => { const q = 4 * m, a0 = row[q], a1 = row[q + 1], b0 = row[q + 2], b1 = row[q + 3];
      return pairD(a0, a1, d) + pairD(b0, b1, d) + oppD(a0, b0, d) + oppD(a0, b1, d) + oppD(a1, b0, d) + oppD(a1, b1, d); };
    const isRest = (r, p) => r < 0 ? (lastRest0 ? lastRest0[p] : 0) : (R[r].indexOf(p) >= S ? 1 : 0);
    // базовая стоимость
    for (let p = 0; p < n; p++) G[p] = G0[p];
    // пересчитаем счётчики с нуля для расписания (кроме истории)
    const base = () => { let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { c += WP * P[i * n + j] ** 2 + WO * O[i * n + j] ** 2; } for (let p = 0; p < n; p++) c += WG * G[p] ** 2; return c; };
    R.forEach(row => { for (let m = 0; m < per; m++) matchD(row, m, 1); for (let s = 0; s < S; s++) G[row[s]]++; });
    cost = base();
    const restPen = () => { let c = 0; for (let r = 0; r < rounds; r++) for (let s = S; s < n; s++) { const p = R[r][s]; if (isRest(r - 1, p)) c += WC; } return c; };
    if (S < n) cost += restPen();
    let T = 60; const T1 = 0.05, k = Math.pow(T1 / T, 1 / iters);
    let curBest = cost, curBestR = R.map(x => x.slice());
    for (let it = 0; it < iters; it++, T *= k) {
      const r = (rnd() * rounds) | 0, row = R[r];
      if (per > 1 && rnd() < 0.5) { // обмен целыми парами между матчами: меняет только соперников
        const m1 = (rnd() * per) | 0; let m2 = (rnd() * (per - 1)) | 0; if (m2 >= m1) m2++;
        const a = 4 * m1 + ((rnd() * 2) | 0) * 2, b = 4 * m2 + ((rnd() * 2) | 0) * 2;
        let d = matchD(row, m1, -1) + matchD(row, m2, -1);
        const sw = () => { let t = row[a]; row[a] = row[b]; row[b] = t; t = row[a + 1]; row[a + 1] = row[b + 1]; row[b + 1] = t; };
        sw(); d += matchD(row, m1, 1) + matchD(row, m2, 1);
        if (d <= 0 || rnd() < Math.exp(-d / T)) { cost += d; if (cost < curBest) { curBest = cost; curBestR = R.map(z => z.slice()); } }
        else { matchD(row, m1, -1); matchD(row, m2, -1); sw(); matchD(row, m1, 1); matchD(row, m2, 1); }
        continue;
      }
      const s1 = (rnd() * S) | 0; let s2 = (rnd() * n) | 0; if (s2 === s1) continue;
      const m1 = s1 >> 2, m2 = s2 < S ? s2 >> 2 : -1;
      if (m1 === m2 && (s1 >> 1) === (s2 >> 1)) continue; // свап внутри одной пары — ничего не меняет
      const x = row[s1], y = row[s2];
      let d = matchD(row, m1, -1); if (m2 >= 0 && m2 !== m1) d += matchD(row, m2, -1);
      row[s1] = y; row[s2] = x;
      d += matchD(row, m1, 1); if (m2 >= 0 && m2 !== m1) d += matchD(row, m2, 1);
      if (m2 < 0) { // x уходит отдыхать, y начинает играть
        d += WG * ((G[x] - 1) ** 2 - G[x] ** 2) + WG * ((G[y] + 1) ** 2 - G[y] ** 2);
        // соседние раунды: отдых подряд
        const pr = isRest(r - 1, x), pr2 = isRest(r - 1, y), nx = r + 1 < rounds ? isRest(r + 1, x) : 0, ny = r + 1 < rounds ? isRest(r + 1, y) : 0;
        d += WC * (pr + nx) - WC * (pr2 + ny);
      }
      if (d <= 0 || rnd() < Math.exp(-d / T)) { cost += d; if (m2 < 0) { G[x]--; G[y]++; } if (cost < curBest) { curBest = cost; curBestR = R.map(z => z.slice()); } }
      else { // откат
        let u = matchD(row, m1, -1); if (m2 >= 0 && m2 !== m1) u += matchD(row, m2, -1);
        row[s1] = x; row[s2] = y; matchD(row, m1, 1); if (m2 >= 0 && m2 !== m1) matchD(row, m2, 1);
      }
    }
    if (curBest < bestCost) { bestCost = curBest; best = curBestR; }
  }
  return best.map(row => Array.from({ length: per }, (_, m) => [[ids[row[4 * m]], ids[row[4 * m + 1]]], [ids[row[4 * m + 2]], ids[row[4 * m + 3]]]]));
}
const WHIST = {"8":[4,0,1,2,6,7,3,5],"12":[7,1,6,10,3,2,0,9,11,4,5,8],"16":[7,2,4,13,1,8,0,3,15,12,11,9,10,14,6,5],"20":[14,8,2,17,13,3,1,19,7,6,9,11,12,15,4,16,18,10,0,5],"24":[17,20,23,19,15,22,2,11,0,5,16,4,1,14,8,6,21,13,7,3,9,10,18,12]};
function whistCycle(ids) { const n = ids.length, m = n - 1, b = WHIST[n], perm = ids.slice().sort(() => rnd() - .5);
  const rounds = Array.from({ length: m }, (_, r) => Array.from({ length: n / 4 }, (_, k) => { const q = b.slice(4 * k, 4 * k + 4).map(x => perm[x === m ? m : (x + r) % m]); return [[q[0], q[1]], [q[2], q[3]]]; }));
  return rounds.sort(() => rnd() - .5); }
export function americanoSchedule(ids, rounds, courts) {
  const n = ids.length, per = Math.min(Math.floor(n / 4), Math.max(1, courts || 1));
  if (n < 4 || per < 1 || rounds < 1) return null;
  if (WHIST[n] && per === n / 4) {
    const out = []; while (out.length + n - 1 <= rounds) out.push(...whistCycle(ids));
    const left = rounds - out.length; if (!left) return out;
    const hist = out.flatMap((rd, r) => rd.map(([a, b]) => ({ round: r + 1, teamA: a, teamB: b })));
    return out.concat(americanoOpt(ids, left, courts, hist, whistCycle(ids).slice(0, left)));
  }
  return americanoOpt(ids, rounds, courts, null);
}

// следующий раунд американо с учётом уже созданных матчей (кнопка «+ раунд»)
export function americanoNext(ids, games, courts) { const r = americanoOpt(ids, 1, courts, games || []); return r ? r[0] : null; }

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
// круговой: каждая пара с каждой; раундов больше полного круга — следующий круг (каждый с каждым ещё раз, новый порядок).
// Матчи, которые не влезли на корты, уходят в следующий подраунд. rounds — сколько раундов нужно (по умолчанию один круг).
function rrCycle(list0) {
  const list = list0.slice(); if (list.length % 2) list.push(null);
  const m = list.length, arr = list.slice(), out = [];
  for (let r = 0; r < m - 1; r++) { for (let i = 0; i < m / 2; i++) { const a = arr[i], b = arr[m - 1 - i]; if (a && b) out.push(r % 2 ? [b, a] : [a, b]); } arr.splice(1, 0, arr.pop()); }
  return out;
}
export function roundRobinSchedule(teams, courts, rounds) {
  if (teams.length < 2) return null;
  const c = Math.max(1, courts || 1), out = [], queue = [];
  const pack = () => { // раскладываем по раундам плотно: в раунд берём первые по очереди матчи, где обе пары свободны, пока есть корты
    const busy = new Set(), rd = [];
    for (let i = 0; i < queue.length && rd.length < c; ) { const [a, b] = queue[i], ka = a.join("|"), kb = b.join("|");
      if (!busy.has(ka) && !busy.has(kb)) { rd.push(queue.splice(i, 1)[0]); busy.add(ka); busy.add(kb); } else i++; }
    return rd; };
  let cycle = 0;
  const need = rounds || 0;
  queue.push(...rrCycle(teams));
  while (queue.length) {
    out.push(pack());
    if (need && out.length >= need) break;
    if (!queue.length && need && out.length < need) { cycle++; queue.push(...rrCycle(teams.slice().sort(() => rnd() - 0.5)).map(([a, b]) => cycle % 2 ? [b, a] : [a, b])); }
  }
  return out;
}
// следующий раунд для пар (кнопка «+ раунд»): сначала те, кто встречался реже всего, потом — кто меньше играл
export function teamNextRound(teams, games, courts) {
  const key = tm => tm.slice().sort().join("|"), met = {}, played = {};
  teams.forEach(tm => (played[key(tm)] = 0));
  (games || []).forEach(g => { const a = key(g.teamA), b = key(g.teamB); if (a in played) played[a]++; if (b in played) played[b]++; const k = a < b ? a + "~" + b : b + "~" + a; met[k] = (met[k] || 0) + 1; });
  const maxM = Math.min(Math.floor(teams.length / 2), Math.max(1, courts || 1));
  let best = null, bestCost = Infinity;
  for (let it = 0; it < 300; it++) {
    const cand = [];
    for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) { const a = key(teams[i]), b = key(teams[j]), k = a < b ? a + "~" + b : b + "~" + a;
      cand.push({ a: teams[i], b: teams[j], ka: a, kb: b, met: met[k] || 0, load: played[a] + played[b], r: rnd() }); }
    cand.sort((x, y) => x.met - y.met || x.load - y.load || x.r - y.r);
    const used = new Set(), pick = []; let cost = 0;
    for (const c of cand) { if (pick.length >= maxM) break; if (used.has(c.ka) || used.has(c.kb)) continue; if (it && rnd() < 0.15) continue;
      used.add(c.ka); used.add(c.kb); pick.push([c.a, c.b]); cost += c.met * 100 + c.load; }
    cost += (maxM - pick.length) * 10000;
    if (cost < bestCost) { bestCost = cost; best = pick; }
  }
  return best;
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

// ---------- King of the Court: переход после каждого раунда ----------
// Корт 1 (первый в списке) — главный. Раунд 1 — случайная рассадка по 4 на корт.
// Дальше: победители поднимаются на корт выше, проигравшие спускаются ниже; на главном корте победители остаются,
// на последнем — проигравшие остаются. На новом корте пары разбиваются: каждый играет с новым партнёром.
// lastRound — матчи предыдущего раунда в порядке кортов (0 — главный), со счётом.
export function kotcRound(ids, lastRound, courts) {
  if (!lastRound || !lastRound.length) {
    const per = Math.min(Math.floor(ids.length / 4), Math.max(1, courts || 1)); if (per < 1) return null;
    const sh = ids.slice(); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    return Array.from({ length: per }, (_, c) => { const q = sh.slice(c * 4, c * 4 + 4); return [[q[0], q[1]], [q[2], q[3]]]; });
  }
  const N = lastRound.length, W = [], L = [];
  lastRound.forEach((g, i) => { const aw = g.scoreA >= g.scoreB; W[i] = aw ? g.teamA : g.teamB; L[i] = aw ? g.teamB : g.teamA; });
  return lastRound.map((_, i) => {
    const [A, B] = N === 1 ? [W[0], L[0]] : i === 0 ? [W[0], W[1]] : i === N - 1 ? [L[N - 2], L[N - 1]] : [L[i - 1], W[i + 1]];
    return [[A[0], B[0]], [A[1], B[1]]];
  });
}
// финал королей: американо на четверых — каждый с каждым в паре (3 матча)
export function kotcFinal(k) { const [a, b, c, d] = k; return [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]]; }
