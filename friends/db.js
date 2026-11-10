// Слой данных: вход, загрузка лиги из Supabase, сохранение изменений (diff-sync), живые обновления.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export function createDb(cfg) {
  // Хранилище сессии: память + localStorage. В Telegram на iPhone localStorage не сохраняется, и после выбора фото
  // или переключения приложений библиотека «теряла» вход. Память держит сессию, пока открыто приложение.
  const mem = {};
  const storage = {
    getItem: k => { if (k in mem) return mem[k]; try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} },
    removeItem: k => { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} },
  };
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage } });
  const L = cfg.LEAGUE;
  // Подстраховка: если вход всё же пропал, а мы внутри Telegram — тихо входим заново и повторяем действие
  let tgInitData = null;
  async function ensureSession() {
    const { data } = await sb.auth.getSession(); if (data.session) return data.session;
    if (tgInitData) { try { await signInTelegram(tgInitData); } catch (e) {} const r = await sb.auth.getSession(); return r.data.session; }
    return null;
  }
  const authLost = e => /not signed in|not a member|JWT|jwt/.test(String((e && e.message) || ""));
  async function R(fn, args) {
    await ensureSession();
    let r = await sb.rpc(fn, args);
    if (r.error && authLost(r.error) && tgInitData) { try { await signInTelegram(tgInitData); } catch (e) {} r = await sb.rpc(fn, args); }
    return r;
  }
  let snapshot = {}; // table -> { id -> JSON } последнее известное состояние базы

  // ---------- вход ----------
  async function session() { const { data } = await sb.auth.getSession(); return data.session; }
  async function signInTelegram(initData) {
    tgInitData = initData;
    const { data, error } = await sb.functions.invoke("telegram-auth", { body: { initData, league: L } });
    if (error || !data || !data.session) throw new Error((data && data.error) || (error && error.message) || "telegram auth failed");
    await sb.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    return data;
  }
  async function signInGoogle() {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) throw error;
  }
  async function signInEmail(email) {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
  }
  async function signOut() { await sb.auth.signOut(); }
  async function me() {
    const s = await session(); if (!s) return null;
    const { data: m } = await sb.from("league_members").select("role, player_id").eq("league_id", L).eq("user_id", s.user.id).maybeSingle();
    const { data: p } = await sb.from("profiles").select("display_name").eq("user_id", s.user.id).maybeSingle();
    return { id: s.user.id, role: m ? m.role : null, playerId: m ? m.player_id : null, name: (p && p.display_name) || s.user.user_metadata?.name || s.user.email || "" };
  }
  async function ensureProfile(name) {
    const s = await session(); if (!s) return;
    await sb.from("profiles").upsert({ user_id: s.user.id, display_name: name || s.user.user_metadata?.name || s.user.email || "" }, { onConflict: "user_id", ignoreDuplicates: true });
  }
  async function joinLeague(code) { const { error } = await R("join_league", { p_league: L, p_code: code }); if (error) throw error; }
  async function claimPlayer(playerId) { const { error } = await R("claim_player", { p_league: L, p_player: playerId }); if (error) throw error; }
  async function updateMyProfile(name, avatar) { const { error } = await R("update_my_profile", { p_league: L, p_name: name, p_avatar: avatar || null }); if (error) throw error; }
  async function listMembers() {
    await ensureSession();
    const { data, error } = await sb.from("league_members").select("user_id, role, player_id").eq("league_id", L);
    if (error) throw error;
    const names = await profileNames((data || []).map(m => m.user_id));
    return (data || []).map(m => ({ userId: m.user_id, role: m.role, playerId: m.player_id, name: names[m.user_id] || "" }));
  }
  async function setMemberRole(userId, role) { const { error } = await R("set_member_role", { p_league: L, p_user: userId, p_role: role }); if (error) throw error; }
  async function removeMember(userId) { const { error } = await R("remove_member", { p_league: L, p_user: userId }); if (error) throw error; }
  async function setDisplayName(name) { await ensureSession(); const s = await session(); if (!s) return; const { error } = await sb.from("profiles").update({ display_name: name }).eq("user_id", s.user.id); if (error) throw error; }

  // ---------- загрузка ----------
  const rowsToState = (r) => ({
    players: r.players.map(p => ({ id: p.id, name: p.name, active: p.active, userId: p.user_id || null, avatar: p.avatar || null, eloStart: p.elo_start ?? 1500, eloAdj: Array.isArray(p.elo_adj) ? p.elo_adj : [] })),
    clubs: r.clubs.slice().sort((a,b)=>a.sort-b.sort).map(c => c.name),
    bookings: r.bookings.map(b => ({ id: b.id, date: b.date, time: b.time_start || "", timeEnd: b.time_end || "", club: b.club || "", court: b.courts || "", type: b.court_type || null })),
    tournaments: r.tournaments.slice().sort((a,b)=>a.seq-b.seq).map(t => ({
      id: t.id, seq: t.seq, name: t.name, date: t.date, status: t.status, format: t.format, courts: t.courts, participantIds: t.participant_ids || [],
      teams: t.teams || [], scoringType: t.scoring?.type || null, scoringMode: t.scoring?.mode || null, scoringTarget: t.scoring?.target ?? null, scoringMinutes: t.scoring?.minutes ?? null,
      rounds: t.rounds || undefined, swissCap: t.swiss_cap || undefined, linkedTo: t.linked_to || undefined, money: t.money || {}, settings: t.settings || {},
    })),
    games: r.games.map(g => ({ id: g.id, tournamentId: g.tournament_id, round: g.round, court: g.court, teamA: g.team_a, teamB: g.team_b, scoreA: g.score_a, scoreB: g.score_b, decided: g.score_a!=null && g.score_b!=null && g.score_a!==g.score_b, label: g.label || undefined })),
    log: r.logs.map(l => ({ t: new Date(l.at).getTime(), who: l.user_id, a: l.action, _id: l.id })),
  });
  const stateToRows = (s) => ({
    players: s.players.map(p => ({ id: p.id, league_id: L, name: p.name, active: !!p.active, user_id: p.userId || null, avatar: p.avatar || null, elo_start: Math.round(+p.eloStart || 1500), elo_adj: Array.isArray(p.eloAdj) ? p.eloAdj : [] })),
    clubs: s.clubs.map((n, i) => ({ league_id: L, name: n, sort: i })),
    bookings: s.bookings.map(b => ({ id: b.id, league_id: L, date: b.date, time_start: b.time || null, time_end: b.timeEnd || null, club: b.club || null, courts: b.court != null ? String(b.court) : null, court_type: b.type || null })),
    tournaments: s.tournaments.map(t => ({ id: t.id, league_id: L, seq: t.seq || 0, name: t.name, date: t.date || null, status: t.status || "scheduled", format: t.format, courts: t.courts || null, participant_ids: t.participantIds || [], teams: t.teams || [],
      scoring: { type: t.scoringType || null, mode: t.scoringMode || null, target: t.scoringTarget ?? null, minutes: t.scoringMinutes ?? null }, rounds: t.rounds || null, swiss_cap: t.swissCap || null, linked_to: t.linkedTo || null, money: t.money || {}, settings: t.settings || {} })),
    games: s.games.map(g => ({ id: g.id, league_id: L, tournament_id: g.tournamentId, round: g.round, court: g.court || null, team_a: g.teamA, team_b: g.teamB, score_a: g.scoreA ?? null, score_b: g.scoreB ?? null, label: g.label || null })),
  });
  const keyOf = { players: r => r.id, clubs: r => r.name, bookings: r => r.id, tournaments: r => r.id, games: r => r.id };
  const keyCols = { players: "league_id,id", clubs: "league_id,name", bookings: "league_id,id", tournaments: "league_id,id", games: "league_id,id" };

  async function loadAll() {
    await ensureSession();
    const q = (t, sel) => sb.from(t).select(sel || "*").eq("league_id", L);
    const [players, clubs, bookings, tournaments, games, logs] = await Promise.all([
      q("players"), q("clubs"), q("bookings"), q("tournaments_public"), q("games"), sb.from("logs").select("*").eq("league_id", L).order("at", { ascending: false }).limit(300),
    ]);
    for (const r of [players, clubs, bookings, tournaments, games]) if (r.error) throw r.error;
    const rows = { players: players.data, clubs: clubs.data, bookings: bookings.data, tournaments: tournaments.data, games: games.data, logs: (logs.data || []).slice().reverse() };
    const st = rowsToState(rows);
    snapshot = {}; const sr = stateToRows(st);
    for (const t of Object.keys(sr)) { snapshot[t] = {}; sr[t].forEach(r => snapshot[t][keyOf[t](r)] = JSON.stringify(r)); }
    return st;
  }

  // ---------- сохранение: сравниваем с последним снимком, пишем только разницу ----------
  async function sync(st, newLogs) {
    await ensureSession();
    const sr = stateToRows(st);
    // турниры раньше игр (внешний ключ), удаление — игры раньше турниров
    for (const t of ["players", "clubs", "bookings", "tournaments", "games"]) {
      const cur = {}; sr[t].forEach(r => cur[keyOf[t](r)] = r);
      const ups = Object.keys(cur).filter(k => snapshot[t]?.[k] !== JSON.stringify(cur[k])).map(k => cur[k]);
      if (ups.length) { const { error } = await sb.from(t).upsert(ups, { onConflict: keyCols[t] }); if (error) throw error; }
    }
    for (const t of ["games", "tournaments", "bookings", "clubs", "players"]) {
      const cur = new Set(sr[t].map(keyOf[t]));
      const dels = Object.keys(snapshot[t] || {}).filter(k => !cur.has(k));
      if (dels.length) {
        const col = t === "clubs" ? "name" : "id";
        const { error } = await sb.from(t).delete().eq("league_id", L).in(col, dels); if (error) throw error;
      }
    }
    if (newLogs && newLogs.length) {
      const { error } = await sb.from("logs").insert(newLogs.map(l => ({ league_id: L, at: new Date(l.t).toISOString(), user_id: l.who || null, action: l.a })));
      if (error) throw error;
    }
    snapshot = {}; for (const t of Object.keys(sr)) { snapshot[t] = {}; sr[t].forEach(r => snapshot[t][keyOf[t](r)] = JSON.stringify(r)); }
  }

  // ---------- живые обновления ----------
  function subscribe(onChange) {
    const ch = sb.channel("league-" + L);
    ["players", "clubs", "bookings", "tournaments", "games"].forEach(t => ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: "league_id=eq." + L }, () => onChange(t)));
    ch.subscribe();
    return () => sb.removeChannel(ch);
  }
  async function profileNames(ids) {
    if (!ids.length) return {};
    const { data, error } = await R("member_names", { p_league: L });
    if (error) throw error;
    const want = new Set(ids);
    return Object.fromEntries((data || []).filter(p => want.has(p.user_id)).map(p => [p.user_id, p.display_name]));
  }
  return { sb, league: L, session, signInTelegram, signInGoogle, signInEmail, signOut, me, ensureProfile, joinLeague, claimPlayer, updateMyProfile, listMembers, setMemberRole, removeMember, setDisplayName, loadAll, sync, subscribe, profileNames };
}
