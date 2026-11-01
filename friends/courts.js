// «Свободные корты» Одессы + уведомления (Telegram).
// Данные собирает серверная функция court-slots (каждые 5 минут) в таблицу court_slots; здесь только показываем и управляем уведомлениями.
// Два экрана: viewFree() — дата + фильтры (сколько кортов, сколько часов подряд, уличные) → варианты по клубам;
//             viewWatch() — новое уведомление + мои уведомления.
export const COURT_CLUBS = [
  ["padelpoint", "Padel Point"], ["dynamica", "Динамика"], ["yellow", "Yellow Padel"], ["beat_fontan", "Beat Фонтан"],
  ["beat_shev", "Beat Шевченко"], ["underair", "UnderAir"], ["justpadel", "JustPadel"],
];
const CN = Object.fromEntries(COURT_CLUBS);
const CLUB_HUE = { padelpoint: 145, dynamica: 265, yellow: 48, beat_fontan: 200, beat_shev: 220, underair: 185, justpadel: 330 };
// уличные корты: JustPadel целиком; Beat Шевченко 3–4; Padel Point «открытый №1»; Yellow 4–6 (улица); UnderAir 2–4 (открытые)
export function isOutdoor(club, name) { return club === "justpadel" || /\(улица\)|открыт/i.test(name || ""); }
// Padel Point продаёт залы одним слотом: «Зал, корты 5–8» = 4 корта, «Зал, корты 3–4» = 2 корта
export function courtCap(name) { const m = /корты\s*(\d+)\s*[–-]\s*(\d+)/i.exec(name || ""); return m ? Math.max(1, +m[2] - +m[1] + 1) : 1; }
function shortName(n) {
  return String(n || "").replace(/^Зал,\s*корты\s*/i, "Зал ").replace(/^Улица,\s*открытый\s*/i, "Улица ").replace(/^Улица,\s*крытый\s*/i, "Крытый ")
    .replace(/\s*\((зал|внутри|крытый)\)/i, "").replace(/\s*\((улица|открытый)\)/i, " · ул.").replace(/\s*корт$/i, "").replace(/^Центральный$/i, "Центральный");
}
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const PARTS = [["all", "Любое", 0, 1440], ["morning", "Утро", 0, 720], ["day", "День", 720, 1020], ["evening", "Вечер", 1020, 1440]];
const HOURS = [1, 2, 3];

