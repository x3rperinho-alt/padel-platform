// Вкладка «Ігри»: рейтингові й дружні матчі 2×2 і дружні турніри, які створюють самі гравці.
// Матч хранится как маленький турнир: format "match", s.kind = "match" (в Эло) | "friendly" (без Эло) | "ftour" (дружеский турнир, в Эло, не в сезон).
// Счёт вносит любой участник; 24 часа другие участники могут оспорить — пока спор не решён админом, матч не идёт в Эло.
import { t, getLang, dateFmt } from "./i18n.js";

const S = {
  uk: {
    g_tab: "Ігри", g_create: "+ Створити", g_open: "Відкриті", g_mine: "Мої", g_all: "Усі", g_my_level: "Мій рівень",
    k_match: "Рейтинговий", k_friendly: "Дружній", k_ftour: "Турнір",
    k_match_t: "Рейтинговий матч", k_friendly_t: "Дружній матч", k_ftour_t: "Дружній турнір",
    k_match_d: "2×2 · рахується в Ело. Записатись можуть лише гравці твого рівня.", k_friendly_d: "2×2 · без Ело. Просто пограти, будь-який рівень.", k_ftour_d: "Американо, мексикано та інші формати. Рахується в Ело, не в сезон.",
    g_what: "Що створюємо?", g_new_match: "Новий матч", g_kind: "Тип", g_date: "День", g_time: "Початок", g_dur: "Тривалість", g_min: "хв",
    g_club: "Клуб", g_other: "Інше", g_other_ph: "Назва місця", g_court: "Корт", g_court_ph: "напр. Корт 3", g_booked: "Корт уже заброньовано", g_booked_hint: "Інші бачитимуть, що місце точно є",
    g_levels: "Рівень гравців", g_levels_hint: "Записатись зможуть лише гравці з цього діапазону", g_partner: "Мій партнер", g_partner_none: "Шукаю всіх трьох", g_partner_hint: "Якщо граєте парою — шукатимете лише суперників",
    g_price: "Ціна з людини, ₴", g_price_hint: "Лише для інформації — оплата на місці", g_note: "Коментар", g_note_ph: "напр. беру м'ячі, граємо 2 сети", g_publish: "Створити гру",
    g_need_time: "Вкажи час: з … до …", g_need_place: "Обери клуб", g_you_not_fit: "Твій рівень ({lv}) не в обраному діапазоні", g_partner_not_fit: "Рівень партнера не в діапазоні", g_created: "Гру створено — чекаємо гравців",
    g_free: "вільне місце", g_free_n: "{n} вільних", g_free_1: "1 вільне", g_full: "4/4 · зібрано", g_join: "Зайняти місце", g_join_res: "У резерв", g_leave: "Вийти з гри", g_you_in: "Ти граєш",
    g_late_q: "До гри менше 3 годин. Якщо вийдеш зараз — це пізня відмова і вона знизить твою надійність. Вийти?", g_left: "Ти вийшов з гри", g_joined: "Ти в грі!",
    g_cancel: "Скасувати гру", g_cancel_q: "Скасувати гру? Усі учасники отримають повідомлення.", g_cancelled: "Гру скасовано", g_st_cancelled: "скасовано",
    g_st_open: "шукаємо гравців", g_st_full: "зібрано", g_st_await: "чекає рахунок", g_st_played: "зіграно", g_st_disputed: "оскаржено", g_st_live: "йде",
    g_team_a: "Пара 1", g_team_b: "Пара 2", g_chance: "Шанси на перемогу", g_if: "Якщо виграєте ≈ +{w} · програєте ≈ −{l}", g_no_elo: "Дружня гра — не впливає на Ело",
    g_pairs: "Пари", g_pairs_hint: "Обери, хто з ким. Найрівніший варіант позначено.", g_pairs_fair: "найрівніше", g_pairs_saved: "Пари збережено", g_pairs_fixed: "Пара організатора зафіксована",
    g_score: "Внести рахунок", g_score_hint: "Рахунок по сетах. Вносить будь-хто з четвірки — інші зможуть оскаржити протягом 24 годин.", g_set: "Сет {n}", g_add_set: "+ сет", g_save_score: "Зберегти рахунок",
    g_score_bad: "Заповни хоча б один сет повністю", g_score_tie: "У сеті не може бути нічиєї", g_score_saved: "Рахунок збережено — Ело оновлено", g_score_saved_f: "Рахунок збережено",
    g_result: "Результат", g_win: "Перемога", g_by: "Рахунок вніс(ла) {name} · {when}", g_dispute: "Оскаржити", g_dispute_until: "Оскаржити можна до {when}", g_dispute_ph: "Що не так з рахунком?", g_dispute_send: "Надіслати адміну",
    g_disputed: "Рахунок оскаржено", g_disputed_by: "{name}: «{reason}»", g_disputed_note: "Поки адмін не перевірить, гра не рахується в Ело.", g_disputed_sent: "Скаргу надіслано адміну",
    g_res_ok: "Рахунок вірний", g_res_clear: "Скасувати рахунок", g_resolved: "Готово", g_disputes: "Спірні результати", g_fix: "Виправити",
    g_organizer: "Організатор", g_players: "Гравці", g_reserve: "Резерв", g_no_open: "Поки немає відкритих ігор. Створи свою — інші побачать її тут і в боті.",
    g_no_mine: "Ти ще не записаний на жодну гру.", g_upcoming: "Найближчі", g_need_score: "Внеси рахунок", g_history: "Зіграні", g_stats_played: "ігор", g_stats_wins: "перемог", g_reliab: "надійність",
    g_reliab_hint: "Надійність — скільки ігор ти зіграв з тих, на які записувався. Пізня відмова (менше ніж за 3 год) її знижує.",
    g_late_n: "пізніх відмов: {n}", g_elo_d: "Ело", g_bot_note: "Бот нагадає учасникам за 2 години до гри.", g_back: "Ігри",
    g_need_card: "Щоб записуватися, заповни картку гравця в профілі.", g_need_level: "Записатися можна, коли рівень підтверджено.", g_not_fit: "Не твій рівень",
    g_players_n: "гравців", g_today: "Сьогодні", g_tomorrow: "Завтра", g_court_free: "корт ще не заброньовано", g_booked_short: "корт є", g_your_lv: "твій рівень", g_announce: "📣 Анонс у групу", g_announce_hint: "Бот опублікує гру в «{g}» і сам оновлюватиме: хто записався, зібрано, рахунок", g_no_group: "Група для анонсів ще не підключена — це робить адмін (Адмін → Група).", g_from: "З", g_to: "До", g_past_time: "Цей час уже минув", g_err_many: "У тебе вже 5 запланованих ігор — спершу зіграй або скасуй одну", g_err_level: "Твій рівень не підходить під цей діапазон", g_err_disputed: "Рахунок уже оскаржено — чекаємо адміна", g_err_late: "Оскаржити можна лише протягом 24 год", g_err_early: "Рахунок можна внести за годину до початку гри", g_err_closed: "Гра вже закрита", g_err_rights: "Це може зробити лише учасник гри або організатор", g_err_teams: "Склад гри змінився — онови сторінку", g_score_draw: "1:1 за сетами — додай вирішальний сет (або тай-брейк)", g_st_expired: "не зібрались", g_time_lbl: "Час", g_price_lbl: "Ціна з людини",
  },
  ru: {
    g_tab: "Игры", g_create: "+ Создать", g_open: "Открытые", g_mine: "Мои", g_all: "Все", g_my_level: "Мой уровень",
    k_match: "Рейтинговый", k_friendly: "Дружеский", k_ftour: "Турнир",
    k_match_t: "Рейтинговый матч", k_friendly_t: "Дружеский матч", k_ftour_t: "Дружеский турнир",
    k_match_d: "2×2 · идёт в Эло. Записаться могут только игроки твоего уровня.", k_friendly_d: "2×2 · без Эло. Просто поиграть, любой уровень.", k_ftour_d: "Американо, мексикано и другие форматы. Идёт в Эло, не в сезон.",
    g_what: "Что создаём?", g_new_match: "Новый матч", g_kind: "Тип", g_date: "День", g_time: "Начало", g_dur: "Длительность", g_min: "мин",
    g_club: "Клуб", g_other: "Другое", g_other_ph: "Название места", g_court: "Корт", g_court_ph: "напр. Корт 3", g_booked: "Корт уже забронирован", g_booked_hint: "Другие увидят, что место точно есть",
    g_levels: "Уровень игроков", g_levels_hint: "Записаться смогут только игроки из этого диапазона", g_partner: "Мой партнёр", g_partner_none: "Ищу всех троих", g_partner_hint: "Если играете парой — будете искать только соперников",
    g_price: "Цена с человека, ₴", g_price_hint: "Только для информации — оплата на месте", g_note: "Комментарий", g_note_ph: "напр. беру мячи, играем 2 сета", g_publish: "Создать игру",
    g_need_time: "Укажи время: с … до …", g_need_place: "Выбери клуб", g_you_not_fit: "Твой уровень ({lv}) не в выбранном диапазоне", g_partner_not_fit: "Уровень партнёра не в диапазоне", g_created: "Игра создана — ждём игроков",
    g_free: "свободное место", g_free_n: "{n} свободно", g_free_1: "1 свободно", g_full: "4/4 · собрано", g_join: "Занять место", g_join_res: "В резерв", g_leave: "Выйти из игры", g_you_in: "Ты играешь",
    g_late_q: "До игры меньше 3 часов. Если выйдешь сейчас — это поздний отказ, он снизит твою надёжность. Выйти?", g_left: "Ты вышел из игры", g_joined: "Ты в игре!",
    g_cancel: "Отменить игру", g_cancel_q: "Отменить игру? Все участники получат уведомление.", g_cancelled: "Игра отменена", g_st_cancelled: "отменена",
    g_st_open: "ищем игроков", g_st_full: "собрано", g_st_await: "ждёт счёт", g_st_played: "сыграно", g_st_disputed: "оспорено", g_st_live: "идёт",
    g_team_a: "Пара 1", g_team_b: "Пара 2", g_chance: "Шансы на победу", g_if: "Если выиграете ≈ +{w} · проиграете ≈ −{l}", g_no_elo: "Дружеская игра — не влияет на Эло",
    g_pairs: "Пары", g_pairs_hint: "Выбери, кто с кем. Самый ровный вариант отмечен.", g_pairs_fair: "ровнее всего", g_pairs_saved: "Пары сохранены", g_pairs_fixed: "Пара организатора зафиксирована",
    g_score: "Внести счёт", g_score_hint: "Счёт по сетам. Вносит любой из четвёрки — остальные могут оспорить в течение 24 часов.", g_set: "Сет {n}", g_add_set: "+ сет", g_save_score: "Сохранить счёт",
    g_score_bad: "Заполни хотя бы один сет полностью", g_score_tie: "В сете не может быть ничьей", g_score_saved: "Счёт сохранён — Эло обновлено", g_score_saved_f: "Счёт сохранён",
    g_result: "Результат", g_win: "Победа", g_by: "Счёт внёс(ла) {name} · {when}", g_dispute: "Оспорить", g_dispute_until: "Оспорить можно до {when}", g_dispute_ph: "Что не так со счётом?", g_dispute_send: "Отправить админу",
    g_disputed: "Счёт оспорен", g_disputed_by: "{name}: «{reason}»", g_disputed_note: "Пока админ не проверит, игра не идёт в Эло.", g_disputed_sent: "Жалоба отправлена админу",
    g_res_ok: "Счёт верный", g_res_clear: "Отменить счёт", g_resolved: "Готово", g_disputes: "Спорные результаты", g_fix: "Исправить",
    g_organizer: "Организатор", g_players: "Игроки", g_reserve: "Резерв", g_no_open: "Пока нет открытых игр. Создай свою — другие увидят её здесь и в боте.",
    g_no_mine: "Ты ещё не записан ни на одну игру.", g_upcoming: "Ближайшие", g_need_score: "Внеси счёт", g_history: "Сыгранные", g_stats_played: "игр", g_stats_wins: "побед", g_reliab: "надёжность",
    g_reliab_hint: "Надёжность — сколько игр ты сыграл из тех, на которые записывался. Поздний отказ (меньше чем за 3 ч) её снижает.",
    g_late_n: "поздних отказов: {n}", g_elo_d: "Эло", g_bot_note: "Бот напомнит участникам за 2 часа до игры.", g_back: "Игры",
    g_need_card: "Чтобы записываться, заполни карточку игрока в профиле.", g_need_level: "Записаться можно, когда уровень подтверждён.", g_not_fit: "Не твой уровень",
    g_players_n: "игроков", g_today: "Сегодня", g_tomorrow: "Завтра", g_court_free: "корт ещё не забронирован", g_booked_short: "корт есть", g_your_lv: "твой уровень", g_announce: "📣 Анонс в группу", g_announce_hint: "Бот опубликует игру в «{g}» и сам будет обновлять: кто записался, собрано, счёт", g_no_group: "Группа для анонсов ещё не подключена — это делает админ (Админ → Группа).", g_from: "С", g_to: "До", g_past_time: "Это время уже прошло", g_err_many: "У тебя уже 5 запланированных игр — сначала сыграй или отмени одну", g_err_level: "Твой уровень не подходит под этот диапазон", g_err_disputed: "Счёт уже оспорен — ждём админа", g_err_late: "Оспорить можно только в течение 24 ч", g_err_early: "Счёт можно внести за час до начала игры", g_err_closed: "Игра уже закрыта", g_err_rights: "Это может сделать только участник игры или организатор", g_err_teams: "Состав игры изменился — обнови страницу", g_score_draw: "1:1 по сетам — добавь решающий сет (или тай-брейк)", g_st_expired: "не собрались", g_time_lbl: "Время", g_price_lbl: "Цена с человека",
  },
  en: {
    g_tab: "Games", g_create: "+ Create", g_open: "Open", g_mine: "Mine", g_all: "All", g_my_level: "My level",
    k_match: "Rated", k_friendly: "Friendly", k_ftour: "Tournament",
    k_match_t: "Rated match", k_friendly_t: "Friendly match", k_ftour_t: "Friendly tournament",
    k_match_d: "2×2 · counts for Elo. Only players of your level can join.", k_friendly_d: "2×2 · no Elo. Just for fun, any level.", k_ftour_d: "Americano, Mexicano and other formats. Counts for Elo, not for the season.",
    g_what: "What are we creating?", g_new_match: "New match", g_kind: "Type", g_date: "Day", g_time: "Start", g_dur: "Duration", g_min: "min",
    g_club: "Club", g_other: "Other", g_other_ph: "Venue name", g_court: "Court", g_court_ph: "e.g. Court 3", g_booked: "Court already booked", g_booked_hint: "Others will see the court is secured",
    g_levels: "Player level", g_levels_hint: "Only players in this range can join", g_partner: "My partner", g_partner_none: "Looking for all three", g_partner_hint: "If you play as a pair, you'll only look for opponents",
    g_price: "Price per person, ₴", g_price_hint: "For info only — pay at the club", g_note: "Comment", g_note_ph: "e.g. I bring balls, 2 sets", g_publish: "Create game",
    g_need_time: "Set the time: from … to …", g_need_place: "Pick a club", g_you_not_fit: "Your level ({lv}) is outside the range", g_partner_not_fit: "Partner's level is outside the range", g_created: "Game created — waiting for players",
    g_free: "free spot", g_free_n: "{n} free", g_free_1: "1 free", g_full: "4/4 · full", g_join: "Take a spot", g_join_res: "Join reserve", g_leave: "Leave game", g_you_in: "You're in",
    g_late_q: "Less than 3 hours to the game. Leaving now is a late cancellation and lowers your reliability. Leave?", g_left: "You left the game", g_joined: "You're in!",
    g_cancel: "Cancel game", g_cancel_q: "Cancel the game? All players will be notified.", g_cancelled: "Game cancelled", g_st_cancelled: "cancelled",
    g_st_open: "looking for players", g_st_full: "full", g_st_await: "needs score", g_st_played: "played", g_st_disputed: "disputed", g_st_live: "live",
    g_team_a: "Pair 1", g_team_b: "Pair 2", g_chance: "Win chances", g_if: "Win ≈ +{w} · lose ≈ −{l}", g_no_elo: "Friendly game — doesn't affect Elo",
    g_pairs: "Pairs", g_pairs_hint: "Choose who plays with whom. The most even option is marked.", g_pairs_fair: "most even", g_pairs_saved: "Pairs saved", g_pairs_fixed: "Organizer's pair is fixed",
    g_score: "Enter score", g_score_hint: "Score by sets. Any of the four can enter it — others can dispute within 24 hours.", g_set: "Set {n}", g_add_set: "+ set", g_save_score: "Save score",
    g_score_bad: "Fill in at least one full set", g_score_tie: "A set can't be a draw", g_score_saved: "Score saved — Elo updated", g_score_saved_f: "Score saved",
    g_result: "Result", g_win: "Win", g_by: "Score entered by {name} · {when}", g_dispute: "Dispute", g_dispute_until: "Can be disputed until {when}", g_dispute_ph: "What's wrong with the score?", g_dispute_send: "Send to admin",
    g_disputed: "Score disputed", g_disputed_by: "{name}: “{reason}”", g_disputed_note: "Until an admin checks it, the game doesn't count for Elo.", g_disputed_sent: "Sent to admin",
    g_res_ok: "Score is correct", g_res_clear: "Clear score", g_resolved: "Done", g_disputes: "Disputed results", g_fix: "Correct",
    g_organizer: "Organizer", g_players: "Players", g_reserve: "Reserve", g_no_open: "No open games yet. Create one — others will see it here and in the bot.",
    g_no_mine: "You haven't joined any games yet.", g_upcoming: "Upcoming", g_need_score: "Enter the score", g_history: "Played", g_stats_played: "games", g_stats_wins: "wins", g_reliab: "reliability",
    g_reliab_hint: "Reliability — how many of the games you joined you actually played. A late cancellation (under 3 h) lowers it.",
    g_late_n: "late cancellations: {n}", g_elo_d: "Elo", g_bot_note: "The bot will remind players 2 hours before the game.", g_back: "Games",
    g_need_card: "Fill in your player card in Profile to join games.", g_need_level: "You can join once your level is confirmed.", g_not_fit: "Not your level",
    g_players_n: "players", g_today: "Today", g_tomorrow: "Tomorrow", g_court_free: "court not booked yet", g_booked_short: "court booked", g_your_lv: "your level", g_announce: "📣 Announce in group", g_announce_hint: "The bot will post the game to “{g}” and keep it updated: who joined, full, score", g_no_group: "No announcement group is connected yet — an admin does this (Admin → Group).", g_from: "From", g_to: "To", g_past_time: "That time has passed", g_err_many: "You already have 5 planned games — play or cancel one first", g_err_level: "Your level doesn't fit this range", g_err_disputed: "The score is already disputed — waiting for an admin", g_err_late: "You can only dispute within 24 h", g_err_early: "You can enter the score from 1 hour before the start", g_err_closed: "The game is closed", g_err_rights: "Only a player of this game or the organizer can do this", g_err_teams: "The line-up changed — refresh the page", g_score_draw: "1:1 in sets — add the deciding set (or tie-break)", g_st_expired: "didn't fill", g_time_lbl: "Time", g_price_lbl: "Per person",
  },
};

