// Вход в коммьюнити: Telegram (Mini App) → сохранённая сессия → экран входа. Лига открытая — код не нужен.
import { t } from "./i18n.js";
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const view = () => document.getElementById("view");
function screen(html) { view().innerHTML = `<div class="card" style="margin-top:24px;">${html}</div>`; }

function loginScreen(db) {
  return new Promise(resolve => {
    screen(`
      <h2>${t("login")}</h2>
      <p class="tiny" style="margin:6px 0 14px;">${t("login_hint")}</p>
      <button class="btn primary block" id="btnGoogle">${t("login_google")}</button>
      <div class="row" style="gap:8px;margin-top:12px;">
        <input type="email" id="emailInp" placeholder="email" style="flex:1;">
        <button class="btn" id="btnEmail">${t("send_link")}</button>
      </div>
      <p class="tiny" id="authMsg" style="margin:10px 0 0;"></p>`);
    const msg = m => { document.getElementById("authMsg").textContent = m; };
    document.getElementById("btnGoogle").onclick = async () => { try { await db.signInGoogle(); } catch (e) { msg("Google: " + e.message); } };
    document.getElementById("btnEmail").onclick = async () => {
      const email = document.getElementById("emailInp").value.trim(); if (!email) return;
      try { await db.signInEmail(email); msg(t("link_sent", { email })); } catch (e) { msg("Email: " + e.message); }
    };
    db.sb.auth.onAuthStateChange((_ev, s) => { if (s) resolve(s); });
  });
}

export async function bootstrap(db) {
  screen(`<p class="tiny">…</p>`);
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg && tg.initData) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    // свайп вниз по странице не должен сворачивать мини-приложение — пусть он просто листает интерфейс
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
    try { await db.signInTelegram(tg.initData); }
    catch (e) { screen(`<h3>Telegram</h3><p class="tiny">${esc(e.message)}</p>`); throw e; }
  }
  let s = await db.session();
  if (!s) s = await loginScreen(db);
  await db.ensureProfile();
  let user = await db.me();
  if (!user || !user.role) { try { await db.joinOpen(); } catch (e) { screen(`<h3>Closed</h3><p class="tiny">${esc(e.message)}</p>`); throw e; } user = await db.me(); }
  const data = await db.loadAll();
  return { user, data, tgLang: tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.language_code : null };
}
