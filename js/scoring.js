/* scoring.js — score, time bonus, streak bonus, best-score persistence */
(function (global) {
  const BASE_SCORE = 100;
  const MAX_TIME_BONUS = 50;
  const STREAK_STEP = 10;
  const STREAK_CAP = 10;

  // Higher difficulty pays out more per correct answer — same effort curve
  // as the puzzle bands in puzzle.js (LEVELS 1-5).
  const LEVEL_MULTIPLIER = { 1: 1, 2: 1.2, 3: 1.5, 4: 2, 5: 3 };

  // Just display names — kept here (not in puzzle.js) so challenge.html
  // can show them without loading puzzle.js at all, which contains the
  // solving algorithm. Keep in sync with puzzle.js's LEVELS names.
  const LEVEL_NAMES = { 1: 'Beginner', 2: 'Easy', 3: 'Medium', 4: 'Hard', 5: 'Expert' };

  function calcAnswerScore({ remainingMs, totalMs, streak, level }) {
    const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    const timeBonus = Math.round(MAX_TIME_BONUS * ratio);
    const streakBonus = Math.min(streak, STREAK_CAP) * STREAK_STEP;
    const multiplier = LEVEL_MULTIPLIER[level] || 1;
    const total = Math.round((BASE_SCORE + timeBonus + streakBonus) * multiplier);
    return { base: BASE_SCORE, timeBonus, streakBonus, multiplier, total };
  }

  function bestKey(mode) {
    return `game24_best_${mode}`;
  }

  function getBest(mode) {
    return parseInt(localStorage.getItem(bestKey(mode)) || '0', 10);
  }

  function setBest(mode, value) {
    if (value > getBest(mode)) {
      localStorage.setItem(bestKey(mode), String(value));
      return true;
    }
    return false;
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  global.Scoring24 = { BASE_SCORE, LEVEL_MULTIPLIER, LEVEL_NAMES, calcAnswerScore, getBest, setBest, formatTime };
})(window);
