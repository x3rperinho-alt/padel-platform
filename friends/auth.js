// Вход и загрузка лиги до старта интерфейса.
// Порядок: Telegram (если открыто как Mini App) → сохранённая сессия → экран входа (Google / email).
// Если аккаунт есть, но в лиге человека нет — экран с кодом приглашения.
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const view = () => document.getElementById("view");

function screen(html) { view().innerHTML = `<div class="card" style="margin-top:24px;">${html}</div>`; }

function loginScreen(db) {
  return new Promise(resolve => {
    screen(`
      <h2>Вход</h2>
      <p class="tiny" style="margin:6px 0 14px;">Из Telegram вход происходит сам. В браузере — через Google или ссылку на почту.</p>
      <button class="btn primary block" id="btnGoogle">Войти через Google</button>
      <div class="row" style="gap:8px;margin-top:12px;">
        <input type="email" id="emailInp" placeholder="email" style="flex:1;">
        <button class="btn" id="btnEmail">Прислать ссылку</button>
      </div>
      <p class="tiny" id="authMsg" style="margin:10px 0 0;"></p>`);
    const msg = t => { document.getElementById("authMsg").textContent = t; };
    document.getElementById("btnGoogle").onclick = async () => { try { await db.signInGoogle(); } catch (e) { msg("Google: " + e.message); } };
    document.getElementById("btnEmail").onclick = async () => {
      const email = document.getElementById("emailInp").value.trim(); if (!email) return;
      try { await db.signInEmail(email); msg("Ссылка отправлена на " + email + " — открой её на этом же устройстве."); } catch (e) { msg("Email: " + e.message); }
    };
    db.sb.auth.onAuthStateChange((_ev, s) => { if (s) resolve(s); });
  });
}

function inviteScreen(db, user) {
  return new Promise(resolve => {
    screen(`
      <h2>Код приглашения</h2>
      <p class="tiny" style="margin:6px 0 14px;">Вы вошли как ${esc(user.name || "")}, но ещё не в лиге. Введите код, который дал организатор.</p>
      <div class="row" style="gap:8px;">
        <input type="text" id="codeInp" placeholder="код" style="flex:1;">
        <button class="btn primary" id="btnJoin">Войти в лигу</button>
      </div>
      <p class="tiny" id="joinMsg" style="margin:10px 0 0;"></p>
      <button class="btn ghost sm" id="btnOut" style="margin-top:10px;">Выйти из аккаунта</button>`);
    document.getElementById("btnJoin").onclick = async () => {
      try { await db.joinLeague(document.getElementById("codeInp").value.trim()); resolve(); }
      catch (e) { document.getElementById("joinMsg").textContent = "Код не подошёл"; }
    };
    document.getElementById("btnOut").onclick = async () => { await db.signOut(); location.reload(); };
  });
}

export async function bootstrap(db) {
  screen(`<p class="tiny">Загрузка…</p>`);
  // 1) Telegram Mini App
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.initData) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    try { await db.signInTelegram(tg.initData); }
    catch (e) { screen(`<h3>Не удалось войти через Telegram</h3><p class="tiny">${esc(e.message)}</p><p class="tiny">Попробуйте открыть приложение заново из бота.</p>`); throw e; }
  }
  // 2) сессия (сохранённая или только что полученная)
  let s = await db.session();
  if (!s) s = await loginScreen(db);
  await db.ensureProfile();
  // 3) членство в лиге
  let user = await db.me();
  while (!user || !user.role) { await inviteScreen(db, user || {}); user = await db.me(); }
  // 4) данные
  screen(`<p class="tiny">Загружаю данные лиги…</p>`);
  const data = await db.loadAll();
  return { user, data };
}
