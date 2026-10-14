// Перенос данных из текущего артефакта (state.json) в базу Supabase, в лигу 'friends'.
// Запуск:  node scripts/import-friends.mjs state.json
// Нужны переменные окружения: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (из Supabase → Project Settings → API).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const [,, file] = process.argv;
if (!file) { console.error("usage: node scripts/import-friends.mjs state.json"); process.exit(1); }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const L = "friends";
const data = JSON.parse(readFileSync(file, "utf8"));

const must = async (p, what) => { const { error } = await p; if (error) { console.error(what, error.message); process.exit(1); } };

await must(sb.from("leagues").upsert({ id: L, name: "Padel Club", ui: "friends", settings: { lang: "ru", currency: "грн" } }), "league");
await must(sb.from("players").upsert(data.players.map(p => ({ id: p.id, league_id: L, name: p.name, active: !!p.active }))), "players");
await must(sb.from("clubs").upsert((data.clubs || []).map((n, i) => ({ league_id: L, name: n, sort: i }))), "clubs");
await must(sb.from("bookings").upsert((data.bookings || []).map(b => ({ id: b.id, league_id: L, date: b.date, time_start: b.time || null, time_end: b.timeEnd || null, club: b.club, courts: b.court != null ? String(b.court) : null, court_type: b.type || null }))), "bookings");
// турниры: этап 1 должен быть вставлен раньше этапа 2 (linked_to) — сортируем по seq
const ts = (data.tournaments || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)).map(t => ({
  id: t.id, league_id: L, seq: t.seq || 0, name: t.name, date: t.date || null, status: t.status || "scheduled", format: t.format,
  courts: t.courts || null, participant_ids: t.participantIds || [], teams: t.teams || [],
  scoring: t.scoringType ? { type: t.scoringType, mode: t.scoringMode, target: t.scoringTarget, minutes: t.scoringMinutes }
          : (t.scoringSystem === "points-race" ? { type: "points", mode: "race", target: t.target } : {}),
  rounds: t.rounds || null, swiss_cap: t.swissCap || null, linked_to: t.linkedTo || null, money: t.money || {}, settings: {},
}));
await must(sb.from("tournaments").upsert(ts), "tournaments");
await must(sb.from("games").upsert((data.games || []).map(g => ({ id: g.id, league_id: L, tournament_id: g.tournamentId, round: g.round, court: g.court || null, team_a: g.teamA, team_b: g.teamB, score_a: g.scoreA, score_b: g.scoreB, label: g.label || null }))), "games");
await must(sb.from("logs").insert((data.log || []).map(l => ({ league_id: L, at: new Date(l.t).toISOString(), action: l.a }))), "logs");
console.log(`imported: ${data.players.length} players, ${ts.length} tournaments, ${(data.games||[]).length} games, ${(data.log||[]).length} log entries`);
