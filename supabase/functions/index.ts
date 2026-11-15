// Напоминания о днях рождения участников сообщества — в личку админам через бота лиги.
// Запускается pg_cron раз в день утром (см. миграцию 0018). Кому слать: все админы и владельцы лиги (league_members role admin/owner)
// + дополнительно court_kv 'bd_notify': { "<лига>": ["<user_id>", ...] }.
// ДР хранится в players.contacts.birthday: "ГГГГ-ММ-ДД" или "--ММ-ДД" (год не указан).
// Раз в неделю, по понедельникам в 9:00 — сводка ДР на 10 дней вперёд: с этого понедельника по среду следующей недели
// (ранние дни следующей недели приходят заранее). Нет ни одного ДР — не пишем. Отметка 'bd_week:<лига>' = дата понедельника.
// Каждый день в 9:00 — «сегодня день рождения у …», чтобы админы сразу поздравили (только если есть именинники).
// ?dry=1 — ничего не отправляет, только счётчики: недельная сводка, сколько именинников сегодня, сколько получателей (&date=ГГГГ-ММ-ДД — другой день).
import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "Europe/Kyiv";
const SEND_FROM_HOUR = 9; // раньше 9:00 по Киеву не пишем, даже если функцию кто-то дёрнул
const DAILY = true; // ежедневное «сегодня день рождения у …»

function kyivNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, hour: +p.hour };
}
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// какие «ММ-ДД» празднуются в этот день: 29 февраля в невисокосный год — 28-го
const mdsFor = (d: string) => { const md = d.slice(5), y = +d.slice(0, 4); return md === "02-28" && !isLeap(y) ? ["02-28", "02-29"] : [md]; };
const esc = (s: string) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const years = (n: number) => { const a = n % 10, b = n % 100; return n + " " + (a === 1 && b !== 11 ? "год" : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? "года" : "лет"); };
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const weekday = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