export function createCourts({ db, esc, toast, rerender, go = () => {}, groupChat = false }) {
  const sb = db.sb;
  const pref = (() => { try { return JSON.parse(localStorage.getItem("padel.courts") || "{}"); } catch (e) { return {}; } })();
  const S = { date: null, need: pref.need || 2, hours: pref.hours || 2, outdoor: pref.outdoor != null ? pref.outdoor : false, part: pref.part || "all",
    slots: {}, loading: false, status: [], watches: [], tg: undefined, uid: null, sheet: null, err: null, opened: false,
    w: null, busy: false, group: null };
  const savePref = () => { try { localStorage.setItem("padel.courts", JSON.stringify({ need: S.need, hours: S.hours, outdoor: S.outdoor, part: S.part })); } catch (e) {} };

  const kyiv = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(x => [x.type, x.value])); return { today: `${p.year}-${p.month}-${p.day}`, now: +p.hour * 60 + +p.minute }; };
  const addDays = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const T = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const TE = m => m >= 1440 ? "24:00" : T(m);
  const M = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
  const dt = d => new Date(d + "T12:00:00Z");
  const dLong = d => { const t = dt(d); return `${WD[t.getUTCDay()]}, ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
  const ago = iso => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 90 ? "только что" : s < 3600 ? `${Math.round(s / 60)} мин назад` : `${Math.round(s / 3600)} ч назад`; };
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
  const courtsW = n => `${n} ${plural(n, "корт", "корта", "кортов")}`;
  const hoursW = n => `${n} ${plural(n, "час", "часа", "часов")}`;

  async function loadDate(d, force) {
    if (!force && S.slots[d] && Date.now() - S.slots[d].at < 60000) return;
    S.loading = true; S.err = null;
    try {
      let rows = [], from = 0;
      for (;;) {
        const { data, error } = await sb.from("court_slots").select("club,court,court_name,start_min,end_min,book_url").eq("date", d).order("start_min").range(from, from + 999);
        if (error) throw error; rows = rows.concat(data || []); if (!data || data.length < 1000) break; from += 1000;
      }
      S.slots[d] = { at: Date.now(), rows };
    } catch (e) { S.err = String(e.message || e); }
    S.loading = false;
  }
  async function loadMeta() {
    const [st, w] = await Promise.all([sb.from("court_status").select("*"), sb.from("court_watches").select("*").order("date").order("from_min")]);
    S.status = st.data || []; S.watches = w.data || [];
    if (groupChat) { try { const { data: g } = await sb.rpc("court_group_ready"); S.group = g || null; } catch (e) { S.group = null; } }
    if (S.tg === undefined) {
      const { data: s } = await sb.auth.getSession(); S.uid = s && s.session ? s.session.user.id : null;
      if (S.uid) { const { data: p } = await sb.from("profiles").select("telegram_id").eq("user_id", S.uid).maybeSingle(); S.tg = !!(p && p.telegram_id); } else S.tg = false;
    }
  }
  async function open() {
    S.opened = true; const { today } = kyiv();
    if (!S.date || S.date < today) S.date = today;
    rerender();
    await Promise.all([loadDate(S.date), loadMeta().catch(() => {})]); rerender();
  }

  // ---------- подбор вариантов: N кортов подряд на H часов ----------
  const horizonOf = k => { const s = S.status.find(x => x.club === k); return s && s.horizon; };
  function options(rows, d) {
    const { today, now } = kyiv(); const part = PARTS.find(p => p[0] === S.part) || PARTS[0];
    const byClub = {};
    rows.forEach(r => {
      if (!S.outdoor && isOutdoor(r.club, r.court_name)) return;
      const c = byClub[r.club] || (byClub[r.club] = { courts: {}, url: r.book_url });
      const k = c.courts[r.court] || (c.courts[r.court] = { name: r.court_name, cap: courtCap(r.court_name), out: isOutdoor(r.club, r.court_name), set: new Set(), url: r.book_url });
      k.set.add(r.start_min);
    });
    const res = {};
    for (const [club, c] of Object.entries(byClub)) {
      const list = Object.values(c.courts).sort((a, b) => a.out - b.out || a.name.localeCompare(b.name, "ru", { numeric: true }));
      const starts = new Set(); list.forEach(k => k.set.forEach(t => starts.add(t)));
      const opts = [];
      [...starts].sort((a, b) => a - b).forEach(t => {
        if (t < part[2] || t >= part[3] || (d === today && t <= now)) return;
        const free = list.filter(k => { for (let i = 0; i < S.hours; i++) if (!k.set.has(t + 60 * i)) return false; return true; });
        const cap = free.reduce((a, k) => a + k.cap, 0);
        if (cap >= S.need) opts.push({ t, end: t + 60 * S.hours, courts: free, cap });
      });
      res[club] = { opts, url: c.url };
    }
    return res;
  }

  // ---------- экран «Свободные корты» ----------
  function dateStrip() {
    const { today } = kyiv();
    return `<div class="ct-datebar"><button class="ct-arrow" data-act="ct-scroll" data-val="-1" aria-label="раньше">‹</button><div class="ct-dates" id="ctDates">${Array.from({ length: 21 }, (_, i) => addDays(today, i)).map((d, i) => {
      const t = dt(d), we = t.getUTCDay() === 0 || t.getUTCDay() === 6;
      return `<button class="ct-date ${S.date === d ? "active" : ""} ${we ? "we" : ""} ${i === 0 ? "today" : ""}" data-act="ct-date" data-val="${d}"><small>${i === 0 ? "сегодня" : i === 1 ? "завтра" : WD[t.getUTCDay()]}</small><b>${t.getUTCDate()}</b><small>${MON[t.getUTCMonth()].slice(0, 3)}</small></button>`;
    }).join("")}</div><button class="ct-arrow" data-act="ct-scroll" data-val="1" aria-label="позже">›</button></div>`;
  }
  function filters() {
    return `<div class="card ct-filters">
      <div class="ct-frow"><span class="ct-flbl">Кортов</span>
        <div class="ct-stepper"><button data-act="ct-need" data-val="-1" ${S.need <= 1 ? "disabled" : ""}>−</button><b>${S.need}</b><button data-act="ct-need" data-val="1" ${S.need >= 6 ? "disabled" : ""}>+</button></div></div>
      <div class="ct-frow"><span class="ct-flbl">Часов подряд</span>
        <div class="ct-pills">${HOURS.map(h => `<button class="${S.hours === h ? "active" : ""}" data-act="ct-hours" data-val="${h}">${h} ч</button>`).join("")}</div></div>
      <div class="ct-frow"><span class="ct-flbl">Время</span>
        <div class="ct-pills">${PARTS.map(p => `<button class="${S.part === p[0] ? "active" : ""}" data-act="ct-part" data-val="${p[0]}">${p[1]}</button>`).join("")}</div></div>
      <div class="ct-frow"><span class="ct-flbl">Уличные корты<small>${S.outdoor ? "показываем и уличные" : "только крытые и в зале"}</small></span>
        <button class="ct-switch ${S.outdoor ? "on" : ""}" data-act="ct-outdoor" role="switch" aria-checked="${S.outdoor}"><i></i></button></div>
    </div>`;
  }
  function results() {
    const data = S.slots[S.date];
    if (S.err) return `<div class="card"><p class="tiny">Не удалось загрузить: ${esc(S.err)}</p></div>`;
    if (!data) return `<div class="card"><div class="empty">Загружаю…</div></div>`;
    const res = options(data.rows, S.date);
    const ok = COURT_CLUBS.filter(([k]) => res[k] && res[k].opts.length).sort((a, b) => res[b[0]].opts.length - res[a[0]].opts.length);
    const none = COURT_CLUBS.filter(([k]) => !(res[k] && res[k].opts.length));
    const why = k => { const hz = horizonOf(k); return hz && hz < S.date ? "запись ещё не открыта" : "нет вариантов"; };
    const card = ([k, n]) => {
      const r = res[k], anyOut = r.opts.some(o => o.courts.some(c => c.out));
      return `<div class="card ct-clubcard">
        <div class="ct-clubhead"><span class="ct-logo" style="--h:${CLUB_HUE[k] || 25}">${esc((n.match(/[A-ZА-ЯЁ]/g) || [n[0]]).slice(0, 2).join(""))}</span><div style="flex:1;min-width:0;"><h3>${esc(n)}</h3><span class="tiny">${r.opts.length} ${plural(r.opts.length, "вариант", "варианта", "вариантов")}${anyOut ? " · есть уличные" : ""}</span></div></div>
        <div class="ct-times">${r.opts.map((o, i) => `<button class="ct-tbtn" data-act="ct-open" data-club="${k}" data-i="${i}" style="--i:${Math.min(i, 12)}"><b>${T(o.t)}</b><small>до ${TE(o.end)}</small></button>`).join("")}</div>
      </div>`;
    };
    const summary = `${courtsW(S.need)} · ${hoursW(S.hours)}${S.outdoor ? "" : " · без уличных"}`;
    const sig = [S.date, S.need, S.hours, S.part, S.outdoor].join("|"), anim = sig !== S.lastSig; S.lastSig = sig;
    return `<div class="ct-reshead"><h3>${dLong(S.date)}</h3><span class="tiny">${summary}</span></div>
      <div class="ct-results ${anim ? "ct-anim" : ""}">${ok.length ? ok.map(card).join("") : `<div class="card"><div class="empty"><div class="ic">&#127934;</div>На этот день нет ${courtsW(S.need)} на ${hoursW(S.hours)} подряд.<br><span class="tiny">Попробуй меньше часов или кортов — или включи уведомление.</span></div></div>`}
      </div>${none.length ? `<div class="ct-none">${none.map(([k, n]) => `<span><b>${esc(n)}</b> — ${why(k)}</span>`).join("")}</div>` : ""}
      <button class="card ct-cta" data-act="ct-watch-new"><span class="ct-cta-ic">🔔</span><span><b>Сообщить, когда освободится</b><small>${summary}, ${dLong(S.date)}</small></span><span class="ct-cta-arr">›</span></button>`;
  }
  function sheet() {
    if (!S.sheet) return "";
    const data = S.slots[S.date]; if (!data) return "";
    const r = options(data.rows, S.date)[S.sheet.club]; const o = r && r.opts[S.sheet.i]; if (!o) return "";
    const hall = o.courts.some(c => c.cap > 1);
    return `<div class="ct-sheet-bg" data-act="ct-close"></div>
      <div class="ct-sheet" role="dialog">
        <div class="ct-grab"></div>
        <div class="ct-sheet-top"><div><span class="tiny">${dLong(S.date)}</span><h2>${esc(CN[S.sheet.club])}</h2></div><button class="icon-btn" data-act="ct-close" aria-label="закрыть">✕</button></div>
        <div class="ct-big">${T(o.t)} – ${TE(o.end)}<small>${hoursW(S.hours)}</small></div>
        <div class="ct-lbl">Свободно всё это время · нужно ${courtsW(S.need)}, есть ${o.cap}</div>
        <div class="ct-courtlist">${o.courts.map(c => `<div class="ct-court"><span class="ct-dot ${c.out ? "out" : ""}"></span><b>${esc(c.name)}</b><span class="tiny">${c.cap > 1 ? courtsW(c.cap) + " · " : ""}${c.out ? "улица" : "крытый"}</span></div>`).join("")}</div>
        ${hall ? `<p class="tiny" style="margin:8px 0 0;">Padel Point бронирует залы целиком: «корты 3–4» — это 2 корта, «корты 5–8» — 4 корта.</p>` : ""}
        <button class="btn primary block" style="margin-top:16px;" data-act="ct-book" data-url="${esc(o.courts[0].url || r.url || "")}">Забронировать на сайте клуба ↗</button>
      </div>`;
  }
  function viewFree() {
    const upd = S.status.length ? S.status.map(s => s.updated_at).sort().slice(-1)[0] : null;
    const bad = S.status.filter(s => !s.ok);
    return `${dateStrip()}${filters()}${results()}
      <p class="tiny ct-foot">${upd ? `Обновлено ${ago(upd)} · ` : ""}данные из систем бронирования клубов${bad.length ? ` · <span style="color:var(--danger)">не обновляется: ${bad.map(s => esc(s.club_name)).join(", ")}</span>` : ""}</p>
      ${sheet()}`;
  }

  // ---------- экран «Уведомления» ----------
  function wDefaults() { const { today } = kyiv(); return { date: S.date && S.date >= today ? S.date : today, from: "18:00", to: "22:00", need: S.need, hours: S.hours, outdoor: S.outdoor, clubs: [], target: S.group ? "group" : "me" }; }
  function viewWatch() {
    const { today } = kyiv();
    if (!S.w) S.w = wDefaults(); const W = S.w;
    if (W.date < today) W.date = today;
    const days = Array.from({ length: 21 }, (_, i) => addDays(today, i));
    const hrs = Array.from({ length: 19 }, (_, i) => T((i + 6) * 60)).concat(["24:00"]);
    const opt = (v, cur) => `<option value="${v}" ${v === cur ? "selected" : ""}>${v}</option>`;
    const myW = S.watches.filter(w => w.date >= today);
    const wline = w => `${courtsW(w.courts || 1)} × ${hoursW(w.hours || 1)}${w.outdoor === false ? " · без уличных" : ""} · ${w.clubs && w.clubs.length ? w.clubs.map(k => esc(CN[k] || k)).join(", ") : "все клубы"}${w.to_group ? " · 💬 в беседу" : w.chat_id ? "" : " · нет Telegram — не придут"}`;
    return `
      <div class="card ct-watch">
        <h3>Новое уведомление</h3>
        <p class="tiny" style="margin:4px 0 12px;">Бот напишет в Telegram, как только в этом окне появится подходящий вариант.${S.tg === false ? " <b>В личку пишем только тем, кто вошёл через бота в Telegram.</b>" : ""}</p>
        <label class="field" style="margin-bottom:10px;"><span class="lbl">Дата</span><select id="ctWDate">${days.map((d, i) => `<option value="${d}" ${d === W.date ? "selected" : ""}>${i === 0 ? "Сегодня, " : i === 1 ? "Завтра, " : ""}${dLong(d)}</option>`).join("")}</select></label>
        <div class="row" style="gap:10px;">
          <label class="field" style="flex:1;margin-bottom:10px;"><span class="lbl">Начать не раньше</span><select id="ctWFrom">${hrs.slice(0, -1).map(h => opt(h, W.from)).join("")}</select></label>
          <label class="field" style="flex:1;margin-bottom:10px;"><span class="lbl">Закончить до</span><select id="ctWTo">${hrs.slice(1).map(h => opt(h, W.to)).join("")}</select></label>
        </div>
        <div class="ct-frow"><span class="ct-flbl">Кортов</span>
          <div class="ct-stepper"><button data-act="ct-wneed" data-val="-1" ${W.need <= 1 ? "disabled" : ""}>−</button><b>${W.need}</b><button data-act="ct-wneed" data-val="1" ${W.need >= 6 ? "disabled" : ""}>+</button></div></div>
        <div class="ct-frow"><span class="ct-flbl">Часов подряд</span>
          <div class="ct-pills">${HOURS.map(h => `<button class="${W.hours === h ? "active" : ""}" data-act="ct-whours" data-val="${h}">${h} ч</button>`).join("")}</div></div>
        <div class="ct-frow"><span class="ct-flbl">Уличные корты</span><button class="ct-switch ${W.outdoor ? "on" : ""}" data-act="ct-woutdoor" role="switch" aria-checked="${W.outdoor}"><i></i></button></div>
        <span class="ct-lbl" style="margin-top:8px;">Клубы</span>
        <div class="wrap-tags"><button class="chip ${!W.clubs.length ? "active" : ""}" data-act="ct-wclub" data-val="">Все</button>${COURT_CLUBS.map(([k, n]) => `<button class="chip ${W.clubs.includes(k) ? "active" : ""}" data-act="ct-wclub" data-val="${k}">${esc(n)}</button>`).join("")}</div>
        ${groupChat ? `<span class="ct-lbl" style="margin-top:14px;">Куда писать</span>
        <div class="ct-pills ct-pills-wide"><button class="${W.target === "group" ? "active" : ""}" data-act="ct-wtarget" data-val="group" ${S.group ? "" : "disabled"}>💬 В беседу</button><button class="${W.target === "me" ? "active" : ""}" data-act="ct-wtarget" data-val="me">Мне в личку</button></div>
        <p class="tiny" style="margin:6px 2px 0;">${S.group ? `Беседа: <b>${esc(S.group.title || "подключена")}</b>` : "Беседа ещё не подключена — организатор пишет в ней /start@padelinfoodessa_bot"}</p>` : ""}
        <button class="btn primary block" style="margin-top:16px;" data-act="ct-watch-add" ${S.busy ? "disabled" : ""}>Следить</button>
      </div>
      <div class="ct-reshead"><h3>Мои уведомления</h3><span class="tiny">${myW.length || ""}</span></div>
      ${myW.length ? myW.map(w => `<div class="card ct-wcard"><div class="ct-wdate"><b>${dt(w.date).getUTCDate()}</b><small>${MON[dt(w.date).getUTCMonth()].slice(0, 3)}</small></div>
          <div class="ct-wmain"><b>${WD[dt(w.date).getUTCDay()]} · ${T(w.from_min)}–${TE(w.to_min)}</b><span class="tiny">${wline(w)}</span></div>
          <button class="icon-btn" data-act="ct-watch-del" data-id="${w.id}" aria-label="удалить">✕</button></div>`).join("")
        : `<div class="card"><p class="tiny" style="margin:0;">Пока нет. Создай выше — бот напишет, когда освободится подходящий вариант.</p></div>`}`;
  }

  function openLink(u) {
    if (!/^https:\/\//.test(u || "")) return;
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData && tg.openLink) tg.openLink(u); else window.open(u, "_blank", "noopener");
  }
  function readForm() {
    const g = id => document.getElementById(id);
    if (S.w && g("ctWDate")) { S.w.date = g("ctWDate").value; S.w.from = g("ctWFrom").value; S.w.to = g("ctWTo").value; }
  }
  function bind(root) {
    root.querySelectorAll("[data-act^='ct-']").forEach(el => {
      const a = el.dataset.act, v = el.dataset.val;
      const on = fn => { el.onclick = ev => { ev.stopPropagation(); fn(); }; };
      if (a === "ct-date") on(async () => { S.date = v; S.sheet = null; S.dateScroll = null; rerender(); await loadDate(v); rerender(); });
      else if (a === "ct-scroll") on(() => { const st = root.querySelector("#ctDates"); if (st) st.scrollBy({ left: +v * Math.max(200, st.clientWidth * 0.8), behavior: "smooth" }); });
      else if (a === "ct-need") on(() => { S.need = Math.max(1, Math.min(6, S.need + +v)); savePref(); rerender(); });
      else if (a === "ct-hours") on(() => { S.hours = +v; savePref(); rerender(); });
      else if (a === "ct-part") on(() => { S.part = v; savePref(); rerender(); });
      else if (a === "ct-outdoor") on(() => { S.outdoor = !S.outdoor; savePref(); rerender(); });
      else if (a === "ct-open") on(() => { S.sheet = { club: el.dataset.club, i: +el.dataset.i }; rerender(); });
      else if (a === "ct-close") on(() => { S.sheet = null; rerender(); });
      else if (a === "ct-book") on(() => openLink(el.dataset.url));
      else if (a === "ct-watch-new") on(() => { S.w = wDefaults(); go("watch"); });
      else if (a === "ct-wneed") on(() => { readForm(); S.w.need = Math.max(1, Math.min(6, S.w.need + +v)); rerender(); });
      else if (a === "ct-whours") on(() => { readForm(); S.w.hours = +v; rerender(); });
      else if (a === "ct-woutdoor") on(() => { readForm(); S.w.outdoor = !S.w.outdoor; rerender(); });
      else if (a === "ct-wtarget") on(() => { readForm(); S.w.target = v; rerender(); });
      else if (a === "ct-wclub") on(() => { readForm(); const c = S.w.clubs; S.w.clubs = !v ? [] : c.includes(v) ? c.filter(x => x !== v) : c.concat(v); rerender(); });
      else if (a === "ct-watch-add") on(async () => {
        readForm(); const W = S.w, f = M(W.from), t = M(W.to);
        if (t <= f) { toast("«Закончить до» должно быть позже начала"); return; }
        if (t - f < 60 * W.hours) { toast(`Окно меньше, чем ${hoursW(W.hours)}`); return; }
        S.busy = true; rerender();
        try {
          const row = { date: W.date, from_min: f, to_min: t, clubs: W.clubs.length ? W.clubs : null, courts: W.need, hours: W.hours, outdoor: W.outdoor };
          if (groupChat && W.target === "group" && S.group) row.to_group = true;
          const { error } = await sb.from("court_watches").insert(row);
          if (error) throw error;
          await loadMeta(); toast(row.to_group ? "Готово — напишем в беседу" : S.tg ? "Готово — напишем в Telegram" : "Сохранено, но без Telegram уведомления не придут");
        } catch (e) { const m = String(e.message || e); toast(/too many/.test(m) ? "Слишком много уведомлений (макс. 30)" : /group chat/.test(m) ? "Беседа не подключена" : "Не удалось: " + m); }
        S.busy = false; rerender();
      });
      else if (a === "ct-watch-del") on(async () => { try { const { error } = await sb.from("court_watches").delete().eq("id", el.dataset.id); if (error) throw error; await loadMeta(); rerender(); } catch (e) { toast("Не удалось удалить"); } });
    });
    ["ctWDate", "ctWFrom", "ctWTo"].forEach(id => { const el = root.querySelector("#" + id); if (el) el.onchange = readForm; });
    const strip = root.querySelector("#ctDates"), act = strip && strip.querySelector(".active");
    if (strip) {
      if (S.dateScroll != null) strip.scrollLeft = S.dateScroll; else if (act) strip.scrollLeft = act.offsetLeft - strip.clientWidth / 2 + act.offsetWidth / 2;
      const arrows = () => { const l = root.querySelector('[data-act="ct-scroll"][data-val="-1"]'), r = root.querySelector('[data-act="ct-scroll"][data-val="1"]');
        if (l) l.disabled = strip.scrollLeft < 4; if (r) r.disabled = strip.scrollLeft > strip.scrollWidth - strip.clientWidth - 4; };
      strip.onscroll = () => { S.dateScroll = strip.scrollLeft; arrows(); }; arrows();
    }
    document.body.classList.toggle("ct-noscroll", !!S.sheet);
  }
  return { viewFree, viewWatch, bind, open, state: S };
}
