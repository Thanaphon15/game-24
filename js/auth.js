/* auth.js — Supabase-backed login/register, session state, nav rendering. */
(function (global) {
  function notConfigured() {
    return { ok: false, message: 'ระบบสมาชิกยังไม่พร้อมใช้งาน — ยังไม่ได้ตั้งค่า Supabase (ดู js/supabaseClient.js)' };
  }

  function mapAuthError(error) {
    const msg = error && error.message ? error.message : '';
    if (msg.includes('Invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (msg.includes('already registered') || msg.includes('already exists')) return 'อีเมลนี้ถูกใช้สมัครแล้ว';
    if (msg.includes('Password should be')) return 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)';
    return msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
  }

  async function isBanned(userId) {
    const { data } = await sb.from('profiles').select('is_banned').eq('id', userId).single();
    return !!(data && data.is_banned);
  }

  async function handleLogin({ email, password }) {
    if (!global.SUPABASE_CONFIGURED) return notConfigured();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: mapAuthError(error) };

    if (await isBanned(data.user.id)) {
      await sb.auth.signOut();
      return { ok: false, message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
    }
    return { ok: true, message: 'เข้าสู่ระบบสำเร็จ กำลังพาไปหน้าหลัก...', redirect: './' };
  }

  async function handleRegister({ name, email, password, school, grade, classroom }) {
    if (!global.SUPABASE_CONFIGURED) return notConfigured();
    const { error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { name, school, grade, classroom } }
    });
    if (error) return { ok: false, message: mapAuthError(error) };
    return { ok: true, message: 'สมัครสมาชิกสำเร็จ! กำลังพาไปหน้าหลัก...', redirect: './' };
  }

  async function getCurrentUser() {
    if (!global.SUPABASE_CONFIGURED) return null;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single();
    return { ...user, profile };
  }

  async function signOut() {
    if (global.SUPABASE_CONFIGURED) await sb.auth.signOut();
    location.href = './';
  }

  async function renderNavAuthState() {
    const menu = document.querySelector('.nav-menu');
    if (!menu || !global.SUPABASE_CONFIGURED) return;

    const user = await getCurrentUser();
    if (!user) return;

    const loginLink = menu.querySelector('a[href="login"]');
    if (loginLink) loginLink.parentElement.remove();

    const registerLink = menu.querySelector('a[href="register"]');
    if (registerLink) {
      registerLink.textContent = 'ออกจากระบบ';
      registerLink.href = '#';
      registerLink.addEventListener('click', e => {
        e.preventDefault();
        signOut();
      });
    }

    const historyLi = document.createElement('li');
    historyLi.innerHTML = '<a href="history">ประวัติของฉัน</a>';
    menu.insertBefore(historyLi, registerLink ? registerLink.parentElement : null);

    if (user.profile && user.profile.is_admin) {
      const li = document.createElement('li');
      li.innerHTML = '<a href="admin">ADMIN</a>';
      menu.insertBefore(li, registerLink ? registerLink.parentElement : null);
    }
  }

  async function getCurrentSeason() {
    if (!global.SUPABASE_CONFIGURED) return 1;
    const { data } = await sb.from('app_settings').select('current_season').eq('id', true).single();
    return data ? data.current_season : 1;
  }

  async function getPlayerStats(userId) {
    if (!global.SUPABASE_CONFIGURED) return null;
    const { data } = await sb.from('player_stats').select('*').eq('user_id', userId).maybeSingle();
    return data;
  }

  async function renderPersonalScoreCard(container) {
    if (!container || !global.SUPABASE_CONFIGURED) return;
    const user = await getCurrentUser();
    if (!user) {
      container.classList.add('hidden');
      return;
    }

    const [stats, season] = await Promise.all([getPlayerStats(user.id), getCurrentSeason()]);
    const total = stats ? stats.total_score : 0;
    const games = stats ? stats.games_played : 0;
    const streak = stats ? stats.best_streak : 0;
    const displayName = user.profile ? user.profile.name : user.email;

    container.classList.remove('hidden');
    container.innerHTML = `
      <div class="score-card-header">
        <span>สวัสดี, ${UI24.escapeHtml(displayName)}</span>
        <span class="score-card-season">ซีซัน ${season}</span>
      </div>
      <div class="score-card-stats">
        <div class="score-card-stat"><span class="scs-value">${total.toLocaleString()}</span><span class="scs-label">คะแนนสะสม</span></div>
        <div class="score-card-stat"><span class="scs-value">${games}</span><span class="scs-label">เกมที่เล่น</span></div>
        <div class="score-card-stat"><span class="scs-value">${streak}</span><span class="scs-label">สตรีคสูงสุด</span></div>
      </div>
    `;
  }

  function bindForm(formId, noteId, onSubmit) {
    const form = document.getElementById(formId);
    const note = document.getElementById(noteId);
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      const data = Object.fromEntries(new FormData(form).entries());
      const result = await onSubmit(data);

      if (submitBtn) submitBtn.disabled = false;
      if (note) {
        note.textContent = result.message;
        note.classList.remove('hidden');
        note.classList.toggle('auth-note-error', !result.ok);
      }
      if (result.ok && result.redirect) {
        setTimeout(() => { location.href = result.redirect; }, 900);
      }
    });
  }

  global.Auth24 = {
    handleLogin,
    handleRegister,
    getCurrentUser,
    signOut,
    renderNavAuthState,
    getCurrentSeason,
    getPlayerStats,
    renderPersonalScoreCard,
    bindForm
  };
})(window);