type P = { id: string; name: string; contacts: Record<string, string> | null };
function line(p: P, onDate: string) {
  const c = p.contacts || {}, m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(c.birthday || "");
  const age = m && m[1] !== "-" ? +onDate.slice(0, 4) - +m[1] : null;
  const tg = c.telegram ? String(c.telegram).replace(/^@/, "").replace(/^https:\/\/t\.me\//, "") : "";
  const tgOk = /^[A-Za-z0-9_]{4,32}$/.test(tg);
  return `• <b>${esc(p.name)}</b>${age && age > 0 && age < 120 ? ` — ${years(age)}` : ""}${tgOk ? ` · <a href="https://t.me/${tg}">@${esc(tg)}</a>` : ""}`;
}

async function tgSend(token: string, chat: number, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) { const t = await r.text(); console.error("tg", r.status, t); return { ok: false, status: r.status, error: t.slice(0, 200) }; }
  return { ok: true };
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const q = new URL(req.url).searchParams;
  const hello = q.get("hello") === "1"; // разовое «бот подключён» — проверка, что бот может писать в личку
  const { today, hour } = kyivNow();
  const { data: cfg } = await db.from("court_kv").select("v").eq("k", "bd_notify").maybeSingle();
  const leagues: Record<string, string[]> = { ...((cfg && cfg.v) || {}) };
  // админы и владельцы каждой лиги получают уведомления автоматически
  const { data: adm } = await db.from("league_members").select("league_id, user_id").in("role", ["admin", "owner"]);
  (adm || []).forEach((m: { league_id: string; user_id: string }) => { const a = leagues[m.league_id] = (leagues[m.league_id] || []).slice(); if (!a.includes(m.user_id)) a.push(m.user_id); });
  const out: Record<string, unknown> = {};
  for (const [league, userIds] of Object.entries(leagues)) {
    const token = Deno.env.get("BOT_TOKEN_" + league.toUpperCase());
    if (!token || !Array.isArray(userIds) || !userIds.length) { out[league] = "no token or recipients"; continue; }
    const { data: profs } = await db.from("profiles").select("user_id, telegram_id").in("user_id", userIds);
    const chats = (profs || []).map(p => p.telegram_id).filter(Boolean) as number[];
    if (hello) {
      const k = "bd_hello:" + league, { data: was } = await db.from("court_kv").select("v").eq("k", k).maybeSingle();
      if (was) { out[league] = "hello already sent"; continue; }
      const res = await Promise.all(chats.map(c => tgSend(token, c, "🎂 Готово: буду каждое утро в 9:00 присылать, у кого из сообщества день рождения — сегодня и завтра.")));
      if (res.some(r => r.ok)) await db.from("court_kv").upsert({ k, v: { at: new Date().toISOString() }, updated_at: new Date().toISOString() });
      out[league] = res; continue;
    }
    const { data: players } = await db.from("players").select("id, name, contacts").eq("league_id", league).eq("active", true).not("contacts->>birthday", "is", null);
    const on = (d: string) => (players || []).filter((p: P) => { const b = (p.contacts || {}).birthday || ""; return mdsFor(d).includes(b.slice(-5)); }) as P[];
    const dm = (d: string) => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]}`;
    // ---------- недельная сводка (понедельник) ----------
    const dry = q.get("dry") === "1", dd = q.get("date") || "", base = dry && /^\d{4}-\d{2}-\d{2}$/.test(dd) ? dd : today;
    const monday = addDays(base, -((weekday(base) + 6) % 7));
    const weekText = () => {
      const days = (from: number, n: number) => Array.from({ length: n }, (_, i) => addDays(monday, from + i))
        .flatMap(d => on(d).map(p => `${WD[weekday(d)]}, ${dm(d)} — ${line(p, d).slice(2)}`));
      const all = days(0, 10); // пн … ср следующей недели
      if (!all.length) return "";
      return `🎂 <b>Дни рождения на 10 дней</b> (${dm(monday)} – ${dm(addDays(monday, 9))})\n${all.map(x => "• " + x).join("\n")}`;
    };
    // функцию можно дёрнуть публичным ключом — поэтому наружу только счётчики, без имён и дат
    if (dry) { const t = weekText(); out[league] = { monday, would_send: !!t, lines: (t.match(/^• /gm) || []).length, today: base, today_n: on(base).length, recipients: chats.length }; continue; }
    if (hour < SEND_FROM_HOUR) { out[league] = "too early"; continue; }
    const res0: Record<string, unknown> = {};
    if (today === monday) {
      const wk = "bd_week:" + league, { data: wsent } = await db.from("court_kv").select("v").eq("k", wk).maybeSingle();
      if (!(wsent && wsent.v && wsent.v.date === monday)) {
        const text = weekText(); let ok = true;
        if (text) { const r = await Promise.all(chats.map(c => tgSend(token, c, text))); ok = r.some(x => x.ok); res0.week = r; } else res0.week = "nobody";
        if (ok) await db.from("court_kv").upsert({ k: wk, v: { date: monday }, updated_at: new Date().toISOString() });
      }
    }
    // ---------- ежедневное: сегодня и завтра ----------
    if (!DAILY) { out[league] = { ...res0, day: "off" }; continue; }
    const sentKey = "bd_sent:" + league, { data: sent } = await db.from("court_kv").select("v").eq("k", sentKey).maybeSingle();
    if (sent && sent.v && sent.v.date === today) { out[league] = { ...res0, day: "already sent today" }; continue; }
    const now = on(today);
    if (now.length) {
      const text = `🎂 <b>Сегодня, ${dm(today)}, день рождения</b>\n${now.map(p => line(p, today)).join("\n")}\n\nНе забудь поздравить 🙂`;
      const res = await Promise.all(chats.map(c => tgSend(token, c, text))); out[league] = { ...res0, day: res };
      if (!res.some(r => r.ok)) continue; // не дошло — попробуем на следующем запуске (cron дёргает дважды)
    } else out[league] = { ...res0, day: "nobody" };
    await db.from("court_kv").upsert({ k: sentKey, v: { date: today }, updated_at: new Date().toISOString() });
  }
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
});
