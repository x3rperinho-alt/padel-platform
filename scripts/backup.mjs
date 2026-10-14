// Выгружает все таблицы в backups/<дата>.json (и как пинг держит базу бодрой).
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const tables = ["leagues", "league_members", "players", "clubs", "bookings", "tournaments", "games", "logs", "registrations", "bot_outbox"];
const out = {};
for (const t of tables) { const { data, error } = await sb.from(t).select("*"); if (error) throw error; out[t] = data; }
mkdirSync("backups", { recursive: true });
writeFileSync(`backups/${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out));
console.log("backup ok:", Object.fromEntries(tables.map(t => [t, out[t].length])));
