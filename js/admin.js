/* admin.js — admin-only player management: search, ban/unban, permanent delete. */
(function (global) {
  const DELETE_FUNCTION = 'admin-delete-user';

  async function guardAdminPage(gateEl, panelEl) {
    if (!global.SUPABASE_CONFIGURED) {
      gateEl.textContent = 'ยังไม่ได้ตั้งค่า Supabase — แก้ไข js/supabaseClient.js ก่อนใช้งานหน้านี้';
      gateEl.classList.remove('hidden');
      return null;
    }

    const user = await Auth24.getCurrentUser();
    if (!user) {
      gateEl.innerHTML = 'กรุณา<a href="login">เข้าสู่ระบบ</a>ด้วยบัญชีผู้ดูแลระบบก่อน';
      gateEl.classList.remove('hidden');
      return null;
    }
    if (!user.profile || !user.profile.is_admin) {
      gateEl.textContent = 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าผู้ดูแลระบบ';
      gateEl.classList.remove('hidden');
      return null;
    }

    gateEl.classList.add('hidden');
    panelEl.classList.remove('hidden');
    return user;
  }

  async function loadUsers(searchTerm) {
    let query = sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (searchTerm) query = query.ilike('name', `%${searchTerm}%`);
    const { data, error } = await query;
    if (error) {
      console.error('[GAME24] loadUsers error', error);
      return [];
    }
    return data;
  }

  function renderUsers(container, rows, handlers, currentUserId) {
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="admin-empty">ไม่พบผู้เล่น</p>';
      return;
    }

    rows.forEach(row => {
      const el = document.createElement('div');
      el.className = `admin-row${row.is_banned ? ' banned' : ''}`;
      const joined = new Date(row.created_at).toLocaleDateString('th-TH');
      el.innerHTML = `
        <div class="admin-info">
          <div class="admin-name">
            ${UI24.escapeHtml(row.name)}
            ${row.is_admin ? '<span class="tag tag-admin">ADMIN</span>' : ''}
            ${row.is_banned ? '<span class="tag tag-banned">ระงับ</span>' : ''}
          </div>
          <div class="admin-meta">${UI24.escapeHtml(row.classroom) || '-'} · ${UI24.escapeHtml(row.school)} · สมัคร ${joined}</div>
        </div>
        <div class="admin-actions">
          <button class="btn btn-ghost btn-sm" data-action="view">ดูโปรไฟล์</button>
          ${row.id === currentUserId ? '' : `<button class="btn btn-outline btn-sm" data-action="ban">${row.is_banned ? 'เลิกระงับ' : 'ระงับผู้เล่น'}</button>`}
          ${row.is_admin ? '' : '<button class="btn btn-danger btn-sm" data-action="delete">ลบถาวร</button>'}
        </div>
      `;
      const viewBtn = el.querySelector('[data-action="view"]');
      if (viewBtn) viewBtn.addEventListener('click', () => handlers.onView(row));
      const banBtn = el.querySelector('[data-action="ban"]');
      if (banBtn) banBtn.addEventListener('click', () => handlers.onToggleBan(row));
      const delBtn = el.querySelector('[data-action="delete"]');
      if (delBtn) delBtn.addEventListener('click', () => handlers.onDelete(row));
      container.appendChild(el);
    });
  }

  async function getSeasonInfo() {
    const { data, error } = await sb.from('app_settings').select('current_season, season_started_at').eq('id', true).single();
    if (error) {
      console.error('[GAME24] getSeasonInfo error', error);
      return { current_season: 1, season_started_at: null };
    }
    return data;
  }

  async function startNewSeason(currentSeason) {
    const { error } = await sb
      .from('app_settings')
      .update({ current_season: currentSeason + 1, season_started_at: new Date().toISOString() })
      .eq('id', true);
    if (error) console.error('[GAME24] startNewSeason error', error);
    return !error;
  }

  async function updateProfileName(userId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) return { ok: false, message: 'ชื่อห้ามเว้นว่าง' };
    const { error } = await sb.from('profiles').update({ name: trimmed }).eq('id', userId);
    if (error) {
      console.error('[GAME24] updateProfileName error', error);
      return { ok: false, message: 'แก้ไขชื่อไม่สำเร็จ' };
    }
    return { ok: true };
  }

  async function toggleBan(userId, currentlyBanned) {
    const { error } = await sb.from('profiles').update({ is_banned: !currentlyBanned }).eq('id', userId);
    if (error) console.error('[GAME24] toggleBan error', error);
    return !error;
  }

  async function deleteUserPermanently(userId) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { ok: false, message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };

    try {
      const res = await fetch(`${global.SUPABASE_URL}/functions/v1/${DELETE_FUNCTION}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ userId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.error || 'ลบไม่สำเร็จ' };
      return { ok: true };
    } catch (e) {
      return { ok: false, message: 'เรียก Edge Function ไม่สำเร็จ — ตรวจสอบว่า deploy admin-delete-user แล้ว' };
    }
  }

  global.Admin24 = {
    guardAdminPage,
    loadUsers,
    renderUsers,
    updateProfileName,
    toggleBan,
    deleteUserPermanently,
    getSeasonInfo,
    startNewSeason
  };
})(window);
