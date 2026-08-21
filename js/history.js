/* history.js — personal game history + client-computed achievement badges.
   Badges are derived from the player's own scores rows (all-time, all
   seasons) — no extra tables needed. */
(function (global) {
  const BADGES = [
    { id: 'starter', icon: '🌱', name: 'มือใหม่หัดเล่น', test: s => s.games >= 1 },
    { id: 'warrior10', icon: '🎮', name: 'นักสู้ 10 เกม', test: s => s.games >= 10 },
    { id: 'warrior50', icon: '⚔️', name: 'นักสู้ 50 เกม', test: s => s.games >= 50 },
    { id: 'streak10', icon: '🔥', name: 'สตรีคเทพ (10+)', test: s => s.bestStreak >= 10 },
    { id: 'accurate', icon: '🎯', name: 'แม่นยำ (≥80%)', test: s => s.attempts >= 20 && s.accuracy >= 80 },
    { id: 'expert', icon: '👑', name: 'Expert Master', test: s => s.expertStreak3 },
    { id: 'kilo', icon: '💯', name: 'คะแนนทะลุ 1000', test: s => s.maxScore >= 1000 },
    { id: 'deity', icon: '🔱', name: 'เทพเจ้า', test: s => s.maxScore >= 100000 }
  ];

  async function fetchHistory(userId, limit) {
    const { data, error } = await sb
      .from('scores')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit || 50);
    if (error) {
      console.error('[GAME24] fetchHistory error', error);
      return [];
    }
    return data;
  }

  function summarize(rows) {
    const games = rows.length;
    const attempts = rows.reduce((sum, r) => sum + r.correct + r.wrong, 0);
    const correctSum = rows.reduce((sum, r) => sum + r.correct, 0);
    const accuracy = attempts > 0 ? Math.round((correctSum / attempts) * 100) : 0;
    const bestStreak = rows.reduce((max, r) => Math.max(max, r.best_streak), 0);
    const maxScore = rows.reduce((max, r) => Math.max(max, r.score), 0);
    const expertStreak3 = rows.some(r => r.level === 5 && r.best_streak >= 3);
    return { games, attempts, accuracy, bestStreak, maxScore, expertStreak3 };
  }

  function computeBadges(rows) {
    const stats = summarize(rows);
    return BADGES.filter(b => b.test(stats));
  }

  function renderSummary(container, rows) {
    const s = summarize(rows);
    container.innerHTML = `
      <div class="complete-stat"><span class="cs-label">เกมทั้งหมด</span><span class="cs-value">${s.games}</span></div>
      <div class="complete-stat"><span class="cs-label">คะแนนสูงสุด</span><span class="cs-value">${s.maxScore.toLocaleString()}</span></div>
      <div class="complete-stat"><span class="cs-label">ความแม่นยำ</span><span class="cs-value">${s.accuracy}%</span></div>
      <div class="complete-stat"><span class="cs-label">สตรีคสูงสุด</span><span class="cs-value">${s.bestStreak}</span></div>
    `;
  }

  function renderBadges(container, badges) {
    container.innerHTML = '';
    if (!badges.length) {
      container.innerHTML = '<p class="leaderboard-note">เล่น Challenge ให้จบสักเกม เพื่อปลดล็อกเหรียญตรารางวัลแรก!</p>';
      return;
    }
    badges.forEach(b => {
      const el = document.createElement('div');
      el.className = 'badge-chip';
      el.innerHTML = `<span class="badge-icon">${b.icon}</span><span class="badge-name">${UI24.escapeHtml(b.name)}</span>`;
      container.appendChild(el);
    });
  }

  function renderHistory(container, rows) {
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="leaderboard-note">ยังไม่มีประวัติการเล่น ลองเข้าโหมด Challenge ดูสิ!</p>';
      return;
    }
    rows.forEach(row => {
      const el = document.createElement('div');
      el.className = 'history-row';
      const date = new Date(row.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
      const attempts = row.correct + row.wrong;
      const accuracy = attempts > 0 ? Math.round((row.correct / attempts) * 100) : 0;
      el.innerHTML = `
        <div class="history-score">${row.score.toLocaleString()}</div>
        <div class="history-meta">
          <div>LEVEL ${row.level} · ${accuracy}% แม่นยำ · สตรีคสูงสุด ${row.best_streak}</div>
          <div class="history-date">${date}</div>
        </div>
      `;
      container.appendChild(el);
    });
  }

  global.History24 = { fetchHistory, summarize, computeBadges, renderSummary, renderBadges, renderHistory };
})(window);
