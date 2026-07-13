import 'dotenv/config';
import { MCPServerStreamableHttp } from '@openai/agents';
import { runCase } from './runCase';
import { hotelsInBerlin } from './cases/hotelsInBerlin';
import { offTopicPizza } from './cases/offTopicPizza';
import { sunnyWeekendFromAthens } from './cases/sunnyWeekendFromAthens';
import { weatherInBerlin } from './cases/weatherInBerlin';
import type { Case } from './types';

// The Phase 1 case set. Each phase of Stage 10 adds cases; multi-turn cases
// and the full regression suite land in Phases 3 and 4.
const CASES: Case[] = [
  weatherInBerlin,
  hotelsInBerlin,
  sunnyWeekendFromAthens,
  offTopicPizza,
];

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

  // Support `npm run evals -- --case name-pattern` to run one case (or a
  // substring match) in isolation. Handy while iterating on a single fix.
  const filterArg = process.argv.indexOf('--case');
  const filter = filterArg >= 0 ? process.argv[filterArg + 1] : undefined;
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
  process.stdout.write(
    `Running ${selected.length} of ${CASES.length} case(s)${filterInfo}: ${selected.map((c) => c.name).join(', ')}\n`,
  );

  // We always dump the full agent output (final message + tool calls +
  // last agent) after each case — pass or fail — so you can eyeball what
  // the model actually said without needing to remember a flag. If this
  // ever gets too noisy, add a `--brief` opt-out.

  let totalAsserts = 0;
  let failedAsserts = 0;
  const failedCases: string[] = [];

  for (const c of selected) {
    process.stdout.write(`\n▶ ${c.name}\n  ${c.description}\n`);
    const out = await runCase(c, mcpTravel, mcpWeather);
    const results = c.expect(out);
    let caseFailed = false;
    for (const r of results) {
      totalAsserts++;
      const icon = r.passed ? '  ✓' : '  ✗';
      process.stdout.write(`${icon} ${r.description}\n`);
      if (!r.passed) {
        failedAsserts++;
        caseFailed = true;
        if (r.details) process.stdout.write(`      ${r.details}\n`);
      }
    }
    if (caseFailed) failedCases.push(c.name);

    process.stdout.write(`\n  ── agent output ──\n`);
    process.stdout.write(`  User: ${c.user}\n`);
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
    process.stdout.write(`Failed cases: ${failedCases.join(', ')}\n`);
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
