/* puzzle.js — 24-solver, puzzle generation, expression evaluation */
(function (global) {
  const EPS = 1e-6;
  const TARGET = 24;

  const LEVELS = {
    1: { name: 'Beginner', min: 1, max: 6, allowDuplicates: false, minRaw: 10, maxRaw: null, timeSeconds: 45 },
    2: { name: 'Easy', min: 1, max: 9, allowDuplicates: false, minRaw: 6, maxRaw: null, timeSeconds: 35 },
    3: { name: 'Medium', min: 1, max: 10, allowDuplicates: true, minRaw: 1, maxRaw: null, timeSeconds: 25 },
    4: { name: 'Hard', min: 2, max: 13, allowDuplicates: true, minRaw: 1, maxRaw: 20, timeSeconds: 18 },
    5: { name: 'Expert', min: 3, max: 13, allowDuplicates: true, minRaw: 1, maxRaw: 8, timeSeconds: 12 }
  };

  // Exhaustive search over all ways to combine 4 numbers with + - * / and
  // parentheses (implicit via recursive pairwise reduction). Returns every
  // expression string whose value is ~24. Search space is tiny (4 numbers)
  // so no memoization/cap is needed.
  function search(items) {
    if (items.length === 1) {
      return Math.abs(items[0].val - TARGET) < EPS ? [items[0].expr] : [];
    }
    const results = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const a = items[i];
        const b = items[j];
        const rest = items.filter((_, idx) => idx !== i && idx !== j);
        const candidates = [
          { val: a.val + b.val, expr: `(${a.expr}+${b.expr})` },
          { val: a.val - b.val, expr: `(${a.expr}-${b.expr})` },
          { val: a.val * b.val, expr: `(${a.expr}*${b.expr})` }
        ];
        if (Math.abs(b.val) > EPS) {
          candidates.push({ val: a.val / b.val, expr: `(${a.expr}/${b.expr})` });
        }
        for (const c of candidates) {
          results.push(...search([c, ...rest]));
        }
      }
    }
    return results;
  }

  function solve(numbers) {
    const items = numbers.map(n => ({ val: n, expr: String(n) }));
    const results = search(items);
    return { solvable: results.length > 0, count: results.length, examples: results };
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function drawNumbers(level) {
    const cfg = LEVELS[level];
    const nums = [];
    for (let i = 0; i < 4; i++) {
      let n;
      do {
        n = randomInt(cfg.min, cfg.max);
      } while (!cfg.allowDuplicates && nums.includes(n));
      nums.push(n);
    }
    return nums;
  }

  function generatePuzzle(level) {
    const cfg = LEVELS[level] || LEVELS[3];
    const MAX_ATTEMPTS = 400;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const numbers = drawNumbers(level);
      const result = solve(numbers);
      if (!result.solvable) continue;
      if (result.count < cfg.minRaw) continue;
      if (cfg.maxRaw !== null && result.count > cfg.maxRaw) continue;
      return {
        level,
        numbers,
        solutionExample: result.examples[0],
        timeSeconds: cfg.timeSeconds
      };
    }

    // Relaxed fallback: accept anything solvable at all.
    for (let attempt = 0; attempt < 400; attempt++) {
      const numbers = drawNumbers(level);
      const result = solve(numbers);
      if (result.solvable) {
        return {
          level,
          numbers,
          solutionExample: result.examples[0],
          timeSeconds: cfg.timeSeconds
        };
      }
    }

    // Guaranteed-solvable last resort: (1+2+3)*4 = 24.
    return {
      level,
      numbers: [1, 2, 3, 4],
      solutionExample: '((1+2+3)*4)',
      timeSeconds: cfg.timeSeconds
    };
  }

  // Evaluate a token list built by the UI's own grammar rules
  // (tokens: {type:'num', value:Number} | {type:'op', value:'+'|'-'|'*'|'/'} | {type:'paren', value:'('|')'})
  function evaluateTokens(tokens) {
    const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
    const output = [];
    const opStack = [];

    for (const t of tokens) {
      if (t.type === 'num') {
        output.push(t);
      } else if (t.type === 'op') {
        while (
          opStack.length &&
          opStack[opStack.length - 1].type === 'op' &&
          prec[opStack[opStack.length - 1].value] >= prec[t.value]
        ) {
          output.push(opStack.pop());
        }
        opStack.push(t);
      } else if (t.value === '(') {
        opStack.push(t);
      } else if (t.value === ')') {
        while (opStack.length && opStack[opStack.length - 1].value !== '(') {
          output.push(opStack.pop());
        }
        opStack.pop(); // discard '('
      }
    }
    while (opStack.length) output.push(opStack.pop());

    const stack = [];
    for (const t of output) {
      if (t.type === 'num') {
        stack.push(t.value);
        continue;
      }
      const b = stack.pop();
      const a = stack.pop();
      switch (t.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/':
          if (Math.abs(b) < EPS) throw new Error('DIV_ZERO');
          stack.push(a / b);
          break;
      }
    }
    return stack[0];
  }

  function isTwentyFour(value) {
    return Math.abs(value - TARGET) < EPS;
  }

  global.Puzzle24 = { LEVELS, EPS, TARGET, solve, generatePuzzle, evaluateTokens, isTwentyFour };
})(window);
