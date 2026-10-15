// Слой данных коммьюнити: вход, загрузка лиги, точечные операции (без diff-sync — каждое действие сразу в базу).
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function createDb(cfg) {
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const L = cfg.LEAGUE;
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, { p_league: L, ...args }); if (error) throw error; return data; };

  // ---------- вход ----------
  async function session() { const { data } = await sb.auth.getSession(); return data.session; }
  async function signInTelegram(initData) {
    const { data, error } = await sb.functions.invoke("telegram-auth", { body: { initData, league: L } });
    if (error || !data || !data.session) throw new Error((data && data.error) || (error && error.message) || "telegram auth failed");
    await sb.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    return data;
  }
  async function signInGoogle() { const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }); if (error) throw error; }
  async function signInEmail(email) { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error; }
  async function signOut() { await sb.auth.signOut(); }
  async function me() {
    const s = await session(); if (!s) return null;
    const { data: m } = await sb.from("league_members").select("role, player_id").eq("league_id", L).eq("user_id", s.user.id).maybeSingle();
    const { data: p } = await sb.from("profiles").select("display_name").eq("user_id", s.user.id).maybeSingle();
    return { id: s.user.id, role: m ? m.role : null, playerId: m ? m.player_id : null, name: (p && p.display_name) || s.user.user_metadata?.name || s.user.email || "" };
  }
  async function ensureProfile(name) {
    const s = await session(); if (!s) return;
    const { data } = await sb.from("profiles").select("user_id").eq("user_id", s.user.id).maybeSingle();
    if (!data) await sb.from("profiles").insert({ user_id: s.user.id, display_name: name || s.user.user_metadata?.name || s.user.email || "" });
  }
  async function joinOpen() { return rpc("join_open", {}); }

  // ---------- загрузка ----------
  const toPlayer = p => ({ id: p.id, name: p.name, active: p.active, userId: p.user_id || null, avatar: p.avatar || null, level: p.level != null ? +p.level : null, eloStart: p.elo_start ?? 1500, confirmed: !!p.elo_confirmed, contacts: p.contacts || {}, bio: p.bio || "", levelStatus: p.level_status || "ok", levelClaim: p.level_claim != null ? +p.level_claim : null });
  const toTournament = t => ({ id: t.id, seq: t.seq || 0, name: t.name, date: t.date, status: t.status, format: t.format, courts: t.courts, participantIds: t.participant_ids || [], teams: t.teams || [],
    scoring: t.scoring || {}, rounds: t.rounds || null, money: t.money || {}, s: t.settings || {} });
  const toGame = g => ({ id: g.id, tournamentId: g.tournament_id, round: g.round, court: g.court, teamA: g.team_a, teamB: g.team_b, scoreA: g.score_a, scoreB: g.score_b, label: g.label || null });
  const toReg = r => ({ tournamentId: r.tournament_id, playerId: r.player_id, status: r.status, paid: !!r.paid, at: r.created_at });
  async function loadAll() {
    const q = t => sb.from(t).select("*").eq("league_id", L);
    const [players, tournaments, games, regs] = await Promise.all([q("players"), q("tournaments_public"), q("games"), q("registrations")]);
    for (const r of [players, tournaments, games, regs]) if (r.error) throw r.error;
    return {
      players: players.data.map(toPlayer),
      tournaments: tournaments.data.map(toTournament).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.seq - b.seq),
      games: games.data.map(toGame),
      registrations: regs.data.map(toReg),
    };
  }

  // ---------- игрок ----------
  async function createMyPlayer(name, level, source, contacts) { return rpc("create_my_player", { p_name: name, p_level: level, p_source: source, p_contacts: contacts || {} }); }
  async function updateMyCard(name, avatar, contacts, bio) { return rpc("update_my_card", { p_name: name, p_avatar: avatar || null, p_contacts: contacts || {}, p_bio: bio || null }); }
  async function reviewLevel(pid, action, level) { return rpc("review_level", { p_player: pid, p_action: action, p_level: level ?? null }); }
  async function submitQuiz(answers, score) { return rpc("submit_quiz", { p_answers: answers, p_score: score }); }
  async function adjustMyLevel(level) { return rpc("adjust_my_level", { p_level: level }); }
  async function register(tid) { return rpc("register_tournament", { p_tournament: tid }); }
  async function unregister(tid) { return rpc("unregister_tournament", { p_tournament: tid }); }
  async function setDisplayName(name) { const s = await session(); if (!s) return; const { error } = await sb.from("profiles").update({ display_name: name }).eq("user_id", s.user.id); if (error) throw error; }

  // ---------- админ ----------
  async function saveTournament(t) {
    const row = { id: t.id, league_id: L, seq: t.seq || 0, name: t.name, date: t.date || null, status: t.status || "scheduled", format: t.format || "americano", courts: t.courts || null,
      participant_ids: t.participantIds || [], teams: t.teams || [], scoring: t.scoring || {}, rounds: t.rounds || null, settings: t.s || {} };
    if (t.money) row.money = t.money;
    const { error } = await sb.from("tournaments").upsert(row, { onConflict: "league_id,id" }); if (error) throw error;
  }
  async function deleteTournament(tid) { const { error } = await sb.from("tournaments").delete().eq("league_id", L).eq("id", tid); if (error) throw error; }
  async function setRegistration(tid, pid, patch) { const { error } = await sb.from("registrations").update(patch).eq("league_id", L).eq("tournament_id", tid).eq("player_id", pid); if (error) throw error; }
  async function removeRegistration(tid, pid) { const { error } = await sb.from("registrations").delete().eq("league_id", L).eq("tournament_id", tid).eq("player_id", pid); if (error) throw error; }
  async function addRegistration(tid, pid, status) { const { error } = await sb.from("registrations").upsert({ league_id: L, tournament_id: tid, player_id: pid, status: status || "main", paid: false }, { onConflict: "league_id,tournament_id,player_id" }); if (error) throw error; }
  async function updatePlayer(pid, patch) {
    const row = {}; if ("level" in patch) row.level = patch.level; if ("eloStart" in patch) row.elo_start = patch.eloStart; if ("confirmed" in patch) row.elo_confirmed = patch.confirmed; if ("active" in patch) row.active = patch.active; if ("name" in patch) row.name = patch.name; if ("levelStatus" in patch) row.level_status = patch.levelStatus;
    const { error } = await sb.from("players").update(row).eq("league_id", L).eq("id", pid); if (error) throw error;
  }
  async function addLog(action) { const s = await session(); await sb.from("logs").insert({ league_id: L, user_id: s ? s.user.id : null, action }); }
  async function listMembers() {
    const { data, error } = await sb.from("league_members").select("user_id, role, player_id").eq("league_id", L); if (error) throw error;
    const names = await profileNames((data || []).map(m => m.user_id));
    return (data || []).map(m => ({ userId: m.user_id, role: m.role, playerId: m.player_id, name: names[m.user_id] || "" }));
  }
  async function setMemberRole(userId, role) { return rpc("set_member_role", { p_user: userId, p_role: role }); }
  async function profileNames(ids) {
    if (!ids.length) return {};
    const { data, error } = await sb.rpc("member_names", { p_league: L }); if (error) throw error;
    const want = new Set(ids); return Object.fromEntries((data || []).filter(p => want.has(p.user_id)).map(p => [p.user_id, p.display_name]));
  }

  // ---------- живые обновления ----------
  function subscribe(onChange) {
    const ch = sb.channel("league-" + L);
    for (const t of ["players", "tournaments", "games", "registrations"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: "league_id=eq." + L }, () => onChange(t));
    ch.subscribe(); return () => sb.removeChannel(ch);
  }

  return { sb, league: L, session, signInTelegram, signInGoogle, signInEmail, signOut, me, ensureProfile, joinOpen, loadAll,
    createMyPlayer, updateMyCard, adjustMyLevel, reviewLevel, submitQuiz, register, unregister, setDisplayName,
    saveTournament, deleteTournament, setRegistration, removeRegistration, addRegistration, updatePlayer, addLog, listMembers, setMemberRole, profileNames, subscribe };
}
