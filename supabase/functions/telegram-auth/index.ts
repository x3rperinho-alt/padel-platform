// Вход через Telegram Mini App.
// Клиент присылает initData (строка от Telegram) и league (id лиги).
// Функция: 1) проверяет подпись initData токеном бота этой лиги; 2) находит/создаёт пользователя;
// 3) добавляет его в лигу как игрока (открыть бота лиги = быть приглашённым); 4) возвращает сессию.
//
// Секреты (Supabase → Edge Functions → Secrets):
//   BOT_TOKEN_FRIENDS, BOT_TOKEN_048   — токены ботов по лигам (имя: BOT_TOKEN_<LEAGUE в верхнем регистре>)
//   AUTH_PEPPER                        — любая длинная случайная строка (для паролей tg-аккаунтов)
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — подставляются Supabase автоматически

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");

async function verifyInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash"); if (!hash) throw new Error("no hash");
  params.delete("hash");
  const dataCheck = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, dataCheck));
  if (calc !== hash) throw new Error("bad signature");
  const authDate = +(params.get("auth_date") || 0);
  if (Date.now() / 1000 - authDate > 60 * 60 * 24) throw new Error("initData expired");
  return JSON.parse(params.get("user") || "{}");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { initData, league } = await req.json();
    if (!initData || !league) throw new Error("initData and league required");
    const botToken = Deno.env.get("BOT_TOKEN_" + String(league).toUpperCase());
    if (!botToken) throw new Error("no bot token for league " + league);
    const tg = await verifyInitData(initData, botToken);
    if (!tg.id) throw new Error("no user in initData");

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });

    // детерминированный пароль для tg-аккаунта: никому не показывается, живёт только здесь
    const email = `tg${tg.id}@telegram.local`;
    const password = hex(await hmac(new TextEncoder().encode(Deno.env.get("AUTH_PEPPER")!), "tg:" + tg.id)).slice(0, 48);
    const displayName = [tg.first_name, tg.last_name].filter(Boolean).join(" ") || tg.username || ("Player " + tg.id);

    // найти пользователя по telegram_id, иначе создать
    let userId: string | null = null;
    const { data: prof } = await admin.from("profiles").select("user_id").eq("telegram_id", tg.id).maybeSingle();
    if (prof) userId = prof.user_id;
    else {
      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { telegram_id: tg.id, name: displayName } });
      if (error && !/already/i.test(error.message)) throw error;
      if (created?.user) userId = created.user.id;
      else { // уже есть аккаунт с таким email — найдём
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        userId = list?.users.find(u => u.email === email)?.id || null;
      }
      if (!userId) throw new Error("cannot create user");
      await admin.from("profiles").upsert({ user_id: userId, display_name: displayName, telegram_id: tg.id, telegram_username: tg.username || null, lang: (tg.language_code || "uk").slice(0, 2) });
    }
    // членство в лиге: открыл бота лиги → игрок лиги (роль не понижаем, если уже админ)
    await admin.from("league_members").upsert({ league_id: league, user_id: userId, role: "player" }, { onConflict: "league_id,user_id", ignoreDuplicates: true });

    const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
    if (signErr) throw signErr;
    return new Response(JSON.stringify({ session: session.session, user_id: userId, display_name: displayName }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  }
});
