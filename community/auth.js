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

// Кэш последних данных на устройстве: приложение открывается мгновенно на нём, а свежие данные подтягиваются следом.
const CACHE_KEY = () => "c048_cache_v1:" + location.pathname;
export function saveCache(tgId, user, data) {
  if (!tgId || !user || !data) return;
  try { localStorage.setItem(CACHE_KEY(), JSON.stringify({ tgId, user, data, at: Date.now() })); } catch (e) {}
}
function readCache(tgId) {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY()) || "null");
    if (c && c.tgId === tgId && c.user && c.user.role && c.data && Date.now() - c.at < 14 * 864e5) return c; } catch (e) {}
  return null;
}

export async function bootstrap(db) {
  const tg = window.Telegram && window.Telegram.WebApp;
  const tgUser = tg && tg.initData && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const tgId = tgUser ? tgUser.id : null, tgLang = tgUser ? tgUser.language_code : null;
  if (tg && tg.initData) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    // свайп вниз по странице не должен сворачивать мини-приложение — пусть он просто листает интерфейс
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
  }
  // полный путь входа и загрузки (раньше он всегда блокировал открытие)
  const full = async (quiet) => { // quiet — приложение уже открыто из кэша, ошибки не рисуем поверх него
    if (tg && tg.initData) {
      // уже есть живая сессия этого же Telegram-аккаунта — не ждём вход заново, обновляем его в фоне
      const s0 = await db.session().catch(() => null);
      const same = s0 && tgId && s0.user && s0.user.email === `tg${tgId}@telegram.local`;
      if (same) db.signInTelegram(tg.initData).catch(() => {});
      else { try { await db.signInTelegram(tg.initData); }
        catch (e) { if (!quiet) screen(`<h3>Telegram</h3><p class="tiny">${esc(e.message)}</p>`); throw e; } }
    }
    let s = await db.session();
    if (!s) { if (quiet) return null; s = await loginScreen(db); }
    const dataP = db.loadAll().catch(() => null); // данные грузим параллельно с проверкой профиля
    let [user] = await Promise.all([db.me(), db.ensureProfile()]);
    let data;
    if (!user || !user.role) { try { await db.joinOpen(); } catch (e) { if (!quiet) screen(`<h3>Closed</h3><p class="tiny">${esc(e.message)}</p>`); throw e; }
      user = await db.me(); data = await db.loadAll(); }
    else data = (await dataP) || await db.loadAll();
    saveCache(tgId, user, data);
    return { user, data };
  };
  const cached = tgId ? readCache(tgId) : null;
  if (cached) {
    return { user: cached.user, data: cached.data, tgLang, tgId, fresh: full(true).catch(e => { console.error(e); return null; }) };
  }
  screen(`<p class="tiny">…</p>`);
  const r = await full();
  return { ...r, tgLang, tgId, fresh: null };
}
