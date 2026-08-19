/* leaderboard.js — public ranking page.
   Reads public.leaderboard_view (best score per non-banned player) when
   Supabase is configured; falls back to mock data otherwise so the page
   still works before setup is finished. */
(function (global) {
  const SCHOOL_NAME = 'TANTRARAK SCHOOL';

  const MOCK_DATA = [
    { name: 'Player A', grade: 'ม.6', classroom: 'ม.6/1', score: 12450 },
    { name: 'Player B', grade: 'ม.5', classroom: 'ม.5/2', score: 11980 },
    { name: 'Player C', grade: 'ม.6', classroom: 'ม.6/3', score: 11320 },
    { name: 'Player D', grade: 'ม.4', classroom: 'ม.4/1', score: 10870 },
    { name: 'Player E', grade: 'ม.3', classroom: 'ม.3/1', score: 9850 },
    { name: 'Player F', grade: 'ม.3', classroom: 'ม.3/2', score: 9420 },
    { name: 'Player G', grade: 'ม.5', classroom: 'ม.5/1', score: 9250 },
    { name: 'Player H', grade: 'ม.2', classroom: 'ม.2/1', score: 9180 },
    { name: 'Player I', grade: 'ม.4', classroom: 'ม.4/2', score: 8890 },
    { name: 'Player J', grade: 'ม.1', classroom: 'ม.1/3', score: 8760 },
    { name: 'Player K', grade: 'ม.3', classroom: 'ม.3/1', score: 8420 },
    { name: 'Player L', grade: 'ม.6', classroom: 'ม.6/2', score: 8150 },
    { name: 'Player M', grade: 'ม.2', classroom: 'ม.2/4', score: 8005 },
    { name: 'Player N', grade: 'ม.1', classroom: 'ม.1/1', score: 7650 },
    { name: 'Player O', grade: 'ม.4', classroom: 'ม.4/3', score: 7480 },
    { name: 'Player P', grade: 'ม.2', classroom: 'ม.2/2', score: 7300 },
    { name: 'Player Q', grade: 'ม.5', classroom: 'ม.5/3', score: 7120 },
    { name: 'Player R', grade: 'ม.3', classroom: 'ม.3/3', score: 6980 },
    { name: 'Player S', grade: 'ม.1', classroom: 'ม.1/2', score: 6540 },
    { name: 'Player T', grade: 'ม.6', classroom: 'ม.6/4', score: 6210 }
  ].map(row => ({ ...row, school: SCHOOL_NAME }));

  async function fetchLeaderboard({ grade = 'all' } = {}) {
    if (!global.SUPABASE_CONFIGURED) {
      let rows = [...MOCK_DATA];
      if (grade !== 'all') rows = rows.filter(r => r.grade === grade);
      return rows.sort((a, b) => b.score - a.score);
    }

    let query = sb.from('leaderboard_view').select('*').order('best_score', { ascending: false }).limit(50);
    if (grade !== 'all') query = query.eq('grade', grade);
    const { data, error } = await query;
    if (error) {
      console.error('[GAME24] fetchLeaderboard error', error);
      return [];
    }
    return data.map(row => ({
      name: row.name,
      grade: row.grade,
      classroom: row.classroom,
      school: row.school,
      score: row.best_score
    }));
  }

  function renderLeaderboard(container, rows) {
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="leaderboard-note">ยังไม่มีข้อมูลผู้เล่นในระดับชั้นนี้</p>';
      return;
    }
    rows.forEach((row, idx) => {
      const rank = idx + 1;
      const el = document.createElement('div');
      el.className = `rank-row${rank <= 3 ? ` top-${rank}` : ''}`;
      el.innerHTML = `
        <div class="rank">${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}</div>
        <div>
          <div class="rank-name">${row.name}</div>
          <div class="rank-class">${row.classroom} · ${row.school}</div>
        </div>
        <div class="rank-score">${row.score.toLocaleString()}</div>
      `;
      container.appendChild(el);
    });
  }

  global.Leaderboard24 = { SCHOOL_NAME, fetchLeaderboard, renderLeaderboard };
})(window);
