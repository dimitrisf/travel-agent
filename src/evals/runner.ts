import 'dotenv/config';
import { MCPServerStreamableHttp } from '@openai/agents';
import { runCase } from './runCase';
import { getTurns } from './types';
import { bookingProposalNoFinalityClaim } from './cases/bookingProposalNoFinalityClaim';
import { hotelsInBerlin } from './cases/hotelsInBerlin';
import { noBookingPrereqsBeforeOptions } from './cases/noBookingPrereqsBeforeOptions';
import { offTopicPizza } from './cases/offTopicPizza';
import { onTopicFollowUpAllowed } from './cases/onTopicFollowUpAllowed';
import { optionsCountMatchesRequest } from './cases/optionsCountMatchesRequest';
import { originAskRequired } from './cases/originAskRequired';
import { sunnyWeekendFromAthens } from './cases/sunnyWeekendFromAthens';
import { verbatimHotelPrices } from './cases/verbatimHotelPrices';
import { verbatimPriceAcrossTurns } from './cases/verbatimPriceAcrossTurns';
import { weatherInBerlin } from './cases/weatherInBerlin';
import type { Case } from './types';

// Case set grows per phase. Single-turn cases first, then the multi-turn
// regressions added in Phase 4, then the Stage-9-Phase-3 guardrail case.
const CASES: Case[] = [
  weatherInBerlin,
  hotelsInBerlin,
  sunnyWeekendFromAthens,
  offTopicPizza,
  originAskRequired,
  verbatimHotelPrices,
  optionsCountMatchesRequest,
  onTopicFollowUpAllowed,
  noBookingPrereqsBeforeOptions,
  verbatimPriceAcrossTurns,
  bookingProposalNoFinalityClaim,
];

