// new-round — Supabase Edge Function
// Generates a solvable 24-game puzzle server-side and returns ONLY the 4
// numbers to the caller — never the solution. This is the fix for the
// puzzle solver being shipped to (and callable from) the browser: the
// solving algorithm now only ever runs here, server-side.
//
// Deploy via Supabase Dashboard → Edge Functions → Deploy a new function
// → Via Editor → name it exactly "new-round" → paste this file's content
// → Deploy. Turn OFF "Verify JWT" (this function checks the caller's
// token itself).
//
// Game logic below is intentionally duplicated from submit-answer's copy
// (and from js/puzzle.js on the frontend) rather than imported from a
// shared file, because the Dashboard's browser-based function editor
// deploys one self-contained file at a time.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EPS = 1e-6;
const TARGET = 24;

const LEVELS: Record<number, { min: number; max: number; allowDuplicates: boolean; minRaw: number; maxRaw: number | null; timeSeconds: number }> = {
  1: { min: 1, max: 6, allowDuplicates: false, minRaw: 10, maxRaw: null, timeSeconds: 45 },
  2: { min: 1, max: 9, allowDuplicates: false, minRaw: 6, maxRaw: null, timeSeconds: 35 },
  3: { min: 1, max: 10, allowDuplicates: true, minRaw: 1, maxRaw: null, timeSeconds: 25 },
  4: { min: 2, max: 13, allowDuplicates: true, minRaw: 1, maxRaw: 20, timeSeconds: 18 },
  5: { min: 3, max: 13, allowDuplicates: true, minRaw: 1, maxRaw: 8, timeSeconds: 12 }
};

interface Item {
  val: number;
  expr: string;
}

function search(items: Item[]): string[] {
  if (items.length === 1) {
    return Math.abs(items[0].val - TARGET) < EPS ? [items[0].expr] : [];
  }
  const results: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const a = items[i];
      const b = items[j];
      const rest = items.filter((_, idx) => idx !== i && idx !== j);
      const candidates: Item[] = [
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

function solve(numbers: number[]) {
  const items = numbers.map(n => ({ val: n, expr: String(n) }));
  const results = search(items);
  return { solvable: results.length > 0, count: results.length };
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function drawNumbers(level: number): number[] {
  const cfg = LEVELS[level];
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    let n: number;
    do {
      n = randomInt(cfg.min, cfg.max);
    } while (!cfg.allowDuplicates && nums.includes(n));
    nums.push(n);
  }
  return nums;
}

function generatePuzzle(level: number) {
  const cfg = LEVELS[level] || LEVELS[3];

  for (let attempt = 0; attempt < 400; attempt++) {
    const numbers = drawNumbers(level);
    const result = solve(numbers);
    if (!result.solvable) continue;
    if (result.count < cfg.minRaw) continue;
    if (cfg.maxRaw !== null && result.count > cfg.maxRaw) continue;
    return { level, numbers, timeSeconds: cfg.timeSeconds };
  }

  for (let attempt = 0; attempt < 400; attempt++) {
    const numbers = drawNumbers(level);
    const result = solve(numbers);
    if (result.solvable) return { level, numbers, timeSeconds: cfg.timeSeconds };
  }

  return { level, numbers: [1, 2, 3, 4], timeSeconds: cfg.timeSeconds };
}

Deno.serve(async req => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type'
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing bearer token' }), { status: 401, headers: cors });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const {
      data: { user },
      error: userErr
    } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
    }

    const body = await req.json();
    const lvl = Number(body.level);
    const sessionId = body.sessionId;
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 5) {
      return new Response(JSON.stringify({ error: 'invalid level' }), { status: 400, headers: cors });
    }
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400, headers: cors });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: session, error: sessionErr } = await adminClient
      .from('scores')
      .select('id, user_id')
      .eq('id', sessionId)
      .single();
    if (sessionErr || !session || session.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'invalid session' }), { status: 403, headers: cors });
    }

    const puzzle = generatePuzzle(lvl);

    const { data: round, error: insertErr } = await adminClient
      .from('rounds')
      .insert({
        user_id: user.id,
        session_id: sessionId,
        level: lvl,
        numbers: puzzle.numbers
      })
      .select('id')
      .single();
    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 500, headers: cors });
    }

    return new Response(
      JSON.stringify({ roundId: round.id, numbers: puzzle.numbers, timeSeconds: puzzle.timeSeconds }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
