// submit-answer — Supabase Edge Function
// Verifies a Challenge answer against the round issued by new-round and
// awards score server-side. The client never decides whether an answer
// is correct or how many points it's worth — it just submits the built
// expression and this function is the sole source of truth.
//
// Deploy via Supabase Dashboard → Edge Functions → Deploy a new function
// → Via Editor → name it exactly "submit-answer" → paste this file's
// content → Deploy. Turn OFF "Verify JWT".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EPS = 1e-6;
const TARGET = 24;

const LEVEL_TIME_SECONDS: Record<number, number> = { 1: 45, 2: 35, 3: 25, 4: 18, 5: 12 };
const LEVEL_MULTIPLIER: Record<number, number> = { 1: 1, 2: 1.2, 3: 1.5, 4: 2, 5: 3 };
const BASE_SCORE = 100;
const MAX_TIME_BONUS = 50;
const STREAK_STEP = 10;
const STREAK_CAP = 10;
const MAX_WRONG_ATTEMPTS = 8;

interface Token {
  type: 'num' | 'op' | 'paren';
  value: number | string;
}

function evaluateTokens(tokens: Token[]): number {
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const output: Token[] = [];
  const opStack: Token[] = [];

  for (const t of tokens) {
    if (t.type === 'num') {
      output.push(t);
    } else if (t.type === 'op') {
      while (
        opStack.length &&
        opStack[opStack.length - 1].type === 'op' &&
        prec[opStack[opStack.length - 1].value as string] >= prec[t.value as string]
      ) {
        output.push(opStack.pop()!);
      }
      opStack.push(t);
    } else if (t.value === '(') {
      opStack.push(t);
    } else if (t.value === ')') {
      while (opStack.length && opStack[opStack.length - 1].value !== '(') {
        output.push(opStack.pop()!);
      }
      opStack.pop();
    }
  }
  while (opStack.length) output.push(opStack.pop()!);

  const stack: number[] = [];
  for (const t of output) {
    if (t.type === 'num') {
      stack.push(t.value as number);
      continue;
    }
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    switch (t.value) {
      case '+':
        stack.push(a + b);
        break;
      case '-':
        stack.push(a - b);
        break;
      case '*':
        stack.push(a * b);
        break;
      case '/':
        if (Math.abs(b) < EPS) throw new Error('DIV_ZERO');
        stack.push(a / b);
        break;
    }
  }
  return stack[0];
}

function isTwentyFour(value: number): boolean {
  return Math.abs(value - TARGET) < EPS;
}

function calcAnswerScore(remainingMs: number, totalMs: number, streak: number, level: number) {
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const timeBonus = Math.round(MAX_TIME_BONUS * ratio);
  const streakBonus = Math.min(streak, STREAK_CAP) * STREAK_STEP;
  const multiplier = LEVEL_MULTIPLIER[level] || 1;
  return Math.round((BASE_SCORE + timeBonus + streakBonus) * multiplier);
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
    const roundId = body.roundId;
    const tokens: Token[] = Array.isArray(body.tokens) ? body.tokens : [];
    if (!roundId || !tokens.length) {
      return new Response(JSON.stringify({ error: 'roundId and tokens are required' }), { status: 400, headers: cors });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: round, error: roundErr } = await adminClient
      .from('rounds')
      .select('*')
      .eq('id', roundId)
      .single();
    if (roundErr || !round || round.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'invalid round' }), { status: 403, headers: cors });
    }
    if (round.used) {
      return new Response(JSON.stringify({ error: 'round already answered' }), { status: 400, headers: cors });
    }

    const submittedNums = tokens
      .filter(t => t.type === 'num')
      .map(t => t.value as number)
      .sort((a, b) => a - b);
    const issuedNums = [...(round.numbers as number[])].sort((a, b) => a - b);
    const numbersMatch =
      submittedNums.length === issuedNums.length && submittedNums.every((n, i) => n === issuedNums[i]);

    let result: number | null = null;
    if (numbersMatch) {
      try {
        result = evaluateTokens(tokens);
      } catch {
        result = null;
      }
    }
    const correct = numbersMatch && result !== null && isTwentyFour(result);

    // Only a CORRECT answer consumes the round. A wrong guess does NOT
    // set used=true — the frontend lets a player retry the same question
    // after a wrong answer (timer keeps running), so the round must stay
    // submittable until it's actually solved.
    //
    // The claim itself is atomic (UPDATE ... WHERE used = false): if two
    // requests for the same round race each other, only one can flip
    // used to true and get rows back — the loser sees claimed === null
    // and must not award points, closing a double-submit race that a
    // SELECT-then-UPDATE sequence would be vulnerable to.
    if (correct) {
      const { data: claimed, error: claimErr } = await adminClient
        .from('rounds')
        .update({ used: true, correct: true, answered_at: new Date().toISOString() })
        .eq('id', roundId)
        .eq('used', false)
        .select('id')
        .maybeSingle();
      if (claimErr || !claimed) {
        return new Response(JSON.stringify({ error: 'round already answered' }), { status: 400, headers: cors });
      }
    }

    const { data: session, error: sessionErr } = await adminClient
      .from('scores')
      .select('*')
      .eq('id', round.session_id)
      .single();
    if (sessionErr || !session || session.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'invalid session' }), { status: 403, headers: cors });
    }

    const durationMs = Date.now() - new Date(session.created_at).getTime();

    if (!correct) {
      // Wrong guesses don't consume the round (a genuine player can keep
      // retrying) — but with no cap, a script could brute-force every
      // possible expression from the 4 visible numbers by hammering this
      // endpoint until one happens to be correct, using the server as a
      // free solver. A real player essentially never needs more than a
      // handful of wrong tries on one puzzle, so capping it forces the
      // round to end (and the player to move on) long before brute force
      // could explore a meaningful fraction of the search space.
      const newWrongAttempts = (round.wrong_attempts || 0) + 1;
      const roundOver = newWrongAttempts >= MAX_WRONG_ATTEMPTS;

      await adminClient
        .from('rounds')
        .update(
          roundOver
            ? { wrong_attempts: newWrongAttempts, used: true, correct: false, answered_at: new Date().toISOString() }
            : { wrong_attempts: newWrongAttempts }
        )
        .eq('id', roundId);

      await adminClient
        .from('scores')
        .update({ wrong: session.wrong + 1, current_streak: 0, duration_ms: durationMs })
        .eq('id', session.id);

      return new Response(JSON.stringify({ correct: false, roundOver }), { status: 200, headers: cors });
    }

    const totalMs = (LEVEL_TIME_SECONDS[round.level] || 25) * 1000;
    const elapsedMs = Date.now() - new Date(round.created_at).getTime();
    const remainingMs = Math.max(0, totalMs - elapsedMs);
    const newStreak = session.current_streak + 1;
    const gained = calcAnswerScore(remainingMs, totalMs, newStreak, round.level);

    const newScore = session.score + gained;
    const newBestStreak = Math.max(session.best_streak, newStreak);

    await adminClient
      .from('scores')
      .update({
        score: newScore,
        correct: session.correct + 1,
        current_streak: newStreak,
        best_streak: newBestStreak,
        duration_ms: durationMs
      })
      .eq('id', session.id);

    return new Response(JSON.stringify({ correct: true, gained, newScore, newStreak }), {
      status: 200,
      headers: cors
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