// Render a one-line tool-output summary. If `parsed` is an array, show its
// length. If it's an object, show any array-valued fields (e.g. "outbound:
// array[5], inbound: array[0]") — the shape that matters most for our
// search_* tools. Falls back to a truncated raw preview.
function summarizeToolOutput(parsed: unknown, raw: string): string {
  const preview = previewRaw(raw);
  if (Array.isArray(parsed)) {
    return `array[${parsed.length}]  ${preview}`;
  }
  if (parsed !== null && typeof parsed === 'object') {
    const shape = Object.entries(parsed as Record<string, unknown>)
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: array[${v.length}]`;
        if (v !== null && typeof v === 'object') return `${k}: object`;
        return `${k}: ${typeof v}`;
      })
      .join(', ');
    return `{${shape}}  ${preview}`;
  }
  return preview;
}

// Collapse whitespace so multi-line JSON fits on one line, then truncate.
// Keeps the log scannable while still showing enough of the raw output to
// spot the shape.
function previewRaw(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= 220) return oneLine;
  return `${oneLine.slice(0, 220)}… (${raw.length} chars total)`;
}

// Free-tier Neon compute suspends after ~5 min of inactivity ("Scale to
// Zero"), producing P1001 on the next request until it wakes. Rather than
// letting the first case eat the cold-start failure, hit a lightweight
// DB-touching endpoint up front and retry with backoff until it succeeds
// (or we give up). Retries only on 5xx — 4xx means the API is up but
// disagrees with the query, which is fine here (the DB responded).
async function warmDatabase(base: string): Promise<void> {
  const url = `${base}/api/flights?origin=ATH&destination=LHR&departure_date=2026-07-17&currency=EUR`;
  const backoffs = [500, 1000, 2000, 3000, 4000, 5000];
  const start = Date.now();
  process.stdout.write('Pre-flight: waking DB...\n');

  for (let attempt = 1; attempt <= backoffs.length + 1; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) {
        // 2xx or 4xx both prove the DB responded. Empty array on 200 is
        // fine — we only care that the round-trip completed.
        process.stdout.write(
          `Pre-flight: DB warm (attempt ${attempt}, ${Date.now() - start}ms)\n`,
        );
        return;
      }
      const body = await res.text();
      process.stdout.write(
        `Pre-flight attempt ${attempt}: HTTP ${res.status} — ${body.slice(0, 120)}\n`,
      );
    } catch (err) {
      // Fetch itself failed — dev server likely not up. Same retry policy.
      process.stdout.write(
        `Pre-flight attempt ${attempt}: fetch failed — ${(err as Error).message}\n`,
      );
    }
    const wait = backoffs[attempt - 1];
    if (wait !== undefined) {
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  process.stdout.write(
    `Pre-flight: gave up after ${Date.now() - start}ms — proceeding anyway; cases may fail.\n`,
  );
}

async function main() {
  const base =
    process.env.APP_BASE ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const mcpTravel = new MCPServerStreamableHttp({
    name: 'travel',
    url: process.env.TRAVEL_MCP_URL ?? `${base}/api/mcp/travel`,
  });
  const mcpWeather = new MCPServerStreamableHttp({
    name: 'weather',
    url: process.env.WEATHER_MCP_URL ?? `${base}/api/mcp/weather`,
  });

  try {
    await Promise.all([mcpTravel.connect(), mcpWeather.connect()]);
  } catch (err) {
    console.error(
      'Failed to connect to MCP servers. Is `npm run dev` running on :3000?',
    );
    console.error(err);
    process.exit(1);
  }

  // Wake the DB before running cases so the first case doesn't eat a
  // cold-start P1001. See warmDatabase() for the retry policy.
  await warmDatabase(base);

  // Support `npm run evals -- --case name-pattern` to run one case (or a
  // substring match) in isolation. Handy while iterating on a single fix.
  //
  // Also honor `EVALS_CASE=name-pattern` as a fallback because npm on some
  // Windows versions strips arbitrary flags between `--` and the script,
  // even when they shouldn't be npm-owned (`--brief`, `--case ...` have
  // both been observed to disappear on npm 10.9.2). Env vars survive.
  const filterArg = process.argv.indexOf('--case');
  const filter =
    filterArg >= 0
      ? process.argv[filterArg + 1]
      : process.env.EVALS_CASE || undefined;

  // `--brief` (or `EVALS_BRIEF=1`) skips the agent-output dump for cases
  // where every assertion passed. Failing cases still print their full
  // context (that's when you actually need it). Default stays chatty
  // because the extra info is usually helpful while iterating on a new
  // case.
  const brief =
    process.argv.includes('--brief') || process.env.EVALS_BRIEF === '1';

  const selected = filter
    ? CASES.filter((c) => c.name.includes(filter))
    : CASES;

  if (filter && selected.length === 0) {
    console.error(`No cases matched --case "${filter}".`);
    process.exit(1);
  }

  // Announce the effective selection up front so it's obvious when args
  // got stripped by npm (see comment on `--full` below) — if you expected
  // one case and see three, the arg-forwarding was mangled.
  const filterInfo = filter ? ` (filter: "${filter}")` : ' (no filter)';
  const modeInfo = brief ? ' [brief]' : '';
  process.stdout.write(
    `Running ${selected.length} of ${CASES.length} case(s)${filterInfo}${modeInfo}: ${selected.map((c) => c.name).join(', ')}\n`,
  );

  let totalAsserts = 0;
  let failedAsserts = 0;
  // Track per-case failure counts so the end-of-run summary can say
  // "name (2/5 failed)" instead of just listing names — that lets you
  // triage which failure is worst without scrolling back.
  const failedCases: Array<{ name: string; failed: number; total: number }> =
    [];

  for (const c of selected) {
    process.stdout.write(`\n▶ ${c.name}\n  ${c.description}\n`);
    // Wall-clock per case. Useful for spotting slow cases (Neon cold-start,
    // big searches) without a separate profiler.
    const t0 = Date.now();
    const out = await runCase(c, mcpTravel, mcpWeather);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    const results = c.expect(out);
    let caseFailed = 0;
    for (const r of results) {
      totalAsserts++;
      const icon = r.passed ? '  ✓' : '  ✗';
      process.stdout.write(`${icon} ${r.description}\n`);
      if (!r.passed) {
        failedAsserts++;
        caseFailed++;
        if (r.details) process.stdout.write(`      ${r.details}\n`);
      }
    }
    process.stdout.write(`  (${elapsedSec}s)\n`);
    if (caseFailed > 0) {
      failedCases.push({ name: c.name, failed: caseFailed, total: results.length });
    }

    // Skip the agent-output block on green passes when --brief is set.
    // Failing cases always print it — that's the whole point of having it.
    if (brief && caseFailed === 0) {
      continue;
    }

    process.stdout.write(`\n  ── agent output ──\n`);
    // Print each turn's user input so multi-turn cases show the whole
    // conversation flow. Single-turn cases still get "User: ..." (turn count 1).
    const turns = getTurns(c);
    if (turns.length === 1) {
      process.stdout.write(`  User: ${turns[0]}\n`);
    } else {
      turns.forEach((t, i) => {
        process.stdout.write(`  User (turn ${i + 1}/${turns.length}): ${t}\n`);
      });
    }
    process.stdout.write(`  Last agent: ${out.lastAgent}\n`);
    if (out.guardrailTripped) {
      process.stdout.write(`  Guardrail tripped: ${out.guardrailTripped}\n`);
    }
    if (out.errored) {
      process.stdout.write(`  Errored: ${out.errored}\n`);
    }
    process.stdout.write(`  Tool calls (${out.toolCalls.length}):\n`);
    for (const tc of out.toolCalls) {
      const argsStr = JSON.stringify(tc.args);
      const shortArgs =
        argsStr.length > 120 ? argsStr.slice(0, 120) + '…' : argsStr;
      process.stdout.write(`    - ${tc.agent} → ${tc.name}(${shortArgs})\n`);
      // Also surface a compact summary of the tool output — e.g. so a
      // "search returned 5 flights but the summary listed 1" mismatch is
      // visible at a glance without re-running with a debugger.
      if (tc.output != null) {
        process.stdout.write(
          `        → ${summarizeToolOutput(tc.parsedOutput, tc.output)}\n`,
        );
      }
    }
    process.stdout.write(`  Final message:\n`);
    // Indent every line of the final message by 4 spaces so it visually
    // sits under the "Final message:" label.
    const indented = out.finalText
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    process.stdout.write(indented + '\n');
    process.stdout.write(`  ── end agent output ──\n`);
  }

  process.stdout.write(
    `\n${totalAsserts - failedAsserts}/${totalAsserts} assertions passed across ${selected.length} case(s).\n`,
  );
  if (failedCases.length > 0) {
    // One line per failed case with its own pass/fail ratio, so the
    // summary tells you where to look first when several cases fail.
    process.stdout.write(`Failed cases:\n`);
    for (const fc of failedCases) {
      process.stdout.write(
        `  - ${fc.name} (${fc.failed}/${fc.total} failed)\n`,
      );
    }
    process.exit(1);
  } else {
    process.stdout.write('All cases passed.\n');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
