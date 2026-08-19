/* ui.js — shared DOM helpers: nav toggle, flash feedback, floating popups */
(function (global) {
  function initNav() {
    const toggle = document.querySelector('.nav-toggle');
    const menu = document.querySelector('.nav-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      menu.classList.toggle('open');
      toggle.classList.toggle('open');
    });
    menu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        menu.classList.remove('open');
        toggle.classList.remove('open');
      });
    });
  }

  function flash(el, className, duration = 500) {
    if (!el) return;
    el.classList.remove(className);
    // force reflow so the animation restarts if triggered twice quickly
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), duration);
  }

  function popFeedback(container, text, type) {
    if (!container) return;
    const el = document.createElement('div');
    el.className = `feedback-pop feedback-${type}`;
    el.textContent = text;
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function floatScore(container, amount) {
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'score-float';
    el.textContent = `+${amount}`;
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function pulse(el) {
    flash(el, 'pulse', 400);
  }

  function shake(el) {
    flash(el, 'shake', 450);
  }

  global.UI24 = { initNav, flash, popFeedback, floatScore, pulse, shake };
})(window);