// ---------- время «с … до …» двумя выпадающими списками (матчи и турниры) ----------
const pad2 = n => String(n).padStart(2, "0");
const toMin = x => { const [h, m] = String(x).split(":").map(Number); return h * 60 + (m || 0); };
const fromMin = x => { x = ((x % 1440) + 1440) % 1440; return pad2(Math.floor(x / 60)) + ":" + pad2(x % 60); };
const durMin = (a, b) => ((toMin(b) - toMin(a)) % 1440 + 1440) % 1440;
// новый конец, когда меняют начало: длительность сохраняется (или берётся по умолчанию)
export function shiftEnd(oldS, newS, oldE, defDur) {
  if (!newS) return oldE || "";
  const d = oldS && oldE ? durMin(oldS, oldE) : oldE ? 0 : defDur || 0;
  return d ? fromMin(toMin(newS) + d) : oldE || "";
}
export function timeRangeHtml(o) { // { idS, idE, s, e, lblS, lblE }
  const L = getLang(), hu = L === "en" ? "h" : L === "ru" ? "ч" : "год";
  const dur = m => { const h = m / 60; return (Number.isInteger(h) ? h : String(h).replace(".", L === "en" ? "." : ",")) + " " + hu; };
  const starts = []; for (let m = 6 * 60; m <= 23 * 60 + 30; m += 30) starts.push(fromMin(m));
  if (o.s && !starts.includes(o.s)) starts.push(o.s); starts.sort((a, b) => toMin(a) - toMin(b));
  let ends;
  if (o.s) { ends = []; for (let d = 60; d <= 300; d += 30) ends.push([fromMin(toMin(o.s) + d), d]);
    if (o.e && !ends.some(x => x[0] === o.e)) { ends.push([o.e, durMin(o.s, o.e)]); ends.sort((a, b) => a[1] - b[1]); } }
  else { ends = starts.map(x => [x, null]); if (o.e && !starts.includes(o.e)) ends.unshift([o.e, null]); }
  const opt = (v, cur, txt) => `<option value="${v}" ${v === cur ? "selected" : ""}>${txt || v}</option>`;
  return `<div class="grid2 time-range">
    <label class="field"><span class="lbl">${o.lblS}</span><select id="${o.idS}" ${o.actS ? `data-act="${o.actS}"` : ""}><option value="">—</option>${starts.map(v => opt(v, o.s)).join("")}</select></label>
    <label class="field"><span class="lbl">${o.lblE}</span><select id="${o.idE}"><option value="">—</option>${ends.map(([v, d]) => opt(v, o.e, d ? `${v} · ${dur(d)}` : v)).join("")}</select></label></div>`;
}

