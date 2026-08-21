/* game.js — Game24 controller, shared by practice.html and challenge.html */
(function (global) {
  const OP_SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  class Game24 {
    constructor(opts) {
      this.mode = opts.mode; // 'practice' | 'challenge'
      this.el = {
        setupPanel: document.getElementById('setup-panel'),
        gamePanel: document.getElementById('game-panel'),
        completePanel: document.getElementById('complete-panel'),
        levelBtns: Array.from(document.querySelectorAll('.level-btn')),
        startBtn: document.getElementById('start-game-btn'),
        levelLabel: document.getElementById('current-level-label'),
        cardsRow: document.getElementById('cards-row'),
        expressionDisplay: document.getElementById('expression-display'),
        scoreValue: document.getElementById('score-value'),
        streakValue: document.getElementById('streak-value'),
        bestValue: document.getElementById('best-value'),
        timerBar: document.getElementById('timer-bar'),
        timerText: document.getElementById('timer-text'),
        timerWrap: document.getElementById('timer-wrap'),
        feedbackContainer: document.getElementById('feedback-container'),
        hintBtn: document.getElementById('hint-btn'),
        hintDisplay: document.getElementById('hint-display'),
        skipBtn: document.getElementById('skip-btn'),
        endBtn: document.getElementById('end-session-btn'),
        submitBtn: document.getElementById('op-submit'),
        backBtn: document.getElementById('op-back'),
        clearBtn: document.getElementById('op-clear'),
        opBtns: Array.from(document.querySelectorAll('.op-symbol')),
        openParenBtn: document.getElementById('op-open'),
        closeParenBtn: document.getElementById('op-close'),
        finalScore: document.getElementById('final-score'),
        finalCorrect: document.getElementById('final-correct'),
        finalWrong: document.getElementById('final-wrong'),
        finalAccuracy: document.getElementById('final-accuracy'),
        finalBestStreak: document.getElementById('final-best-streak'),
        finalTime: document.getElementById('final-time'),
        playAgainBtn: document.getElementById('play-again-btn'),
        backHomeBtn: document.getElementById('back-home-btn'),
        soundToggleBtn: document.getElementById('sound-toggle-btn')
      };

      this.level = 3;
      this.cards = [];
      this.tokens = [];
      this.state = 'operand'; // 'operand' | 'operator'
      this.parenDepth = 0;

      this.score = 0;
      this.streak = 0;
      this.bestStreak = 0;
      this.correctCount = 0;
      this.wrongCount = 0;
      this.sessionStart = 0;

      this.puzzle = null;
      this.timerId = null;
      this.remainingMs = 0;
      this.totalMs = 0;
    }

    init() {
      this.el.levelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          this.level = parseInt(btn.dataset.level, 10);
          this.el.levelBtns.forEach(b => b.classList.toggle('selected', b === btn));
        });
      });
      const defaultBtn = this.el.levelBtns.find(b => parseInt(b.dataset.level, 10) === this.level);
      if (defaultBtn) defaultBtn.classList.add('selected');

      this.el.startBtn.addEventListener('click', () => this.startSession());
      this.el.opBtns.forEach(btn => {
        btn.addEventListener('click', () => this.clickOperator(btn.dataset.op));
      });
      if (this.el.openParenBtn) this.el.openParenBtn.addEventListener('click', () => this.clickParen('('));
      if (this.el.closeParenBtn) this.el.closeParenBtn.addEventListener('click', () => this.clickParen(')'));
      this.el.backBtn.addEventListener('click', () => this.backspace());
      this.el.clearBtn.addEventListener('click', () => this.clearAll());
      this.el.submitBtn.addEventListener('click', () => this.submit());
      if (this.el.hintBtn) this.el.hintBtn.addEventListener('click', () => this.showHint());
      if (this.el.skipBtn) this.el.skipBtn.addEventListener('click', () => this.skip());
      if (this.el.endBtn) this.el.endBtn.addEventListener('click', () => this.endSession());
      if (this.el.playAgainBtn) this.el.playAgainBtn.addEventListener('click', () => this.reset());

      document.addEventListener('keydown', e => this.handleKeydown(e));

      if (this.el.bestValue) {
        this.el.bestValue.textContent = Scoring24.getBest(this.mode);
      }

      if (this.el.soundToggleBtn && global.Sound24) {
        const syncSoundIcon = () => {
          this.el.soundToggleBtn.textContent = Sound24.isMuted() ? '🔇' : '🔊';
        };
        syncSoundIcon();
        this.el.soundToggleBtn.addEventListener('click', () => {
          Sound24.setMuted(!Sound24.isMuted());
          syncSoundIcon();
        });
      }
    }

    handleKeydown(e) {
      if (this.el.gamePanel.classList.contains('hidden')) return;
      if ('1234567890'.includes(e.key)) {
        const val = parseInt(e.key, 10) === 0 ? 10 : parseInt(e.key, 10);
        const idx = this.cards.findIndex(c => !c.used && c.value === val);
        if (idx !== -1) this.clickNumber(idx);
      } else if (['+', '-', '*', 'x', 'X', '/'].includes(e.key)) {
        const op = e.key === 'x' || e.key === 'X' ? '*' : e.key;
        this.clickOperator(op);
      } else if (e.key === '(') {
        this.clickParen('(');
      } else if (e.key === ')') {
        this.clickParen(')');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this.backspace();
      } else if (e.key === 'Enter') {
        this.submit();
      } else if (e.key === 'Escape') {
        this.clearAll();
      }
    }

    async startSession() {
      this.score = 0;
      this.streak = 0;
      this.bestStreak = 0;
      this.correctCount = 0;
      this.wrongCount = 0;
      this.sessionStart = performance.now();
      this.serverRowId = null;
      this.currentRoundId = null;

      this.el.setupPanel.classList.add('hidden');
      this.el.completePanel.classList.add('hidden');
      this.el.gamePanel.classList.remove('hidden');

      this.updateStatsUI();

      if (this.mode === 'challenge') {
        await this.createServerRow();
        if (!this.serverRowId) {
          alert('เริ่มเกมไม่สำเร็จ (อาจถูกจำกัดความถี่การเริ่มเกมใหม่ ลองอีกครั้งในอีกสักครู่)');
          this.reset();
          return;
        }
        await this.nextRound();
      } else {
        this.nextPuzzle();
      }
    }

    // Practice mode only — puzzle is generated and solved locally so the
    // hint button works; nothing here touches the server.
    nextPuzzle() {
      this.puzzle = Puzzle24.generatePuzzle(this.level);
      this.cards = this.puzzle.numbers.map(v => ({ value: v, used: false }));
      this.tokens = [];
      this.state = 'operand';
      this.parenDepth = 0;
      if (this.el.hintDisplay) this.el.hintDisplay.classList.add('hidden');
      if (this.el.levelLabel) {
        const mult = Scoring24.LEVEL_MULTIPLIER[this.level] || 1;
        this.el.levelLabel.textContent = `LEVEL ${this.level} · ${Scoring24.LEVEL_NAMES[this.level]} · ×${mult} คะแนน`;
      }
      this.renderCards();
      this.renderExpression();
      this.updateButtonStates();
    }

    // Challenge mode only — the puzzle (numbers) and its eventual scoring
    // are decided server-side by the new-round / submit-answer Edge
    // Functions, so the solving algorithm and answer never reach the
    // browser and a client can't fabricate correct answers or scores.
    async nextRound() {
      this.tokens = [];
      this.state = 'operand';
      this.parenDepth = 0;
      this.cards = [];
      this.currentRoundId = null;
      this.renderCards();
      this.renderExpression();
      this.updateButtonStates();

      const result = await this.callEdgeFunction('new-round', { level: this.level, sessionId: this.serverRowId });
      if (!result || result.error) {
        console.error('[GAME24] nextRound failed', result && result.error);
        UI24.popFeedback(this.el.feedbackContainer, 'โหลดโจทย์ไม่สำเร็จ ลองกดใหม่', 'wrong');
        return;
      }

      this.currentRoundId = result.roundId;
      this.cards = result.numbers.map(v => ({ value: v, used: false }));

      if (this.el.levelLabel) {
        const mult = Scoring24.LEVEL_MULTIPLIER[this.level] || 1;
        this.el.levelLabel.textContent = `LEVEL ${this.level} · ${Scoring24.LEVEL_NAMES[this.level]} · ×${mult} คะแนน`;
      }
      this.renderCards();
      this.renderExpression();
      this.updateButtonStates();
      this.resetQuestionTimer(result.timeSeconds * 1000);
    }

    async callEdgeFunction(name, body) {
      if (typeof sb === 'undefined' || !global.SUPABASE_CONFIGURED) return { error: 'not configured' };
      const {
        data: { session }
      } = await sb.auth.getSession();
      if (!session) return { error: 'no session' };
      try {
        const res = await fetch(`${global.SUPABASE_URL}/functions/v1/${name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify(body)
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { error: json.error || `HTTP ${res.status}` };
        return json;
      } catch (e) {
        return { error: String(e) };
      }
    }

    renderCards() {
      this.el.cardsRow.innerHTML = '';
      this.cards.forEach((card, idx) => {
        const btn = document.createElement('button');
        btn.className = 'number-card' + (card.used ? ' used' : '');
        btn.textContent = card.value;
        btn.disabled = card.used || this.state !== 'operand';
        btn.addEventListener('click', () => this.clickNumber(idx));
        this.el.cardsRow.appendChild(btn);
      });
    }

    renderExpression() {
      const str = this.tokens
        .map(t => (t.type === 'num' ? t.value : OP_SYMBOLS[t.value] || t.value))
        .join(' ');
      this.el.expressionDisplay.textContent = str || 'สร้างสมการของคุณที่นี่...';
      this.el.expressionDisplay.classList.toggle('empty', this.tokens.length === 0);
    }

    updateButtonStates() {
      const allUsed = this.cards.every(c => c.used);
      this.el.opBtns.forEach(btn => {
        btn.disabled = this.state !== 'operator';
      });
      if (this.el.openParenBtn) this.el.openParenBtn.disabled = this.state !== 'operand';
      if (this.el.closeParenBtn) {
        const last = this.tokens[this.tokens.length - 1];
        this.el.closeParenBtn.disabled =
          this.state !== 'operator' || this.parenDepth === 0 || (last && last.value === '(');
      }
      this.el.submitBtn.disabled = !(this.state === 'operator' && this.parenDepth === 0 && allUsed);
      this.el.backBtn.disabled = this.tokens.length === 0;
      this.el.clearBtn.disabled = this.tokens.length === 0;
      Array.from(this.el.cardsRow.children).forEach((btn, idx) => {
        btn.disabled = this.cards[idx].used || this.state !== 'operand';
      });
    }

    clickNumber(idx) {
      const card = this.cards[idx];
      if (!card || card.used || this.state !== 'operand') return;
      card.used = true;
      this.tokens.push({ type: 'num', value: card.value });
      this.state = 'operator';
      this.renderExpression();
      this.updateButtonStates();
    }

    clickOperator(op) {
      if (this.state !== 'operator') return;
      this.tokens.push({ type: 'op', value: op });
      this.state = 'operand';
      this.renderExpression();
      this.updateButtonStates();
    }

    clickParen(paren) {
      if (paren === '(') {
        if (this.state !== 'operand') return;
        this.tokens.push({ type: 'paren', value: '(' });
        this.parenDepth++;
      } else {
        const last = this.tokens[this.tokens.length - 1];
        if (this.state !== 'operator' || this.parenDepth === 0 || (last && last.value === '(')) return;
        this.tokens.push({ type: 'paren', value: ')' });
        this.parenDepth--;
      }
      this.renderExpression();
      this.updateButtonStates();
    }

    backspace() {
      const last = this.tokens.pop();
      if (!last) return;
      if (last.type === 'num') {
        const card = [...this.cards].reverse().find(c => c.used && c.value === last.value);
        if (card) card.used = false;
        this.state = 'operand';
      } else if (last.type === 'op') {
        this.state = 'operator';
      } else if (last.value === '(') {
        this.parenDepth--;
        this.state = 'operand';
      } else {
        this.parenDepth++;
        this.state = 'operator';
      }
      this.renderCards();
      this.renderExpression();
      this.updateButtonStates();
    }

    clearAll() {
      this.cards.forEach(c => (c.used = false));
      this.tokens = [];
      this.state = 'operand';
      this.parenDepth = 0;
      this.renderCards();
      this.renderExpression();
      this.updateButtonStates();
    }

    async submit() {
      if (this.el.submitBtn.disabled) return;

      if (this.mode === 'practice') {
        let result;
        try {
          result = Puzzle24.evaluateTokens(this.tokens);
        } catch (err) {
          UI24.popFeedback(this.el.feedbackContainer, '❌ หารด้วย 0 ไม่ได้', 'wrong');
          UI24.shake(this.el.expressionDisplay);
          this.registerWrong();
          return;
        }
        if (Puzzle24.isTwentyFour(result)) {
          this.handleCorrectLocal();
        } else {
          UI24.popFeedback(this.el.feedbackContainer, '❌ TRY AGAIN', 'wrong');
          UI24.shake(this.el.expressionDisplay);
          this.registerWrong();
        }
        return;
      }

      // Challenge mode: the server verifies the answer and decides the
      // score — this client never computes or asserts correctness itself.
      this.el.submitBtn.disabled = true;
      const tokensPayload = this.tokens.map(t => ({ type: t.type, value: t.value }));
      const result = await this.callEdgeFunction('submit-answer', {
        roundId: this.currentRoundId,
        tokens: tokensPayload
      });
      this.updateButtonStates();

      if (!result || result.error) {
        console.error('[GAME24] submit-answer failed', result && result.error);
        UI24.popFeedback(this.el.feedbackContainer, 'ตรวจคำตอบไม่สำเร็จ ลองใหม่', 'wrong');
        return;
      }

      if (result.correct) {
        this.handleCorrectServer(result);
      } else if (result.roundOver) {
        // Tried enough times on this one puzzle (server-enforced cap,
        // stops brute-forcing every possible expression) — move on to a
        // fresh question instead of allowing further retries on this one.
        UI24.popFeedback(this.el.feedbackContainer, '❌ ลองครบจำนวนแล้ว ไปข้อถัดไป', 'wrong');
        UI24.shake(this.el.expressionDisplay);
        this.registerWrong({ advance: true });
      } else {
        UI24.popFeedback(this.el.feedbackContainer, '❌ TRY AGAIN', 'wrong');
        UI24.shake(this.el.expressionDisplay);
        this.registerWrong();
      }
    }

    registerWrong(opts) {
      if (global.Sound24) Sound24.wrong();
      this.wrongCount++;
      this.streak = 0;
      this.updateStatsUI();
      if (opts && opts.advance && this.mode === 'challenge') {
        this.el.submitBtn.disabled = true;
        setTimeout(() => {
          if (!this.running) return;
          this.nextRound();
        }, 700);
      } else {
        this.clearAll();
      }
    }

    // Practice mode: score computed locally purely for on-screen fun
    // feedback — never saved online, so there's nothing to protect.
    handleCorrectLocal() {
      if (global.Sound24) Sound24.correct();
      this.correctCount++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);

      const scoreInfo = Scoring24.calcAnswerScore({
        remainingMs: 0,
        totalMs: 0,
        streak: this.streak,
        level: this.level
      });
      const gained = scoreInfo.total;
      this.score += gained;

      UI24.popFeedback(this.el.feedbackContainer, '🎉 CORRECT!', 'correct');
      UI24.floatScore(this.el.feedbackContainer, gained);
      UI24.pulse(this.el.scoreValue);
      if (this.streak > 1) UI24.pulse(this.el.streakValue);

      this.updateStatsUI();

      setTimeout(() => this.nextPuzzle(), 550);
    }

    // Challenge mode: score/streak come from the server's response to
    // submit-answer — the client just reflects them in the UI.
    handleCorrectServer(result) {
      if (global.Sound24) Sound24.correct();
      this.correctCount++;
      this.streak = result.newStreak;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.score = result.newScore;

      UI24.popFeedback(this.el.feedbackContainer, '🎉 CORRECT!', 'correct');
      UI24.floatScore(this.el.feedbackContainer, result.gained);
      UI24.pulse(this.el.scoreValue);
      if (this.streak > 1) UI24.pulse(this.el.streakValue);

      this.updateStatsUI();
      this.stopQuestionTimer();

      setTimeout(() => {
        if (!this.running) return;
        this.nextRound();
      }, 550);
    }

    skip() {
      this.wrongCount++;
      this.streak = 0;
      this.updateStatsUI();
      if (this.mode === 'challenge') {
        this.nextRound();
      } else {
        this.nextPuzzle();
      }
    }

    showHint() {
      if (!this.el.hintDisplay || !this.puzzle) return;
      const pretty = this.puzzle.solutionExample
        .replace(/\*/g, '×')
        .replace(/\//g, '÷');
      this.el.hintDisplay.textContent = `ตัวอย่างคำตอบ: ${pretty} = 24`;
      this.el.hintDisplay.classList.remove('hidden');
    }

    updateStatsUI() {
      if (this.el.scoreValue) this.el.scoreValue.textContent = this.score;
      if (this.el.streakValue) this.el.streakValue.textContent = this.streak;
      if (this.el.bestValue) this.el.bestValue.textContent = Scoring24.getBest(this.mode);
    }

    resetQuestionTimer(ms) {
      this.stopQuestionTimer();
      this.remainingMs = ms;
      this.totalMs = ms;
      this.running = true;
      this.lastTickSecond = null;
      this.renderTimer();
      this.timerId = setInterval(() => {
        this.remainingMs -= 100;
        if (this.remainingMs <= 0) {
          this.remainingMs = 0;
          this.renderTimer();
          this.stopQuestionTimer();
          this.timeUp();
          return;
        }
        this.renderTimer();
      }, 100);
    }

    stopQuestionTimer() {
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = null;
      }
    }

    renderTimer() {
      if (!this.el.timerText || !this.el.timerBar) return;
      const seconds = Math.ceil(this.remainingMs / 1000);
      this.el.timerText.textContent = Scoring24.formatTime(this.remainingMs);
      const pct = this.totalMs > 0 ? (this.remainingMs / this.totalMs) * 100 : 0;
      this.el.timerBar.style.width = `${pct}%`;
      const low = seconds <= 5;
      this.el.timerWrap.classList.toggle('low', low);
      if (low) {
        UI24.pulse(this.el.timerWrap);
        if (global.Sound24 && seconds !== this.lastTickSecond && seconds > 0) {
          Sound24.tick();
          this.lastTickSecond = seconds;
        }
      }
    }

    timeUp() {
      this.running = false;
      this.wrongCount++;
      if (global.Sound24) Sound24.wrong();
      UI24.popFeedback(this.el.feedbackContainer, '⏰ หมดเวลา!', 'wrong');
      this.endSession();
    }

    endSession() {
      this.running = false;
      this.stopQuestionTimer();
      if (global.Sound24) Sound24.complete();
      const totalMs = performance.now() - this.sessionStart;
      const attempts = this.correctCount + this.wrongCount;
      const accuracy = attempts > 0 ? Math.round((this.correctCount / attempts) * 100) : 0;

      if (this.mode === 'challenge') {
        Scoring24.setBest(this.mode, this.score);
        // Nothing to save here — submit-answer already kept the scores
        // row updated live after every correct answer, server-side.
      }

      this.el.gamePanel.classList.add('hidden');
      this.el.completePanel.classList.remove('hidden');

      if (this.el.finalScore) this.el.finalScore.textContent = this.score;
      if (this.el.finalCorrect) this.el.finalCorrect.textContent = this.correctCount;
      if (this.el.finalWrong) this.el.finalWrong.textContent = this.wrongCount;
      if (this.el.finalAccuracy) this.el.finalAccuracy.textContent = `${accuracy}%`;
      if (this.el.finalBestStreak) this.el.finalBestStreak.textContent = this.bestStreak;
      if (this.el.finalTime) this.el.finalTime.textContent = Scoring24.formatTime(totalMs);
    }

    // Creates the row for this Challenge session up front (score 0).
    // From here on, only the submit-answer Edge Function (via
    // service_role) ever updates this row's score/correct/streak —
    // the client has no UPDATE rights on scores at all.
    async createServerRow() {
      if (typeof Auth24 === 'undefined' || !global.SUPABASE_CONFIGURED) return;
      const user = await Auth24.getCurrentUser();
      if (!user) return;
      const { data, error } = await sb
        .from('scores')
        .insert({
          user_id: user.id,
          mode: this.mode,
          level: this.level,
          score: 0,
          correct: 0,
          wrong: 0,
          best_streak: 0,
          duration_ms: 0
        })
        .select('id')
        .single();
      if (error) {
        console.error('[GAME24] createServerRow insert failed', error);
        return;
      }
      this.serverRowId = data.id;
    }

    reset() {
      this.el.completePanel.classList.add('hidden');
      this.el.gamePanel.classList.add('hidden');
      this.el.setupPanel.classList.remove('hidden');
      if (this.el.bestValue) this.el.bestValue.textContent = Scoring24.getBest(this.mode);
    }
  }

  global.Game24 = Game24;
})(window);
