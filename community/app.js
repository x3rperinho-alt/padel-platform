// 048 Padel Community — турниры по уровням с записью, рейтинг Эло по анкете, профили. Счёт вносит только админ.
import { CONFIG } from "./config.js";
import { createDb } from "./db.js";
import { bootstrap } from "./auth.js";
import { americanoSchedule, defaultAmericanoRounds, mexicanoRound, swissRound, balanceTeams, roundRobinSchedule, playerTable, teamTable, playoffFirst, playoffNext, playoffPlaces, isBracket } from "./engine.js";
import { t, setLang, getLang, detectLang, LANGS, dateFmt, quiz, quizLevel, quizElo } from "./i18n.js";
import { createGames, timeRangeHtml, shiftEnd } from "./games.js";

setLang(detectLang(null));
const db = createDb(CONFIG);
const BOOT = await bootstrap(db);
setLang(detectLang(BOOT.tgLang));

(() => {
  // 1 уровень = 1000 Эло, поэтому делитель и K в 5 раз больше классических (400 и 32): поведение то же, что было
  const CONFIRM_N = 3;
  // ---------- Эло: правила (одни для всех, см. «Как считается Эло» во вкладке «Рейтинг») ----------
  // 1 уровень = 1000 Эло (как в Raketo: 2.434 → 2434).
  // Ожидание пары: E = 1 / (1 + 10^((Эло соперников − Эло пары) / 1000)), Эло пары — среднее двух игроков,
  //   берётся на НАЧАЛО турнира (внутри турнира рейтинг не «плывёт» от порядка матчей).
  // Результат S: победа 1, ничья 0.5, поражение 0.
  // Матч: Δ = 20 × (1 + до 0.5 за разницу счёта: +0.05 за каждое очко, максимум с разницы 10) × (S − E).
  //   Равные пары, победа 11:10 → +10; победа 16:5 → +15; поражение — столько же со знаком минус.
  // Турнир: итог игрока ограничен ±75 (если сумма больше — все матчи турнира пропорционально уменьшаются).
  // Итого: чтобы сдвинуться на подуровень (≈300 Эло, например D → D+), нужно минимум 4 очень сильных турнира.
  const ELO = { K: 20, DIV: 1000, MARGIN_MAX: 10, MARGIN_BONUS: 0.5, T_CAP: 75 };
  const eloMargin = diff => 1 + Math.min(Math.abs(diff), ELO.MARGIN_MAX) / ELO.MARGIN_MAX * ELO.MARGIN_BONUS;
  const eloExpect = (own, opp) => 1 / (1 + Math.pow(10, (opp - own) / ELO.DIV));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const byId = (arr, id) => arr.find(x => x.id === id);
  // сегодняшняя дата по местному времени (toISOString дал бы UTC — в Киеве с 00:00 до 02–03:00 это ещё «вчера»)
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const uid = () => "t_" + Math.random().toString(36).slice(2, 10);
  const state = { players: [], tournaments: [], games: [], registrations: [], league: {}, tab: "tournaments", view: {} };
  Object.assign(state, BOOT.data);
  const U = BOOT.user;
  const isAdmin = () => U && (U.role === "owner" || U.role === "admin");
  const canEdit = () => isAdmin() || (U && U.role === "editor");
  const myPlayer = () => state.players.find(p => p.userId === U.id) || null;
  // дружеский турнир из вкладки «Игры» ведёт тот, кто его создал (плюс админы)
  const canEditT = tt => canEdit() || (!!tt && !!tt.s && tt.s.kind === "ftour" && tt.status !== "played" && !!myPlayer() && tt.s.created_by === myPlayer().id); // после завершения — только админ (как в базе)
  const isGameT = tt => !!(tt && tt.s && ["match", "friendly", "ftour"].includes(tt.s.kind));

  // ---------- «на главный экран»: в Telegram — родная функция (откроет мини-приложение с входом), в браузере Android — установка PWA ----------
  const tgApp = window.Telegram && window.Telegram.WebApp;
  let homeMode = null, pwaPrompt = null;
  const homeBtnEl = () => document.getElementById("homeBtn");
  const showHome = mode => { homeMode = mode; const b = homeBtnEl(); if (b) b.hidden = false; };
  const hideHome = () => { homeMode = null; const b = homeBtnEl(); if (b) b.hidden = true; };
  if (tgApp && tgApp.initData && tgApp.isVersionAtLeast && tgApp.isVersionAtLeast("8.0") && tgApp.checkHomeScreenStatus) {
    try { tgApp.checkHomeScreenStatus(st => { if (st === "missed" || st === "unknown") showHome("tg"); }); } catch (e) {}
    try { tgApp.onEvent("homeScreenAdded", () => { hideHome(); toast(t("home_added")); }); } catch (e) {}
  } else window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); pwaPrompt = e; showHome("pwa"); });
  async function addToHome() {
    if (homeMode === "tg") {
      const go = () => { try { tgApp.addToHomeScreen(); } catch (e) { err(e); } };
      // на iPhone Telegram открывает свою страницу в Safari, а там кнопка «Поделиться» спрятана в «⋯» — подсказываем заранее
      if (tgApp.platform === "ios" && tgApp.showPopup) { try { tgApp.showPopup({ title: t("home_add_long"), message: t("home_ios_hint"), buttons: [{ id: "go", type: "default", text: t("home_ios_ok") }, { type: "cancel" }] }, id => { if (id === "go") go(); }); return; } catch (e) {} }
      go();
    }
    else if (homeMode === "pwa" && pwaPrompt) { pwaPrompt.prompt(); try { const r = await pwaPrompt.userChoice; if (r.outcome === "accepted") { hideHome(); toast(t("home_added")); } } catch (e) {} }
  }

  // ---------- уровни ----------
    // Буквы по шкале Raketo (уровень = Эло / 1000). Выше B+ (4.5) Raketo границ не дал — A-, A, A+ взяты с шагом как у B+.
  const letter = lv => lv == null ? "—" : lv < 1.9 ? "D-" : lv < 2.2 ? "D" : lv < 2.5 ? "D+" : lv < 2.75 ? "C-" : lv < 3.1 ? "C" : lv < 3.5 ? "C+" : lv < 3.75 ? "B-" : lv < 4 ? "B" : lv < 4.5 ? "B+" : lv < 5 ? "A-" : lv < 6 ? "A" : "A+";
  // кусочно-линейный перевод по опорным точкам [из, в]
  const interp = (pts, v) => { if (v <= pts[0][0]) return pts[0][1]; for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k]; if (v <= x1) return y0 + (y1 - y0) * (v - x0) / (x1 - x0); } return pts[pts.length - 1][1]; };
  // Перевод «буква в букву»: границы букв чужого приложения → те же буквы в шкале Raketo, внутри буквы — пропорционально
  const PADO_ELO = [[0, 1], [750, 1.9], [1000, 2.2], [1300, 2.5], [1600, 2.75], [1900, 3.1], [2200, 3.5], [2500, 3.75], [2800, 4], [3100, 4.5], [3400, 5], [3700, 6], [4000, 7]];
  const PADO_IND = [[0, 1], [1, 1.9], [1.5, 2.2], [2, 2.5], [2.5, 2.75], [3, 3.1], [3.5, 3.5], [4, 3.75], [4.5, 4], [5, 4.5], [5.5, 5], [6.5, 6], [7, 7]];
  // Playtomic: E→D-, D→D, D+→D+, C→C-…C, C+→C+, B→B-…B+, A→A-…A+
  const PLAYTOMIC = [[0, 1], [1, 1.9], [2, 2.2], [2.5, 2.5], [4, 3.1], [5, 3.5], [6, 4.5], [7, 7]];
  const toRaketo = (src, v) => { if (v == null || v === "" || isNaN(+v)) return null; v = +v;
    const r = src === "pado" ? (v > 7 ? interp(PADO_ELO, Math.min(v, 4000)) : interp(PADO_IND, v)) : src === "playtomic" ? interp(PLAYTOMIC, Math.min(v, 7)) : v;
    return Math.round(r * 1000) / 1000; };
  // шкала как в Raketo: Эло = уровень × 1000 (2.434 → 2434). Pado / Playtomic тоже просто × 1000.
  const levelElo = lv => lv == null ? 2500 : Math.round(+lv * 1000);
  const fmtLv = lv => lv == null || lv === "" ? "—" : String(+(+lv).toFixed(3));
  const letterClass = l => !l || l === "—" ? "" : "lv-" + l[0].toLowerCase();
  const levelBadge = (lv, size) => `<span class="lvb ${letterClass(letter(lv))} ${size || ""}" title="${lv ?? ""}">${letter(lv)}</span>`;
  // уровни турнира буквами: D / C / B / A — подряд идущие; крайние без границы (D — «от нуля», A — «без верха»)
  const LV_G = [["D", 0, 2.499], ["C", 2.5, 3.499], ["B", 3.5, 4.499], ["A", 4.5, 7]];
  const lvLetters = s => { const a = s.level_min, b = s.level_max; if (a == null && b == null) return [];
    return LV_G.filter(([, lo, hi]) => (a == null || hi >= +a) && (b == null || lo <= +b)).map(g => g[0]); };
  // точно ли границы совпадают с буквами (тогда подпись «D» / «C–B» вместо цифр)
  const lvExact = s => { const a = s.level_min, b = s.level_max; if (a == null && b == null) return null;
    const lo = a == null || +a <= 0.01 ? 0 : LV_G.findIndex(g => Math.abs(g[1] - a) < 0.006);
    const hi = b == null || +b >= 7 ? LV_G.length - 1 : LV_G.findIndex(g => Math.abs(g[2] - b) < 0.011);
    if (lo < 0 || hi < 0 || lo > hi) return null; return lo === hi ? LV_G[lo][0] : LV_G[lo][0] + "–" + LV_G[hi][0]; };
  function setLvLetters(s, L) {
    if (L === "all") { s.level_min = null; s.level_max = null; return; }
    let cur = lvLetters(s); const at = x => LV_G.findIndex(g => g[0] === x);
    if (cur.includes(L)) { const i = cur.indexOf(L); cur = i === 0 || i === cur.length - 1 ? cur.filter(x => x !== L) : [L]; } else cur = cur.concat(L);
    if (!cur.length) { s.level_min = null; s.level_max = null; return; }
    const is = cur.map(at), lo = Math.min(...is), hi = Math.max(...is);
    s.level_min = lo === 0 ? null : LV_G[lo][1]; s.level_max = hi === LV_G.length - 1 ? null : LV_G[hi][2];
  }
  const CLUBS = ["Dynamica", "Padel Point", "Beat на Фонтане", "Beat на Шевченка", "UnderAir", "Yellow Padel Club", "JustPadel"];
  const rangeLabel = s => { const ex = lvExact(s); if (ex) return ex; const a = s.level_min != null ? letter(+s.level_min) : null, b = s.level_max != null ? letter(+s.level_max) : null; return !a && !b ? t("all_levels") : a && b ? (a === b ? a : a + " – " + b) : a ? a + "+" : "≤ " + b; };

  // ---------- Эло: старт из анкеты, K удвоен пока не подтверждён (меньше 3 турниров и не подтверждён админом) ----------
  function orderedGames() {
    const tOrder = {}; state.tournaments.forEach((tt, i) => tOrder[tt.id] = i);
    return state.games.slice().sort((a, b) => (tOrder[a.tournamentId] || 0) - (tOrder[b.tournamentId] || 0) || a.round - b.round || (a.court || 0) - (b.court || 0));
  }
  function computeElo() {
    const r = {}, tp = {}, st = {}, seq = {}, adj = {};
    state.players.forEach(p => { r[p.id] = p.eloStart || 1500; tp[p.id] = new Set(); st[p.id] = { g: 0, w: 0, l: 0, d: 0 }; });
    // ручные правки админа: «после турнира X Эло игрока = N»
    const overrides = []; state.players.forEach(p => (p.eloAdj || []).forEach(o => o && o.value != null && overrides.push({ pid: p.id, after: o.after || null, value: +o.value, at: o.at })));
    const applyOv = after => overrides.filter(o => o.after === after && !o.done).forEach(o => { o.done = true; if (r[o.pid] == null) return; (adj[o.pid] = adj[o.pid] || []).push({ after, from: r[o.pid], to: o.value, at: o.at }); r[o.pid] = o.value; });
    applyOv(null);
    // игры вкладки «Игры»: дружеский матч, отменённая игра и оспоренный счёт (пока админ не решил) в Эло не идут
    const tInfo = {}; state.tournaments.forEach(tt => tInfo[tt.id] = tt);
    const noElo = tt => !!tt && !!tt.s && (tt.s.kind === "friendly" || tt.status === "cancelled" || (!!tt.s.dispute && !tt.s.dispute.done));
    // у матча 2×2 победитель — по сетам (в самой игре хранится сумма геймов, от неё — бонус за разницу)
    const setsRes = tt => { const ss = tt && tt.s && tt.s.kind === "match" && tt.s.sets; if (!ss || !ss.length) return null; let a = 0, b = 0; ss.forEach(([x, y]) => { if (x > y) a++; else if (y > x) b++; }); return a > b ? 1 : a < b ? 0 : null; };
    const byT = {}; orderedGames().forEach(g => { if (g.scoreA == null || g.scoreB == null || g.scoreA + g.scoreB <= 0) return; if (noElo(tInfo[g.tournamentId])) return; (byT[g.tournamentId] = byT[g.tournamentId] || []).push(g); });
    const tIds = state.tournaments.map(tt => tt.id).filter(id => byT[id]); Object.keys(byT).forEach(id => { if (!tIds.includes(id)) tIds.push(id); });
    const tsum = {};
    // правка админа «после X», где X выпал из Эло (оспоренный / отменённый матч) — применяется на месте X по порядку, а не в самом конце
    const inT = new Set(tIds), tPos = {}; state.tournaments.forEach((tt, i) => tPos[tt.id] = i);
    const applyGone = before => [...new Set(overrides.filter(o => !o.done && o.after && !inT.has(o.after) && tPos[o.after] != null && tPos[before] != null && tPos[o.after] < tPos[before]).map(o => o.after))].forEach(applyOv);
    tIds.forEach(tid => {
      applyGone(tid);
      const snap = { ...r }, avg = ids => ids.reduce((a, id) => a + (snap[id] ?? 1500), 0) / ids.length;
      const items = {}, sum = {}, isM = !!(tInfo[tid] && tInfo[tid].s && tInfo[tid].s.kind === "match"), sr = setsRes(tInfo[tid]);
      byT[tid].forEach(g => {
        const rA = avg(g.teamA), rB = avg(g.teamB), eA = eloExpect(rA, rB), m = eloMargin(g.scoreA - g.scoreB);
        const sA = sr != null ? sr : g.scoreA > g.scoreB ? 1 : g.scoreA < g.scoreB ? 0 : 0.5, dA = ELO.K * m * (sA - eA);
        g.teamA.concat(g.teamB).forEach(id => { if (!st[id]) return; st[id].g++; if (!isM) tp[id].add(tid);
          const inA = g.teamA.includes(id), own = inA ? g.scoreA : g.scoreB, opp = inA ? g.scoreB : g.scoreA, mine = inA ? g.teamA : g.teamB, them = inA ? g.teamB : g.teamA;
          const win = inA ? sA === 1 : sA === 0, loss = inA ? sA === 0 : sA === 1; if (!win && !loss) st[id].d++; else if (win) st[id].w++; else st[id].l++;
          const raw = inA ? dA : -dA; sum[id] = (sum[id] || 0) + raw;
          (items[id] = items[id] || []).push({ g, own, opp, win, loss, partner: mine.find(x => x !== id), opps: them, ownR: inA ? rA : rB, oppR: inA ? rB : rA, e: inA ? eA : 1 - eA, m, raw, d: raw }); });
      });
      Object.keys(items).forEach(id => {
        const total = sum[id], capped = Math.max(-ELO.T_CAP, Math.min(ELO.T_CAP, total)), f = total ? capped / total : 1;
        items[id].forEach(x => { x.d = x.raw * f; x.capped = f < 0.999; }); r[id] += capped;
        (tsum[id] = tsum[id] || {})[tid] = { raw: total, d: capped, before: snap[id], after: r[id] };
        seq[id] = (seq[id] || []).concat(items[id]);
      });
      applyOv(tid);
    });
    overrides.filter(o => !o.done).forEach(o => { o.done = true; if (r[o.pid] == null) return; (adj[o.pid] = adj[o.pid] || []).push({ after: o.after, from: r[o.pid], to: o.value, at: o.at }); r[o.pid] = o.value; }); // турнир удалён — правка всё равно действует
    const unconfirmed = {}; state.players.forEach(p => unconfirmed[p.id] = !p.confirmed && tp[p.id].size < CONFIRM_N);
    const tcount = {}; Object.keys(tp).forEach(id => tcount[id] = tp[id].size);
    const lastT = tIds[tIds.length - 1] || null;
    return { ratings: r, stats: st, unconfirmed, tcount, seq, tsum, adj, lastT };
  }
  const board = () => { const E = computeElo(); return { E, list: state.players.filter(p => p.active && p.levelStatus === "ok").sort((a, b) => E.ratings[b.id] - E.ratings[a.id]) }; };

  // ---------- общие кусочки ----------
  const HOME_IC = `<svg class="home-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M12 11.5v5M9.5 14h5"/></svg>`;
  const SIL = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="12"/><path d="M8 60c2-14 12-22 24-22s22 8 24 22z"/></svg>`;
  const avatarHtml = (pid, sz) => { const p = byId(state.players, pid); sz = sz || 44; return p && p.avatar ? `<span class="avatar" style="width:${sz}px;height:${sz}px;"><img src="${esc(p.avatar)}" alt=""></span>` : `<span class="avatar ph" style="width:${sz}px;height:${sz}px;">${SIL}</span>`; };
  const pname = pid => { const p = byId(state.players, pid); return p ? p.name : "?"; };
  // ---------- партнёр (LuPadel): ссылки и переключатели живут в leagues.settings.partner, правит админ ----------
  const PARTNER_DEF = { name: "LuPadel", shop: "https://lupadel.olx.ua/uk/home/", consult: "", season: true };
  const partner = () => ({ ...PARTNER_DEF, ...(((state.league || {}).partner) || {}) });
  const httpsOk = u => /^https:\/\/[^\s"'<>]+$/.test(u || "");
  function partnerHtml(kind, tid) {
    const P = partner(), btn = (u, l, k) => httpsOk(u) ? `<button class="btn sm" data-act="open-link" data-url="${esc(u)}" data-pt="${k}" data-ptw="${kind}" data-ptt="${esc(tid || "")}">${l} ↗</button>` : "";
    const links = btn(P.shop, t("p_shop"), "shop") + btn(P.consult, t("p_consult"), "consult");
    return `<div class="card pt-card ${kind}"><div class="pt-top"><span class="pt-kick">${t(kind === "season" ? "p_season" : "p_prizes")}</span><img class="pt-logo" src="lupadel.svg" alt="${esc(P.name)}"></div>
      ${kind === "prizes" ? `<p class="tiny" style="margin:8px 0 0;">${t("p_prizes_sub")}</p>` : ""}${links ? `<div class="pt-links">${links}</div>` : ""}</div>`;
  }
  // подпись игрока в текущем турнире (ставит админ): «Имя (подпись)» — видят все; LBL заполняется при показе турнира
  let LBL = {};
  // постоянная подпись игрока (players.label, ставит админ) — показывается везде; подпись турнира важнее
  const plab = pid => { const p = byId(state.players, pid); return (p && p.label) || ""; };
  const lblOf = pid => LBL[pid] || plab(pid);
  const lblHtml = pid => lblOf(pid) ? ` <span class="nm-lbl">(${esc(lblOf(pid))})</span>` : "";
  const pnl = pid => esc(pname(pid)) + lblHtml(pid);           // имя + подпись, без ссылки
  const pnt = pid => pname(pid) + (lblOf(pid) ? " (" + lblOf(pid) + ")" : ""); // то же простым текстом
  const pl = pid => `<span class="plink" data-act="open-profile" data-id="${esc(pid)}">${esc(pname(pid))}</span>${lblHtml(pid)}`;
  let toastTimer; function toast(m) { const el = document.getElementById("toast"); el.textContent = m; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200); }
  const err = e => toast(t("error", { msg: (e && e.message) || e }));
  // поле ввода с кнопкой ✓ справа: прячет клавиатуру и сохраняет (scope: ob — анкета, pf:<id> — профиль)
  const okWrap = (inner, scope) => `<span class="ok-wrap">${inner}<button type="button" class="ok-btn" data-act="field-ok" data-scope="${scope}" aria-label="${t("save")}">✓</button></span>`;
  const decFix = inp => { const cur = inp.value; let x = cur.replace(/,/g, ".").replace(/[^0-9.]/g, ""); const i = x.indexOf("."); if (i >= 0) x = x.slice(0, i + 1) + x.slice(i + 1).replace(/\./g, "");
    if (x !== cur) { const pos = inp.selectionStart; inp.value = x; try { inp.setSelectionRange(Math.min(pos, x.length), Math.min(pos, x.length)); } catch (e) {} } };
  const isField = el => !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "file", "button", "submit"].includes(el.type)));
  // подтверждение: в Telegram — родное окно; иначе — своё окно в приложении (системный confirm() в некоторых встроенных браузерах заблокирован и молча отвечает «нет»)
  const ask = msg => new Promise(res => {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData && tg.showConfirm && (!tg.isVersionAtLeast || tg.isVersionAtLeast("6.2"))) { try { tg.showConfirm(msg, ok => res(!!ok)); return; } catch (e) {} }
    const wrap = document.createElement("div"); wrap.className = "ask-modal";
    wrap.innerHTML = `<div class="ask-box" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="ask-btns"><button type="button" class="btn" data-v="0">${t("cancel")}</button><button type="button" class="btn primary" data-v="1">OK</button></div></div>`;
    const fin = v => { wrap.remove(); res(v); };
    wrap.onclick = e => { const b = e.target.closest("[data-v]"); if (b) fin(b.dataset.v === "1"); else if (e.target === wrap) fin(false); };
    document.body.appendChild(wrap); const ok = wrap.querySelector('[data-v="1"]'); if (ok) ok.focus();
  });
  let savingN = 0, saveEpoch = 0; // сколько счетов сейчас сохраняется; номер «поколения» сохранений
  async function reload() { try { const ep = saveEpoch; const d = await db.loadAll();
      if (savingN || ep !== saveEpoch) { pendingLive = true; return; } // пока грузили, ушёл новый счёт — эти данные уже устарели
      Object.assign(state, d); render(); } catch (e) { console.error(e); } }
  let reloadTimer, pendingLive = false;
  const liveReload = () => { if (isField(document.activeElement) || savingN) { pendingLive = true; return; } pendingLive = false; reload(); };
  db.subscribe(() => { clearTimeout(reloadTimer); reloadTimer = setTimeout(liveReload, 600); });
  const timeRange = s => s.time ? esc(s.time) + (s.time_end ? "–" + esc(s.time_end) : "") : "";
  const regsOf = tid => state.registrations.filter(r => r.tournamentId === tid && r.status !== "cancelled").sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const myReg = tid => { const me = myPlayer(); return me ? regsOf(tid).find(r => r.playerId === me.id) : null; };
  // подходит ли турнир по уровню текущему игроку (null — уровень ещё не подтверждён)
  // текущий уровень игрока = текущее Эло / 1000 (с учётом турниров и правок админа); кеш сбрасывается на каждом render()
  let _EC = null; const Enow = () => _EC || (_EC = computeElo());
  const lvNow = pOrId => { const p = typeof pOrId === "string" ? byId(state.players, pOrId) : pOrId; if (!p || (p.level == null && p.levelStatus !== "ok")) return p ? p.level : null; const r = Enow().ratings[p.id]; return r != null ? Math.round(r) / 1000 : p.level; };
  const fitsLevel = tt => { const me = myPlayer(); if (!me || me.level == null || me.levelStatus !== "ok") return null; const lv = lvNow(me);
    const a = tt.s.level_min, b = tt.s.level_max; return (a == null || lv >= +a) && (b == null || lv <= +b); };
  const isUpcoming = tt => tt.status !== "played" && (!tt.date || tt.date >= today());
  // ---------- запись парами и подтверждение заявок ----------
  const isPairs = tt => !!(tt && tt.s.pairs);
  const teamMembers = (tid, n) => regsOf(tid).filter(r => r.status === "main" && r.team === n);
  const teamNos = tt => { const n = +tt.s.slots || 0; if (n > 0) return Array.from({ length: n }, (_, i) => i + 1);
    const used = [...new Set(regsOf(tt.id).filter(r => r.status === "main" && r.team != null).map(r => r.team))].sort((a, b) => a - b); return used.concat([(used[used.length - 1] || 0) + 1]); };
  const firstFreeTeam = (tid, need) => { const tt = byId(state.tournaments, tid); return teamNos(tt).find(n => teamMembers(tid, n).length + (need || 1) <= 2) ?? null; };
  const pendingOf = tid => regsOf(tid).filter(r => r.approval === "pending");
  const myRejected = tid => { const me = myPlayer(); return me ? state.registrations.find(r => r.tournamentId === tid && r.playerId === me.id && r.approval === "rejected") : null; };
  const regBadge = r => r.approval === "pending" ? `<span class="ct-mine pending">${t("pending_approval")}</span>` : `<span class="ct-mine ${r.status}">${r.status === "main" ? t("registered_main") : t("registered_reserve")}</span>`;
  const regErrMsg = m => /team full/.test(m) ? t("team_full") : /partner already/.test(m) ? t("partner_taken") : /partner level/.test(m) ? t("partner_level_bad") : /too low/.test(m) ? t("level_too_low") : /too high/.test(m) ? t("level_too_high") : /closed/.test(m) ? t("registration_closed") : /level pending/.test(m) ? t("reg_need_level") : /no player/.test(m) ? t("need_card") : t("error", { msg: m });
  const regToast = r => /pending/.test(r || "") ? t("request_sent") : /reserve/.test(r || "") ? t("registered_reserve") : t("registered_main");

  // ---------- анкета ----------
  function viewOnboarding() {
    const d = state._onb || (state._onb = { name: (U.name && U.name !== "?" ? U.name : ""), source: "playtomic", level: "", ig: "", step: null, answers: [] });
    if (d.step != null) return viewQuiz(d);
    const isQuiz = d.source === "quiz";
    const lv = isQuiz ? null : toRaketo(d.source, d.level);
    return `
      <div class="section-head"><h2>${t("welcome")}</h2></div>
      <div class="card">
        <p class="tiny" style="margin:0 0 14px;">${t("onboarding_hint")}</p>
        <label class="field"><span class="lbl">${t("your_name")}</span>${okWrap(`<input type="text" id="obName" value="${esc(d.name)}" maxlength="40" enterkeyhint="done">`, "ob")}</label>
        <label class="field"><span class="lbl">${t("instagram_opt")}</span>${okWrap(`<input type="text" id="obIg" value="${esc(d.ig)}" placeholder="@nickname" enterkeyhint="done">`, "ob")}</label>
        ${bdSelects("ob", d.bd || { d: "", m: "", y: "" })}
        <div class="field"><span class="lbl">${t("level_source")}</span><div class="wrap-tags">${["playtomic","pado","raketo","quiz"].map(x => `<span class="chip ${d.source===x?'active':''} ${x==="quiz"?"chip-quiz":""}" data-act="ob-source" data-val="${x}">${t("src_"+x)}</span>`).join("")}</div></div>
        ${isQuiz ? `
        <div class="quiz-intro"><div class="quiz-intro-ic">?</div><p>${t("quiz_intro")}</p></div>
        <button class="btn primary block" data-act="quiz-start">${t("quiz_start")} →</button>` : `
        <label class="field"><span class="lbl">${t("app_nick", { app: t("src_" + d.source) })}</span>${okWrap(`<input type="text" id="obNick" value="${esc(d.nick || "")}" placeholder="${t("nick_or_link")}" maxlength="200" enterkeyhint="done">`, "ob")}<span class="tiny field-hint">${t("link_hint_" + d.source) || ""}</span></label>
        <label class="field"><span class="lbl">${t("lv_in_" + d.source)}</span>${okWrap(`<input type="text" inputmode="decimal" autocomplete="off" class="dec-in" id="obLevel" enterkeyhint="done" value="${esc(d.level)}" placeholder="${{ raketo: "2.434", pado: "1450", playtomic: "3.25" }[d.source]}">`, "ob")}</label>
        <div class="ob-preview ${lv==null?'dim':''}">${levelBadge(lv, "big")}<div><div class="tiny">${d.source === "raketo" ? "" : t("as_raketo") + " · "}${t("letter")} · ${t("start_elo")}</div><div class="ob-elo">${lv==null?"—":(d.source === "raketo" ? "" : fmtLv(lv) + " · ") + letter(lv)+" · "+levelElo(lv)}</div></div></div>
        <div class="review-note">${t("review_note", { app: t("src_" + d.source) })}</div>
        <button class="btn primary block" style="margin-top:14px;" data-act="ob-save" ${d.name.trim().length<2||lv==null||lv<0||lv>7||!(d.nick||"").trim()?"disabled":""}>${t("send_review")}</button>`}
      </div>`;
  }
  function viewQuiz(d) {
    const Q = quiz(), n = Q.length;
    if (d.step >= n) {
      const lv = quizLevel(d.answers);
      return `<div class="section-head"><h2>${t("quiz_result")}</h2></div>
        <div class="card quiz-result">
          <div class="qr-badge">${levelBadge(lv, "huge")}</div>
          <div class="qr-elo">${letter(lv)} · ${levelElo(lv)} Elo</div>
          <div class="tiny" style="text-align:center;">${t("level_value")} ${fmtLv(lv)}</div>
          <p class="tiny" style="margin:14px 0;">${t("quiz_note")}</p>
          <p class="tiny" style="margin:0 0 12px;">${t("quiz_adjust_hint")}</p>
          <button class="btn primary block" data-act="quiz-save">${t("done")}</button>
        </div>`;
    }
    const [q, opts] = Q[d.step];
    return `<div class="section-head"><button class="btn ghost sm back" data-act="quiz-back">‹ ${t("back")}</button><span class="tiny">${t("quiz_step", { n: d.step + 1, total: n })}</span></div>
      <div class="quiz-bar"><i style="width:${Math.round(d.step / n * 100)}%"></i></div>
      <div class="card quiz-card">
        <h2 class="quiz-q">${esc(q)}</h2>
        <div class="quiz-opts">${opts.map((o, i) => `<button class="quiz-opt ${d.answers[d.step] === i ? "on" : ""}" data-act="quiz-ans" data-val="${i}"><span class="quiz-dot">${i + 1}</span>${esc(o)}</button>`).join("")}</div>
      </div>`;
  }
  async function saveOnboarding() {
    const d = state._onb; const ig = d.ig.trim().replace(/^@/, "");
    const isQuiz = d.source === "quiz"; const score = d.answers.reduce((a, x) => a + x, 0);
    const lv = isQuiz ? quizLevel(d.answers) : toRaketo(d.source, d.level);
    const bd = bdValue(d.bd); if (bd === null) { toast(t("bd_bad")); return; }
    const extra = { ...(ig ? { instagram: ig } : {}), ...(bd ? { birthday: bd } : {}), ...(isQuiz ? { quiz: d.answers.slice() } : { [d.source]: appLink(d.nick) || (d.nick || "").trim().replace(/^@/, ""), level_raw: String(d.level).trim() }) };
    try {
      if (d.retest) await db.submitQuiz(d.answers.slice(), score);
      else await db.createMyPlayer(d.name.trim(), lv, d.source, extra);
      state._onb = null; await reload(); toast(isQuiz ? t("saved") : t("sent_review"));
    } catch (e) { err(e); }
  }

  function levelBannerHtml() {
    const me = myPlayer(); if (!me || me.levelStatus === "ok") return "";
    const src = (me.contacts || {}).level_source || "", app = t("src_" + src), nick = (me.contacts || {})[src];
    if (me.levelStatus === "pending") return `<div class="lv-banner pending"><div class="lv-banner-ic">⏳</div><div>
      <b>${t("pending_title")}</b><p>${t("pending_text", { lv: fmtLv(me.levelClaim), letter: letter(me.levelClaim), app })}${nick ? ` (${esc(nick)})` : ""}.</p>
      <button class="btn sm" data-act="retest-start">${t("pending_quiz")}</button></div></div>`;
    return `<div class="lv-banner need"><div class="lv-banner-ic">!</div><div><b>${t("need_quiz_title")}</b><p>${t("need_quiz_text", { app })}</p>
      <button class="btn sm primary" data-act="retest-start">${t("quiz_start")} →</button></div></div>`;
  }

  // ---------- турниры ----------
  function tTile(tt) {
    const regs = regsOf(tt.id), main = regs.filter(r => r.status === "main").length, res = regs.filter(r => r.status === "reserve").length;
    const slots = +tt.s.slots || 0, mine = myReg(tt.id), pairs = isPairs(tt), cap = pairs ? slots * 2 : slots;
    const full = cap > 0 && main >= cap, pend = isAdmin() && isUpcoming(tt) ? pendingOf(tt.id).length : 0;
    const st = tt.status === "played" ? ["done", t("played")] : tt.status === "live" ? ["live", t("live")] : !tt.s.reg_open ? ["planned", t("reg_closed")] : full ? ["res", t("reg_reserve")] : ["live", t("reg_open")];
    return `<div class="tile t-tile ct" data-act="open-t" data-id="${tt.id}">
      <div class="ct-top"><span class="lvb ${letterClass(rangeLabel(tt.s)[0]==="≤"?rangeLabel(tt.s).slice(2):rangeLabel(tt.s))}">${esc(rangeLabel(tt.s))}</span><span class="t-status ${st[0]}"><i></i>${st[1]}</span></div>
      <div class="t-tile-name">${esc(tt.name)}</div>
      <div class="tiny">${dateFmt(tt.date, true)}${tt.s.time ? " · " + timeRange(tt.s) : ""}${tt.s.place ? " · " + esc(tt.s.place) : ""}${pairs ? " · " + t(tt.format) : ""}</div>
      ${tt.s.partner_prizes ? `<div class="pt-tag">🎁 ${t("p_prizes")}</div>` : ""}
      ${pend ? `<div class="ct-pend">⏳ ${t("pending_n", { n: pend })}</div>` : ""}
      <div class="ct-bottom">
        <span class="ct-slots">${tt.status === "played" ? `<b>${new Set(state.games.filter(g => g.tournamentId === tt.id).flatMap(g => g.teamA.concat(g.teamB))).size}</b> ${t("players").toLowerCase()}` : pairs ? `<b>${main}</b>/${cap || "∞"} ${t("slots")} · ${slots || "∞"} ${t("pairs_n")}${res ? ` · ${t("reserve")} ${res}` : ""}` : slots ? `<b>${main}</b>/${slots} ${t("slots")}${res ? ` · ${t("reserve")} ${res}` : ""}` : `${main} ${t("players").toLowerCase()}`}</span>
        ${!mine && isUpcoming(tt) && fitsLevel(tt) === false ? `<span class="ct-nofit">${t("not_your_level")}</span>` : mine ? regBadge(mine) : tt.s.price ? `<span class="tiny">${esc(tt.s.price)} ₴</span>` : ""}
      </div>
    </div>`;
  }
  function viewTournaments() {
    if (state.view.t) return viewTournamentDetail(state.view.t);
    const list = state.tournaments.filter(tt => !isGameT(tt)), up = list.filter(isUpcoming), past = list.filter(tt => !isUpcoming(tt)).reverse();
    return `${levelBannerHtml()}<div class="section-head"><h2>${t("tournaments")}</h2>${canEdit() ? `<button class="btn primary sm" data-act="new-t">${t("new_tournament")}</button>` : ""}</div>
      ${up.length ? `<div class="stack">${up.map(tTile).join("")}</div>` : `<div class="card"><div class="empty"><div class="ic">&#127934;</div>${t("no_tournaments")}</div></div>`}
      ${past.length ? `<h3 class="sub-h">${t("past")}</h3><div class="stack">${past.map(tTile).join("")}</div>` : ""}`;
  }
  function viewTournamentDetail(tid) {
    if (state.view.editT === tid && state._tf) return tournamentFormHtml(state._tf);
    const tt = byId(state.tournaments, tid); if (!tt) { state.view.t = null; return viewTournaments(); }
    LBL = (tt.s && tt.s.labels) || {};
    if (state.view.editT === tid) return tournamentFormHtml(tt);
    if (state.view.run === tid && state._run && canEditT(tt)) return runSetupHtml(tt);
    if (tt.status === "live" || (state.view.fix === tid && canEditT(tt))) return liveHtml(tt, tt.status !== "live");
    const tGames = state.games.filter(g => g.tournamentId === tid && g.scoreA != null && g.scoreB != null);
    if (tGames.length) return tournamentResultsHtml(tt, tGames);
    const regs = regsOf(tid), main = regs.filter(r => r.status === "main"), res = regs.filter(r => r.status === "reserve");
    const pairs = isPairs(tt), slots = +tt.s.slots || 0, cap = pairs ? slots * 2 : slots, mine = myReg(tid), me = myPlayer(), rej = !mine && myRejected(tid);
    const free = cap ? Math.max(0, cap - main.length) : null;
    const canReg = tt.s.reg_open && tt.status !== "played";
    const canJoin = !!me && me.levelStatus === "ok" && !mine && canReg && fitsLevel(tt) !== false;
    const adminBtns = r => r.approval === "pending"
      ? `<button class="btn sm ok" data-act="reg-approve" data-tid="${tid}" data-pid="${r.playerId}" title="${t("approve")}" aria-label="${t("approve")}">✓</button><button class="btn sm ghost danger" data-act="reg-reject" data-tid="${tid}" data-pid="${r.playerId}" title="${t("reject")}" aria-label="${t("reject")}">✕</button>`
      : `<button class="btn sm ${r.paid?'primary':''}" data-act="reg-paid" data-tid="${tid}" data-pid="${r.playerId}">₴</button><button class="btn sm ghost" data-act="reg-move" data-tid="${tid}" data-pid="${r.playerId}" data-to="${r.status==='main'?'reserve':'main'}" title="${r.status==='main'?t('move_reserve'):t('move_main')}">${r.status==='main'?'↓':'↑'}</button><button class="btn sm ghost danger" data-act="reg-remove" data-tid="${tid}" data-pid="${r.playerId}">✕</button>`;
    const sub = r => `${letter(lvNow(r.playerId))}${r.approval === "pending" ? ` · <span class="pend-tag">${t("pending_approval")}</span>` : ""}${isAdmin() && r.approval !== "pending" ? " · " + (r.paid ? "✓ " + t("paid") : t("not_paid")) : ""}`;
    const row = (r, i) => `<div class="link-row p-row ${r.approval === "pending" ? "is-pending" : ""}"><span class="p-row-main" data-act="open-profile" data-id="${r.playerId}">${avatarHtml(r.playerId, 34)}<span><span class="p-row-name">${pnl(r.playerId)}</span><br><span class="tiny">${sub(r)}</span></span></span>
      <span class="p-row-side">${isAdmin() ? adminBtns(r) : i != null ? `<span class="tiny">${i+1}</span>` : ""}</span></div>`;
    const approvalNote = tt.s.approval && canReg ? `<p class="tiny" style="margin:8px 0 0;">${t("approval_note")}</p>` : "";
    const rejNote = rej ? `<div class="rej-note">${t("rejected_note")}</div>` : "";
    let regBtn;
    if (!me) regBtn = `<p class="tiny">${t("need_card")}</p>`;
    else if (me.levelStatus !== "ok") regBtn = `<p class="tiny">${t("reg_need_level")}</p>`;
    else if (mine) regBtn = `<div class="row">${regBadge(mine)}${!pairs && mine.status === "reserve" && mine.approval !== "pending" ? `<span class="tiny">${t("you_in_reserve_pos", { n: res.findIndex(r => r.playerId === me.id) + 1 })}</span>` : ""}${canReg ? `<button class="btn sm" data-act="unreg" data-id="${tid}">${mine.approval === "pending" ? t("withdraw_request") : t("unregister")}</button>` : ""}</div>`
      + (mine.approval === "pending" ? `<p class="tiny" style="margin:8px 0 0;">${t("pending_hint")}</p>` : "")
      + (pairs && mine.addedBy && mine.addedBy !== me.id ? `<p class="tiny" style="margin:8px 0 0;">${t("added_by_partner", { name: esc(pname(mine.addedBy)) })}</p>` : "");
    else if (fitsLevel(tt) === false) regBtn = `<div class="nofit-note">${t(lvNow(me) < +(tt.s.level_min ?? -1) ? "level_too_low" : "level_too_high")} · ${letter(lvNow(me))} ${fmtLv(lvNow(me))}</div>`;
    else if (!canReg) regBtn = `<p class="tiny">${t("registration_closed")}</p>`;
    else if (pairs) {
      const inRange = p => { const lv = lvNow(p); return (tt.s.level_min == null || (lv != null && lv >= +tt.s.level_min)) && (tt.s.level_max == null || (lv != null && lv <= +tt.s.level_max)); };
      const cands = state.players.filter(p => p.active && p.id !== me.id && p.levelStatus === "ok" && !regs.some(r => r.playerId === p.id) && inRange(p)).sort((a, b) => a.name.localeCompare(b.name));
      const emptyPair = firstFreeTeam(tid, 2) != null, anyPlace = firstFreeTeam(tid, 1) != null;
      regBtn = rejNote + (state.view.partnerFor === tid
        ? `<div class="partner-pick"><label class="field"><span class="lbl">${t("choose_partner")}</span><select id="partnerSel">${cands.map(p => `<option value="${p.id}">${esc(p.name)}${p.label ? " (" + esc(p.label) + ")" : ""} · ${letter(lvNow(p))}</option>`).join("")}</select></label>
            ${cands.length ? "" : `<p class="tiny" style="margin:-4px 0 10px;">${t("no_partners")}</p>`}
            <div class="row" style="gap:8px;justify-content:flex-end;"><button class="btn sm" data-act="partner-cancel">${t("cancel")}</button><button class="btn sm primary" data-act="reg-pair" data-id="${tid}" ${cands.length ? "" : "disabled"}>${emptyPair ? t("reg_as_pair") : t("reg_pair_reserve")}</button></div></div>`
        : `<button class="btn primary block" data-act="partner-open" data-id="${tid}">${t("reg_with_partner")}</button>
           ${anyPlace ? `<p class="tiny" style="margin:8px 0 0;text-align:center;">${t("or_take_place")}</p>` : `<button class="btn block" style="margin-top:8px;" data-act="reg" data-id="${tid}">${t("reg_reserve_solo")}</button>`}`) + approvalNote;
    }
    else regBtn = rejNote + `<button class="btn primary block" data-act="reg" data-id="${tid}">${t("register")}${free != null ? ` · ${free ? t("free_slots", { n: free }) : t("reserve")}` : ""}</button>` + approvalNote;
    // карточка пары: 2 места; на первом свободном месте — кнопка «Зайняти»
    const pairCard = n => { const m = teamMembers(tid, n), my = me && m.some(r => r.playerId === me.id);
      const place = k => m[k] ? row(m[k], null) : `<div class="pair-free">${canJoin && k === m.length ? `<button class="btn sm" data-act="reg-team" data-id="${tid}" data-team="${n}">+ ${t("take_place")}</button>` : `<span class="tiny">${t("free_place")}</span>`}</div>`;
      if (!m.length) return `<div class="pair-slot empty"><div class="pair-slot-h"><b>${t("pair")} ${n}</b>${canJoin ? `<button class="btn sm" data-act="reg-team" data-id="${tid}" data-team="${n}">+ ${t("take_place")}</button>` : `<span class="tiny">0/2 · ${t("free_place")}</span>`}</div></div>`;
      return `<div class="pair-slot ${m.length === 2 ? "full" : ""} ${my ? "mine" : ""}"><div class="pair-slot-h"><b>${t("pair")} ${n}</b><span class="tiny">${m.length}/2</span></div>${place(0)}${place(1)}</div>`; };
    const fullPairs = teamNos(tt).filter(n => teamMembers(tid, n).length === 2).length;
    const addTeamSel = pairs ? `<select id="addRegTeam" style="flex:0 0 auto;max-width:42%;">${teamNos(tt).filter(n => teamMembers(tid, n).length < 2).map(n => `<option value="${n}">${t("pair")} ${n}</option>`).join("")}<option value="">${t("reserve")}</option></select>` : "";
    return `
      <div class="section-head"><button class="btn ghost sm back" data-act="t-back">‹ ${backLbl()}</button>${canEditT(tt) ? `<button class="btn sm" data-act="edit-t" data-id="${tid}">${t("edit")}</button>` : ""}</div>
      <h2 class="t-title">${esc(tt.name)}</h2>
      <div class="card">
        <div class="info-grid">
          <div><span class="tiny">${t("t_date")}</span><b>${dateFmt(tt.date, true)}</b></div>
          <div><span class="tiny">${t("time")}</span><b>${timeRange(tt.s) || "—"}</b></div>
          <div><span class="tiny">${t("place")}</span><b>${esc(tt.s.place || "—")}</b></div>
          <div><span class="tiny">${t("format")}</span><b>${esc(t(tt.format))}</b></div>
          <div><span class="tiny">${t("level_range")}</span><b>${esc(rangeLabel(tt.s))}</b></div>
          <div><span class="tiny">${t("price")}</span><b>${tt.s.price ? esc(tt.s.price) + " ₴" : "—"}</b></div>
          ${(tt.s.court_nums || []).length ? `<div><span class="tiny">${t("courts_lbl")}</span><b>${tt.s.court_nums.map(esc).join(", ")}</b></div>` : ""}
        </div>
        ${tt.s.note ? `<p class="tiny" style="margin:10px 0 0;white-space:pre-line;">${esc(tt.s.note)}</p>` : ""}
        <div style="margin-top:14px;">${regBtn}</div>
        ${tt.s.contact ? `<button class="btn block" style="margin-top:8px;" data-act="open-link" data-url="${esc(tt.s.contact)}">${t("write_organizer")} ↗</button>` : ""}
      </div>
      ${tt.s.partner_prizes ? partnerHtml("prizes", tt.id) : ""}
      ${raffleHtml(tt)}
      ${pairs
        ? `<div class="card"><h3>${t("pairs_title")} <span class="tiny">· ${fullPairs}/${slots || teamNos(tt).length - 1}</span></h3><div class="pair-grid">${teamNos(tt).map(pairCard).join("")}</div></div>`
        : `<div class="card"><h3>${t("main_list")} <span class="tiny">· ${main.length}${slots ? "/" + slots : ""}</span></h3><div style="margin-top:6px;">${main.map(row).join("") || `<div class="tiny">${t("nobody_yet")}</div>`}</div></div>`}
      ${res.length || isAdmin() ? `<div class="card"><h3>${t("reserve_list")} <span class="tiny">· ${res.length}</span></h3><div style="margin-top:6px;">${res.map(row).join("") || `<div class="tiny">${t("nobody_yet")}</div>`}</div></div>` : ""}
      ${tt.s.kind === "ftour" && tt.s.created_by ? `<div class="card"><span class="tiny">${t("organizer_lbl")}:</span> ${pl(tt.s.created_by)}</div>` : ""}
      ${canEditT(tt) && tt.status !== "played" ? runCardHtml(tt) : ""}
      ${labelsCardHtml(tt, main.map(r => r.playerId))}
      ${isAdmin() ? `<div class="card"><h3>${t("add_player")}</h3><div class="row" style="margin-top:8px;gap:8px;"><select id="addRegSel" style="flex:1;min-width:0;">${state.players.filter(p => p.active && !regs.some(r => r.playerId === p.id)).sort((a,b)=>a.name.localeCompare(b.name)).map(p => `<option value="${p.id}">${esc(p.name)}${p.label ? " (" + esc(p.label) + ")" : ""} · ${letter(lvNow(p))}</option>`).join("")}</select>${addTeamSel}<button class="btn" data-act="reg-add" data-id="${tid}">+</button></div>
        <p class="tiny" style="margin:10px 0 0;">${t("score_later")}</p></div>` : ""}`;
  }
  // ---------- итоги турнира: таблица, статистика, раунды по кнопке ----------
  function tournamentResultsHtml(tt, tGames) {
    const tid = tt.id, E = computeElo();
    const row = {}; const R = id => row[id] = row[id] || { id, pts: 0, pa: 0, w: 0, l: 0, d: 0, g: 0 };
    tGames.forEach(g => { [[g.teamA, g.scoreA, g.scoreB], [g.teamB, g.scoreB, g.scoreA]].forEach(([team, own, opp]) => team.forEach(id => { const r = R(id); r.g++; r.pts += own; r.pa += opp; if (own > opp) r.w++; else if (own < opp) r.l++; else r.d++; })); });
    const eloD = id => (E.seq[id] || []).filter(x => x.g.tournamentId === tid).reduce((a, x) => a + x.d, 0);
    const rows = Object.values(row).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.pts - b.pa) - (a.pts - a.pa));
    const finished = tt.status === "played" || (tt.date && tt.date < today());
    const roundsOpen = !finished || state.view.roundsOpen === tid;
    const byRound = {}; tGames.forEach(g => (byRound[g.round] = byRound[g.round] || []).push(g));
    const rKeys = Object.keys(byRound).sort((a, b) => a - b);
    // статистика турнира
    const facts = [];
    const top = (arr, key) => { const m = Math.max(...arr.map(x => x[key])); return arr.filter(x => x[key] === m); };
    if (rows.length) { const m = top(rows, "pts"); facts.push([t("f_mvp"), m.map(x => pl(x.id)).join(", "), m[0].pts + " " + t("pts")]); }
    const mw = top(rows, "w"); if (mw.length <= 2 && mw[0].w) facts.push([t("f_wins"), mw.map(x => pl(x.id)).join(", "), mw[0].w + "-" + mw[0].l]);
    const pairs = {}; tGames.forEach(g => [[g.teamA, g.scoreA - g.scoreB], [g.teamB, g.scoreB - g.scoreA]].forEach(([tm, df]) => { const k = tm.slice().sort().join("|"); const q = pairs[k] = pairs[k] || { ids: tm, n: 0, df: 0 }; q.n++; q.df += df; }));
    const bp = Object.values(pairs).filter(x => x.n >= 2).sort((a, b) => b.df / b.n - a.df / a.n)[0];
    if (bp && bp.df > 0) facts.push([t("f_best_pair"), bp.ids.map(pl).join(" + "), (bp.df >= 0 ? "+" : "") + (bp.df / bp.n).toFixed(1) + " " + t("per_game")]);
    const gl = g => { const w = g.scoreA >= g.scoreB ? g.teamA : g.teamB, l = g.scoreA >= g.scoreB ? g.teamB : g.teamA; return `${w.map(pl).join(" + ")} <span class="tiny">${t("vs")}</span> ${l.map(pl).join(" + ")}`; };
    const big = tGames.slice().sort((a, b) => Math.abs(b.scoreA - b.scoreB) - Math.abs(a.scoreA - a.scoreB))[0];
    if (big && big.scoreA !== big.scoreB) facts.push([t("f_biggest"), gl(big), Math.max(big.scoreA, big.scoreB) + ":" + Math.min(big.scoreA, big.scoreB) + " · " + t("round") + " " + big.round]);
    const close = tGames.filter(g => g !== big).sort((a, b) => Math.abs(a.scoreA - a.scoreB) - Math.abs(b.scoreA - b.scoreB))[0];
    if (close) facts.push([t("f_closest"), gl(close), Math.max(close.scoreA, close.scoreB) + ":" + Math.min(close.scoreA, close.scoreB) + " · " + t("round") + " " + close.round]);
    const eg = rows.map(x => ({ id: x.id, d: eloD(x.id) })).sort((a, b) => b.d - a.d)[0];
    if (eg && eg.d > 0) facts.push([t("f_elo"), pl(eg.id), "+" + Math.round(eg.d) + " Elo"]);
    const sbox = v => `<span class="sbox">${v}</span>`;
    const match = g => { const wa = g.scoreA > g.scoreB, wb = g.scoreB > g.scoreA; return `<div class="match">
        <div class="court-lbl">${t("court")} ${g.court || "—"}</div>
        <div class="mrow"><div class="pair ${wa ? "winner" : ""}">${pl(g.teamA[0])}<small>${g.teamA[1] ? pl(g.teamA[1]) : ""}</small></div>
          <div class="score">${sbox(g.scoreA)}<span class="colon">:</span>${sbox(g.scoreB)}</div>
          <div class="pair right ${wb ? "winner" : ""}">${pl(g.teamB[0])}<small>${g.teamB[1] ? pl(g.teamB[1]) : ""}</small></div></div></div>`; };
    const medal = i => i === 0 ? "gold" : "";
    return `
      <div class="section-head"><button class="btn ghost sm back" data-act="t-back">‹ ${backLbl()}</button>${canEditT(tt) ? `<span style="display:flex;gap:6px;"><button class="btn sm" data-act="fix-open" data-id="${tid}">${t("fix_scores")}</button><button class="btn sm" data-act="edit-t" data-id="${tid}">${t("edit")}</button></span>` : ""}</div>
      <h2 class="t-title">${esc(tt.name)}</h2>
      <p class="tiny" style="margin:-4px 0 12px;">${dateFmt(tt.date, true)}${tt.s.time ? " · " + timeRange(tt.s) : ""}${tt.s.place ? " · " + esc(tt.s.place) : ""} · ${esc(t(tt.format))} · ${esc(rangeLabel(tt.s))}</p>
      ${isTeamF(tt.format) && teamsOf(tt).length ? `<div class="card"><h3>${t("standings")}</h3>${standingsHtml(tt, tGames)}</div>` : ""}
      <div class="card"><h3>${isTeamF(tt.format) && teamsOf(tt).length ? t("players") : t("standings")}</h3>
        <table class="tbl" style="margin-top:6px;"><tr><th></th><th>${t("players")}</th><th>${t("pts")}</th><th>W-L</th><th>${t("diff")}</th><th>Elo</th></tr>
        ${rows.map((r, i) => { const d = eloD(r.id); return `<tr><td><span class="pos-badge ${medal(i)}">${i + 1}</span></td>
          <td class="lb-name"><span class="lb-p" data-act="open-profile" data-id="${r.id}">${avatarHtml(r.id, 28)}<span class="plink">${esc(pname(r.id))}</span>${lblHtml(r.id)}</span></td>
          <td class="lb-elo">${r.pts}</td><td>${r.w}-${r.l}${r.d ? "-" + r.d : ""}</td><td>${r.pts - r.pa >= 0 ? "+" : ""}${r.pts - r.pa}</td>
          <td class="tiny ${d >= 0 ? "up" : "down"}" style="font-size:13px;">${d >= 0 ? "+" : ""}${Math.round(d)}</td></tr>`; }).join("")}
        </table></div>
      ${facts.length ? `<div class="card"><h3>${t("t_stats")}</h3><div class="facts">${facts.map(([k, who, sub]) => `<div class="fact"><div class="tiny">${k}</div><div class="fact-who">${who}</div><div class="fact-sub">${sub}</div></div>`).join("")}</div></div>` : ""}
      ${isAdmin() && finished ? announceCardHtml(tt, tGames) : ""}
      ${tt.s.partner_prizes ? partnerHtml("prizes", tt.id) : ""}
      ${raffleHtml(tt)}
      ${labelsCardHtml(tt, rows.map(r => r.id))}
      ${finished ? `<button class="rounds-toggle ${roundsOpen ? "open" : ""}" data-act="toggle-rounds" data-id="${tid}">${roundsOpen ? t("hide_rounds") : t("view_rounds", { n: rKeys.length })}<span class="chev">›</span></button>` : ""}
      ${roundsOpen ? rKeys.map(r => `<h3 style="margin:16px 0 8px;">${t("round").charAt(0).toUpperCase() + t("round").slice(1)} ${r}</h3>${byRound[r].sort((a, b) => (a.court || 0) - (b.court || 0)).map(match).join("")}`).join("") : ""}`;
  }
  // ---------- факты для объявления после турнира (видит только админ, текст можно зачитать) ----------
  function announceFacts(tt, tGames) {
    const L = [], gs = tGames.filter(scoredG).slice().sort((a, b) => a.round - b.round || (a.court || 0) - (b.court || 0));
    if (!gs.length) return L;
    const N = pnt, P = tm => tm.map(N).join(" + "), sc = g => Math.max(g.scoreA, g.scoreB) + ":" + Math.min(g.scoreA, g.scoreB);
    const W = g => g.scoreA >= g.scoreB ? g.teamA : g.teamB, Lo = g => g.scoreA >= g.scoreB ? g.teamB : g.teamA;
    const vs = g => P(W(g)) + " — " + P(Lo(g)), rnd = g => t("round") + " " + g.round;
    const total = gs.reduce((a, g) => a + g.scoreA + g.scoreB, 0);
    L.push(["📊", t("af_total", { g: gs.length, p: total, r: Math.max(...gs.map(g => g.round)) })]);
    // победители
    const team = isTeamF(tt.format) && teamsOf(tt).length;
    if (team) { const tr = tt.format === "playoff" ? playoffPlaces(teamsOf(tt), gs) : teamTable(teamsOf(tt), gs);
      if (tr[0]) L.push(["🏆", t("af_winner_team", { who: P(tr[0].players), pts: tr[0].pts, w: tr[0].w, l: tr[0].l })]);
      if (tt.format !== "playoff" && tr[1]) { const gap = tr[0].pts - tr[1].pts; L.push(["📏", gap === 0 ? t("af_gap0") : t("af_gap", { n: gap, who: P(tr[1].players) })]); } }
    const ids = [...new Set(gs.flatMap(g => g.teamA.concat(g.teamB)))], R = {}; ids.forEach(id => R[id] = { id, pts: 0, pa: 0, w: 0, l: 0, d: 0, g: 0, seq: [] });
    gs.forEach(g => [[g.teamA, g.scoreA, g.scoreB], [g.teamB, g.scoreB, g.scoreA]].forEach(([tm, own, opp]) => tm.forEach(id => { const r = R[id]; r.g++; r.pts += own; r.pa += opp; const res = own > opp ? "w" : own < opp ? "l" : "d"; r[res]++; r.seq.push(res); })));
    const rows = Object.values(R).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.pts - b.pa) - (a.pts - a.pa));
    if (!team) { const top3 = rows.slice(0, 3);
      L.push(["🏆", t("af_winner", { who: N(top3[0].id), pts: top3[0].pts, w: top3[0].w, l: top3[0].l })]);
      if (top3[1]) { const gap = top3[0].pts - top3[1].pts; L.push(["📏", gap === 0 ? t("af_gap0") : t("af_gap", { n: gap, who: N(top3[1].id) })]); }
      if (top3.length === 3) L.push(["🥈", t("af_podium", { b: N(top3[1].id), c: N(top3[2].id) })]); }
    // самый длинный матч (больше всего очков разыграно) — если счёт не «всегда одна сумма»
    const sums = gs.map(g => g.scoreA + g.scoreB);
    if (new Set(sums).size > 1) { const lg = gs.slice().sort((a, b) => (b.scoreA + b.scoreB) - (a.scoreA + a.scoreB))[0];
      L.push(["⏱", t("af_longest", { m: vs(lg), s: sc(lg), n: lg.scoreA + lg.scoreB, r: rnd(lg) })]); }
    // разгром и самый упорный
    const dec = gs.filter(g => g.scoreA !== g.scoreB);
    const big = dec.slice().sort((a, b) => Math.abs(b.scoreA - b.scoreB) - Math.abs(a.scoreA - a.scoreB) || (b.scoreA + b.scoreB) - (a.scoreA + a.scoreB))[0];
    if (big) L.push(["💥", t("af_blowout", { m: vs(big), s: sc(big), r: rnd(big) })]);
    const tight = dec.filter(g => g !== big).sort((a, b) => Math.abs(a.scoreA - a.scoreB) - Math.abs(b.scoreA - b.scoreB) || (b.scoreA + b.scoreB) - (a.scoreA + a.scoreB));
    if (tight[0]) { const d = Math.abs(tight[0].scoreA - tight[0].scoreB), many = tight.filter(g => Math.abs(g.scoreA - g.scoreB) === d).length;
      L.push(["🫀", t("af_tight", { m: vs(tight[0]), s: sc(tight[0]), r: rnd(tight[0]) }) + (many > 1 ? " " + t("af_tight_more", { n: many - 1, d }) : "")]); }
    const shut = gs.filter(g => Math.min(g.scoreA, g.scoreB) === 0 && g.scoreA !== g.scoreB); if (shut.length) L.push(["🧹", t("af_shutout", { m: shut.map(vs).join("; ") })]);
    const draws = gs.filter(g => g.scoreA === g.scoreB); if (draws.length) L.push(["🤝", t("af_draws", { n: draws.length })]);
    // серии и без поражений (индивидуально)
    const streak = r => { let b = 0, c = 0; r.seq.forEach(x => { c = x === "w" ? c + 1 : 0; b = Math.max(b, c); }); return b; };
    const st = rows.map(r => ({ id: r.id, n: streak(r) })).sort((a, b) => b.n - a.n);
    if (st[0] && st[0].n >= 3) { const who = st.filter(x => x.n === st[0].n); if (who.length <= 3) L.push(["🔥", t("af_streak", { who: (team ? [...new Set(who.map(x => P(teamsOf(tt).find(tm => tm.includes(x.id)) || [x.id])))] : who.map(x => N(x.id))).join(", "), n: st[0].n })]); }
    const unb = rows.filter(r => r.g >= 3 && !r.l); if (unb.length && unb.length <= 4) L.push(["🛡", t("af_unbeaten", { who: (team ? [...new Set(unb.map(x => P(teamsOf(tt).find(tm => tm.includes(x.id)) || [x.id])))] : unb.map(x => N(x.id))).join(", ") })]);
    if (!team) {
      // лучшая оборона: меньше всего пропущено за игру
      const df = rows.filter(r => r.g >= 2).sort((a, b) => a.pa / a.g - b.pa / b.g)[0]; if (df) L.push(["🧱", t("af_defense", { who: N(df.id), n: (df.pa / df.g).toFixed(1) })]);
      // лучший дуэт (партнёры меняются)
      const pr = {}; gs.forEach(g => [[g.teamA, g.scoreA - g.scoreB], [g.teamB, g.scoreB - g.scoreA]].forEach(([tm, d]) => { const k = tm.slice().sort().join("|"); const q = pr[k] = pr[k] || { tm, n: 0, d: 0, w: 0 }; q.n++; q.d += d; if (d > 0) q.w++; }));
      const bp = Object.values(pr).filter(q => q.n >= 2).sort((a, b) => b.d - a.d)[0]; if (bp && bp.d > 0) L.push(["💞", t("af_duo", { who: P(bp.tm), d: bp.d, n: bp.n })]);
      // камбэк: начал с поражения, а финишировал в тройке
      const cb = rows.slice(0, 3).filter(r => r.seq[0] === "l"); if (cb.length) L.push(["🔄", t("af_comeback", { who: cb.map(r => N(r.id)).join(", ") })]);
    }
    // самый результативный раунд
    const byR = {}; gs.forEach(g => byR[g.round] = (byR[g.round] || 0) + g.scoreA + g.scoreB);
    const rk = Object.keys(byR); if (rk.length > 1 && new Set(Object.values(byR)).size > 1) { const r = rk.sort((a, b) => byR[b] - byR[a])[0]; L.push(["🎯", t("af_round", { r, n: byR[r] })]); }
    // рост Эло
    const E = computeElo(), eg = ids.map(id => ({ id, d: (E.seq[id] || []).filter(x => x.g.tournamentId === tt.id).reduce((a, x) => a + x.d, 0) })).sort((a, b) => b.d - a.d)[0];
    if (eg && eg.d >= 1) L.push(["📈", t("af_elo", { who: N(eg.id), n: Math.round(eg.d) })]);
    return L;
  }
  function announceCardHtml(tt, tGames) {
    const open = state.view.factsOpen === tt.id;
    const lines = open ? announceFacts(tt, tGames) : [];
    return `<div class="card af-card"><button type="button" class="fold-h" data-act="facts-toggle" data-id="${tt.id}"><span>🎙 ${t("af_title")} <span class="tiny">· ${t("admins_only")}</span></span><span class="chev ${open ? "open" : ""}">›</span></button>
      ${open ? `<div id="factsText" class="af-text">${lines.map(([ic, txt]) => `<p>${ic} ${esc(txt)}</p>`).join("")}</div>
        <button class="btn sm block" style="margin-top:10px;" data-act="facts-copy">⧉ ${t("copy_text")}</button>` : ""}</div>`;
  }
  // ---------- подписи игроков в турнире (только админ ставит, видят все) ----------
  // ---------- статистика нажатий на ссылки партнёра (для ежемесячного отчёта) ----------
  let ptStats = null, ptLoading = false;
  function partnerStatsHtml() {
    if (!ptStats) { if (!ptLoading) { ptLoading = true; const since = new Date(); since.setMonth(since.getMonth() - 6);
        db.partnerClicks(since.toISOString()).then(d => { ptStats = d; }).catch(e => { ptStats = []; console.error(e); }).finally(() => { ptLoading = false; if (state.view.adm === "partner") render(); }); }
      return `<div class="card"><h3>${t("p_stats")}</h3><p class="tiny">…</p></div>`; }
    const now = new Date(), mStart = new Date(now.getFullYear(), now.getMonth(), 1), pStart = new Date(now.getFullYear(), now.getMonth() - 1, 1), d30 = new Date(now - 30 * 864e5);
    const per = (from, to) => { const xs = ptStats.filter(x => { const d = new Date(x.at); return d >= from && (!to || d < to); });
      return { all: xs.length, shop: xs.filter(x => x.kind === "shop").length, consult: xs.filter(x => x.kind === "consult").length, users: new Set(xs.map(x => x.user_id)).size }; };
    const mName = d => d.toLocaleDateString(getLang() === "en" ? "en-GB" : getLang() === "ru" ? "ru-RU" : "uk-UA", { month: "long" });
    const rows = [[mName(now), per(mStart)], [mName(pStart), per(pStart, mStart)], [t("p_30d"), per(d30)], [t("p_6m"), per(new Date(0))]];
    return `<div class="card"><div class="row"><h3 style="margin:0;">${t("p_stats")}</h3><button class="icon-btn" data-act="pt-refresh" title="↻">↻</button></div>
      <table class="tbl" style="margin-top:10px;"><tr><th></th><th>${t("p_clicks")}</th><th>${t("p_shop")}</th><th>${t("p_consult")}</th><th>${t("p_people")}</th></tr>
      ${rows.map(([l, r]) => `<tr><td><b>${esc(l)}</b></td><td class="lb-elo">${r.all}</td><td>${r.shop}</td><td>${r.consult}</td><td>${r.users}</td></tr>`).join("")}</table>
      <p class="tiny" style="margin:8px 0 0;">${t("p_stats_hint")}</p></div>`;
  }
  // ---------- розыгрыш среди участников турнира: честный случайный выбор, результат сохраняется в турнире и виден всем ----------
  function raffleIds(tt) {
    const played = [...new Set(tGamesOf(tt.id).filter(scoredG).flatMap(g => g.teamA.concat(g.teamB)))]; if (played.length) return played;
    const main = regsOf(tt.id).filter(r => r.status === "main" && r.approval !== "pending").map(r => r.playerId);
    return main.length ? main : (tt.participantIds || []).slice();
  }
  const rndInt = n => { const a = new Uint32Array(1); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : (a[0] = Math.floor(Math.random() * 4294967296)); return a[0] % n; };
  function raffleHtml(tt) {
    const list = tt.s.raffles || [];
    const rows = list.map((r, i) => `<div class="rf-row"><span class="rf-ic">🎁</span><div style="flex:1;min-width:0;"><b>${pnl(r.winner)}</b><div class="tiny">${r.prize ? esc(r.prize) + " · " : ""}${t("rf_of", { n: r.n })}</div></div>${isAdmin() ? `<button class="icon-btn" data-act="rf-del" data-id="${tt.id}" data-val="${i}" title="${t("delete")}">✕</button>` : ""}</div>`).join("");
    if (!canEdit()) return list.length ? `<div class="card rf-card"><h3>🎲 ${t("rf_title")}</h3>${rows}</div>` : "";
    const won = new Set(list.map(r => r.winner)), pool = raffleIds(tt).filter(id => !won.has(id));
    const open = state.view.rfOpen === tt.id || list.length;
    return `<div class="card rf-card"><button class="rounds-toggle ${open ? "open" : ""}" data-act="rf-toggle" data-id="${tt.id}" style="margin:0;">🎲 ${t("rf_title")}${list.length ? ` <span class="tiny">· ${list.length}</span>` : ""}<span class="chev">›</span></button>
      ${open ? `${rows}<div class="rf-stage" id="rfStage"></div>
      <div class="row" style="gap:8px;margin-top:10px;"><input type="text" id="rfPrize" maxlength="60" autocomplete="off" placeholder="${t("rf_prize_ph")}" style="flex:1;min-width:0;"><button class="btn primary" data-act="rf-run" data-id="${tt.id}" ${pool.length ? "" : "disabled"}>${t("rf_run")}</button></div>
      <p class="tiny" style="margin:8px 0 0;">${t("rf_hint", { n: pool.length })}</p>` : ""}</div>`;
  }
  let rfBusy = false;
  async function runRaffle(tid, btn) {
    const tt = byId(state.tournaments, tid); if (!tt || rfBusy) return;
    const list = tt.s.raffles || [], won = new Set(list.map(r => r.winner)), pool = raffleIds(tt).filter(id => !won.has(id)); if (!pool.length) return;
    const prize = String((document.getElementById("rfPrize") || {}).value || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const winner = pool[rndInt(pool.length)], stage = document.getElementById("rfStage");
    rfBusy = true; savingN++; if (btn) btn.disabled = true;
    try {
      if (stage) { stage.classList.add("on"); const t0 = Date.now(), dur = 2600; let k = 0;
        await new Promise(res => { const step = () => { const el = Date.now() - t0; if (el >= dur) return res();
          stage.innerHTML = `<span>${esc(pnt(pool[(k++ + rndInt(pool.length)) % pool.length]))}</span>`; setTimeout(step, 50 + el / dur * 220); }; step(); });
        stage.innerHTML = `<span class="win">🎉 ${esc(pnt(winner))}</span>`; }
      const raffles = list.concat([{ winner, prize, n: pool.length, at: new Date().toISOString() }]);
      await db.saveTournament(tRow(tt, { s: { ...tt.s, raffles } })); tt.s = { ...tt.s, raffles };
      await db.addLog(`Розыгрыш «${tt.name}»${prize ? " (" + prize + ")" : ""}: ${pname(winner)} из ${pool.length}`).catch(() => {});
      await new Promise(r => setTimeout(r, 1800));
    } catch (e) { err(e); } finally { rfBusy = false; savingN--; render(); }
  }
  function labelsCardHtml(tt, ids) {
    if (!isAdmin() || !ids.length) return "";
    const open = state.view.lblOpen === tt.id, n = ids.filter(id => LBL[id]).length;
    return `<div class="card lbl-card"><button type="button" class="fold-h" data-act="lbl-toggle" data-id="${tt.id}"><span>✎ ${t("lbl_title")}${n ? ` <span class="tiny">· ${n}</span>` : ""}</span><span class="chev ${open ? "open" : ""}">›</span></button>
      ${open ? `<p class="tiny" style="margin:8px 0 10px;">${t("lbl_hint")}</p>${ids.slice().sort((a, b) => pname(a).localeCompare(pname(b))).map(id => `<div class="lbl-row"><span class="lbl-name">${esc(pname(id))}</span>
        <span class="ok-wrap"><input type="text" class="lbl-in" data-tid="${tt.id}" data-pid="${id}" maxlength="30" autocomplete="off" enterkeyhint="done" value="${esc(LBL[id] || "")}" placeholder="${t("lbl_ph")}"><button type="button" class="ok-btn" data-act="lbl-ok" aria-label="${t("save")}">✓</button></span></div>`).join("")}` : ""}</div>`;
  }
  async function saveLabel(inp) {
    const tt = byId(state.tournaments, inp.dataset.tid), pid = inp.dataset.pid; if (!tt) return;
    const val = String(inp.value || "").replace(/\s+/g, " ").trim().slice(0, 30), cur = (tt.s.labels || {})[pid] || "";
    if (val === cur) return;
    const labels = { ...(tt.s.labels || {}) }; if (val) labels[pid] = val; else delete labels[pid];
    try { await db.saveTournament(tRow(tt, { s: { ...tt.s, labels } })); tt.s = { ...tt.s, labels }; LBL = labels; toast(t("saved")); if (!isField(document.activeElement)) render(); } catch (e) { err(e); }
  }
  // ---------- проведение турнира: старт, раунды, счёт, таблица наживо ----------
  const TEAM_F = ["team_americano", "roundrobin", "playoff"], STEP_F = ["mexicano", "swiss"];
  const isTeamF = f => TEAM_F.includes(f);
  const scoredG = g => g.scoreA != null && g.scoreB != null;
  const tGamesOf = tid => state.games.filter(g => g.tournamentId === tid);
  const strengthFn = () => { const E = computeElo(); return id => ((E.ratings[id] ?? 2500) - 2500) / 50; };
  const tRow = (tt, patch) => ({ id: tt.id, seq: tt.seq, name: tt.name, date: tt.date, status: tt.status, format: tt.format, courts: tt.courts, participantIds: tt.participantIds, teams: tt.teams, scoring: tt.scoring, rounds: tt.rounds, s: tt.s, ...patch });
  const runPlayers = tid => regsOf(tid).filter(r => r.status === "main" && r.approval !== "pending").map(r => r.playerId);
  const teamsOf = tt => (tt.teams || []).map(x => x.players || x).filter(x => Array.isArray(x) && x.length === 2);
  const pairName = tm => `${pl(tm[0])} + ${pl(tm[1])}`;
  const gameId = (tid, r, c) => `${tid}-r${r}-c${c}`;
  // номера кортов, на которых идёт турнир («2, 3, 5»); пусто — корты 1, 2, 3…
  const parseCourts = v => [...new Set(String(v || "").split(/[^0-9]+/).filter(Boolean).map(Number).filter(n => n > 0 && n < 100))];
  const courtNo = (nums, i) => (nums && nums[i - 1]) || i; // i — порядковый номер матча в раунде (с 1)
  // пары: как записались парами, остальных — «сильный + слабый»
  function buildTeams(tt, ids, shuffle) {
    const S = strengthFn(), used = new Set(), list = [];
    if (isPairs(tt)) teamNos(tt).forEach(n => { const m = teamMembers(tt.id, n).filter(r => r.approval !== "pending" && ids.includes(r.playerId)); if (m.length === 2) { list.push(m.map(r => r.playerId)); m.forEach(r => used.add(r.playerId)); } });
    const fromReg = list.length, rest = ids.filter(id => !used.has(id)), auto = balanceTeams(rest, S, shuffle);
    const inT = new Set(auto.flat()); return { list: list.concat(auto), fromReg, left: rest.filter(id => !inT.has(id)) };
  }
  function runDefaultRounds(r, n) {
    if (r.format === "americano") return defaultAmericanoRounds(n, r.courts);
    if (r.format === "mexicano") return 6;
    if (r.format === "swiss") return 5;
    if (r.format === "playoff") return Math.round(Math.log2(Math.max(2, r.teams.list.length)));
    return (roundRobinSchedule(r.teams.list, r.courts) || []).length;
  }
  function initRun(tt) {
    const ids = runPlayers(tt.id), sc = tt.scoring || {};
    const cn = parseCourts((tt.s.court_nums || []).join(","));
    const r = { tid: tt.id, format: tt.format || "americano", courts: cn.length || tt.courts || 2, courtNums: cn, mode: sc.mode || "total", target: sc.target ?? 21, touched: false };
    r.teams = buildTeams(tt, ids, false); r.rounds = runDefaultRounds(r, ids.length); return r;
  }
  function readRun() {
    const r = state._run, g = id => document.getElementById(id); if (!r) return r;
    if (g("runCourts")) r.courts = Math.max(1, Math.min(12, +g("runCourts").value || 1));
    if (g("runCourtNums")) { const before = r.courtNums.join(); r.courtNums = parseCourts(g("runCourtNums").value); if (r.courtNums.length && r.courtNums.join() !== before) r.courts = r.courtNums.length; }
    if (g("runRounds")) { const v = Math.max(1, Math.min(40, +g("runRounds").value || 1)); if (v !== r.rounds) r.touched = true; r.rounds = v; }
    if (g("runTarget")) r.target = g("runTarget").value === "" ? null : Math.max(1, Math.min(99, +g("runTarget").value));
    return r;
  }
  function runCheck(r, ids) {
    if (isTeamF(r.format)) {
      if (r.teams.list.length < 2) return t("run_need_pairs");
      if (r.format === "playoff" && !isBracket(r.teams.list.length)) return t("run_need_bracket", { n: r.teams.list.length });
    } else if (ids.length < 4) return t("run_need_n", { n: 4 });
    return null;
  }
  function runSummary(r, ids) {
    if (r.format === "playoff") { const n = r.teams.list.length; return isBracket(n) ? t("run_sum_playoff", { n, m: n }) : ""; }
    if (isTeamF(r.format)) { const full = (roundRobinSchedule(r.teams.list, r.courts) || []).length; return t("run_sum_rr", { n: Math.min(r.rounds, full), full, m: r.teams.list.length * (r.teams.list.length - 1) / 2 }); }
    const per = Math.min(Math.floor(ids.length / 4), r.courts), rest = ids.length - per * 4;
    return t("run_sum_ind", { n: r.rounds, c: per }) + (rest > 0 ? " · " + t("run_sum_rest", { n: rest }) : "");
  }
  function runCardHtml(tt) {
    const ids = runPlayers(tt.id), pend = pendingOf(tt.id).length;
    return `<div class="card run-card"><h3>${t("run_title")}</h3><p class="tiny" style="margin:6px 0 10px;">${t("run_hint")}</p>
      <div class="tiny" style="margin-bottom:10px;">${t("run_participants")}: <b>${ids.length}</b>${pend ? ` · <span class="pend-tag">${t("run_pending_excluded", { n: pend })}</span>` : ""}</div>
      <button class="btn primary block" data-act="run-open" data-id="${tt.id}">${t("run_setup")} ▸</button></div>`;
  }
  function runSetupHtml(tt) {
    const r = state._run, ids = runPlayers(tt.id), f = r.format, team = isTeamF(f), er = runCheck(r, ids), pend = pendingOf(tt.id).length;
    const fmts = ["americano", "mexicano", "swiss", "team_americano", ...(f === "roundrobin" ? ["roundrobin"] : []), "playoff"];
    const lv = id => letter(lvNow(id));
    const fullRR = team && f !== "playoff" ? (roundRobinSchedule(r.teams.list, r.courts) || []).length : null;
    const inp = (id, label, val, extra) => `<label class="field"><span class="lbl">${label}</span><input type="number" inputmode="numeric" id="${id}" value="${val ?? ""}" ${extra || ""}></label>`;
    return `
      <div class="section-head"><button class="btn ghost sm back" data-act="run-cancel">‹ ${t("cancel")}</button><h2 style="font-size:16px;">${t("run_title")}</h2></div>
      <h2 class="t-title">${esc(tt.name)}</h2>
      <div class="card">
        <div class="field"><span class="lbl">${t("t_format")}</span><div class="wrap-tags">${fmts.map(x => `<span class="chip ${f === x ? "active" : ""}" data-act="run-format" data-val="${x}">${t(x)}</span>`).join("")}</div>
          <p class="tiny" style="margin:8px 0 0;">${t("fmt_" + (f === "roundrobin" ? "team_americano" : f))}</p></div>
      </div>
      <div class="card"><h3>${t("run_participants")} <span class="tiny">· ${ids.length}</span></h3>
        ${pend ? `<p class="tiny" style="margin:6px 0 0;"><span class="pend-tag">${t("run_pending_excluded", { n: pend })}</span></p>` : ""}
        ${team ? `<div class="run-teams">${r.teams.list.map((tm, i) => `<div class="run-team"><span class="run-n">${i + 1}</span><span class="run-tn">${pnl(tm[0])} <span class="tiny">${lv(tm[0])}</span> + ${pnl(tm[1])} <span class="tiny">${lv(tm[1])}</span></span></div>`).join("")}</div>
            ${r.teams.left.length ? `<p class="tiny warn-t">${t("run_left_out", { names: r.teams.left.map(pname).map(esc).join(", ") })}</p>` : ""}
            <p class="tiny" style="margin:8px 0;">${r.teams.fromReg === r.teams.list.length ? t("run_teams_all_reg") : r.teams.fromReg ? t("run_teams_from_reg", { n: r.teams.fromReg }) : t("run_teams_auto")}</p>
            ${r.teams.list.length - r.teams.fromReg > 1 ? `<button class="btn sm" data-act="run-shuffle">↻ ${t("run_shuffle")}</button>` : ""}`
          : `<div class="chips-wrap" style="margin-top:8px;">${ids.map(id => `<span class="chip sm run-p">${pnl(id)} <b>${lv(id)}</b></span>`).join("")}</div>`}
      </div>
      <div class="card">
        <label class="field"><span class="lbl">${t("t_court_nums")}</span><input type="text" inputmode="decimal" autocomplete="off" id="runCourtNums" value="${esc(r.courtNums.join(", "))}" placeholder="${t("t_court_nums_ph")}"></label>
        <p class="tiny" style="margin:-6px 0 12px;">${r.courtNums.length ? t("run_courts_used", { list: r.courtNums.slice(0, r.courts).join(", ") }) : t("t_court_nums_hint")}</p>
        <div class="grid2">${inp("runCourts", t("t_courts"), r.courts, 'min="1" max="12"')}${f === "playoff" ? `<div></div>` : inp("runRounds", t("run_rounds"), r.rounds, `min="1" max="${fullRR || 40}"`)}</div>
        <div class="field"><span class="lbl">${t("run_scoring")}</span><div class="wrap-tags">
          <span class="chip ${r.mode === "total" ? "active" : ""}" data-act="run-mode" data-val="total">${t("run_total")}</span>
          <span class="chip ${r.mode === "race" ? "active" : ""}" data-act="run-mode" data-val="race">${t("run_race")}</span></div></div>
        ${inp("runTarget", t("run_target"), r.target, 'min="1" max="99"')}
        <p class="tiny" style="margin:-6px 0 12px;">${r.mode === "total" ? t("run_total_hint", { n: r.target || 21, a: Math.ceil((r.target || 21) * 0.6), b: (r.target || 21) - Math.ceil((r.target || 21) * 0.6) }) : t("run_race_hint", { n: r.target || 6 })}</p>
        <p class="run-sum">${er ? `<span class="warn-t">${er}</span>` : runSummary(r, ids)}</p>
        <button class="btn primary block" data-act="run-start" ${er ? "disabled" : ""}>${t("run_start")}</button>
        ${STEP_F.includes(f) ? `<p class="tiny" style="margin:8px 0 0;text-align:center;">${t("run_step_note")}</p>` : ""}
      </div>`;
  }
  async function startRun() {
    const r = readRun(), tt = byId(state.tournaments, r.tid), ids = runPlayers(tt.id), e0 = runCheck(r, ids); if (e0) { toast(e0); return; }
    const S = strengthFn(), M = ([a, b]) => ({ teamA: a, teamB: b, label: null });
    let rounds;
    if (r.format === "americano") rounds = (americanoSchedule(ids, r.rounds, r.courts) || []).map(rd => rd.map(M));
    else if (r.format === "mexicano") rounds = [mexicanoRound(ids, [], r.courts, S).map(M)];
    else if (r.format === "swiss") rounds = [swissRound(ids, [], r.courts, S, 2).map(M)];
    else if (r.format === "playoff") rounds = [playoffFirst(r.teams.list.slice().sort((a, b) => S(b[0]) + S(b[1]) - S(a[0]) - S(a[1])))];
    else rounds = (roundRobinSchedule(r.teams.list, r.courts) || []).slice(0, r.rounds).map(rd => rd.map(M));
    if (!rounds.length || !rounds[0] || !rounds[0].length) { toast(t("run_need_n", { n: 4 })); return; }
    const games = []; rounds.forEach((rd, i) => rd.forEach((m, c) => games.push({ id: gameId(tt.id, i + 1, c + 1), tournamentId: tt.id, round: i + 1, court: courtNo(r.courtNums, c + 1), teamA: m.teamA, teamB: m.teamB, scoreA: null, scoreB: null, label: m.label })));
    const team = isTeamF(r.format);
    try {
      await db.deleteGames(tGamesOf(tt.id).map(g => g.id));
      await db.saveTournament(tRow(tt, { format: r.format, courts: r.courts, status: "live", participantIds: team ? r.teams.list.flat() : ids, teams: team ? r.teams.list.map((p, i) => ({ id: "tm" + (i + 1), players: p })) : [],
        scoring: { mode: r.mode, target: r.target }, rounds: r.format === "playoff" ? null : (STEP_F.includes(r.format) ? r.rounds : rounds.length), s: { ...tt.s, reg_open: false, reg_was: !!tt.s.reg_open, court_nums: r.courtNums } }));
      await db.saveGames(games); await db.addLog("Старт турніру: " + tt.name).catch(() => {});
      state._run = null; state.view.run = null; state.view.liveTab = "m"; state.view.liveRound = null; window.scrollTo(0, 0); await reload(); toast(t("run_started"));
    } catch (e) { err(e); }
  }
  // таблица: личная / по парам / места плей-офф
  function standingsHtml(tt, games) {
    const sg = games.filter(scoredG), E = computeElo(), tid = tt.id;
    const teams = teamsOf(tt), diff = r => `${r.pts - r.pa >= 0 ? "+" : ""}${r.pts - r.pa}`;
    if (isTeamF(tt.format) && teams.length) {
      const rows = tt.format === "playoff" ? playoffPlaces(teams, sg) : teamTable(teams, sg);
      return `<table class="tbl" style="margin-top:6px;"><tr><th></th><th>${t("team_col")}</th>${tt.format === "playoff" ? "" : `<th>${t("pts")}</th>`}<th>W-L</th><th>${t("diff")}</th></tr>
        ${rows.map((r, i) => `<tr><td><span class="pos-badge ${i === 0 && (tt.format !== "playoff" || r.place === 1) ? "gold" : ""}">${tt.format === "playoff" ? (r.place || "–") : i + 1}</span></td><td class="lb-name team-cell">${pairName(r.players)}</td>${tt.format === "playoff" ? "" : `<td class="lb-elo">${r.pts}</td>`}<td>${r.w}-${r.l}${r.d ? "-" + r.d : ""}</td><td>${diff(r)}</td></tr>`).join("")}</table>`;
    }
    const ids = tt.participantIds && tt.participantIds.length ? tt.participantIds : [...new Set(games.flatMap(g => g.teamA.concat(g.teamB)))];
    const eloD = id => (E.seq[id] || []).filter(x => x.g.tournamentId === tid).reduce((a, x) => a + x.d, 0);
    return `<table class="tbl" style="margin-top:6px;"><tr><th></th><th>${t("players")}</th><th>${t("pts")}</th><th>W-L</th><th>${t("diff")}</th><th>Elo</th></tr>
      ${playerTable(ids, sg).map((r, i) => { const d = eloD(r.id); return `<tr><td><span class="pos-badge ${i === 0 && r.pts ? "gold" : ""}">${i + 1}</span></td>
        <td class="lb-name"><span class="lb-p" data-act="open-profile" data-id="${r.id}">${avatarHtml(r.id, 28)}<span class="plink">${esc(pname(r.id))}</span>${lblHtml(r.id)}</span></td>
        <td class="lb-elo">${r.pts}</td><td>${r.w}-${r.l}${r.d ? "-" + r.d : ""}</td><td>${diff(r)}</td>
        <td class="tiny ${d >= 0 ? "up" : "down"}" style="font-size:13px;">${r.g ? (d >= 0 ? "+" : "") + Math.round(d) : "—"}</td></tr>`; }).join("")}</table>`;
  }
  function liveHtml(tt, fix) {
    const tid = tt.id, games = tGamesOf(tid), edit = canEditT(tt), me = myPlayer(), sc = tt.scoring || {};
    const maxR = games.length ? Math.max(...games.map(g => g.round)) : 0;
    const byR = r => games.filter(g => g.round === r).sort((a, b) => (a.court || 0) - (b.court || 0));
    const done = r => byR(r).length > 0 && byR(r).every(scoredG);
    let firstOpen = maxR; for (let r = 1; r <= maxR; r++) if (!done(r)) { firstOpen = r; break; }
    const cur = state.view.liveRound && state.view.liveRound <= maxR ? state.view.liveRound : firstOpen;
    const tab = state.view.liveTab || "m";
    const planned = STEP_F.includes(tt.format) ? Math.max(tt.rounds || 0, maxR) : tt.format === "playoff" ? Math.max(maxR, Math.round(Math.log2(Math.max(2, teamsOf(tt).length)))) : maxR;
    const nScored = games.filter(scoredG).length;
    const scLbl = sc.target ? t(sc.mode === "race" ? "sc_race" : "sc_total", { n: sc.target }) : "";
    const lbl = g => g.label ? `<b class="po-lbl">${t("po_" + g.label)}</b> · ` : "";
    const match = g => { const wa = scoredG(g) && g.scoreA > g.scoreB, wb = scoredG(g) && g.scoreB > g.scoreA, mine = me && g.teamA.concat(g.teamB).includes(me.id);
      const inp = s => `<input class="sc-in" type="number" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" min="0" max="99" data-gid="${g.id}" data-side="${s}" value="${(s === "A" ? g.scoreA : g.scoreB) ?? ""}" aria-label="${t("score")}">`;
      const box = v => `<span class="sbox">${v ?? "–"}</span>`;
      return `<div class="match live-m ${mine ? "mine" : ""} ${scoredG(g) ? "is-done" : ""}" data-gid="${g.id}">
        <div class="court-lbl"><span>${lbl(g)}${t("court")} ${g.court || "—"}${mine ? ` · <b class="your-m">${t("your_match")}</b>` : ""}</span>${edit ? `<button type="button" class="sc-ok ${scoredG(g) ? "saved" : ""}" aria-label="${t("save")}">✓</button>` : ""}</div>
        <div class="mrow"><div class="pair ${wa ? "winner" : ""}">${pl(g.teamA[0])}<small>${pl(g.teamA[1])}</small></div>
          <div class="score">${edit ? inp("A") : box(g.scoreA)}<span class="colon">:</span>${edit ? inp("B") : box(g.scoreB)}</div>
          <div class="pair right ${wb ? "winner" : ""}">${pl(g.teamB[0])}<small>${pl(g.teamB[1])}</small></div></div></div>`; };
    const inRound = new Set(byR(cur).flatMap(g => g.teamA.concat(g.teamB)));
    const resting = (isTeamF(tt.format) ? teamsOf(tt).filter(tm => !inRound.has(tm[0])).map(tm => pnl(tm[0]) + " + " + pnl(tm[1])) : (tt.participantIds || []).filter(id => !inRound.has(id)).map(pnl));
    const chips = Array.from({ length: Math.max(planned, maxR) }, (_, i) => i + 1).map(r => r <= maxR
      ? `<span class="chip sm rnd-chip ${r === cur ? "active" : ""} ${done(r) ? "done" : ""}" data-act="live-round" data-val="${r}">${r}${done(r) ? " ✓" : ""}</span>`
      : `<span class="chip sm rnd-chip future">${r}</span>`).join("");
    let controls = "";
    if (edit && !fix) {
      const curDone = done(cur), nextLbl = r => { const g0 = byR(r)[0]; return g0 && g0.label ? t("po_" + g0.label) : t("round_n", { n: r }); };
      if (curDone && cur < maxR) controls = `<button class="btn primary block" data-act="live-round" data-val="${cur + 1}">${t("go_next", { what: nextLbl(cur + 1) })} ▸</button>`;
      else if (STEP_F.includes(tt.format) && cur === maxR) controls = curDone
        ? `<button class="btn primary block" data-act="live-next" data-id="${tid}">${maxR < planned ? t("next_round", { n: maxR + 1 }) : t("extra_round")}</button>`
        : `<p class="tiny" style="text-align:center;margin:4px 0;">${t("fill_round_first", { n: maxR })}${maxR < planned ? " · " + t("then_next", { n: maxR + 1 }) : ""}</p>`;
      else if (!curDone) controls = `<p class="tiny" style="text-align:center;margin:4px 0;">${tt.format === "playoff" ? t("po_auto") : t("fill_round_first", { n: cur })}</p>`;
      else if (cur === maxR) controls = `<div class="all-done">🏁 ${t("all_rounds_done")}</div>`;
      if (STEP_F.includes(tt.format) && cur === maxR && maxR > 1 && byR(maxR).every(g => !scoredG(g))) controls += `<button class="btn ghost sm danger block" style="margin-top:8px;" data-act="live-remove" data-id="${tid}">${t("remove_round", { n: maxR })}</button>`;
    }
    const allDone = games.length && games.every(scoredG);
    const finishCard = edit ? (fix
      ? `<div class="card"><button class="btn primary block" data-act="fix-done">${t("fix_done")}</button></div>`
      : `<div class="card live-end"><div class="row"><span class="tiny">${t("scored_n", { a: nScored, b: games.length })}</span>${nScored ? "" : `<button class="btn ghost sm danger" data-act="live-cancel" data-id="${tid}">${t("cancel_start")}</button>`}</div>
          <button class="btn ${allDone && (!STEP_F.includes(tt.format) || maxR >= planned) ? "primary" : ""} block" style="margin-top:10px;" data-act="live-finish" data-id="${tid}">🏁 ${t("finish_t")}</button></div>`) : "";
    return `
      <div class="section-head"><button class="btn ghost sm back" data-act="t-back">‹ ${backLbl()}</button>${edit && !fix ? `<button class="btn sm" data-act="edit-t" data-id="${tid}">${t("edit")}</button>` : ""}</div>
      <div class="live-head"><h2 class="t-title">${esc(tt.name)}</h2>${fix ? `<span class="t-status planned">✎ ${t("fix_scores_short")}</span>` : `<span class="t-status live"><i></i>${t("live")}</span>`}</div>
      <p class="tiny" style="margin:-4px 0 12px;">${esc(t(tt.format))}${scLbl ? " · " + scLbl : ""}${tt.s.place ? " · " + esc(tt.s.place) : ""}${tt.s.time ? " · " + timeRange(tt.s) : ""}</p>
      <div class="seg live-tabs"><button class="${tab === "m" ? "active" : ""}" data-act="live-tab" data-val="m">${t("live_matches")}</button><button class="${tab === "t" ? "active" : ""}" data-act="live-tab" data-val="t">${t("live_table")}</button></div>
      ${tab === "t" ? `<div class="card"><h3>${t("standings")}</h3>${nScored ? "" : `<p class="tiny">${t("no_scores_yet")}</p>`}${standingsHtml(tt, games)}</div>` : `
        <div class="chips-scroll rnd-chips">${chips}</div>
        <h3 class="sub-h" style="margin-top:6px;">${t("round_n", { n: cur })}${planned > 1 ? ` <span class="tiny">/ ${planned}</span>` : ""}</h3>
        ${edit && !fix && cur === firstOpen && nScored === 0 ? `<p class="tiny" style="margin:0 0 10px;">${t("live_hint_admin")}</p>` : ""}
        ${byR(cur).map(match).join("")}
        ${resting.length ? `<p class="tiny rest-line">💤 ${t("rest")}: ${resting.join(", ")}</p>` : ""}
        ${controls ? `<div style="margin:12px 0;">${controls}</div>` : ""}`}
      ${raffleHtml(tt)}
      ${labelsCardHtml(tt, tt.participantIds && tt.participantIds.length ? tt.participantIds : [...new Set(games.flatMap(g => g.teamA.concat(g.teamB)))])}
      ${finishCard}`;
  }
  // сохранение счёта матча (читаем оба поля карточки)
  async function saveScoreFrom(box, explicit) {
    const g = byId(state.games, box.dataset.gid); if (!g) return;
    const [ia, ib] = ["A", "B"].map(s => box.querySelector(`input.sc-in[data-side="${s}"]`));
    const num = x => x.value === "" ? null : Math.max(0, Math.min(99, Math.round(+x.value)));
    const a = num(ia), b = num(ib);
    if ((a == null) !== (b == null)) { if (explicit) { toast(t("score_both")); (a == null ? ia : ib).focus(); } return false; } // ждём второе число
    if (a === g.scoreA && b === g.scoreB) { markOk(box, a != null); return true; }
    const tt = byId(state.tournaments, g.tournamentId);
    if (tt.format === "playoff" && a != null && a === b) { toast(t("need_winner")); return; }
    const wasDone = tGamesOf(tt.id).filter(x => x.round === g.round).every(scoredG);
    const prevA = g.scoreA, prevB = g.scoreB;
    g.scoreA = a; g.scoreB = b;
    box.classList.toggle("is-done", a != null);
    const [pa, pb] = box.querySelectorAll(".pair"); pa.classList.toggle("winner", a != null && a > b); pb.classList.toggle("winner", a != null && b > a);
    savingN++; saveEpoch++;
    try { await db.saveScore(g.id, a, b); markOk(box, a != null); }
    catch (e) { savingN--; g.scoreA = prevA; g.scoreB = prevB; markOk(box, false, true); err(e); return false; }
    try { if (tt.format === "playoff") { try { await playoffAdvance(tt); } catch (e) { err(e); } } } finally { savingN--; }
    const nowDone = tGamesOf(tt.id).filter(x => x.round === g.round).every(scoredG);
    state.view.liveRound = g.round;
    if (nowDone && !wasDone) toast(t("round_done", { n: g.round }));
    if (isField(document.activeElement)) pendingLive = true; else if (pendingLive && !savingN) liveReload(); else render();
    return true;
  }
  // кнопка ✓ матча: оранжевая — есть несохранённые цифры, зелёная — сохранено
  const markOk = (box, saved, dirty) => { const ok = box && box.querySelector(".sc-ok"); if (!ok) return; ok.classList.toggle("dirty", !!dirty); ok.classList.toggle("saved", !!saved && !dirty); };
  async function playoffAdvance(tt) {
    const gs = tGamesOf(tt.id), maxR = Math.max(...gs.map(g => g.round)), upd = [];
    for (let r = 1; r <= maxR; r++) {
      const nx = playoffNext(gs.filter(g => g.round <= r)); if (!nx) continue;
      const ex = gs.filter(g => g.round === r + 1).sort((a, b) => a.court - b.court);
      if (!ex.length) nx.forEach((m, i) => { const g = { id: gameId(tt.id, r + 1, i + 1), tournamentId: tt.id, round: r + 1, court: courtNo(tt.s.court_nums, i + 1), teamA: m.teamA, teamB: m.teamB, scoreA: null, scoreB: null, label: m.label }; upd.push(g); gs.push(g); state.games.push(g); });
      else if (ex.every(g => !scoredG(g))) nx.forEach((m, i) => { const g = ex[i]; if (g && (g.teamA.join() !== m.teamA.join() || g.teamB.join() !== m.teamB.join())) { g.teamA = m.teamA; g.teamB = m.teamB; upd.push(g); } });
    }
    if (upd.length) { await db.saveGames(upd); toast(t("po_next_ready")); }
  }
  async function nextRound(tid) {
    const tt = byId(state.tournaments, tid), gs = tGamesOf(tid), maxR = gs.length ? Math.max(...gs.map(g => g.round)) : 0;
    if (gs.some(g => g.round === maxR && !scoredG(g))) { toast(t("fill_round_first", { n: maxR })); return; }
    const S = strengthFn(), ids = tt.participantIds || [], courts = tt.courts || 2;
    const ms = tt.format === "mexicano" ? mexicanoRound(ids, gs, courts, S) : swissRound(ids, gs, courts, S, 2);
    if (!ms || !ms.length) return;
    const r = maxR + 1, rows = ms.map(([a, b], i) => ({ id: gameId(tid, r, i + 1), tournamentId: tid, round: r, court: courtNo(tt.s.court_nums, i + 1), teamA: a, teamB: b, scoreA: null, scoreB: null, label: null }));
    try { await db.saveGames(rows); if (r > (tt.rounds || 0)) await db.saveTournament(tRow(tt, { rounds: r })); state.view.liveRound = r; window.scrollTo(0, 0); await reload(); toast(t("round_ready", { n: r })); } catch (e) { err(e); }
  }
  async function removeLastRound(tid) {
    const gs = tGamesOf(tid), maxR = Math.max(...gs.map(g => g.round)), last = gs.filter(g => g.round === maxR);
    if (last.some(scoredG)) return;
    try { await db.deleteGames(last.map(g => g.id)); state.view.liveRound = null; await reload(); } catch (e) { err(e); }
  }
  async function finishRun(tid) {
    const tt = byId(state.tournaments, tid), gs = tGamesOf(tid), open = gs.filter(g => !scoredG(g));
    if (open.length === gs.length) { toast(t("no_scores_yet")); return; }
    if (!(await ask(open.length ? t("finish_confirm_open", { n: open.length }) : t("finish_confirm")))) return;
    try { await db.deleteGames(open.map(g => g.id)); await db.saveTournament(tRow(tt, { status: "played" })); await db.addLog("Завершив турнір: " + tt.name).catch(() => {});
      state.view.liveRound = null; state.view.roundsOpen = null; window.scrollTo(0, 0); await reload(); toast(t("finished_toast")); } catch (e) { err(e); }
  }
  async function cancelRun(tid) {
    const tt = byId(state.tournaments, tid); if (!(await ask(t("cancel_start_confirm")))) return;
    try { await db.deleteGames(tGamesOf(tid).map(g => g.id)); await db.saveTournament(tRow(tt, { status: "scheduled", s: { ...tt.s, reg_open: tt.s.reg_was ?? tt.s.reg_open } })); state.view.liveRound = null; await reload(); } catch (e) { err(e); }
  }
  // ---------- сезон: очки за места в турнирах, таблица по лигам, финал ----------
  // Новый сезон — просто добавить строку сюда (даты включительно)
  const SEASONS = [{ id: "s1", n: 1, start: "2026-10-24", end: "2026-12-25", finalists: 8 }];
  const curSeason = () => SEASONS.find(s => today() <= s.end) || SEASONS[SEASONS.length - 1];
  const LEAGUES = ["D", "C"];
  // лига турнира: вручную из настроек или по уровню допуска
  const tLeague = tt => { const v = tt.s.season_league; if (v === "none" || isGameT(tt)) return null; if (LEAGUES.includes(v)) return v;
    const lo = tt.s.level_min != null ? +tt.s.level_min : null, hi = tt.s.level_max != null ? +tt.s.level_max : null;
    const ref = lo != null ? lo : hi != null ? hi - 0.001 : null; if (ref == null) return "D";
    return ref < 2.5 ? "D" : ref < 3.5 ? "C" : null; };
  // итоговые места турнира: группы с одинаковым результатом делят место; beaten — сколько игроков ниже
  function tournamentPlaces(tt) {
    const sg = tGamesOf(tt.id).filter(scoredG); if (!sg.length) return null;
    let rows, unitPairs = false;
    let teams = teamsOf(tt);
    // парный формат без сохранённого списка пар (как #001): пары берём из матчей, если каждый играл всё время с одним партнёром
    if (isTeamF(tt.format) && !teams.length) {
      const pk = {}; sg.forEach(g => [g.teamA, g.teamB].forEach(tm => { if (tm.length === 2) { const k = tm.slice().sort().join("|"); pk[k] = tm.slice().sort(); } }));
      const list = Object.values(pk), seen = {}; list.forEach(tm => tm.forEach(id => seen[id] = (seen[id] || 0) + 1));
      if (list.length && Object.values(seen).every(n => n === 1)) teams = list;
    }
    if (isTeamF(tt.format) && teams.length) {
      unitPairs = true;
      rows = (tt.format === "playoff" ? playoffPlaces(teams, sg).map(r => ({ ids: r.players, key: [r.place || 99, -r.out, -r.pts].join() }))
        : teamTable(teams, sg).map(r => ({ ids: r.players, key: [r.pts, r.w, r.pts - r.pa].join() }))).filter(r => r.ids.length);
    } else {
      const ids = [...new Set(sg.flatMap(g => g.teamA.concat(g.teamB)))];
      rows = playerTable(ids, sg).filter(r => r.g > 0).map(r => ({ ids: [r.id], key: [r.pts, r.w, r.pts - r.pa].join() }));
    }
    const N = rows.reduce((a, r) => a + r.ids.length, 0), out = {};
    let i = 0, above = 0;
    while (i < rows.length) {
      let j = i; while (j + 1 < rows.length && rows[j + 1].key === rows[i].key) j++;
      const grp = rows.slice(i, j + 1), inGrp = grp.reduce((a, r) => a + r.ids.length, 0), place = i + 1;
      const beaten = N - above - inGrp, bonus = place === 1 ? 10 : place === 2 ? 6 : place === 3 ? 3 : 0;
      grp.forEach(r => r.ids.forEach(id => out[id] = { place, of: rows.length, pairs: unitPairs, beaten, bonus, pts: 5 + beaten + bonus }));
      above += inGrp; i = j + 1;
    }
    return out;
  }
  // таблица сезона для лиги
  function seasonTable(season, lg) {
    const ts = state.tournaments.filter(tt => tt.status === "played" && tt.date && tt.date >= season.start && tt.date <= season.end && tLeague(tt) === lg)
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.seq - b.seq);
    const by = {};
    ts.forEach(tt => { const pl = tournamentPlaces(tt); if (!pl) return;
      Object.entries(pl).forEach(([id, r]) => { const x = by[id] = by[id] || { id, pts: 0, n: 0, wins: 0, pod: 0, list: [] }; x.pts += r.pts; x.n++; if (r.place === 1) x.wins++; if (r.place <= 3) x.pod++; x.list.push({ tt, ...r }); }); });
    const rows = Object.values(by).sort((a, b) => b.pts - a.pts || b.wins - a.wins || b.pod - a.pod || pname(a.id).localeCompare(pname(b.id)));
    rows.forEach((r, k) => { const pr = rows[k - 1]; r.pos = pr && pr.pts === r.pts && pr.wins === r.wins && pr.pod === r.pod ? pr.pos : k + 1; r.z = k < season.finalists; });
    return { ts: ts.filter(tt => tGamesOf(tt.id).some(scoredG)), rows };
  }
  const ptsWord = n => t(n % 10 === 1 && n % 100 !== 11 ? "pt1" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "pt2" : "pt5", { n });
  function viewSeason() {
    const S = curSeason(), me = myPlayer();
    const daysLeft = Math.max(0, Math.ceil((new Date(S.end + "T23:59:59") - new Date()) / 864e5));
    const started = today() >= S.start;
    const tabs = LEAGUES.map(lg => ({ lg, ...seasonTable(S, lg) }));
    let lg = state.view.sLeague;
    if (!lg) { const mine = me && tabs.find(x => x.rows.some(r => r.id === me.id)); lg = mine ? mine.lg : "D"; }
    const cur = tabs.find(x => x.lg === lg), rows = cur.rows, F = S.finalists;
    const myRow = me && rows.find(r => r.id === me.id), cut = rows[F - 1];
    let myCard;
    if (myRow) {
      const inZone = myRow.z, gap = !inZone && cut ? cut.pts - myRow.pts + 1 : 0;
      myCard = `<div class="card hot-card s-me"><div class="s-me-pos un">${myRow.pos}</div>
        <div style="flex:1;min-width:0;"><div class="un" style="font-weight:700;font-size:16px;">${t("s_my_place", { n: myRow.pos })}</div>
        <div class="tiny" style="margin-top:3px;">${ptsWord(myRow.pts)} · ${t("s_tourn_n", { n: myRow.n })}</div>
        <div class="s-me-zone ${inZone ? "in" : ""}">${inZone ? "🔥 " + t("s_in_zone") : t("s_to_zone", { n: gap })}</div></div></div>`;
    } else myCard = `<div class="card s-me"><div class="tiny" style="line-height:1.5;">${me ? t("s_not_yet", { lg }) : t("need_card")}</div></div>`;
    const lgChips = `<div class="seg s-lg">${tabs.map(x => `<button class="${x.lg === lg ? "active" : ""}" data-act="s-league" data-val="${x.lg}">${t("s_league", { lg: x.lg })} <span class="s-lg-n">${x.rows.length}</span></button>`).join("")}</div>`;
    const detail = r => r.list.map(x => `<div class="s-det"><div><b>${esc(x.tt.name)}</b><div class="tiny">${dateFmt(x.tt.date)} · ${t(x.pairs ? "s_place_pairs" : "s_place", { p: x.place, of: x.of })}</div></div>
      <div class="s-calc"><span class="tiny">5 + ${x.beaten}${x.bonus ? " + " + x.bonus : ""} =</span> <b>${x.pts}</b></div></div>`).join("");
    const table = rows.length ? `<table class="tbl s-tbl"><tr><th></th><th>${t("players")}</th><th>${t("s_t_short")}</th><th>${t("s_pts")}</th></tr>
      ${rows.map((r, k) => { const open = state.view.sOpen === r.id, isMe = me && r.id === me.id;
        return `${k === F && rows.length > F ? `<tr class="s-cut"><td colspan="4"><span>${t("s_final_zone", { n: F })}</span></td></tr>` : ""}
        <tr class="s-row ${isMe ? "me" : ""} ${r.z ? "z" : ""}" data-act="s-open" data-id="${r.id}">
          <td><span class="pos-badge ${r.pos === 1 ? "gold" : ""}">${r.pos}</span></td>
          <td class="lb-name"><span class="lb-p">${avatarHtml(r.id, 28)}<span class="plink">${esc(pname(r.id))}</span>${lblHtml(r.id)}</span></td>
          <td>${r.n}</td><td class="lb-elo">${r.pts}<span class="s-chev ${open ? "open" : ""}">›</span></td></tr>
        ${open ? `<tr class="s-open-row"><td colspan="4">${detail(r)}<div class="s-det-foot"><span class="tiny">${t("s_total")}</span><b>${ptsWord(r.pts)}</b></div>
          <button class="btn sm ghost" style="margin-top:8px;" data-act="open-profile" data-id="${r.id}">${t("open_profile_btn")}</button></td></tr>` : ""}`; }).join("")}</table>`
      : `<div class="empty" style="padding:22px 6px;"><div class="ic">🏆</div>${started ? t("s_empty_lg", { lg }) : t("s_soon", { d: dateFmt(S.start) })}</div>`;
    const how = state.view.sHow;
    return `<div class="section-head"><h2>${t("season")}</h2></div>
      ${partner().season ? `<div class="card s-hero co">
        <div class="co-lock"><img class="co-048" src="logo.svg" alt="048 Padel"><span class="co-x">×</span>${httpsOk(partner().shop) ? `<button class="co-lp-btn" data-act="open-link" data-url="${esc(partner().shop)}" data-pt="shop" data-ptw="season"><img class="co-lp" src="lupadel.svg" alt="${esc(partner().name)}"></button>` : `<img class="co-lp" src="lupadel.svg" alt="${esc(partner().name)}">`}</div>
        <div class="co-line"></div>
        <div class="co-title un">${t("s_co_title", { n: S.n })}</div>
        <div class="co-sub">${t("s_co_sub", { p: esc(partner().name) })}</div><div class="co-dates un">${dateFmt(S.start)} — ${dateFmt(S.end)}</div>` : `<div class="card s-hero">
        <div class="kick-s">${t("s_name", { n: S.n })}</div>
        <div class="un" style="font-weight:800;font-size:22px;margin-top:6px;">${dateFmt(S.start)} — ${dateFmt(S.end)}</div>`}
        <div class="s-stats">
          <div><b class="un">${started ? daysLeft : Math.max(0, Math.ceil((new Date(S.start + "T00:00:00") - new Date()) / 864e5))}</b><span class="tiny">${t(started ? "s_days_left" : "s_days_to_start")}</span></div>
          <div><b class="un">${cur.ts.length}</b><span class="tiny">${t("s_played", { lg })}</span></div>
          <div><b class="un">${t("s_top", { n: F })}</b><span class="tiny">${t("s_to_final")}</span></div>
        </div>
      </div>
      ${lgChips}
      ${myCard}
      <div class="card">${table}</div>
      <div class="card s-how"><button class="rounds-toggle ${how ? "open" : ""}" data-act="s-how" style="margin:0;">${t("s_how")}<span class="chev">›</span></button>
        ${how ? `<div class="s-how-body">
          <div class="s-rule"><b class="un">+5</b><span>${t("s_r1")}</span></div>
          <div class="s-rule"><b class="un">+1</b><span>${t("s_r2")}</span></div>
          <div class="s-rule"><b class="un">+10 / +6 / +3</b><span>${t("s_r3")}</span></div>
          <p class="tiny" style="margin:12px 0 6px;">${t("s_ex_h")}</p>
          <div class="s-ex">${[[1, 10], [2, 6], [3, 3], [8, 0], [16, 0]].map(([p, bn]) => `<div><span>${t("s_place_short", { p })}</span><span class="tiny">5 + ${16 - p}${bn ? " + " + bn : ""}</span><b class="un">${5 + 16 - p + bn}</b></div>`).join("")}</div>
          <p class="tiny" style="margin:12px 0 0;line-height:1.55;">${t("s_pairs_note")}</p>
          <p class="tiny" style="margin:8px 0 0;line-height:1.55;">${t("s_final_note", { n: F, d: dateFmt(S.end) })}</p>
          <p class="tiny" style="margin:8px 0 0;line-height:1.55;">${t("s_after_note")}</p>
          <p class="tiny" style="margin:8px 0 0;line-height:1.55;">${t("s_tie_note")}</p>
        </div>` : ""}</div>`;
  }
  // ---------- секретные номинации (видит только админ) ----------
  function nominationsHtml() {
    const S = curSeason(), E = computeElo();
    const ts = state.tournaments.filter(tt => tt.status === "played" && tt.date >= S.start && tt.date <= S.end && tLeague(tt));
    const tids = new Set(ts.map(tt => tt.id)), sg = state.games.filter(g => tids.has(g.tournamentId) && scoredG(g));
    const cnt = {}, wins = {}; ts.forEach(tt => { const pl = tournamentPlaces(tt); if (!pl) return; Object.entries(pl).forEach(([id, r]) => { cnt[id] = (cnt[id] || 0) + 1; if (r.place === 1) wins[id] = (wins[id] || 0) + 1; }); });
    const elo = {}; Object.entries(E.seq).forEach(([id, arr]) => arr.forEach(x => { if (tids.has(x.g.tournamentId)) elo[id] = (elo[id] || 0) + x.d; }));
    const pairs = {}; sg.forEach(g => [[g.teamA, g.scoreA - g.scoreB], [g.teamB, g.scoreB - g.scoreA]].forEach(([tm, df]) => { const k = tm.slice().sort().join("|"); const q = pairs[k] = pairs[k] || { ids: tm, n: 0, df: 0 }; q.n++; q.df += df; }));
    const top = (obj, fmt) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, v]) => v > 0).map(([id, v]) => `<div class="nom-row">${avatarHtml(id, 26)}<span>${esc(pname(id))}</span><b>${fmt(v)}</b></div>`).join("") || `<div class="tiny">—</div>`;
    const bp = Object.values(pairs).filter(p => p.n >= 2).sort((a, b) => b.df / b.n - a.df / a.n).slice(0, 3);
    const nom = (ic, title, body) => `<div class="nom"><div class="nom-h">${ic} <b>${title}</b></div>${body}</div>`;
    return `<div class="card"><h3>${t("nom_title")}</h3><p class="tiny" style="margin:4px 0 12px;">🔒 ${t("nom_hint", { n: S.n })}</p>
      ${nom("🔥", t("nom_active"), top(cnt, v => t("s_tourn_n", { n: v })))}
      ${nom("📈", t("nom_progress"), top(elo, v => "+" + Math.round(v) + " Elo"))}
      ${nom("🏆", t("nom_wins"), top(wins, v => "×" + v))}
      ${nom("🤝", t("nom_pair"), bp.length ? bp.map(p => `<div class="nom-row"><span>${esc(pname(p.ids[0]))} + ${esc(pname(p.ids[1]))}</span><b>${p.df >= 0 ? "+" : ""}${(p.df / p.n).toFixed(1)}</b></div>`).join("") : `<div class="tiny">—</div>`)}
      <p class="tiny" style="margin:10px 0 0;">${t("nom_fair")}</p></div>`;
  }
  function tournamentFormHtml(tt) {
    const f = state._tf || (state._tf = { id: tt.id, name: tt.name || "", date: tt.date || "", format: tt.format || "americano", courts: tt.courts || 2, status: tt.status || "scheduled", s: { reg_open: true, ...tt.s } });
    const s = f.s;
    const fmts = ["americano", "team_americano", "mexicano", "swiss", "roundrobin", "playoff"];
    const inp = (id, label, val, type, extra) => `<label class="field"><span class="lbl">${label}</span><input type="${type || "text"}" id="${id}" value="${esc(val ?? "")}" ${extra || ""}></label>`;
    return `
      <div class="section-head"><button class="btn ghost sm back" data-act="tf-cancel">‹ ${t("cancel")}</button><h2 style="font-size:16px;">${f.s.kind === "ftour" && f.isNew ? t("friendly_tournament") : f.isNew ? t("new_tournament").replace("+ ", "") : t("edit")}</h2></div>
      <div class="card">
        ${inp("tfName", t("t_name"), f.name)}
        ${inp("tfDate", t("t_date"), f.date, "date")}
        ${timeRangeHtml({ idS: "tfTime", idE: "tfTimeEnd", s: s.time || "", e: s.time_end || "", lblS: t("t_time"), lblE: t("t_time_end") })}
        ${(() => { const other = f.placeOther || (s.place && !CLUBS.includes(s.place));
          return `<label class="field"><span class="lbl">${t("t_place")}</span><select id="tfPlaceSel"><option value="" ${!s.place && !other ? "selected" : ""}>—</option>${CLUBS.map(c => `<option value="${esc(c)}" ${!other && s.place === c ? "selected" : ""}>${esc(c)}</option>`).join("")}<option value="__other" ${other ? "selected" : ""}>${t("place_other")}</option></select></label>
            ${other ? inp("tfPlace", t("place_other_name"), s.place) : ""}`; })()}
        <div class="field"><span class="lbl">${t("t_format")}</span><div class="wrap-tags">${fmts.map(x => `<span class="chip ${f.format===x?'active':''}" data-act="tf-format" data-val="${x}">${t(x)}</span>`).join("")}</div></div>
        <label class="row tf-toggle"><span>${t("t_pairs_mode")}<br><span class="tiny">${t("t_pairs_hint")}</span></span><input type="checkbox" id="tfPairs" data-act="tf-pairs" ${s.pairs ? "checked" : ""}></label>
        ${inp("tfCourtNums", t("t_court_nums"), (s.court_nums || []).join(", "), "text", 'inputmode="decimal" autocomplete="off" placeholder="' + t("t_court_nums_ph") + '"')}
        <p class="tiny" style="margin:-6px 0 12px;">${t("t_court_nums_hint")}</p>
        <div class="grid3">${inp("tfCourts", t("t_courts"), f.courts, "number", 'min="1" max="12"')}${inp("tfSlots", s.pairs ? t("t_pairs") : t("t_slots"), s.slots, "number", 'min="0" max="64"')}${inp("tfPrice", t("t_price"), s.price, "number", 'min="0"')}</div>
        ${(() => { const sel = lvLetters(s), exact = lvExact(s) || (s.level_min == null && s.level_max == null);
          return `<div class="field"><span class="lbl">${t("t_levels")}</span><div class="wrap-tags lv-chips">
            <span class="chip ${!sel.length ? "active" : ""}" data-act="tf-lv" data-val="all">${t("all_levels")}</span>
            ${LV_G.map(([L]) => `<span class="chip lv-chip ${sel.includes(L) ? "active" : ""}" data-act="tf-lv" data-val="${L}">${L}</span>`).join("")}</div>
            <p class="tiny" style="margin:8px 0 0;">${t("level_range")}: <b>${esc(rangeLabel(s))}</b>${s.level_min != null || s.level_max != null ? ` <span class="muted">(${s.level_min != null ? fmtLv(s.level_min) : "0"} – ${s.level_max != null ? fmtLv(s.level_max) : "∞"})</span>` : ""}</p></div>
          <details class="lv-fine" ${exact ? "" : "open"}><summary class="tiny">${t("lv_fine")}</summary>
            <div class="grid2" style="margin-top:8px;">${inp("tfMin", t("t_level_min"), s.level_min, "text", 'inputmode="decimal" autocomplete="off" class="dec-in"')}${inp("tfMax", t("t_level_max"), s.level_max, "text", 'inputmode="decimal" autocomplete="off" class="dec-in"')}</div></details>`; })()}
        ${inp("tfContact", t("t_contact"), s.contact, "url", 'placeholder="https://t.me/…"')}
        <label class="field"><span class="lbl">${t("t_note")}</span><textarea id="tfNote" rows="3">${esc(s.note || "")}</textarea></label>
        <label class="row" style="cursor:pointer;"><span>${t("t_reg_open")}</span><input type="checkbox" id="tfOpen" ${s.reg_open ? "checked" : ""} style="width:22px;height:22px;"></label>
        ${s.kind ? "" : `<label class="field"><span class="lbl">${t("t_season")}</span><select id="tfSeason">${[["auto", t("t_season_auto", { lg: tLeague({ s: { ...s, season_league: "auto" } }) || "—" })], ["D", t("s_league", { lg: "D" })], ["C", t("s_league", { lg: "C" })], ["none", t("t_season_none")]].map(([v, l]) => `<option value="${v}" ${(s.season_league || "auto") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="row tf-toggle"><span>🎁 ${t("p_prizes")}<br><span class="tiny">${t("p_prizes_hint")}</span></span><input type="checkbox" id="tfPartner" ${s.partner_prizes ? "checked" : ""}></label>
        <label class="row tf-toggle"><span>${t("t_approval")}<br><span class="tiny">${t("t_approval_hint")}</span></span><input type="checkbox" id="tfApproval" ${s.approval ? "checked" : ""}></label>`}
        <div class="pf-actions" style="margin-top:14px;justify-content:space-between;">
          ${f.isNew ? "<span></span>" : `<button class="btn sm ghost danger" data-act="tf-delete">${t("delete")}</button>`}
          <span style="display:flex;gap:6px;"><button class="btn sm" data-act="tf-cancel">${t("cancel")}</button><button class="btn sm primary" data-act="tf-save">${t("save")}</button></span>
        </div>
      </div>`;
  }
  function readTf() {
    const f = state._tf; const g = id => document.getElementById(id); if (!f || !g("tfName")) return f;
    f.name = g("tfName").value.trim(); f.date = g("tfDate").value; f.courts = +g("tfCourts").value || 1;
    if (g("tfSeason")) f.s.season_league = g("tfSeason").value;
    if (g("tfPartner")) f.s.partner_prizes = g("tfPartner").checked;
    if (g("tfCourtNums")) { f.s.court_nums = parseCourts(g("tfCourtNums").value); if (f.s.court_nums.length) f.courts = f.s.court_nums.length; }
    const num = v => v === "" ? null : +v;
    const ps = g("tfPlaceSel"); if (ps) { f.placeOther = ps.value === "__other"; f.s.place = f.placeOther ? (g("tfPlace") ? g("tfPlace").value.trim() : (CLUBS.includes(f.s.place) ? "" : f.s.place || "")) : ps.value; }
    // поменяли начало — конец сдвигается на ту же длительность (новый турнир — 2 часа)
    const ns = g("tfTime").value; let ne = g("tfTimeEnd").value; if (ns !== (f.s.time || "")) ne = shiftEnd(f.s.time, ns, ne, 120);
    Object.assign(f.s, { time: ns, time_end: ne, slots: num(g("tfSlots").value), price: num(g("tfPrice").value), level_min: num(g("tfMin").value), level_max: num(g("tfMax").value), contact: g("tfContact").value.trim(), note: g("tfNote").value.trim(), reg_open: g("tfOpen").checked, pairs: g("tfPairs").checked, approval: g("tfApproval") ? g("tfApproval").checked : !!f.s.approval });
    return f;
  }
  async function saveTf() {
    const f = readTf(); if (!f.name) { toast(t("t_name") + "?"); return; }
    if (f.s.kind && !f.date) { toast(t("t_date") + "?"); return; }
    try { const old = byId(state.tournaments, f.id) || {};
      await db.saveTournament({ id: f.id, seq: f.seq || old.seq || Date.now() % 1e9, name: f.name, date: f.date, status: f.status, format: f.format, courts: f.courts, s: f.s, participantIds: old.participantIds, teams: old.teams, scoring: old.scoring, rounds: old.rounds }); state._tf = null; state.view.editT = null; state.view.t = f.id; await reload(); toast(t("saved")); } catch (e) { err(e); }
  }

  // ---------- рейтинг ----------
  function viewRating() {
    const { E, list } = board();
    const grp = state.view.lvGroup || "all";
    const groups = [["all", t("all_levels")], ["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]];
    const rows = list.filter(p => grp === "all" || letter(E.ratings[p.id] / 1000)[0] === grp);
    return `<div class="section-head"><h2>${t("rating")}</h2></div>
      <div class="chips-wrap" style="margin-bottom:12px;">${groups.map(([k, l]) => `<span class="chip sm ${grp===k?'active':''}" data-act="lv-group" data-val="${k}">${l}</span>`).join("")}</div>
      <div class="card">
        <p class="tiny" style="margin:0 0 8px;">${t("rating_hint", { n: CONFIRM_N })}</p>
        <button type="button" class="fold-h" style="margin:2px 0 10px;font-size:13px;" data-act="elo-how"><span>ⓘ ${t("elo_how")}</span><span class="chev ${state.view.eloHow ? "open" : ""}">›</span></button>
        ${state.view.eloHow ? `<div class="elo-how">${t("elo_how_body").split("\n").map(x => `<p>${esc(x)}</p>`).join("")}</div>` : ""}
        <table class="tbl"><tr><th></th><th>${t("players")}</th><th></th><th>Elo</th><th>${t("games")}</th><th>W-L</th></tr>
        ${rows.map((p, i) => { const s = E.stats[p.id]; return `<tr>
          <td><span class="pos-badge ${i===0?'gold':''}">${i+1}</span></td>
          <td class="lb-name"><span class="lb-p" data-act="open-profile" data-id="${p.id}">${avatarHtml(p.id, 30)}<span class="plink">${esc(p.name)}</span>${lblHtml(p.id)}</span></td>
          <td>${levelBadge(E.ratings[p.id] / 1000)}</td>
          <td class="lb-elo ${E.unconfirmed[p.id]?'unc':''}">${Math.round(E.ratings[p.id])}</td>
          <td>${s.g}</td><td>${s.g ? s.w + "-" + s.l : "—"}</td></tr>`; }).join("")}
        </table></div>`;
  }

  // ---------- профиль ----------
  // ---------- контакты ----------
  const CI = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  // ---------- день рождения: contacts.birthday = "ГГГГ-ММ-ДД" или "--ММ-ДД" (год можно не указывать); другим видны только день и месяц ----------
  const LOC = () => ({ uk: "uk-UA", ru: "ru-RU", en: "en-GB" })[getLang()] || "uk-UA";
  const bdParts = v => { const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(String(v || "")); return m ? { y: m[1] === "-" ? "" : m[1], m: String(+m[2]), d: String(+m[3]) } : { y: "", m: "", d: "" }; };
  // "" — не заполнено, null — такой даты нет (31 февраля), иначе строка для сохранения
  const bdValue = b => { if (!b || !b.d || !b.m) return ""; const y = b.y ? +b.y : 2000, mm = +b.m, dd = +b.d, x = new Date(y, mm - 1, dd);
    if (x.getMonth() !== mm - 1 || x.getDate() !== dd) return null; return (b.y ? b.y : "-") + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0"); };
  const bdOf = p => (p && p.contacts && p.contacts.birthday) || "";
  const bdLabel = v => { const b = bdParts(v); if (!b.d) return ""; return new Date(2000, +b.m - 1, +b.d).toLocaleDateString(LOC(), { day: "numeric", month: "long" }); };
  const bdToday = v => { const b = bdParts(v), n = new Date(); return !!b.d && +b.d === n.getDate() && +b.m === n.getMonth() + 1; };
  const needBd = () => { const me = myPlayer(); return !!me && !bdOf(me); };
  function bdSelects(prefix, b, warn) {
    const yNow = new Date().getFullYear(), months = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(LOC(), { month: "long" }));
    const sel = (id, ph, opts, cur) => `<select id="${prefix}Bd${id}" class="bd-sel"><option value="">${ph}</option>${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    return `<div class="field bd-field ${warn ? "need" : ""}" id="${prefix}Bd"><span class="lbl">🎂 ${t("bd_title")}</span><div class="bd-row">
      ${sel("D", t("bd_day"), Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]), b.d)}
      ${sel("M", t("bd_month"), months.map((m, i) => [i + 1, m]), b.m)}
      ${sel("Y", t("bd_year"), Array.from({ length: yNow - 10 - 1939 }, (_, i) => [yNow - 10 - i, yNow - 10 - i]), b.y)}</div>
      <p class="tiny" style="margin:6px 0 0;">${t("bd_hint")}</p></div>`;
  }
  const readBdSel = prefix => { const g = k => { const el = document.getElementById(prefix + "Bd" + k); return el ? el.value : null; }; return g("D") == null ? null : { d: g("D"), m: g("M"), y: g("Y") }; };
  const CONTACTS = [
    ["phone", CI('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>'), v => "tel:" + v.replace(/[^\d+]/g, "")],
    ["telegram", CI('<path d="M21 3L3 10.5l6.5 2.5L12 20l3-5.5L21 3z"/><path d="M9.5 13L21 3"/>'), v => "https://t.me/" + v],
    ["instagram", CI('<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2.5h5L16 6"/>'), v => "https://instagram.com/" + v],
    ["playtomic", "P", null], ["pado", "P", null], ["raketo", "R", null],
  ];
  // ссылка на профиль в приложении (Raketo, Playtomic, Pado): только https, без пробелов и кавычек
  const appLink = v => { v = String(v || "").trim(); if (/^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S+$/i.test(v) && !/^https?:/i.test(v)) v = "https://" + v; return /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : null; };
  const cleanContact = (k, v) => { v = String(v || "").trim(); if (!v) return ""; if (k === "phone") return v.replace(/[^\d+()\s-]/g, "").slice(0, 20);
    if (["playtomic", "pado", "raketo"].includes(k) && appLink(v)) return appLink(v).slice(0, 200);
    return v.replace(/^https?:\/\/(www\.)?(t\.me|instagram\.com)\/@?/i, "").replace(/^@/, "").replace(/[/?#].*$/, "").slice(0, 40); };
  function contactsHtml(p, mine) {
    const c = p.contacts || {}; const filled = CONTACTS.filter(([k]) => c[k]);
    const pen = mine ? `<button class="icon-btn" data-act="p-edit-contacts" data-id="${p.id}" title="${t("edit")}">✎</button>` : "";
    if (!filled.length) return mine ? `<div class="card"><div class="row"><span class="muted">${t("contacts_empty")}</span><button class="btn sm" data-act="p-edit-contacts" data-id="${p.id}">+ ${t("contacts")}</button></div></div>` : "";
    return `<div class="card"><div class="row"><h3>${t("contacts")}</h3>${pen}</div><div class="ct-list">${filled.map(([k, ic, href]) => {
      const v = c[k], isApp = ["playtomic","pado","raketo"].includes(k), link = isApp ? appLink(v) : null;
      const label = k === "phone" ? v : isApp ? (link ? t("open_profile") + " ↗" : v) : "@" + v;
      const inner = `<span class="ct-ic ct-${k}">${ic}</span><span><span class="tiny">${t("c_" + k)}</span><b>${esc(label)}</b></span>`;
      if (isApp) return link ? `<button class="ct-item" data-act="open-link" data-url="${esc(link)}">${inner}</button>` : `<button class="ct-item" data-act="copy-nick" data-val="${esc(v)}" data-app="${k}">${inner}</button>`;
      return href ? (k === "phone" ? `<a class="ct-item wide" href="${esc(href(v))}">${inner}</a>` : `<button class="ct-item" data-act="open-link" data-url="${esc(href(v))}">${inner}</button>`) : `<div class="ct-item">${inner}</div>`;
    }).join("")}</div></div>`;
  }

  // ---------- турниры игрока: место и изменение Эло ----------
  function playedTournaments(pid, E) {
    const byT = {}; (E.seq[pid] || []).forEach(x => { (byT[x.g.tournamentId] = byT[x.g.tournamentId] || []).push(x); });
    return state.tournaments.filter(tt => byT[tt.id] && tt.format !== "match").map(tt => {
      const pts = {}, diff = {};
      state.games.filter(g => g.tournamentId === tt.id && g.scoreA != null && g.scoreB != null).forEach(g => {
        g.teamA.forEach(id => { pts[id] = (pts[id] || 0) + g.scoreA; diff[id] = (diff[id] || 0) + g.scoreA - g.scoreB; });
        g.teamB.forEach(id => { pts[id] = (pts[id] || 0) + g.scoreB; diff[id] = (diff[id] || 0) + g.scoreB - g.scoreA; }); });
      const order = Object.keys(pts).sort((a, b) => pts[b] - pts[a] || diff[b] - diff[a]);
      const mine = byT[tt.id];
      // место берём из общей таблицы турнира (как в сезоне): учитывает пары и делёж места при равенстве — оба партнёра победившей пары = 1
      const P = tournamentPlaces(tt), me = P && P[pid];
      return { tt, place: me ? me.place : order.indexOf(pid) + 1, n: me ? me.of : order.length, pts: pts[pid] || 0, w: mine.filter(x => x.win).length, l: mine.filter(x => x.loss).length, d: mine.reduce((a, x) => a + x.d, 0) };
    });
  }

  // ---------- ачивки (живые, считаются из результатов) ----------
  const BI = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ACH_ICON = {
    champion: BI('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6"/>'),
    podium: BI('<path d="M3 21V13h6v8M9 21V8h6v13M15 21v-5h6v5M3 21h18"/>'),
    giant: BI('<path d="M3 20l6-12 4 7 3-4 5 9z"/><path d="M14 5l1-2 1 2"/>'),
    clutch: BI('<path d="M13 2L5 14h6l-1 8 9-13h-6z"/>'),
    comeback: BI('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>'),
    streak: BI('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-6 1-9z"/>'),
    onfire: BI('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-6 1-9z"/><path d="M4 5l1 2M20 5l-1 2"/>'),
    blowout: BI('<path d="M4 20l4-4M8 16l8-8 4 4-8 8H8z"/><path d="M14 6l4 4"/>'),
    unbeaten: BI('<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'),
    rocket: BI('<path d="M14 4c3 0 6 3 6 6l-8 8-4-4z"/><path d="M8 14l-4 1 3-5M10 16l-1 4 5-3M15 9h.01"/>'),
    levelup: BI('<path d="M12 20V5M6 11l6-6 6 6"/><path d="M5 20h14"/>'),
    social: BI('<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M13 20a4.5 4.5 0 0 1 9 0"/>'),
    unlucky: BI('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="12" cy="12" r="1"/>'),
  };
  const LETTERS = ["D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
  const eloLetter = e => letter(e / 1000);
  function achievements(pid, E) {
    const s = E.seq[pid] || [], out = []; const add = (k, sub, kind) => out.push({ k, sub, kind: kind || "personal" });
    const tours = playedTournaments(pid, E);
    const wins = tours.filter(x => x.place === 1).length, pods = tours.filter(x => x.place >= 1 && x.place <= 3).length;
    if (wins) add("champion", t("a_champion_sub", { n: wins }), "title");
    else if (pods) add("podium", t("a_podium_sub", { n: pods }), "title");
    const gk = s.filter(x => x.win && x.oppR - x.ownR >= 500);
    if (gk.length) add("giant", t("a_giant_sub", { d: Math.round(Math.max(...gk.map(x => x.oppR - x.ownR))), n: gk.length }));
    const cl = s.filter(x => x.win && x.own - x.opp === 1).length; if (cl >= 2) add("clutch", t("a_clutch_sub", { n: cl }));
    let run = 0, lastT = null, cb = null; s.forEach(x => { if (x.g.tournamentId !== lastT) { run = 0; lastT = x.g.tournamentId; } if (x.loss) run++; else if (x.win) { if (run >= 3) cb = run; run = 0; } });
    if (cb) add("comeback", t("a_comeback_sub", { n: cb }));
    let cur = 0, best = 0; s.forEach(x => { if (x.win) { cur++; best = Math.max(best, cur); } else cur = 0; });
    if (cur >= 3) add("onfire", t("a_onfire_sub", { n: cur })); else if (best >= 4) add("streak", t("a_streak_sub", { n: best }));
    const bl = s.filter(x => x.win && x.own + x.opp >= 8 && x.own / (x.own + x.opp) >= .75).sort((a, b) => (b.own - b.opp) - (a.own - a.opp))[0];
    if (bl) add("blowout", bl.own + ":" + bl.opp + " · " + t("with_partner", { name: pname(bl.partner) }));
    const pr = {}; s.forEach(x => { const q = pr[x.partner] = pr[x.partner] || { g: 0, l: 0 }; q.g++; if (x.loss) q.l++; });
    const unb = Object.keys(pr).filter(k => pr[k].g >= 3 && !pr[k].l); if (unb.length) add("unbeaten", unb.map(k => pname(k) + " " + pr[k].g + "-0").join(", "));
    const rk = tours.filter(x => x.d >= 200).sort((a, b) => b.d - a.d)[0]; if (rk) add("rocket", "+" + Math.round(rk.d) + " · " + rk.tt.name);
    const p = byId(state.players, pid), from = letter(p.level), to = eloLetter(E.ratings[pid]);
    if (s.length && LETTERS.indexOf(to) > LETTERS.indexOf(from)) add("levelup", from + " → " + to);
    const partners = new Set(s.map(x => x.partner)).size; if (partners >= 8) add("social", t("a_social_sub", { n: partners }));
    const ul = s.filter(x => x.loss && x.opp - x.own === 1).length; if (ul >= 3) add("unlucky", t("a_unlucky_sub", { n: ul }), "anti");
    // главные — самые «жёсткие» и позитивные; анти — всегда в конце
    const PRIO = ["champion", "giant", "rocket", "levelup", "unbeaten", "onfire", "streak", "comeback", "clutch", "blowout", "podium", "social", "unlucky"];
    return out.sort((a, b) => PRIO.indexOf(a.k) - PRIO.indexOf(b.k));
  }
  function achievementsHtml(pid, E) {
    const list = achievements(pid, E); const open = state.view.achOpen === pid;
    const cell = b => `<div class="bdg ${b.kind}" title="${esc(t("a_" + b.k + "_desc"))}"><div class="bdg-ic">${ACH_ICON[b.k]}</div><div class="bdg-name">${t("a_" + b.k)}</div><div class="bdg-desc">${esc(b.sub)}</div></div>`;
    const top = list.slice(0, 3), rest = list.slice(3);
    const body = !list.length ? `<p class="tiny" style="margin:10px 0 0;">${t("a_none")}</p>`
      : `<div class="badge-grid">${top.map(cell).join("")}${open ? rest.map(cell).join("") : ""}</div>
         ${rest.length ? `<button class="ach-more ${open ? "open" : ""}" data-act="toggle-ach" data-id="${pid}">${open ? t("ach_less") : `<span class="ach-dots">${rest.slice(0, 4).map(b => `<i class="${b.kind}">${ACH_ICON[b.k]}</i>`).join("")}</span>${t("ach_more", { n: rest.length })}`}</button>` : ""}`;
    return `<div class="card bdg-card"><h3>${t("achievements")} <span class="tiny">· ${list.length}</span></h3>${body}</div>`;
  }

  // ---------- история ----------
  function tournamentsHistoryHtml(pid, E) {
    const tours = playedTournaments(pid, E).reverse(); if (!tours.length) return "";
    const medal = n => n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : "";
    return `<div class="card"><h3>${t("played_tournaments")} <span class="tiny">· ${tours.length}</span></h3><div class="stack" style="margin-top:8px;">${tours.map(x => `
      <div class="row" style="cursor:pointer;" data-act="open-t-tab" data-id="${x.tt.id}"><span>${esc(x.tt.name)}<br><span class="tiny">${dateFmt(x.tt.date)} · ${x.w}-${x.l} · ${x.pts} ${t("pts")} · <span class="${x.d >= 0 ? "up" : "down"}">${x.d >= 0 ? "+" : ""}${Math.round(x.d)} Elo</span></span></span>
      <strong>${medal(x.place)} ${x.place}<span class="tiny">/${x.n}</span></strong></div>`).join("")}</div></div>`;
  }
  function matchHistoryHtml(pid, E) {
    const all = (E.seq[pid] || []).slice().reverse(); if (!all.length) return "";
    const showAll = state.view.mhAll === pid, list = showAll ? all : all.slice(0, 8);
    const tn = id => { const tt = byId(state.tournaments, id); return tt ? tt.name : ""; };
    return `<div class="card"><h3>${t("match_history")} <span class="tiny">· ${all.length}</span></h3><div class="mh-list">${list.map(x => `
      <div class="mh-row ${x.win ? "win" : x.loss ? "loss" : "draw"}">
        <span class="mh-res">${x.win ? "W" : x.loss ? "L" : "D"}</span>
        <div class="mh-main"><div>${t("with_partner", { name: "" })}${x.partner ? pl(x.partner) : "—"}</div><div class="tiny">${t("vs")} ${x.opps.map(pl).join(" + ")}</div><div class="tiny dim">${esc(tn(x.g.tournamentId))}${(byId(state.tournaments, x.g.tournamentId) || {}).format === "match" ? "" : ` · ${t("round")} ${x.g.round}`}</div></div>
        <div class="mh-score"><b>${x.own}:${x.opp}</b><span class="tiny ${x.d >= 0 ? "up" : "down"}">${x.d >= 0 ? "+" : ""}${Math.round(x.d)}</span>${x.e != null ? `<span class="tiny dim" title="${t("elo_chance")}">${Math.round(x.e * 100)}%</span>` : ""}</div>
      </div>`).join("")}</div>
      ${all.length > 8 ? `<button class="btn sm ghost block" style="margin-top:8px;" data-act="mh-all" data-id="${pid}">${showAll ? t("show_less") : t("show_all", { n: all.length })}</button>` : ""}</div>`;
  }

  // ---------- профиль ----------
  function viewProfile() {
    const my = myPlayer(); const pid = state.view.pid || (my && my.id);
    if (!pid || !byId(state.players, pid)) return viewOnboarding();
    const p = byId(state.players, pid), { E, list } = board(); const s = E.stats[pid]; const rank = list.findIndex(x => x.id === pid);
    const mine = my && my.id === pid, nav = !!state.view.pid;
    const upcoming = state.registrations.filter(r => r.playerId === pid && r.status !== "cancelled").map(r => ({ r, tt: byId(state.tournaments, r.tournamentId) })).filter(x => x.tt && isUpcoming(x.tt) && x.tt.format !== "match");
    const head = nav ? `<div class="section-head"><button class="btn ghost sm back" data-act="p-back">‹ ${t("back")}</button><h2 style="flex:1;text-align:right;">${t("profile")}</h2></div>` : `<div class="section-head"><h2>${t("profile")}</h2></div>`;
    if (state.view.editP === pid && (mine || canEdit())) return head + profileEditHtml(p);
    const bdCard = mine && needBd() ? `<div class="bd-need"><span class="bd-need-ic">🎂</span><div><b>${t("bd_need")}</b><p class="tiny">${t("bd_need_sub")}</p></div><button class="btn sm primary" data-act="p-edit-bd" data-id="${pid}">${t("bd_fill")}</button></div>` : "";
    return `${head}${mine ? levelBannerHtml() : ""}${bdCard}
      <div class="card hero">
        <div class="hero-top">
          <div class="hero-id">${avatarHtml(pid, 64)}<div><div class="hero-name">${esc(p.name)}${p.label ? ` <span class="nm-lbl">(${esc(p.label)})</span>` : ""}</div><div class="tiny">${rank >= 0 ? `#${rank+1} / ${list.length}` : ""} · ${p.levelStatus === "ok" ? `${levelBadge(E.ratings[pid] / 1000)} ${fmtLv(Math.round(E.ratings[pid]) / 1000)}` : ""}</div>${bdOf(p) ? `<div class="tiny bd-line ${bdToday(bdOf(p)) ? "today" : ""}">🎂 ${bdToday(bdOf(p)) ? t("bd_today") : esc(bdLabel(bdOf(p)))}</div>` : ""}${mine || canEdit() ? `<button class="btn ghost sm" style="margin-top:6px;" data-act="p-edit" data-id="${pid}">✎ ${t("edit")}${mine && needBd() ? `<i class="need-dot"></i>` : ""}</button>` : ""}</div></div>
          ${p.levelStatus === "ok" ? `<div class="hero-elo"><span class="${E.unconfirmed[pid]?'unc':''}">${Math.round(E.ratings[pid])}</span><small>${E.unconfirmed[pid] ? t("unconfirmed") : t("confirmed")}</small></div>` : `<div class="hero-elo"><span class="pend">⏳</span><small>${p.levelStatus === "pending" ? t("pending_short") : t("need_quiz_short")}</small></div>`}
        </div>
        ${p.levelStatus === "ok" && E.unconfirmed[pid] ? `<p class="tiny" style="margin:8px 0 0;">${t("unconfirmed_hint", { n: CONFIRM_N - E.tcount[pid] })}</p>` : ""}
        <div class="hero-grid">
          <div><strong>${s.g}</strong><span>${t("games")}</span></div>
          <div><strong>${s.g ? s.w + "-" + s.l : "—"}</strong><span>W-L</span></div>
          <div><strong>${E.tcount[pid]}</strong><span>${t("tournaments_played")}</span></div>
        </div>
        ${p.bio ? `<p style="margin:12px 0 0;white-space:pre-line;">${esc(p.bio)}</p>` : ""}
      </div>
      ${contactsHtml(p, mine)}
      ${achievementsHtml(pid, E)}
      ${upcoming.length ? `<div class="card"><h3>${t("my_tournaments")}</h3><div class="stack" style="margin-top:8px;">${upcoming.map(({ r, tt }) => `<div class="row" style="cursor:pointer;" data-act="open-t-tab" data-id="${tt.id}"><span>${esc(tt.name)}<br><span class="tiny">${dateFmt(tt.date)} · ${esc(rangeLabel(tt.s))}</span></span>${r.approval === "pending" ? `<span class="ct-mine pending">${t("pending_approval")}</span>` : `<span class="ct-mine ${r.status}">${r.status === "main" ? t("main_list") : t("reserve_list")}</span>`}</div>`).join("")}</div></div>` : ""}
      ${tournamentsHistoryHtml(pid, E)}
      ${matchHistoryHtml(pid, E)}
      ${mine ? accountCardHtml() : ""}`;
  }
  // админ ставит текущее Эло игрока: до первого турнира — это стартовое Эло, потом — правка «после последнего турнира»
  async function setEloNow(pid, v) {
    const p = byId(state.players, pid); v = Math.round(+v); if (!p || !v || v < 100 || v > 9000) return false;
    const E = computeElo(), cur = Math.round(E.ratings[pid]); if (v === cur) return false;
    if (!E.lastT) await db.updatePlayer(pid, { eloStart: v, level: v / 1000 });
    else { const list = (p.eloAdj || []).filter(o => o.after !== E.lastT).concat([{ after: E.lastT, value: v, at: new Date().toISOString() }]); await db.updatePlayer(pid, { eloAdj: list, level: v / 1000 }); }
    await db.addLog(`Эло ${p.name}: ${cur} → ${v} (вручную)`).catch(() => {}); return true;
  }
  async function setLabel(pid, v) {
    const p = byId(state.players, pid); v = String(v || "").replace(/\s+/g, " ").trim().slice(0, 30); if (!p || v === (p.label || "")) return false;
    await db.updatePlayer(pid, { label: v }); await db.addLog(`Подпись ${p.name}: «${p.label || ""}» → «${v}»`).catch(() => {}); p.label = v; return true;
  }
  function profileEditHtml(p) {
    const pf = state._pf || (state._pf = { name: p.name, avatar: undefined, bio: p.bio || "", c: Object.fromEntries(CONTACTS.map(([k]) => [k, (p.contacts || {})[k] || ""])) });
    if (pf.elo == null) pf.elo = String(Math.round(computeElo().ratings[p.id])); if (pf.lbl == null) pf.lbl = p.label || "";
    const mine = myPlayer() && myPlayer().id === p.id;
    const c0 = p.contacts || {}, E0 = computeElo();
    const canAdj = mine && c0.level_source === "quiz" && Array.isArray(c0.quiz) && !(E0.seq[p.id] || []).length;
    const base = canAdj ? quizLevel(c0.quiz) : null;
    if (canAdj && pf.level == null) pf.level = p.level;
    const adjBlock = canAdj ? `<div class="lv-adj">
        <div class="row"><span class="lbl" style="margin:0;">${t("level_value")}</span><span class="tiny">${t("quiz_range", { a: (base - .3).toFixed(1), b: (base + .3).toFixed(1) })}</span></div>
        <div class="lv-adj-row">
          <button class="lv-step" data-act="lv-step" data-val="-0.1" ${pf.level <= base - .3 + 1e-9 ? "disabled" : ""}>−</button>
          <div class="lv-adj-mid">${levelBadge(pf.level, "big")}<div><div class="ob-elo">${(+pf.level).toFixed(1)}</div><div class="tiny">${letter(pf.level)} · ${levelElo(pf.level)} Elo</div></div></div>
          <button class="lv-step" data-act="lv-step" data-val="0.1" ${pf.level >= base + .3 - 1e-9 ? "disabled" : ""}>+</button>
        </div>
        <p class="tiny" style="margin:6px 0 0;">${t("quiz_adjust_note")}</p></div>` : "";
    const av = pf.avatar === undefined ? p.avatar : pf.avatar;
    return `<div class="card hero">
      <div class="pf-edit">
        <label class="pf-avatar-pick">${av ? `<span class="avatar" style="width:88px;height:88px;"><img src="${av}" alt=""></span>` : `<span class="avatar ph" style="width:88px;height:88px;">${SIL}</span>`}<input type="file" id="pfPhoto" accept="image/*" hidden><span class="pf-cam">📷</span></label>
        <div class="pf-fields"><label class="field"><span class="lbl">${t("your_name")}</span>${okWrap(`<input type="text" id="pfName" value="${esc(pf.name)}" maxlength="40" enterkeyhint="done">`, "pf:" + p.id)}</label>
          <div class="pf-actions"><button class="btn sm" data-act="pf-photo">${av ? t("photo_change") : t("photo_add")}</button>${av ? `<button class="btn sm ghost" data-act="pf-photo-clear">${t("photo_remove")}</button>` : ""}</div></div>
      </div>
      ${adjBlock}
      ${canEdit() ? `<div class="pf-admin"><div class="tiny" style="margin-bottom:6px;">🔒 ${t("admin_only")}</div><div class="pf-admin-row">
        <label class="field"><span class="lbl">${t("cur_elo")}</span><input type="number" inputmode="numeric" step="1" id="pfElo" value="${esc(pf.elo)}"></label>
        <label class="field" style="flex:1;"><span class="lbl">${t("player_lbl")}</span><input type="text" id="pfLbl" maxlength="30" value="${esc(pf.lbl)}" placeholder="${t("player_lbl_ph")}"></label></div>
        <p class="tiny" style="margin:4px 0 0;">${t("elo_now_hint")}</p></div>` : ""}
      <label class="field" style="margin-top:12px;"><span class="lbl">${t("bio")}</span>${okWrap(`<textarea id="pfBio" rows="2" maxlength="200">${esc(pf.bio)}</textarea>`, "pf:" + p.id)}</label>
      ${mine ? bdSelects("pf", pf.bd || (pf.bd = bdParts(bdOf(p))), !bdValue(pf.bd)) : ""}
      ${mine ? `<h3 id="pfContacts" style="margin:6px 0 4px;scroll-margin-top:40px;">${t("contacts")}</h3><p class="tiny" style="margin:0 0 10px;">${t("contacts_hint")}</p>
      <div class="ct-form">${CONTACTS.map(([k, ic]) => `<label class="ct-field"><span class="ct-ic ct-${k}">${ic}</span>${okWrap(`<input type="${k === "phone" ? "tel" : "text"}" id="pfc_${k}" value="${esc(pf.c[k])}" placeholder="${t("c_" + k)}${k === "phone" ? " +380…" : ["playtomic","pado","raketo"].includes(k) ? " — " + t("nick_or_link") : " @nick"}" maxlength="${["playtomic","pado","raketo"].includes(k) ? 200 : 60}" enterkeyhint="done">`, "pf:" + p.id)}</label>`).join("")}</div>` : ""}
      <div class="pf-actions" style="justify-content:flex-end;"><button class="btn sm" data-act="pf-cancel">${t("cancel")}</button><button class="btn sm primary" data-act="pf-save" data-id="${p.id}">${t("save")}</button></div>
    </div>`;
  }
  function readAvatarFile(file) {
    return new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const S = 256, c = document.createElement("canvas"); c.width = S; c.height = S; const x = c.getContext("2d"); const m = Math.min(img.naturalWidth, img.naturalHeight); x.drawImage(img, (img.naturalWidth-m)/2, (img.naturalHeight-m)/2, m, m, 0, 0, S, S); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", .82)); };
      img.onerror = () => rej(new Error("bad image")); img.src = url; });
  }
  async function savePf(pid, keep) {
    const p = byId(state.players, pid); const pf = state._pf; const g = id => document.getElementById(id);
    if (keep && pf && g("pfName")) { pf.name = g("pfName").value; pf.bio = g("pfBio").value; if (g("pfElo")) { pf.elo = g("pfElo").value; pf.lbl = g("pfLbl").value; } CONTACTS.forEach(([k]) => { const el = g("pfc_" + k); if (el) pf.c[k] = el.value; }); }
    const name = g("pfName").value.trim(), bio = g("pfBio").value.trim();
    const contacts = { ...(p.contacts || {}) }; CONTACTS.forEach(([k]) => { const el = g("pfc_" + k); if (el) { const v = cleanContact(k, el.value); if (v) contacts[k] = v; else delete contacts[k]; } });
    const avatar = pf.avatar === undefined ? (p.avatar || null) : pf.avatar;
    const bsel = readBdSel("pf"); if (bsel) { const bd = bdValue(bsel); if (bd === null) { toast(t("bd_bad")); return; } if (bd) contacts.birthday = bd; else delete contacts.birthday; }
    try {
      if (myPlayer() && myPlayer().id === pid) { await db.updateMyCard(name, avatar, contacts, bio); if (pf.level != null && Math.abs(pf.level - p.level) > 1e-9) await db.adjustMyLevel(+pf.level.toFixed(1)); }
      else if (name && name !== p.name) await db.updatePlayer(pid, { name });
      if (canEdit() && g("pfElo")) { await setLabel(pid, g("pfLbl").value); await setEloNow(pid, g("pfElo").value); }
      if (!keep) { state._pf = null; state.view.editP = null; } await reload(); toast(t("saved"));
    } catch (e) { err(e); }
  }
  function accountCardHtml() {
    return `<div class="card"><h3>${t("account")}</h3>
      <div class="stack" style="margin-top:8px;">
        <div class="row"><span class="muted">${t("language")}</span><select id="langSel" style="width:auto;">${LANGS.map(([k, l]) => `<option value="${k}" ${getLang()===k?"selected":""}>${l}</option>`).join("")}</select></div>
        <div class="row"><span class="muted">${t("role")}</span><strong>${esc(U.role)}</strong></div>
        ${homeMode ? `<button class="btn sm" data-act="add-home">${HOME_IC} ${t("home_add_long")}</button>` : ""}
        <button class="btn sm ghost" data-act="logout">${t("logout")}</button>
      </div></div>`;
  }

  // ---------- админ ----------
  function viewAdmin() {
    if (!canEdit()) return "";
    const queue = state.players.filter(p => p.levelStatus !== "ok");
    const pendingN = queue.filter(p => p.levelStatus === "pending").length;
    const sub = state.view.adm || (pendingN ? "review" : "ratings");
    const tabs = [["review", t("review_tab"), pendingN], ["ratings", t("ratings_admin")], ...(isAdmin() ? [["visits", t("visits_tab")], ["nom", "🔒 " + t("nom_tab")], ["partner", "🤝 " + t("p_tab")]] : []), ["roles", t("roles")]];
    let body = "";
    if (sub === "ratings") {
      const q = (state.view.q || "").toLowerCase(); const E = computeElo();
      const rows = state.players.filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      body = `<div class="card"><p class="tiny" style="margin:0 0 8px;">${t("ratings_admin_hint")}</p><input type="search" id="admQ" placeholder="${t("search")}" value="${esc(state.view.q || "")}">
        <div style="margin-top:8px;">${rows.map(p => `<div class="adm-row ${p.active?'':'off'}">
          <div class="adm-main" data-act="open-profile" data-id="${p.id}">${avatarHtml(p.id, 34)}<span><b>${esc(p.name)}</b>${p.label ? ` <span class="nm-lbl">(${esc(p.label)})</span>` : ""}<br><span class="tiny">${t("src_"+((p.contacts||{}).level_source||"self"))}${(p.contacts||{}).quiz_elo != null ? " " + p.contacts.quiz_elo : ""} · Elo ${Math.round(E.ratings[p.id])} · ${E.tcount[p.id]} ${t("tournaments_played")}</span></span></div>
          <div class="adm-ctl">
            <label class="adm-lbl">${t("player_lbl")}<input type="text" maxlength="30" autocomplete="off" enterkeyhint="done" data-act="adm-lbl" data-id="${p.id}" value="${esc(p.label || "")}" placeholder="${t("player_lbl_ph")}"></label>
            <label>${t("level_value")}<input type="text" inputmode="decimal" autocomplete="off" class="dec-in" data-act="adm-level" data-id="${p.id}" value="${p.level ?? ""}"></label>
            <label>${t("start_elo")}<input type="number" step="10" data-act="adm-elo" data-id="${p.id}" value="${p.eloStart}"></label>
            <label>${t("cur_elo")}<input type="number" step="1" data-act="adm-elo-now" data-id="${p.id}" value="${Math.round(E.ratings[p.id])}"></label>
            <button class="btn sm ${p.confirmed?'primary':''}" data-act="adm-confirm" data-id="${p.id}">${p.confirmed ? "✓" : t("confirm")}</button>
            <button class="btn sm ghost" data-act="adm-active" data-id="${p.id}">${p.active ? "⏸" : "▶"}</button>
            ${isAdmin() && p.userId ? `<button class="btn sm ghost danger" data-act="adm-reset" data-id="${p.id}" title="${t("reset_player")}">↺ ${t("reset_short")}</button>` : ""}
          </div></div>`).join("")}</div></div>`;
    } else if (sub === "roles") body = membersCardHtml();
    else if (sub === "visits") body = visitsHtml();
    else if (sub === "nom" && isAdmin()) body = nominationsHtml();
    else if (sub === "partner" && isAdmin()) { const P = partner();
      body = `<div class="card"><div class="pt-top"><b>${esc(P.name)}</b><img class="pt-logo" src="lupadel.svg" alt=""></div><p class="tiny" style="margin:8px 0 12px;">${t("p_admin_hint")}</p>
        <label class="field"><span class="lbl">${t("p_shop")}</span><input type="url" id="ptShop" value="${esc(P.shop || "")}" placeholder="https://…"></label>
        <label class="field"><span class="lbl">${t("p_consult")}</span><input type="url" id="ptConsult" value="${esc(P.consult || "")}" placeholder="https://t.me/…"></label>
        <label class="row tf-toggle"><span>${t("p_season_toggle")}</span><input type="checkbox" id="ptSeason" ${P.season ? "checked" : ""}></label>
        <div class="pf-actions" style="justify-content:flex-end;margin-top:12px;"><button class="btn sm primary" data-act="pt-save">${t("save")}</button></div></div>
        ${partnerStatsHtml()}`; }
    else if (sub === "review") body = !queue.length ? `<div class="card"><div class="empty"><div class="ic">✓</div>${t("review_empty")}</div></div>`
      : `<p class="tiny" style="margin:0 0 10px;">${t("review_hint")}</p>` + queue.sort((a, b) => (a.levelStatus === "pending" ? 0 : 1) - (b.levelStatus === "pending" ? 0 : 1)).map(p => {
        const c = p.contacts || {}, src = c.level_source || "", nick = c[src];
        if (p.levelStatus === "quiz_required") return `<div class="card rv-card wait"><div class="adm-main" data-act="open-profile" data-id="${p.id}">${avatarHtml(p.id, 40)}<span><b>${esc(p.name)}</b><br><span class="tiny">${t("rv_waiting_quiz")} · ${t("src_" + src)} ${p.levelClaim ?? ""}</span></span></div>${isAdmin() ? `<div class="rv-actions" style="margin-top:10px;"><button class="btn sm ghost danger" data-act="adm-reset" data-id="${p.id}">↺ ${t("reset_short")}</button></div>` : ""}</div>`;
        return `<div class="card rv-card">
          <div class="adm-main" data-act="open-profile" data-id="${p.id}">${avatarHtml(p.id, 40)}<span><b>${esc(p.name)}</b><br><span class="tiny">${t("src_" + src)} · ${nick ? (appLink(nick) ? `<button class="rv-link" data-act="open-link" data-url="${esc(appLink(nick))}">${t("open_profile")} ↗</button>` : `<b class="rv-nick">${esc(nick)}</b>`) : "—"}${c.level_raw ? ` · ${t("rv_raw")}: <b>${esc(c.level_raw)}</b>` : ""}</span></span></div>
          <div class="rv-claim">${levelBadge(p.levelClaim, "big")}<div><div class="tiny">${t("rv_claimed")}</div><div class="ob-elo">${fmtLv(p.levelClaim)} · ${letter(p.levelClaim)} · ${levelElo(p.levelClaim)}</div></div></div>
          <div class="rv-actions">
            <label>${t("level_value")}<input type="text" inputmode="decimal" autocomplete="off" class="dec-in" id="rv_${p.id}" value="${p.levelClaim ?? ""}"></label>
            <button class="btn sm primary" data-act="rv-approve" data-id="${p.id}">✓ ${t("rv_approve")}</button>
            <button class="btn sm" data-act="rv-quiz" data-id="${p.id}">${t("rv_ask_quiz")}</button>
            ${isAdmin() ? `<button class="btn sm ghost danger" data-act="adm-reset" data-id="${p.id}">↺ ${t("reset_short")}</button>` : ""}
          </div></div>`;
      }).join("");
    return `<div class="section-head"><h2>${t("admin")}</h2></div>
      <div class="chips-wrap" style="margin-bottom:12px;">${tabs.map(([k, l, n]) => `<span class="chip sm has-badge ${sub===k?'active':''}" data-act="adm-tab" data-val="${k}">${l}${n ? `<span class="cnt-badge">${n}</span>` : ""}</span>`).join("")}</div>${body}`;
  }
  const ROLE_LABEL = { owner: "owner", admin: "admin", editor: "editor", player: "player", viewer: "viewer" };
  // ---------- кто заходил (только админ): ник Telegram, вход, есть ли анкета ----------
  const seenFmt = ts => { if (!ts) return "—"; const d = new Date(ts), now = new Date(), hm = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((day(now) - day(d)) / 864e5);
    return diff === 0 ? t("today") + " " + hm : diff === 1 ? t("yesterday") + " " + hm : String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + " " + hm; };
  function visitsHtml() {
    if (!state._visits) { if (!state._vl) { state._vl = true; db.adminMembers().then(r => { state._visits = r; state._vl = false; render(); }).catch(e => { state._vl = false; state._visits = []; err(e); }); } return `<div class="card"><p class="tiny">…</p></div>`; }
    const st = m => { const p = m.playerId && byId(state.players, m.playerId); return !p ? "none" : p.levelStatus === "pending" ? "pending" : p.levelStatus === "quiz_required" ? "quiz" : "ok"; };
    const all = state._visits, f = state.view.visF || "all";
    const cnt = k => all.filter(m => st(m) === k).length;
    const rows = all.filter(m => f === "all" || st(m) === f);
    const badge = { ok: ["ok", t("vis_ok")], pending: ["pending", t("vis_pending")], quiz: ["quiz", t("vis_quiz")], none: ["none", t("vis_none")] };
    const filters = [["all", t("vis_all"), all.length], ["none", t("vis_none"), cnt("none")], ["pending", t("vis_pending"), cnt("pending")], ["ok", t("vis_ok"), cnt("ok")]];
    return `<div class="card">
      <div class="row" style="margin-bottom:10px;"><span class="tiny">${t("vis_hint")}</span><button class="btn sm ghost" data-act="vis-refresh">↻</button></div>
      <div class="chips-wrap" style="margin-bottom:10px;">${filters.map(([k, l, n]) => `<span class="chip sm ${f === k ? "active" : ""}" data-act="vis-f" data-val="${k}">${l} · ${n}</span>`).join("")}</div>
      ${rows.map(m => { const p = m.playerId && byId(state.players, m.playerId), b = badge[st(m)];
        return `<div class="vis-row">
          ${p ? `<span data-act="open-profile" data-id="${p.id}" style="cursor:pointer;">${avatarHtml(p.id, 38)}</span>` : `<span class="avatar ph" style="width:38px;height:38px;">${SIL}</span>`}
          <div class="vis-main"><div class="vis-name">${esc((p && p.name) || m.name || "—")}${m.role !== "player" ? ` <span class="role-tag ${m.role}">${m.role}</span>` : ""}</div>
            <div class="tiny">${m.username ? `<span class="tg-link" data-act="open-tg" data-u="${esc(m.username)}">@${esc(m.username)}</span>` : `<span>ID ${esc(m.tgId ?? "—")}</span>`}${p && m.name && m.name !== p.name ? ` · ${esc(m.name)}` : ""}</div>
            <div class="tiny">${t("vis_seen")}: <b>${seenFmt(m.seen)}</b> · ${t("vis_first")}: ${seenFmt(m.joined)}</div></div>
          <span class="vis-badge ${b[0]}">${b[1]}</span></div>`; }).join("") || `<div class="tiny">${t("nobody_yet")}</div>`}
    </div>`;
  }
  function membersCardHtml() {
    if (!state._members) { if (!state._ml) { state._ml = true; db.listMembers().then(m => { state._members = m; state._ml = false; render(); }).catch(() => { state._ml = false; state._members = []; }); } return `<div class="card"><p class="tiny">…</p></div>`; }
    const order = { owner: 0, admin: 1, editor: 2, player: 3, viewer: 4 };
    const ms = state._members.slice().sort((a, b) => (order[a.role]-order[b.role]) || (a.name||"").localeCompare(b.name||""));
    const canSet = m => m.userId !== U.id && m.role !== "owner" && !(U.role === "admin" && m.role === "admin");
    return `<div class="card"><div>${ms.map(m => `<div class="link-row p-row"><span class="p-row-main" style="cursor:default;">${m.playerId ? avatarHtml(m.playerId, 34) : `<span class="avatar ph" style="width:34px;height:34px;">${SIL}</span>`}<span><span class="p-row-name">${esc(m.name || "—")}</span><br><span class="tiny">${m.playerId && byId(state.players, m.playerId) ? esc(pname(m.playerId)) : "—"}</span></span></span>
      <span class="p-row-side">${canSet(m) ? `<select class="role-sel" data-act="set-role" data-id="${m.userId}">${["admin","editor","player","viewer"].filter(r => U.role === "owner" || r !== "admin").map(r => `<option value="${r}" ${m.role===r?"selected":""}>${r}</option>`).join("")}</select>` : `<span class="role-tag ${m.role}">${m.role}</span>`}</span></div>`).join("")}</div></div>`;
  }

  // ---------- рендер и события ----------
  // ---------- вкладка «Игры» (games.js) ----------
  const backLbl = () => state.tab === "games" ? G.backLabel() : t("tournaments");
  function newFtour() { const me = myPlayer(), nid = uid();
    state._tf = { id: nid, isNew: true, name: "", date: today(), format: "americano", courts: 2, status: "scheduled", s: { kind: "ftour", created_by: me ? me.id : null, season_league: "none", reg_open: true, slots: 8, approval: false } };
    state.view.t = nid; state.view.editT = nid; window.scrollTo(0, 0); render(); }
  const G = createGames({ state, db, esc, toast, err, render: () => render(), reload: () => reload(), myPlayer, isAdmin, computeElo, eloExpect, ELO, letter, levelBadge, letterClass, avatarHtml, pname, pl,
    lvNow, fmtLv, today, uid, CLUBS, LV_G, lvLetters, setLvLetters, rangeLabel, regsOf, ask, byId, gameId, newFtour, regErrMsg });

  function render() { _EC = null;
    const v = document.getElementById("view");
    const me = myPlayer(); LBL = {};
    if (me && state._onb && state._onb.retest && state._onb.step != null) v.innerHTML = viewQuiz(state._onb);
    else if (!me && state.tab !== "admin") v.innerHTML = viewOnboarding();
    else if (state.tab === "tournaments") v.innerHTML = viewTournaments();
    else if (state.tab === "games") { if (state.view.t && !byId(state.tournaments, state.view.t) && !(state._tf && state._tf.id === state.view.t)) state.view.t = null; // турнир удалили — назад к списку игр
      v.innerHTML = state.view.t ? viewTournamentDetail(state.view.t) : G.view() || (state.view.t ? viewTournamentDetail(state.view.t) : ""); }
    else if (state.tab === "rating") v.innerHTML = viewRating();
    else if (state.tab === "season") v.innerHTML = viewSeason();
    else if (state.tab === "admin") v.innerHTML = viewAdmin();
    else v.innerHTML = viewProfile();
    document.querySelectorAll("nav.tabs button").forEach(b => { b.classList.toggle("active", b.dataset.tab === state.tab); if (b.dataset.tab === "admin") b.hidden = !canEdit(); });
    const labels = { games: G.label(), tournaments: t("tournaments"), season: t("season"), rating: t("rating"), admin: t("admin"), profile: t("profile") };
    document.querySelectorAll("nav.tabs button .lbl").forEach(l => l.textContent = labels[l.parentElement.dataset.tab]);
    updateNavAvatar(); updateNavBadges(); bind(v);
  }
  function updateNavBadges() {
    const pb = document.querySelector('nav.tabs button[data-tab="profile"]'); if (pb) { let dot = pb.querySelector(".need-dot"); if (needBd()) { if (!dot) { dot = document.createElement("i"); dot.className = "need-dot nav"; pb.appendChild(dot); } } else if (dot) dot.remove(); }
    const lv = canEdit() ? state.players.filter(p => p.levelStatus === "pending").length : 0;
    const rg = isAdmin() ? state.registrations.filter(r => r.approval === "pending" && r.status !== "cancelled" && (tt => tt && isUpcoming(tt))(byId(state.tournaments, r.tournamentId))).length : 0;
    [["admin", lv], ["tournaments", rg], ["games", G.disputesN() + G.needScoreN()]].forEach(([tab, n]) => { const b = document.querySelector(`nav.tabs button[data-tab="${tab}"]`); if (!b) return;
      let el = b.querySelector(".nav-badge"); if (!n) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("span"); el.className = "nav-badge"; b.appendChild(el); } el.textContent = n > 99 ? "99+" : n; });
  }
  function updateNavAvatar() {
    const ic = document.querySelector('nav.tabs button[data-tab="profile"] .ic'); const p = myPlayer(); if (!ic) return;
    const key = p && p.avatar ? "img:" + p.avatar.length : "ph"; if (ic.dataset.key === key) return; ic.dataset.key = key;
    ic.innerHTML = p && p.avatar ? `<span class="nav-avatar"><img src="${esc(p.avatar)}" alt=""></span>` : `<span class="nav-avatar ph">${SIL}</span>`;
  }
  function openProfile(pid) { state.view.pBack = state.tab === "profile" ? state.view.pBack : state.tab; state.view.pid = pid; state.view.editP = null; state._pf = null; state.tab = "profile"; window.scrollTo(0, 0); render(); }
  function bind(v) {
    v.querySelectorAll("[data-act]").forEach(el => {
      const a = el.dataset.act, id = el.dataset.id;
      const on = fn => { el.onclick = ev => { ev.stopPropagation(); fn(ev); }; };
      if (G.act(a, el, id, on)) return;
      if (a === "ob-source") on(() => { keepOnb(); if (state._onb.source !== el.dataset.val) state._onb.level = ""; state._onb.source = el.dataset.val; render(); });
      else if (a === "ob-save" || a === "quiz-save") on(saveOnboarding);
      else if (a === "quiz-start") on(() => { keepOnb(); if (state._onb.name.trim().length < 2) { toast(t("need_name")); return; } state._onb.step = 0; state._onb.answers = []; window.scrollTo(0, 0); render(); });
      else if (a === "quiz-ans") on(() => { const d = state._onb; d.answers[d.step] = +el.dataset.val; d.step++; window.scrollTo(0, 0); render(); });
      else if (a === "quiz-back") on(() => { const d = state._onb; if (d.step > 0) d.step--; else if (d.retest) state._onb = null; else d.step = null; render(); });
      else if (a === "retest-start") on(() => { state._onb = { retest: true, source: "quiz", step: 0, answers: [], name: "", ig: "" }; window.scrollTo(0, 0); render(); });

      else if (a === "open-t") on(() => { state.view.t = id; state.view.liveRound = null; state.view.liveTab = "m"; window.scrollTo(0, 0); render(); });
      else if (a === "open-t-tab") on(() => { state.tab = "tournaments"; state.view.t = id; state.view.pid = null; window.scrollTo(0, 0); render(); });
      else if (a === "t-back") on(() => { state.view.t = null; state.view.fix = null; state.view.run = null; state.view.liveRound = null; render(); });
      else if (a === "new-t") on(() => { const nid = uid(); state._tf = { id: nid, isNew: true, name: "", date: today(), format: "americano", courts: 2, status: "scheduled", s: { reg_open: true, slots: 8, approval: true } }; state.view.t = nid; state.view.editT = nid; render(); });
      else if (a === "edit-t") on(() => { state._tf = null; state.view.editT = id; render(); });
      else if (a === "tf-format") on(() => { const f = readTf(), was = f.format; f.format = el.dataset.val; if (f.format === "team_americano") f.s.pairs = true; else if (was === "team_americano") f.s.pairs = false; render(); });
      else if (a === "tf-pairs") { el.onchange = () => { readTf(); render(); }; }
      else if (a === "tf-cancel") on(() => { const f = state._tf; state._tf = null; state.view.editT = null; if (f && f.isNew) state.view.t = null; render(); });
      else if (a === "tf-save") on(saveTf);
      else if (a === "tf-delete") on(async () => { const f = state._tf; if (!(await ask(t("delete_confirm", { name: f.name })))) return; try { await db.deleteTournament(f.id); state._tf = null; state.view.editT = null; state.view.t = null; await reload(); } catch (e) { err(e); } });
      else if (a === "reg") on(async () => { try { const r = await db.register(id); await reload(); toast(regToast(r)); } catch (e) { toast(regErrMsg(String(e.message || ""))); } });
      else if (a === "reg-team") on(async () => { try { const r = await db.register(id, +el.dataset.team); await reload(); toast(regToast(r)); } catch (e) { toast(regErrMsg(String(e.message || ""))); } });
      else if (a === "partner-open") on(() => { state.view.partnerFor = id; render(); });
      else if (a === "partner-cancel") on(() => { state.view.partnerFor = null; render(); });
      else if (a === "reg-pair") on(async () => { const sel = document.getElementById("partnerSel"); if (!sel || !sel.value) return; try { const r = await db.register(id, null, sel.value); state.view.partnerFor = null; await reload(); toast(regToast(r)); } catch (e) { toast(regErrMsg(String(e.message || ""))); } });
      else if (a === "reg-approve" || a === "reg-reject") on(async () => { try { await db.reviewRegistration(el.dataset.tid, el.dataset.pid, a === "reg-approve" ? "approve" : "reject"); await reload(); toast(a === "reg-approve" ? t("approved_toast") : t("rejected_toast")); } catch (e) { err(e); } });
      else if (a === "unreg") on(async () => { try { await db.unregister(id); await reload(); } catch (e) { err(e); } });
      else if (a === "reg-paid") on(async () => { const r = regsOf(el.dataset.tid).find(x => x.playerId === el.dataset.pid); try { await db.setRegistration(el.dataset.tid, el.dataset.pid, { paid: !r.paid }); await reload(); } catch (e) { err(e); } });
      else if (a === "reg-move") on(async () => { const tid = el.dataset.tid, tt = byId(state.tournaments, tid), to = el.dataset.to; let patch = { status: to };
        if (isPairs(tt)) { if (to === "main") { const n = firstFreeTeam(tid, 1); if (n == null) { toast(t("no_free_place")); return; } patch.team_no = n; } else patch.team_no = null; }
        try { await db.setRegistration(tid, el.dataset.pid, patch); await reload(); } catch (e) { err(e); } });
      else if (a === "reg-remove") on(async () => { try { await db.removeRegistration(el.dataset.tid, el.dataset.pid); await db.promoteReserve(el.dataset.tid).catch(() => {}); await reload(); } catch (e) { err(e); } });
      else if (a === "reg-add") on(async () => { const sel = document.getElementById("addRegSel"); if (!sel || !sel.value) return; const ts = document.getElementById("addRegTeam");
        const team = ts ? (ts.value ? +ts.value : null) : null; try { await db.addRegistration(id, sel.value, ts && !ts.value ? "reserve" : "main", team); await reload(); } catch (e) { err(e); } });
      else if (a === "p-edit-contacts") on(() => { state._pf = null; state.view.editP = id; render(); const f = document.getElementById("pfContacts"); if (f) f.scrollIntoView({ block: "start", behavior: "smooth" }); const i = document.getElementById("pfc_phone"); if (i) i.focus({ preventScroll: true }); });
      else if (a === "lv-step") on(() => { keepPf(); const pf = state._pf; pf.level = Math.round((pf.level + +el.dataset.val) * 10) / 10; render(); });
      else if (a === "run-open") on(() => { const tt = byId(state.tournaments, id); state._run = initRun(tt); state.view.run = id; window.scrollTo(0, 0); render(); });
      else if (a === "run-cancel") on(() => { state._run = null; state.view.run = null; render(); });
      else if (a === "run-format") on(() => { const r = readRun(), tt = byId(state.tournaments, r.tid); r.format = el.dataset.val; r.teams = buildTeams(tt, runPlayers(tt.id), false); r.touched = false; r.rounds = runDefaultRounds(r, runPlayers(tt.id).length); render(); });
      else if (a === "run-mode") on(() => { const r = readRun(); r.mode = el.dataset.val; if (r.mode === "race" && (r.target == null || r.target > 15)) r.target = 6; if (r.mode === "total" && (r.target == null || r.target < 10)) r.target = 21; render(); });
      else if (a === "run-shuffle") on(() => { const r = readRun(), tt = byId(state.tournaments, r.tid); r.teams = buildTeams(tt, runPlayers(tt.id), true); render(); });
      else if (a === "run-start") on(async () => { el.disabled = true; await startRun(); el.disabled = false; });
      else if (a === "live-tab") on(() => { state.view.liveTab = el.dataset.val; render(); });
      else if (a === "live-round") on(() => { state.view.liveRound = +el.dataset.val; render(); if (el.tagName === "BUTTON") { const c = document.querySelector(".rnd-chips"); if (c) c.scrollIntoView({ block: "start", behavior: "smooth" }); else window.scrollTo(0, 0); } });
      else if (a === "live-next") on(async () => { el.disabled = true; await nextRound(id); });
      else if (a === "live-remove") on(() => removeLastRound(id));
      else if (a === "live-finish") on(() => finishRun(id));
      else if (a === "live-cancel") on(() => cancelRun(id));
      else if (a === "fix-open") on(() => { state.view.fix = id; state.view.liveTab = "m"; state.view.liveRound = 1; window.scrollTo(0, 0); render(); });
      else if (a === "fix-done") on(() => { state.view.fix = null; state.view.liveRound = null; window.scrollTo(0, 0); render(); });
      else if (a === "s-league") on(() => { state.view.sLeague = el.dataset.val; state.view.sOpen = null; render(); });
      else if (a === "s-open") on(() => { state.view.sOpen = state.view.sOpen === id ? null : id; render(); });
      else if (a === "s-how") on(() => { state.view.sHow = !state.view.sHow; render(); });
      else if (a === "elo-how") on(() => { state.view.eloHow = !state.view.eloHow; render(); });
      else if (a === "lbl-toggle") on(() => { state.view.lblOpen = state.view.lblOpen === id ? null : id; render(); });
      else if (a === "lbl-ok") on(() => { const inp = el.parentElement.querySelector("input.lbl-in"); if (inp) inp.blur(); }); // сохранит onchange
      else if (a === "facts-toggle") on(() => { state.view.factsOpen = state.view.factsOpen === id ? null : id; render(); });
      else if (a === "facts-copy") on(async () => { const el2 = document.getElementById("factsText"); const txt = el2 ? el2.innerText : ""; try { await navigator.clipboard.writeText(txt); toast(t("copied")); } catch (e) { toast(t("copy_fail")); } });
      else if (a === "tf-lv") on(() => { const f = readTf(); setLvLetters(f.s, el.dataset.val); render(); });
      else if (a === "toggle-rounds") on(() => { state.view.roundsOpen = state.view.roundsOpen === id ? null : id; render(); });
      else if (a === "toggle-ach") on(() => { state.view.achOpen = state.view.achOpen === id ? null : id; render(); });
      else if (a === "mh-all") on(() => { state.view.mhAll = state.view.mhAll === id ? null : id; render(); });
      else if (a === "lv-group") on(() => { state.view.lvGroup = el.dataset.val; render(); });
      else if (a === "open-profile") on(() => openProfile(id));
      else if (a === "p-back") on(() => { const b = state.view.pBack || "rating"; state.view.pid = null; state.view.editP = null; state.tab = b === "profile" ? "rating" : b; render(); });
      else if (a === "p-edit-bd") on(() => { state._pf = null; state.view.editP = id; render(); const f = document.getElementById("pfBd"); if (f) f.scrollIntoView({ block: "center", behavior: "smooth" }); });
      else if (a === "p-edit") on(() => { state._pf = null; state.view.editP = id; render(); });
      else if (a === "pf-cancel") on(() => { state._pf = null; state.view.editP = null; render(); });
      else if (a === "pf-save") on(() => savePf(id));
      else if (a === "add-home") on(addToHome);
      else if (a === "vis-f") on(() => { state.view.visF = el.dataset.val; render(); });
      else if (a === "vis-refresh") on(() => { state._visits = null; render(); });
      else if (a === "open-tg") on(() => { const u = "https://t.me/" + el.dataset.u; try { if (tgApp && tgApp.openTelegramLink && tgApp.initData) { tgApp.openTelegramLink(u); return; } } catch (e) {} window.open(u, "_blank"); });
      else if (a === "field-ok") on(() => { const sc = el.dataset.scope || ""; const inp = el.parentElement && el.parentElement.querySelector("input,textarea"); if (inp) inp.blur();
        if (sc === "ob") { keepOnb(); el.classList.add("done"); setTimeout(() => el.classList.remove("done"), 900); }
        else if (sc.startsWith("pf:")) savePf(sc.slice(3), true); });
      else if (a === "adm-reset") on(async () => { const p = byId(state.players, id); if (!p) return; if (!(await ask(t("reset_confirm", { name: p.name })))) return;
        try { await db.resetPlayer(id); await reload(); toast(t("reset_done", { name: p.name })); } catch (e) { err(e); } });
      else if (a === "pf-photo") on(() => { const f = document.getElementById("pfPhoto"); if (f) f.click(); });
      else if (a === "pf-photo-clear") on(() => { keepPf(); state._pf.avatar = null; render(); });
      else if (a === "pt-save") on(async () => { const g = id => document.getElementById(id), shop = g("ptShop").value.trim(), consult = g("ptConsult").value.trim();
        if ((shop && !httpsOk(shop)) || (consult && !httpsOk(consult))) { toast(t("p_bad_link")); return; }
        try { const st = await db.saveLeagueSettings({ partner: { ...partner(), shop, consult, season: g("ptSeason").checked } }); state.league = st; await db.addLog("Партнёр: ссылки обновлены").catch(() => {}); toast(t("saved")); render(); } catch (e) { err(e); } });
      else if (a === "pt-refresh") on(() => { ptStats = null; render(); });
      else if (a === "rf-toggle") on(() => { state.view.rfOpen = state.view.rfOpen === id ? null : id; render(); });
      else if (a === "rf-run") on(() => runRaffle(id, el));
      else if (a === "rf-del") on(async () => { const tt = byId(state.tournaments, id); if (!tt || !confirm(t("rf_del_q"))) return; const raffles = (tt.s.raffles || []).filter((_, i) => i !== +el.dataset.val);
        try { await db.saveTournament(tRow(tt, { s: { ...tt.s, raffles } })); tt.s = { ...tt.s, raffles }; render(); } catch (e) { err(e); } });
      else if (a === "open-link") on(() => { const u = el.dataset.url; if (!/^https?:\/\//i.test(u || "")) return; // только обычные ссылки (не javascript: и т.п.) if (el.dataset.pt) db.trackClick(el.dataset.pt, el.dataset.ptw, el.dataset.ptt).catch(() => {}); const tg = window.Telegram && window.Telegram.WebApp;
        if (tg && tg.initData && /^https:\/\/t\.me\//.test(u) && tg.openTelegramLink) tg.openTelegramLink(u); else if (tg && tg.initData && tg.openLink) tg.openLink(u); else window.open(u, "_blank", "noopener"); });
      else if (a === "copy-nick") on(async () => { const v = el.dataset.val; try { await navigator.clipboard.writeText(v); toast(t("nick_copied", { app: t("src_" + el.dataset.app) })); } catch (e) { toast(v); } });
      else if (a === "logout") on(async () => { await db.signOut(); location.reload(); });
      else if (a === "rv-approve") on(async () => { const inp = document.getElementById("rv_" + id); const lv = inp && inp.value !== "" ? +inp.value : null; try { await db.reviewLevel(id, "approve", lv); await reload(); toast(t("saved")); } catch (e) { err(e); } });
      else if (a === "rv-quiz") on(async () => { try { await db.reviewLevel(id, "quiz"); await reload(); toast(t("saved")); } catch (e) { err(e); } });
      else if (a === "adm-tab") on(() => { state.view.adm = el.dataset.val; render(); });
      else if (a === "adm-confirm") on(async () => { const p = byId(state.players, id); try { await db.updatePlayer(id, { confirmed: !p.confirmed }); await db.addLog((p.confirmed ? "Снял подтверждение: " : "Подтвердил Эло: ") + p.name); await reload(); } catch (e) { err(e); } });
      else if (a === "adm-active") on(async () => { const p = byId(state.players, id); try { await db.updatePlayer(id, { active: !p.active }); await reload(); } catch (e) { err(e); } });
      else if (a === "adm-level") el.onchange = async () => { const p = byId(state.players, id); const lv = el.value === "" ? null : +el.value; try { await db.updatePlayer(id, { level: lv, eloStart: levelElo(lv), levelStatus: lv == null ? p.levelStatus : "ok" }); await db.addLog(`Уровень ${p.name}: ${p.level} → ${lv}`); await reload(); } catch (e) { err(e); } };
      else if (a === "adm-lbl" || a === "adm-elo-now") { el.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } };
        el.onchange = async () => { try { const ch = a === "adm-lbl" ? await setLabel(id, el.value) : await setEloNow(id, el.value); if (!ch) return; toast(t("saved")); liveReload(); } catch (e) { err(e); } }; }
      else if (a === "adm-elo") el.onchange = async () => { const p = byId(state.players, id); const v = +el.value; if (!v) return; try { await db.updatePlayer(id, { eloStart: v }); await db.addLog(`Стартовое Эло ${p.name}: ${p.eloStart} → ${v}`); await reload(); } catch (e) { err(e); } };
      else if (a === "set-role") el.onchange = async () => { try { await db.setMemberRole(id, el.value); const m = state._members.find(x => x.userId === id); if (m) m.role = el.value; toast(t("saved")); } catch (e) { err(e); } };
    });
    ["ob", "pf"].forEach(pr => ["D", "M", "Y"].forEach(k => { const el = document.getElementById(pr + "Bd" + k); if (!el) return;
      el.onchange = () => { const b = readBdSel(pr); if (pr === "ob" && state._onb) state._onb.bd = b; if (pr === "pf" && state._pf) state._pf.bd = b; const f = document.getElementById(pr + "Bd"); if (f && pr === "pf") f.classList.toggle("need", !bdValue(b)); }; }));
    const keepOnb = () => { const n = document.getElementById("obName"), l = document.getElementById("obLevel"), i = document.getElementById("obIg"), k = document.getElementById("obNick"); if (n) state._onb.name = n.value; if (l) state._onb.level = l.value; if (i) state._onb.ig = i.value; if (k) state._onb.nick = k.value; };
    // ввод в анкете: страницу не перерисовываем (иначе курсор прыгает в начало) — обновляем только превью и кнопку
    ["obName", "obLevel", "obIg", "obNick"].forEach(id => { const el = document.getElementById(id); if (el) el.oninput = () => {
      if (el.classList.contains("dec-in")) decFix(el);
      keepOnb(); const d = state._onb, lv = toRaketo(d.source, d.level), ok = lv != null && lv >= 0 && lv <= 7;
      const pv = v.querySelector(".ob-preview");
      if (pv && id === "obLevel") { pv.classList.toggle("dim", !ok); pv.innerHTML = `${levelBadge(ok ? lv : null, "big")}<div><div class="tiny">${d.source === "raketo" ? "" : t("as_raketo") + " · "}${t("letter")} · ${t("start_elo")}</div><div class="ob-elo">${ok ? (d.source === "raketo" ? "" : fmtLv(lv) + " · ") + letter(lv) + " · " + levelElo(lv) : "—"}</div></div>`; }
      const b = v.querySelector('[data-act="ob-save"]'); if (b) b.disabled = d.name.trim().length < 2 || !ok || (d.source !== "quiz" && !(d.nick || "").trim());
    }; });
    const keepPf = () => { const n = document.getElementById("pfName"), b = document.getElementById("pfBio"), ee = document.getElementById("pfElo"), ll = document.getElementById("pfLbl"); if (state._pf && n) { state._pf.name = n.value; state._pf.bio = b.value; if (ee) { state._pf.elo = ee.value; state._pf.lbl = ll.value; } CONTACTS.forEach(([k]) => { const el = document.getElementById("pfc_" + k); if (el) state._pf.c[k] = el.value; }); } };
    // дробные поля — обычный текст с цифровой клавиатурой: в Telegram на Android/iPhone поле type=number не принимает точку
    // (или запятую), если в системе другой десятичный разделитель. Запятую превращаем в точку, лишнее убираем.
    G.bindInputs(v);
    v.querySelectorAll("input.dec-in").forEach(inp => inp.addEventListener("input", () => decFix(inp), true));
    v.querySelectorAll("input.lbl-in").forEach(inp => { inp.onchange = () => saveLabel(inp); inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } }; });
    v.querySelectorAll(".ok-wrap input").forEach(inp => { inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const b = inp.parentElement.querySelector(".ok-btn"); if (b) b.click(); } }; });
    const pfPhoto = document.getElementById("pfPhoto"); if (pfPhoto) pfPhoto.onchange = async () => { const f = pfPhoto.files && pfPhoto.files[0]; if (!f) return; try { keepPf(); state._pf.avatar = await readAvatarFile(f); render(); } catch (e) { err(e); } };
    const q = document.getElementById("admQ"); if (q) q.oninput = () => { state.view.q = q.value; render(); const e2 = document.getElementById("admQ"); e2.focus(); e2.setSelectionRange(e2.value.length, e2.value.length); };
    const ls = document.getElementById("langSel"); if (ls) ls.onchange = () => { setLang(ls.value); document.documentElement.lang = ls.value; render(); };
    // счёт: при «сумме очков» второе число подставляется само; сохраняем, когда поле теряет фокус или Enter
    v.querySelectorAll("input.sc-in").forEach(inp => {
      const box = inp.closest(".match"), other = () => box.querySelector(`input.sc-in[data-side="${inp.dataset.side === "A" ? "B" : "A"}"]`);
      inp.oninput = () => { const g = byId(state.games, inp.dataset.gid), tt = g && byId(state.tournaments, g.tournamentId), sc = (tt && tt.scoring) || {};
        delete inp.dataset.auto; markOk(box, false, true); if (sc.mode !== "total" || !sc.target || inp.value === "") return; const o = other();
        if (o.value === "" || o.dataset.auto) { const val = sc.target - Math.round(+inp.value); if (val >= 0) { o.value = val; o.dataset.auto = "1"; } } };
      inp.onchange = () => saveScoreFrom(box);
      const ok = box.querySelector(".sc-ok");
      if (ok && !ok.dataset.bound) { ok.dataset.bound = "1"; ok.onpointerdown = e => e.preventDefault(); // фокус не уходит, пока не прочитали обе цифры
        ok.onclick = async () => { if (!(await saveScoreFrom(box, true))) return; const ae = document.activeElement; if (ae && box.contains(ae) && ae.blur) ae.blur(); }; }
      inp.onkeydown = e => { if (e.key !== "Enter") return; e.preventDefault(); const all = [...v.querySelectorAll("input.sc-in")], i = all.indexOf(inp);
        const nx = all.slice(i + 1).find(x => x.value === "" && x.dataset.side === "A") || all.slice(i + 1).find(x => x.value === ""); if (nx) nx.focus(); else inp.blur(); };
    });
    ["runCourtNums", "runCourts", "runRounds", "runTarget"].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = () => { const r = readRun(); if ((id === "runCourts" || id === "runCourtNums") && !r.touched) { const tt = byId(state.tournaments, r.tid); r.rounds = runDefaultRounds(r, runPlayers(tt.id).length); } render(); }; });
    ["tfName","tfDate","tfTime","tfTimeEnd","tfPlace","tfPlaceSel","tfCourtNums","tfCourts","tfSlots","tfPrice","tfMin","tfMax","tfContact","tfNote"].forEach(id => { const el = document.getElementById(id); if (el) el.onchange = () => { readTf(); if (id === "tfMin" || id === "tfMax" || id === "tfCourtNums" || id === "tfPlaceSel" || id === "tfTime") render(); }; });
  }
  document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; state.view.t = null; state.view.editT = null; state.view.run = null; state.view.fix = null; state.view.pid = null; state.view.editP = null; state.view.g = null; state.view.gNew = null; state.view.gs = null; window.scrollTo(0, 0); render(); });
  const hb = homeBtnEl(); if (hb) { hb.onclick = addToHome; hb.title = t("home_add_long"); const hl = hb.querySelector(".home-lbl"); if (hl) hl.textContent = t("home_btn"); }
  const lo = document.getElementById("logoutBtn"); if (lo) lo.onclick = async () => { await db.signOut(); location.reload(); };
  const who = document.getElementById("whoami"); if (who) who.textContent = (myPlayer() && myPlayer().name) || U.name || "";
  document.documentElement.lang = getLang();
  const scrollField = el => { if (!isField(el)) return; const vv = window.visualViewport, h = vv ? vv.height : window.innerHeight, r = el.getBoundingClientRect();
    if (r.bottom > h - 24 || r.top < 70) window.scrollBy({ top: r.top - h * 0.3, behavior: "smooth" }); };
  let kbTimer;
  document.addEventListener("focusin", e => { if (!isField(e.target)) return; document.body.classList.add("kb"); clearTimeout(kbTimer); kbTimer = setTimeout(() => scrollField(e.target), 320); });
  document.addEventListener("focusout", () => setTimeout(() => { if (isField(document.activeElement)) return; document.body.classList.remove("kb"); if (pendingLive) liveReload(); }, 150));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", () => { clearTimeout(kbTimer); kbTimer = setTimeout(() => scrollField(document.activeElement), 120); });
  // ссылка из бота: ?g=<id> — сразу открыть игру
  try { const gq = new URLSearchParams(location.search).get("g"); const gt = gq && byId(state.tournaments, gq);
    if (gt && isGameT(gt)) { state.tab = "games"; if (gt.s.kind === "ftour") state.view.t = gt.id; else state.view.g = gt.id; } } catch (e) {}
  render();
})();