export function createGames(X) {
  const { state, db, esc, toast, err, render, reload, myPlayer, isAdmin, computeElo, eloExpect, ELO, letter, levelBadge, letterClass, avatarHtml, pname, pl,
    lvNow, fmtLv, today, uid, CLUBS, LV_G, lvLetters, setLvLetters, rangeLabel, regsOf, ask, byId, gameId, newFtour, regErrMsg } = X;
  const g = (k, v) => { let s = (S[getLang()] || {})[k] ?? S.uk[k]; if (s == null) return t(k, v); if (v) for (const x of Object.keys(v)) s = s.split("{" + x + "}").join(String(v[x])); return s; };
  const KINDS = ["match", "friendly", "ftour"];
  const kindOf = tt => tt && tt.s && tt.s.kind;
  const isGame = tt => KINDS.includes(kindOf(tt));
  const isMatch = tt => kindOf(tt) === "match" || kindOf(tt) === "friendly";
  const startAt = tt => tt.date ? new Date(tt.date + "T" + (tt.s.time || "23:59")) : null;
  const hoursTo = tt => { const d = startAt(tt); return d ? (d - Date.now()) / 36e5 : Infinity; };
  const mainIds = tt => { const ids = regsOf(tt.id).filter(r => r.status === "main" && r.approval !== "pending").map(r => r.playerId); return isMatch(tt) ? ids.slice(0, 4) : ids; };
  const resIds = tt => regsOf(tt.id).filter(r => r.status === "reserve").map(r => r.playerId);
  const capOf = tt => isMatch(tt) ? 4 : (+tt.s.slots || 0) * (tt.s.pairs ? 2 : 1);
  const gameOf = tt => state.games.find(x => x.tournamentId === tt.id);
  const playedIds = tt => [...new Set(state.games.filter(x => x.tournamentId === tt.id && x.scoreA != null).flatMap(x => x.teamA.concat(x.teamB)))];
  const statusOf = tt => tt.status === "cancelled" ? "cancelled" : tt.s.dispute && !tt.s.dispute.done ? "disputed" : tt.status === "played" ? "played"
    : tt.status === "live" ? "live" : hoursTo(tt) < 0 ? (isMatch(tt) && mainIds(tt).length < 4 ? "expired" : "await") : capOf(tt) && mainIds(tt).length >= capOf(tt) ? "full" : "open";
  const isMe = pid => { const me = myPlayer(); return !!me && me.id === pid; };
  const amIn = tt => { const me = myPlayer(); return !!me && (mainIds(tt).includes(me.id) || resIds(tt).includes(me.id) || playedIds(tt).includes(me.id)); };
  const canManage = tt => isAdmin() || isMe(tt.s.created_by);
  const avg = (E, ids) => ids.reduce((a, id) => a + (E.ratings[id] ?? 2500), 0) / ids.length;
  const chanceA = (E, sp) => eloExpect(avg(E, sp[0]), avg(E, sp[1]));
  const fits = (tt, pid) => { const lv = lvNow(pid); const a = tt.s.level_min, b = tt.s.level_max; if (a == null && b == null) return true; if (lv == null) return false; return (a == null || lv >= +a) && (b == null || lv <= +b); };
  const pct = x => Math.round(x * 100) + "%";
  const dayLbl = d => d === today() ? g("g_today") : d === addDays(today(), 1) ? g("g_tomorrow") : dateFmt(d, true);
  const ymd = x => x.getFullYear() + "-" + pad2(x.getMonth() + 1) + "-" + pad2(x.getDate()); // местная дата, не UTC
  const addDays = (d, n) => { const x = new Date(d + "T12:00"); x.setDate(x.getDate() + n); return ymd(x); };
  const whenFmt = iso => { const d = new Date(iso); return dateFmt(ymd(d)) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
  const kindPill = k => `<span class="g-kind g-k-${k}">${k === "match" ? "⚡" : k === "friendly" ? "🤝" : "🏆"} ${g("k_" + k)}</span>`;
  const lvPill = s => { const r = rangeLabel(s); return `<span class="lvb ${letterClass(r[0] === "≤" ? r.slice(2) : r)}">${esc(r)}</span>`; };
  const stPill = st => `<span class="t-status ${st === "open" ? "live" : st === "played" ? "done" : st === "disputed" || st === "await" ? "res" : "planned"}"><i></i>${g("g_st_" + st)}</span>`;

  // ---------- пары ----------
  const splits = ids => ids.length === 4 ? [[[ids[0], ids[1]], [ids[2], ids[3]]], [[ids[0], ids[2]], [ids[1], ids[3]]], [[ids[0], ids[3]], [ids[1], ids[2]]]] : [];
  const allowedSplits = tt => { const ids = mainIds(tt), p = tt.s.pair; let sp = splits(ids);
    if (p && p.length === 2 && ids.includes(p[0]) && ids.includes(p[1])) sp = sp.filter(x => x.some(tm => tm.includes(p[0]) && tm.includes(p[1]))); return sp; };
  const fairest = (E, sp) => sp.slice().sort((a, b) => Math.abs(chanceA(E, a) - .5) - Math.abs(chanceA(E, b) - .5))[0];
  const sameSplit = (a, b) => !!a && !!b && a.some(tm => tm.includes(b[0][0]) && tm.includes(b[0][1]));
  function teamsOf(tt, E) {
    const gm = gameOf(tt); if (gm && gm.scoreA != null) return [gm.teamA, gm.teamB];
    const ids = mainIds(tt); if (ids.length < 4) return null;
    if (tt.teams && tt.teams.length === 2 && tt.teams.flat().every(id => ids.includes(id))) return tt.teams;
    return fairest(E, allowedSplits(tt));
  }
  // до сбора четвёрки: пара организатора — слева, остальные — по порядку записи
  function slotsOf(tt, E) {
    const tm = teamsOf(tt, E); if (tm) return [tm[0], tm[1]];
    const ids = mainIds(tt), p = tt.s.pair;
    if (p && p.length === 2 && ids.includes(p[0]) && ids.includes(p[1])) { const rest = ids.filter(id => !p.includes(id)); return [[p[0], p[1]], [rest[0] || null, rest[1] || null]]; }
    return [[ids[0] || null, ids[1] || null], [ids[2] || null, ids[3] || null]];
  }

  // ---------- надёжность ----------
  function reliability(pid) {
    const played = state.tournaments.filter(tt => isGame(tt) && tt.status === "played" && playedIds(tt).includes(pid)).length;
    const late = state.tournaments.reduce((a, tt) => a + (isGame(tt) ? (tt.s.late || []).filter(x => x.pid === pid).length : 0), 0);
    return { played, late, pct: played + late ? Math.round(100 * played / (played + late)) : null };
  }
  const relBadge = pid => { const r = reliability(pid); return r.pct == null ? "" : `<span class="g-rel ${r.pct < 85 ? "low" : ""}" title="${g("g_reliab")}">✓ ${r.pct}%</span>`; };

  // ---------- плитка ----------
  const slotAv = (pid, sz) => pid ? `<span class="g-av" title="${esc(pname(pid))}">${avatarHtml(pid, sz || 34)}</span>` : `<span class="g-av vac" style="width:${sz || 34}px;height:${sz || 34}px;">+</span>`;
  function tile(tt, E, noDay) {
    if (kindOf(tt) === "ftour") return ftourTile(tt, noDay);
    const st = statusOf(tt), sl = slotsOf(tt, E), n = mainIds(tt).length, me = myPlayer(), mine = amIn(tt);
    const nofit = me && !mine && st === "open" && !fits(tt, me.id);
    const gm = gameOf(tt), res = gm && gm.scoreA != null && tt.s.sets ? tt.s.sets.map(([a, b]) => `${+a}:${+b}`).join(" ") : "";
    const wn = res ? winnerOf(tt) : null, myW = res && me && wn != null && (gm.teamA.includes(me.id) || gm.teamB.includes(me.id)) ? ((wn === 0) === gm.teamA.includes(me.id) ? "W" : "L") : "";
    return `<div class="tile g-tile ${mine ? "mine" : ""} ${st}" data-act="g-open" data-id="${esc(tt.id)}">
      <div class="ct-top"><span class="g-pills">${kindPill(kindOf(tt))}${lvPill(tt.s)}</span>${stPill(st)}</div>
      <div class="g-when">${noDay ? "" : `<b>${dayLbl(tt.date)}</b> · `}<b>${esc(tt.s.time || "")}${tt.s.time_end ? "–" + esc(tt.s.time_end) : ""}</b></div>
      <div class="tiny g-where">📍 ${esc(tt.s.place || "—")}${tt.s.court ? " · " + esc(tt.s.court) : ""}${tt.s.booked ? ` · <span class="g-booked">✓ ${g("g_booked_short")}</span>` : ""}</div>
      <div class="g-row">
        <div class="g-slots"><span class="g-pair">${slotAv(sl[0][0], 32)}${slotAv(sl[0][1], 32)}</span><span class="g-vs">vs</span><span class="g-pair">${slotAv(sl[1][0], 32)}${slotAv(sl[1][1], 32)}</span></div>
        <div class="g-side">${res ? `<b class="g-res">${myW ? `<span class="g-wl ${myW === "W" ? "up" : "down"}">${myW}</span>` : ""}${res}</b>` : mine ? `<span class="ct-mine main">${g("g_you_in")}</span>` : nofit ? `<span class="ct-nofit">${g("g_not_fit")}</span>` : st === "open" ? `<span class="g-freecnt">${4 - n === 1 ? g("g_free_1") : g("g_free_n", { n: 4 - n })}</span>` : ""}
          ${tt.s.price && !res ? `<span class="tiny">${esc(tt.s.price)} ₴</span>` : ""}</div>
      </div>
    </div>`;
  }
  function ftourTile(tt, noDay) {
    const st = statusOf(tt), n = mainIds(tt).length, cap = capOf(tt), mine = amIn(tt);
    return `<div class="tile g-tile ftour ${mine ? "mine" : ""}" data-act="open-t" data-id="${esc(tt.id)}">
      <div class="ct-top"><span class="g-pills">${kindPill("ftour")}${lvPill(tt.s)}</span>${stPill(st === "full" ? "full" : st)}</div>
      <div class="t-tile-name">${esc(tt.name)}</div>
      <div class="g-when">${noDay ? "" : `<b>${dayLbl(tt.date)}</b> · `}${tt.s.time ? esc(tt.s.time) + (tt.s.time_end ? "–" + esc(tt.s.time_end) : "") : ""} · ${esc(t(tt.format))}</div>
      <div class="tiny g-where">📍 ${esc(tt.s.place || "—")} · ${g("g_organizer").toLowerCase()}: ${esc(pname(tt.s.created_by))}</div>
      <div class="ct-bottom"><span class="ct-slots"><b>${tt.status === "played" ? playedIds(tt).length : n}</b>${tt.status === "played" ? "" : "/" + (cap || "∞")} ${g("g_players_n")}</span>${mine ? `<span class="ct-mine main">${g("g_you_in")}</span>` : tt.s.price ? `<span class="tiny">${esc(tt.s.price)} ₴</span>` : ""}</div>
    </div>`;
  }

  // ---------- список ----------
  function view() {
    if (state.view.gNew) return state.view.gNew === "choose" ? chooserHtml() : formHtml();
    if (state.view.g) { const tt = byId(state.tournaments, state.view.g); if (tt) return detailHtml(tt); state.view.g = null; }
    const E = computeElo(), me = myPlayer(), tab = state.view.gTab || "open", kf = state.view.gKind || "all";
    const games = state.tournaments.filter(isGame);
    const sortUp = (a, b) => (a.date || "").localeCompare(b.date || "") || (a.s.time || "").localeCompare(b.s.time || "");
    const head = `<div class="section-head"><h2>${g("g_tab")}</h2><button class="btn primary sm" data-act="g-new">${g("g_create")}</button></div>
      <div class="seg g-seg"><button class="${tab === "open" ? "active" : ""}" data-act="g-tab" data-val="open">${g("g_open")}</button><button class="${tab === "mine" ? "active" : ""}" data-act="g-tab" data-val="mine">${g("g_mine")}</button></div>`;
    const disputes = isAdmin() ? games.filter(tt => statusOf(tt) === "disputed") : [];
    const dispHtml = disputes.length ? `<div class="g-alert"><b>⚠ ${g("g_disputes")} · ${disputes.length}</b><div class="stack" style="margin-top:8px;">${disputes.map(tt => tile(tt, E)).join("")}</div></div>` : "";
    if (tab === "mine") {
      if (!me) return head + `<div class="card"><div class="empty">${g("g_need_card")}</div></div>`;
      const mineG = games.filter(amIn);
      const up = mineG.filter(tt => ["open", "full", "live"].includes(statusOf(tt))).sort(sortUp);
      const need = mineG.filter(tt => statusOf(tt) === "await" && mainIds(tt).includes(me.id)).sort(sortUp);
      const past = mineG.filter(tt => ["played", "disputed", "expired", "cancelled"].includes(statusOf(tt))).sort((a, b) => -sortUp(a, b));
      const r = reliability(me.id), wins = past.filter(tt => isMatch(tt) && (() => { const tm = teamsOf(tt, E), w = winnerOf(tt); return tm && w != null && tm[w].includes(me.id); })()).length;
      const stats = `<div class="card g-stats"><div><strong>${r.played}</strong><span>${g("g_stats_played")}</span></div><div><strong>${wins}</strong><span>${g("g_stats_wins")}</span></div>
        <div><strong class="${r.pct != null && r.pct < 85 ? "low" : ""}">${r.pct == null ? "—" : r.pct + "%"}</strong><span>${g("g_reliab")}</span></div></div>
        <p class="tiny g-rel-hint">${g("g_reliab_hint")}${r.late ? " · " + g("g_late_n", { n: r.late }) : ""}</p>`;
      if (!mineG.length) return head + dispHtml + stats + `<div class="card"><div class="empty"><div class="ic">🎾</div>${g("g_no_mine")}</div></div>`;
      return head + dispHtml + stats
        + (need.length ? `<h3 class="sub-h">✍️ ${g("g_need_score")}</h3><div class="stack">${need.map(tt => tile(tt, E)).join("")}</div>` : "")
        + (up.length ? `<h3 class="sub-h">${g("g_upcoming")}</h3><div class="stack">${up.map(tt => tile(tt, E)).join("")}</div>` : "")
        + (past.length ? `<h3 class="sub-h">${g("g_history")}</h3><div class="stack">${past.map(tt => tile(tt, E)).join("")}</div>` : "");
    }
    let open = games.filter(tt => ["open", "full"].includes(statusOf(tt))).sort(sortUp);
    if (kf !== "all") open = open.filter(tt => kindOf(tt) === kf);
    if (state.view.gLv && me) open = open.filter(tt => fits(tt, me.id));
    const chips = `<div class="chips-scroll g-filters">${["all", "match", "friendly", "ftour"].map(k => `<span class="chip ${kf === k ? "active" : ""}" data-act="g-kind" data-val="${k}">${k === "all" ? g("g_all") : g("k_" + k)}</span>`).join("")}
      ${me ? `<span class="chip ${state.view.gLv ? "active" : ""}" data-act="g-lv">${g("g_my_level")}${me.level != null ? " · " + letter(lvNow(me)) : ""}</span>` : ""}</div>`;
    // группы по дням
    const days = {}; open.forEach(tt => (days[tt.date] = days[tt.date] || []).push(tt));
    return head + dispHtml + chips + (open.length ? Object.keys(days).sort().map(d => `<h3 class="sub-h">${dayLbl(d)}</h3><div class="stack">${days[d].map(tt => tile(tt, E, true)).join("")}</div>`).join("")
      : `<div class="card"><div class="empty"><div class="ic">🎾</div>${g("g_no_open")}</div></div>`);
  }

  // ---------- выбор типа ----------
  function chooserHtml() {
    const card = k => `<button class="g-choose g-k-${k}" data-act="g-kind-pick" data-val="${k}"><span class="g-choose-ic">${k === "match" ? "⚡" : k === "friendly" ? "🤝" : "🏆"}</span><span><b>${g("k_" + k + "_t")}</b><span class="tiny">${g("k_" + k + "_d")}</span></span><span class="g-choose-go">›</span></button>`;
    return `<div class="section-head"><button class="btn ghost sm back" data-act="g-new-cancel">‹ ${g("g_back")}</button><h2 style="font-size:16px;">${g("g_what")}</h2></div>
      <div class="stack">${KINDS.map(card).join("")}</div>`;
  }

  // ---------- форма матча ----------
  function draft(kind) {
    const me = myPlayer(), lv = me ? lvNow(me) : null, s = { level_min: null, level_max: null };
    if (kind === "match" && lv != null) { const G = LV_G.find(([, lo, hi]) => lv >= lo && lv <= hi + 0.0009) || LV_G[0]; setLvLetters(s, G[0]); }
    const h = new Date().getHours() + 2;
    const r = { kind, date: h >= 22 ? addDays(today(), 1) : today(), time: h >= 22 ? "19:00" : String(Math.min(h, 21)).padStart(2, "0") + ":00", place: "", placeOther: false, court: "", booked: false, s, partner: "", price: "", note: "", announce: true };
    r.time_end = shiftEnd(null, r.time, null, 90); return r;
  }
  function readForm() {
    const f = state._gf, q = id => document.getElementById(id); if (!f) return f;
    if (q("gfTime")) { const ns = q("gfTime").value; f.time_end = q("gfTimeEnd").value; if (ns !== f.time) f.time_end = shiftEnd(f.time, ns, f.time_end, 90); f.time = ns; }
    if (q("gfPlace")) f.place = q("gfPlace").value.trim();
    if (q("gfCourt")) f.court = q("gfCourt").value.trim();
    if (q("gfBooked")) f.booked = q("gfBooked").checked;
    if (q("gfAnnounce")) f.announce = q("gfAnnounce").checked;
    if (q("gfPartner")) f.partner = q("gfPartner").value;
    if (q("gfPrice")) f.price = q("gfPrice").value;
    if (q("gfNote")) f.note = q("gfNote").value;
    return f;
  }
  function formHtml() {
    const f = state._gf, me = myPlayer(), s = f.s, sel = lvLetters(s);
    const dates = Array.from({ length: 14 }, (_, i) => addDays(today(), i));
    const wd = d => new Date(d + "T12:00").toLocaleDateString(getLang() === "en" ? "en-GB" : getLang() === "ru" ? "ru-RU" : "uk-UA", { weekday: "short" });
    const partners = state.players.filter(p => p.active && p.levelStatus === "ok" && (!me || p.id !== me.id)).sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="section-head"><button class="btn ghost sm back" data-act="g-new-back">‹ ${t("cancel")}</button><h2 style="font-size:16px;">${g("g_new_match")}</h2></div>
      <div class="card g-form">
        <div class="seg"><button class="${f.kind === "match" ? "active" : ""}" data-act="gf-kind" data-val="match">⚡ ${g("k_match")}</button><button class="${f.kind === "friendly" ? "active" : ""}" data-act="gf-kind" data-val="friendly">🤝 ${g("k_friendly")}</button></div>
        <p class="tiny" style="margin:8px 0 14px;">${g("k_" + f.kind + "_d")}</p>
        <div class="field"><span class="lbl">${g("g_date")}</span><div class="g-dates">${dates.map(d => `<button type="button" class="g-date ${f.date === d ? "active" : ""}" data-act="gf-date" data-val="${d}"><small>${esc(wd(d))}</small><b>${+d.slice(8)}</b></button>`).join("")}</div></div>
        ${timeRangeHtml({ idS: "gfTime", idE: "gfTimeEnd", actS: "gf-time", s: f.time, e: f.time_end, lblS: g("g_from"), lblE: g("g_to") })}
        <div class="field"><span class="lbl">${g("g_club")}</span><div class="wrap-tags">${CLUBS.map(c => `<span class="chip ${!f.placeOther && f.place === c ? "active" : ""}" data-act="gf-club" data-val="${esc(c)}">${esc(c)}</span>`).join("")}<span class="chip ${f.placeOther ? "active" : ""}" data-act="gf-club" data-val="__other">${g("g_other")}</span></div>
          ${f.placeOther ? `<input type="text" id="gfPlace" value="${esc(f.place)}" placeholder="${g("g_other_ph")}" style="margin-top:8px;">` : ""}</div>
        <label class="field"><span class="lbl">${g("g_court")}</span><input type="text" id="gfCourt" value="${esc(f.court)}" placeholder="${g("g_court_ph")}" maxlength="30"></label>
        <label class="row tf-toggle"><span>${g("g_booked")}<br><span class="tiny">${g("g_booked_hint")}</span></span><input type="checkbox" id="gfBooked" ${f.booked ? "checked" : ""}></label>
        <div class="field"><span class="lbl">${g("g_levels")}</span><div class="wrap-tags lv-chips">
          <span class="chip ${!sel.length ? "active" : ""}" data-act="gf-lv" data-val="all">${t("all_levels")}</span>
          ${LV_G.map(([L]) => `<span class="chip lv-chip ${sel.includes(L) ? "active" : ""}" data-act="gf-lv" data-val="${L}">${L}</span>`).join("")}</div>
          <p class="tiny" style="margin:8px 0 0;">${g("g_levels_hint")}: <b>${esc(rangeLabel(s))}</b>${me && me.level != null ? ` · ${g("g_your_lv")}: ${letter(lvNow(me))} ${fmtLv(lvNow(me))}` : ""}</p></div>
        <label class="field"><span class="lbl">${g("g_partner")}</span><select id="gfPartner"><option value="">${g("g_partner_none")}</option>${partners.map(p => `<option value="${p.id}" ${f.partner === p.id ? "selected" : ""}>${esc(p.name)} · ${letter(lvNow(p))}</option>`).join("")}</select></label>
        <p class="tiny" style="margin:-6px 0 12px;">${g("g_partner_hint")}</p>
        <label class="field"><span class="lbl">${g("g_price")}</span><input type="number" id="gfPrice" min="0" step="50" inputmode="numeric" value="${esc(f.price)}" placeholder="—"></label>
        <p class="tiny" style="margin:-6px 0 12px;">${g("g_price_hint")}</p>
        <label class="field"><span class="lbl">${g("g_note")}</span><textarea id="gfNote" rows="2" maxlength="300" placeholder="${g("g_note_ph")}">${esc(f.note)}</textarea></label>
        ${state.group ? `<label class="row tf-toggle g-ann"><span>${g("g_announce")}<br><span class="tiny">${g("g_announce_hint", { g: esc(state.group) })}</span></span><input type="checkbox" id="gfAnnounce" ${f.announce !== false ? "checked" : ""}></label>`
          : `<p class="tiny" style="margin:0 0 12px;">📣 ${g("g_no_group")}</p>`}
        <button class="btn primary block" data-act="gf-save">${g("g_publish")}</button>
        <p class="tiny" style="margin:10px 0 0;text-align:center;">🤖 ${g("g_bot_note")}</p>
      </div>`;
  }
  async function saveForm() {
    const f = readForm(), me = myPlayer(); if (!me) { toast(g("g_need_card")); return; }
    if (!f.time || !f.time_end) { toast(g("g_need_time")); return; }
    if (new Date(f.date + "T" + f.time) < new Date()) { toast(g("g_past_time")); return; }
    if (!f.place) { toast(g("g_need_place")); return; }
    const probe = { s: f.s };
    if (!fits(probe, me.id)) { toast(g("g_you_not_fit", { lv: letter(lvNow(me)) })); return; }
    if (f.partner && !fits(probe, f.partner)) { toast(g("g_partner_not_fit")); return; }
    const id = uid();
    const row = { id, seq: Date.now() % 1e9, name: g("k_" + f.kind + "_t") + " · " + f.place, date: f.date, status: "scheduled", format: "match", courts: 1, teams: [],
      s: { kind: f.kind, created_by: me.id, time: f.time, time_end: f.time_end || null, dur: f.time_end ? durMin(f.time, f.time_end) : null, place: f.place, court: f.court || null, booked: !!f.booked,
        level_min: f.s.level_min, level_max: f.s.level_max, price: f.price === "" ? null : +f.price, note: f.note.trim() || null, pair: f.partner ? [me.id, f.partner] : null, slots: 4, reg_open: true, announce: !!state.group && f.announce !== false } };
    try { await db.createGame(row, f.partner || null); db.kick && db.kick(); state._gf = null; state.view.gNew = null; state.view.g = id; await reload(); toast(g("g_created")); window.scrollTo(0, 0); } catch (e) { gErr(e); }
  }

  // ---------- карточка матча ----------
  const winnerOf = tt => { const gm = gameOf(tt), byGames = gm && gm.scoreA != null ? (gm.scoreA > gm.scoreB ? 0 : gm.scoreA < gm.scoreB ? 1 : null) : null;
    const ss = tt.s.sets; if (!ss || !ss.length) return byGames;
    let a = 0, b = 0; ss.forEach(([x, y]) => { if (x > y) a++; else if (y > x) b++; }); return a > b ? 0 : b > a ? 1 : byGames; };
  function detailHtml(tt) {
    if (kindOf(tt) === "ftour") { state.view.g = null; state.view.t = tt.id; return ""; }
    const E = computeElo(), me = myPlayer(), st = statusOf(tt), k = kindOf(tt), ids = mainIds(tt), res = resIds(tt), sl = slotsOf(tt, E), tm = teamsOf(tt, E);
    const mine = me && ids.includes(me.id), inRes = me && res.includes(me.id), played = st === "played" || st === "disputed";
    const participant = me && (ids.includes(me.id) || playedIds(tt).includes(me.id));
    const canJoin = me && me.levelStatus === "ok" && !mine && !inRes && ["open", "full"].includes(st) && fits(tt, me.id);
    const slot = (pid, team) => pid ? `<div class="g-slot" data-act="open-profile" data-id="${esc(pid)}">${avatarHtml(pid, 48)}<span class="g-slot-n">${esc(pname(pid))}</span><span class="tiny">${letter(lvNow(pid))}${relBadge(pid)}</span></div>`
      : `<div class="g-slot free">${canJoin && st === "open" ? `<button class="g-slot-add" data-act="g-join" data-id="${esc(tt.id)}">+</button><span class="g-slot-n">${g("g_join")}</span>` : `<span class="g-av vac" style="width:48px;height:48px;">?</span><span class="g-slot-n muted">${g("g_free")}</span>`}</div>`;
    const w = played ? winnerOf(tt) : null;
    const court = `<div class="g-court ${played ? "done" : ""}">
      <div class="g-team ${w === 0 ? "won" : ""}">${slot(sl[0][0])}${slot(sl[0][1])}</div>
      <div class="g-net">${played && tt.s.sets ? tt.s.sets.map(([a, b]) => `<span class="g-set"><b class="${+a > +b ? "w" : ""}">${+a}</b><i>:</i><b class="${+b > +a ? "w" : ""}">${+b}</b></span>`).join("") : `<span class="g-vs-big">VS</span>`}</div>
      <div class="g-team ${w === 1 ? "won" : ""}">${slot(sl[1][0])}${slot(sl[1][1])}</div></div>`;
    let chance = "";
    if (tm && !played) { const c = chanceA(E, tm);
      chance = `<div class="g-chance"><div class="g-bar"><span style="width:${Math.round(c * 100)}%"></span></div><div class="g-chance-l"><span>${pct(c)}</span><span class="tiny">${g("g_chance")}</span><span>${pct(1 - c)}</span></div>
        ${k === "match" && mine ? (() => { const myA = tm[0].includes(me.id), e = myA ? c : 1 - c; return `<p class="tiny" style="margin:6px 0 0;text-align:center;">${g("g_if", { w: Math.round(ELO.K * 1.2 * (1 - e)), l: Math.round(ELO.K * 1.2 * e) })}</p>`; })() : ""}</div>`; }
    let actions = "";
    if (!played && st !== "cancelled") {
      if (!me) actions = `<p class="tiny">${g("g_need_card")}</p>`;
      else if (me.levelStatus !== "ok") actions = `<p class="tiny">${g("g_need_level")}</p>`;
      else if (mine || inRes) actions = `<div class="row" style="justify-content:space-between;"><span class="ct-mine ${inRes ? "reserve" : "main"}">${inRes ? t("reserve") : g("g_you_in")}</span>${st !== "await" ? `<button class="btn sm" data-act="g-leave" data-id="${esc(tt.id)}">${g("g_leave")}</button>` : ""}</div>`;
      else if (!fits(tt, me.id)) actions = `<div class="nofit-note">${t(lvNow(me) < +(tt.s.level_min ?? -1) ? "level_too_low" : "level_too_high")} · ${letter(lvNow(me))} ${fmtLv(lvNow(me))}</div>`;
      else if (st === "open") actions = `<button class="btn primary block" data-act="g-join" data-id="${esc(tt.id)}">${g("g_join")} · ${4 - ids.length === 1 ? g("g_free_1") : g("g_free_n", { n: 4 - ids.length })}</button>`;
      else if (st === "full") actions = `<button class="btn block" data-act="g-join" data-id="${esc(tt.id)}">${g("g_join_res")}</button>`;
    }
    const info = `<div class="info-grid g-info">
        <div><span class="tiny">${g("g_date")}</span><b>${dayLbl(tt.date)}</b></div>
        <div><span class="tiny">${g("g_time_lbl")}</span><b>${esc(tt.s.time || "—")}${tt.s.time_end ? "–" + esc(tt.s.time_end) : ""}</b></div>
        <div><span class="tiny">${g("g_club")}</span><b>${esc(tt.s.place || "—")}</b></div>
        <div><span class="tiny">${g("g_court")}</span><b>${esc(tt.s.court || "—")}</b><span class="tiny ${tt.s.booked ? "g-booked" : "muted"}">${tt.s.booked ? "✓ " + g("g_booked").toLowerCase() : g("g_court_free")}</span></div>
        <div><span class="tiny">${t("level_range")}</span><b>${esc(rangeLabel(tt.s))}</b></div>
        <div><span class="tiny">${g("g_price_lbl")}</span><b>${tt.s.price ? esc(tt.s.price) + " ₴" : "—"}</b></div>
      </div>
      <div class="g-org"><span class="tiny">${g("g_organizer")}:</span> ${pl(tt.s.created_by)}</div>
      ${tt.s.note ? `<p class="g-note">${esc(tt.s.note)}</p>` : ""}`;
    // выбор пар
    let pairs = "";
    if (tm && !played && st !== "cancelled" && (canManage(tt) || mine)) {
      const sp = allowedSplits(tt), fair = fairest(E, sp), cur = tm;
      if (sp.length > 1) pairs = `<div class="card"><h3>${g("g_pairs")}</h3><p class="tiny" style="margin:4px 0 10px;">${g("g_pairs_hint")}</p><div class="g-splits">${sp.map((x, i) => { const c = chanceA(E, x);
        return `<button class="g-split ${sameSplit(cur, x) ? "active" : ""}" data-act="g-split" data-id="${esc(tt.id)}" data-val="${i}" ${canManage(tt) ? "" : "disabled"}>
          <span>${esc(pname(x[0][0]))} + ${esc(pname(x[0][1]))}</span><span class="g-split-vs">${pct(c)} : ${pct(1 - c)}${sameSplit(fair, x) ? ` · <b>${g("g_pairs_fair")}</b>` : ""}</span><span>${esc(pname(x[1][0]))} + ${esc(pname(x[1][1]))}</span></button>`; }).join("")}</div></div>`;
      else if (tt.s.pair) pairs = `<p class="tiny" style="text-align:center;margin:0 0 12px;">🔒 ${g("g_pairs_fixed")}</p>`;
    }
    // ввод счёта
    let score = "";
    if (tm && (participant || isAdmin()) && (!played || state.view.gs === tt.id) && st !== "cancelled") {
      if (state.view.gs === tt.id) { const d = state._gs || (state._gs = { sets: (tt.s.sets || [["", ""], ["", ""]]).map(x => x.map(String)), tm });
        score = `<div class="card g-score"><h3>${g("g_score")}</h3><p class="tiny" style="margin:4px 0 12px;">${g("g_score_hint")}</p>
          <div class="g-sc-grid" style="grid-template-columns: minmax(0,1fr) repeat(${d.sets.length}, 52px);">
            <span></span>${d.sets.map((_, i) => `<span class="tiny g-sc-h">${g("g_set", { n: i + 1 })}</span>`).join("")}
            <span class="g-sc-team">${esc(pname(tm[0][0]))} + ${esc(pname(tm[0][1]))}</span>${d.sets.map((x, i) => `<input class="g-sc" type="number" inputmode="numeric" min="0" max="99" id="gsA${i}" value="${esc(x[0])}">`).join("")}
            <span class="g-sc-team">${esc(pname(tm[1][0]))} + ${esc(pname(tm[1][1]))}</span>${d.sets.map((x, i) => `<input class="g-sc" type="number" inputmode="numeric" min="0" max="99" id="gsB${i}" value="${esc(x[1])}">`).join("")}
          </div>
          <div class="row" style="justify-content:space-between;margin-top:12px;">${d.sets.length < 3 ? `<button class="btn sm ghost" data-act="g-set-add">${g("g_add_set")}</button>` : "<span></span>"}
            <span style="display:flex;gap:6px;"><button class="btn sm" data-act="g-score-cancel">${t("cancel")}</button><button class="btn sm primary" data-act="g-score-save" data-id="${esc(tt.id)}">${g("g_save_score")}</button></span></div></div>`; }
      else if ((st === "full" && hoursTo(tt) < 1) || st === "await" || st === "live") score = `<button class="btn ${st === "await" ? "primary" : ""} block g-score-btn" data-act="g-score" data-id="${esc(tt.id)}">✍️ ${g("g_score")}</button>`;
    }
    // результат
    let result = "";
    if (played && state.view.gs !== tt.id) {
      const ts = E.tsum, rows = tm ? tm[0].concat(tm[1]) : [];
      const deltas = k === "match" && st !== "disputed" ? `<div class="g-deltas">${rows.map(pid => { const x = (ts[pid] || {})[tt.id]; const d = x ? Math.round(x.d) : null;
        return `<div class="g-delta" data-act="open-profile" data-id="${esc(pid)}">${avatarHtml(pid, 28)}<span class="g-delta-n">${esc(pname(pid))}</span><b class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${d == null ? "—" : (d > 0 ? "+" : "") + d}</b></div>`; }).join("")}</div>`
        : k === "friendly" ? `<p class="tiny" style="margin:0;">${g("g_no_elo")}</p>` : "";
      const until = tt.s.scored_at ? new Date(new Date(tt.s.scored_at).getTime() + 864e5) : null, open = until && until > new Date();
      const canDispute = participant && open && !tt.s.dispute && !isMe(tt.s.scored_by) && !!tt.s.scored_at;
      const dsp = tt.s.dispute;
      result = `<div class="card"><h3>${g("g_result")}${k === "match" ? ` <span class="tiny">· ${g("g_elo_d")}</span>` : ""}</h3><div style="margin-top:10px;">${deltas}</div>
        ${tt.s.scored_by ? `<p class="tiny" style="margin:10px 0 0;">${g("g_by", { name: esc(pname(tt.s.scored_by)), when: tt.s.scored_at ? whenFmt(tt.s.scored_at) : "—" })}${open && !dsp ? " · " + g("g_dispute_until", { when: whenFmt(until.toISOString()) }) : ""}</p>` : ""}
        ${dsp && !dsp.done ? `<div class="g-disp"><b>⚠ ${g("g_disputed")}</b><p>${g("g_disputed_by", { name: esc(pname(dsp.by)), reason: esc(dsp.reason || "—") })}</p><p class="tiny">${g("g_disputed_note")}</p>
          ${isAdmin() ? `<div class="row" style="gap:6px;justify-content:flex-end;"><button class="btn sm" data-act="g-resolve" data-id="${esc(tt.id)}" data-val="clear">${g("g_res_clear")}</button><button class="btn sm primary" data-act="g-resolve" data-id="${esc(tt.id)}" data-val="ok">${g("g_res_ok")}</button></div>` : ""}</div>` : ""}
        ${canDispute ? (state.view.gd === tt.id ? `<div class="g-disp-form"><textarea id="gdReason" rows="2" maxlength="200" placeholder="${g("g_dispute_ph")}">${esc(state._gdText || "")}</textarea><div class="row" style="gap:6px;justify-content:flex-end;margin-top:8px;"><button class="btn sm" data-act="g-disp-cancel">${t("cancel")}</button><button class="btn sm primary" data-act="g-disp-send" data-id="${esc(tt.id)}">${g("g_dispute_send")}</button></div></div>`
          : `<div class="row" style="gap:6px;justify-content:flex-end;margin-top:10px;"><button class="btn sm ghost" data-act="g-disp" data-id="${esc(tt.id)}">${g("g_dispute")}</button></div>`)
          : (isMe(tt.s.scored_by) && open && !dsp) || (isAdmin() && (!dsp || dsp.done)) ? `<div class="row" style="justify-content:flex-end;margin-top:10px;"><button class="btn sm ghost" data-act="g-score" data-id="${esc(tt.id)}">${g("g_fix")}</button></div>` : ""}
      </div>`;
    }
    const resList = res.length ? `<div class="card"><h3>${g("g_reserve")} <span class="tiny">· ${res.length}</span></h3><div style="margin-top:6px;">${res.map(pid => `<div class="link-row p-row"><span class="p-row-main" data-act="open-profile" data-id="${esc(pid)}">${avatarHtml(pid, 34)}<span><span class="p-row-name">${esc(pname(pid))}</span><br><span class="tiny">${letter(lvNow(pid))} ${relBadge(pid)}</span></span></span></div>`).join("")}</div></div>` : "";
    return `<div class="section-head"><button class="btn ghost sm back" data-act="g-back">‹ ${g("g_back")}</button>${canManage(tt) && !played && st !== "cancelled" ? `<button class="btn sm ghost danger" data-act="g-cancel" data-id="${esc(tt.id)}">${g("g_cancel")}</button>` : ""}</div>
      <div class="card g-hero">
        <div class="ct-top"><span class="g-pills">${kindPill(k)}${lvPill(tt.s)}</span>${stPill(st)}</div>
        <h2 class="g-title">${dayLbl(tt.date)} · ${esc(tt.s.time || "")}${tt.s.time_end ? "–" + esc(tt.s.time_end) : ""}</h2>
        <div class="tiny">📍 ${esc(tt.s.place || "—")}${tt.s.court ? " · " + esc(tt.s.court) : ""}</div>
        ${court}${chance}
        ${k === "friendly" && !played ? `<p class="tiny" style="margin:8px 0 0;text-align:center;">🤝 ${g("g_no_elo")}</p>` : ""}
        ${actions ? `<div style="margin-top:14px;">${actions}</div>` : ""}
      </div>
      ${pairs}${score}${result}
      <div class="card">${info}</div>
      ${resList}`;
  }
  function readScore() { const d = state._gs; if (!d) return d; d.sets.forEach((x, i) => { const a = document.getElementById("gsA" + i), b = document.getElementById("gsB" + i); if (a) x[0] = a.value; if (b) x[1] = b.value; }); return d; }
  async function saveScore(tid) {
    const tt = byId(state.tournaments, tid), d = readScore(), me = myPlayer(); if (!tt || !d) return;
    const sets = d.sets.filter(([a, b]) => a !== "" || b !== "");
    if (!sets.length || sets.some(([a, b]) => a === "" || b === "")) { toast(g("g_score_bad")); return; }
    const num = sets.map(([a, b]) => [Math.min(99, Math.max(0, Math.round(+a) || 0)), Math.min(99, Math.max(0, Math.round(+b) || 0))]);
    if (num.some(([a, b]) => a === b)) { toast(g("g_score_tie")); return; }
    const won = num.reduce((w, [a, b]) => [w[0] + (a > b), w[1] + (b > a)], [0, 0]);
    if (won[0] === won[1]) { toast(g("g_score_draw")); return; } // 1:1 по сетам — нужен решающий сет
    const tm = d.tm || teamsOf(tt, computeElo()); if (!tm) return;
    try { await db.gameScore(tid, tm, num); db.kick && db.kick(); state._gs = null; state.view.gs = null; await reload(); toast(kindOf(tt) === "match" ? g("g_score_saved") : g("g_score_saved_f")); } catch (e) { gErr(e); }
  }

  // ошибки базы — человеческими словами
  const ERRS = [[/time passed/, "g_past_time"], [/too many games/, "g_err_many"], [/partner level out of range/, "g_partner_not_fit"], [/level out of range/, "g_err_level"],
    [/draw/, "g_score_draw"], [/bad sets/, "g_score_bad"], [/dispute open|already disputed/, "g_err_disputed"], [/too late/, "g_err_late"], [/too early/, "g_err_early"],
    [/game closed|registration closed/, "g_err_closed"], [/not a player|not allowed/, "g_err_rights"], [/pair is fixed/, "g_pairs_fixed"], [/need 4 players|bad teams/, "g_err_teams"]];
  const gErr = e => { const m = String((e && e.message) || e || ""), hit = ERRS.find(([re]) => re.test(m)); if (hit) toast(g(hit[1])); else if (regErrMsg) toast(regErrMsg(m)); else err(e); };
  // ---------- обработчики (data-act="g-…" / "gf-…") ----------
  function act(a, el, id, on) {
    if (!/^(g|gf)-/.test(a)) return false;
    const val = el.dataset.val, tt = id ? byId(state.tournaments, id) : null;
    const go = fn => on(async ev => { try { await fn(ev); } catch (e) { gErr(e); } });
    switch (a) {
      case "g-tab": on(() => { state.view.gTab = val; render(); }); break;
      case "g-kind": on(() => { state.view.gKind = val; render(); }); break;
      case "g-lv": on(() => { state.view.gLv = !state.view.gLv; render(); }); break;
      case "g-open": on(() => { state.view.g = id; state.view.gs = null; state._gs = null; state.view.gd = null; window.scrollTo(0, 0); render(); }); break;
      case "g-back": on(() => { state.view.g = null; state.view.gs = null; state._gs = null; render(); }); break;
      case "g-new": on(() => { state.view.gNew = "choose"; window.scrollTo(0, 0); render(); }); break;
      case "g-new-cancel": on(() => { state.view.gNew = null; render(); }); break;
      case "g-new-back": on(() => { state.view.gNew = "choose"; state._gf = null; render(); }); break;
      case "g-kind-pick": on(() => { if (!myPlayer()) { toast(g("g_need_card")); return; } if (val === "ftour") { state.view.gNew = null; newFtour(); return; } state._gf = draft(val); state.view.gNew = "form"; window.scrollTo(0, 0); render(); }); break;
      case "gf-kind": on(() => { const f = readForm(); const was = f.kind; f.kind = val; if (val !== was) { const d = draft(val); f.s = d.s; } render(); }); break;
      case "gf-time": el.onchange = () => { readForm(); render(); }; break;
      case "gf-date": on(() => { readForm().date = val; render(); }); break;
      case "gf-club": on(() => { const f = readForm(); if (val === "__other") { f.placeOther = true; if (CLUBS.includes(f.place)) f.place = ""; } else { f.placeOther = false; f.place = val; } render(); }); break;
      case "gf-lv": on(() => { setLvLetters(readForm().s, val); render(); }); break;
      case "gf-save": go(saveForm); break;
      case "g-join": on(async () => { let r; try { r = await db.register(id); db.kick && db.kick(); } catch (e) { toast(regErrMsg(String((e && e.message) || ""))); return; } await reload(); toast(/reserve/.test(r || "") ? t("registered_reserve") : g("g_joined")); }); break;
      case "g-leave": go(async () => { const late = tt && hoursTo(tt) < 3 && hoursTo(tt) > 0 && mainIds(tt).includes((myPlayer() || {}).id); if (late && !(await ask(g("g_late_q")))) return; await db.unregister(id); db.kick && db.kick(); await reload(); toast(g("g_left")); }); break;
      case "g-cancel": go(async () => { if (!(await ask(g("g_cancel_q")))) return; await db.gameCancel(id); db.kick && db.kick(); state.view.g = null; await reload(); toast(g("g_cancelled")); }); break;
      case "g-split": go(async () => { const sp = allowedSplits(tt)[+val]; if (!sp) return; await db.gameTeams(id, sp); db.kick && db.kick(); await reload(); toast(g("g_pairs_saved")); }); break;
      case "g-score": on(() => { state.view.gs = id; state._gs = null; render(); const x = document.getElementById("gsA0"); if (x) x.focus(); }); break;
      case "g-score-cancel": on(() => { state.view.gs = null; state._gs = null; render(); }); break;
      case "g-set-add": on(() => { const d = readScore(); if (d.sets.length < 3) d.sets.push(["", ""]); render(); }); break;
      case "g-score-save": go(() => saveScore(id)); break;
      case "g-disp": on(() => { state.view.gd = id; render(); const x = document.getElementById("gdReason"); if (x) x.focus(); }); break;
      case "g-disp-cancel": on(() => { state.view.gd = null; render(); }); break;
      case "g-disp-send": go(async () => { const r = (document.getElementById("gdReason") || {}).value || state._gdText || ""; if (r.trim().length < 3) { toast(g("g_dispute_ph")); return; } await db.gameDispute(id, r.trim()); db.kick && db.kick(); state.view.gd = null; state._gdText = ""; await reload(); toast(g("g_disputed_sent")); }); break;
      case "g-resolve": go(async () => { await db.gameResolve(id, val); db.kick && db.kick(); await reload(); toast(g("g_resolved")); }); break;
      default: return false;
    }
    return true;
  }
  // всё, что вводят в формах, сразу запоминаем: живое обновление (кто-то записался) перерисует экран и не сотрёт ввод
  function bindInputs(v) {
    v.querySelectorAll(".g-form input, .g-form select, .g-form textarea").forEach(el => { if (el.id === "gfTime") return; const h = () => readForm(); el.addEventListener("input", h); el.addEventListener("change", h); });
    v.querySelectorAll("input.g-sc").forEach(el => el.addEventListener("input", () => readScore()));
    const dr = v.querySelector("#gdReason"); if (dr) dr.addEventListener("input", () => { state._gdText = dr.value; });
  }
  return { view, act, bindInputs, isGame, kindOf, label: () => g("g_tab"), backLabel: () => g("g_back"), disputesN: () => isAdmin() ? state.tournaments.filter(tt => isGame(tt) && statusOf(tt) === "disputed").length : 0,
    // значок на вкладке: матч уже закончился (по времени конца), а счёта нет — только для основных участников
    needScoreN: () => { const me = myPlayer(); if (!me) return 0; const ended = tt => { const e = tt.s.time_end ? new Date(tt.date + "T" + tt.s.time_end) : null; return !e || e < new Date() || (tt.s.time && tt.s.time_end < tt.s.time); };
      return state.tournaments.filter(tt => isMatch(tt) && statusOf(tt) === "await" && mainIds(tt).includes(me.id) && ended(tt)).length; } };
}
