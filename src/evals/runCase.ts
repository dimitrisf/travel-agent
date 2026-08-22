import {
  type AgentInputItem,
  InputGuardrailTripwireTriggered,
  MCPServerStreamableHttp,
  OutputGuardrailTripwireTriggered,
  run,
} from '@openai/agents';
import { buildAgentGraph } from '../agents/buildAgentGraph';
import { newAgentRunContext } from '../agents/agentRunContext';
import { runWithBackoff } from './runWithBackoff';
import { getTurns } from './types';
import type { Case, CaseOutput } from './types';
import { unwrapToolOutput } from '@/utils/toolOutput';

// Run one case end-to-end through a fresh agent graph, collect what it did
// (tool calls, final text, which agent finished, guardrail trip, or any
// unexpected error), and return that as a CaseOutput. The caller then hands
// this to the case's `expect(...)` for assertion checking.
//
// Uses non-streaming `run()` — the harness cares about the finished state,
// not intermediate events. RunResult exposes everything we need via
// `newItems`, `finalOutput`, and `lastAgent`.
export async function runCase(
  caseDef: Case,
  mcpTravel: MCPServerStreamableHttp,
  mcpWeather: MCPServerStreamableHttp,
): Promise<CaseOutput> {
  const agent = buildAgentGraph(mcpTravel, mcpWeather);

  const toolCalls: CaseOutput['toolCalls'] = [];
  let finalText = '';
  let lastAgent = '';
  let guardrailTripped: string | undefined;
  let errored: string | undefined;
  // Accumulates 429 retries across every turn. Surfaced on the case's
  // timing line by the runner so chronic TPM offenders stay visible
  // even when the case passes on retry.
  let totalRetries = 0;

  try {
    // Loop over the case's turns (single-turn cases still take this path
    // with a one-entry array — see `getTurns`). Each turn is a fresh `run`
    // call with the accumulated history prepended, mirroring how the app's
    // /api/agent route continues a conversation. `result.history` gives us
    // the full conversation to thread into the next turn.
    const turns = getTurns(caseDef);
    let history: AgentInputItem[] = [];

    // Pair tool calls with their outputs by callId, across all turns.
    // `tool_call_item` and its matching `tool_call_output_item` may not be
    // adjacent in `newItems` (parallel tool calls can interleave), so we
    // track each call's index-in-toolCalls by its callId and splice the
    // output back in when it arrives. callIds are globally unique, so one
    // map across turns is safe.
    // For example, a case with two turns might produce this sequence of newItems:
    //   turn 1: tool_call_item (callId=1)
    //   turn 1: tool_call_output_item (callId=1)
    //   turn 2: tool_call_item (callId=2)
    //   turn 2: tool_call_item (callId=3)
    //   turn 2: tool_call_output_item (callId=3)
    //   turn 2: tool_call_output_item (callId=2)
    // The map lets us pair each output with its call, even when the order is
    // not sequential.
    // In the above example, the final toolCalls array would be:
    //   [
    //     { name: ..., args: ..., agent: ..., output: ..., parsedOutput: ... }, // callId=1
    //     { name: ..., args: ..., agent: ..., output: ..., parsedOutput: ... }, // callId=2
    //     { name: ..., args: ..., agent: ..., output: ..., parsedOutput: ... }, // callId=3
    //   ]
    // indexByCallId will eventually contain { '1' => 0, '2' => 1, '3' => 2 }.
    const indexByCallId = new Map<string, number>();

    // Shared AgentRunContext threaded through every turn's run() call.
    // Its `toolCallCollector` is populated by the `agent_tool_end` hook
    // attached in buildTravelAgent, and consumed by the cross-reference
    // output guardrail (Stage 11). Same instance every turn so the
    // guardrail sees the full history, not just the current turn.
    const runCtx = newAgentRunContext();

    // E.g, turns = ['What is the weather in Athens?', 'What about tomorrow?']
    for (const userText of turns) {
      // result is of type RunResult, which has `newItems`, `finalOutput`,
      // `lastAgent`, and `history` (the accumulated conversation).
      // E.g, result = {
      //   newItems: [...],
      //   finalOutput: 'The weather in Athens is sunny.',
      //   lastAgent: { name: 'weather-agent', ... },
      //   history: [...],
      // }
      //
      // Wrapped in runWithBackoff (Stage 17.6) — the OpenAI 30k gpt-4o
      // TPM ceiling used to fail cancel-proposed-booking-happy-path
      // deep in the case list because prior cases had eaten most of
      // the rolling 60s window. Now we retry up to 3 times with the
      // wait-time OpenAI reports in the error body ("try again in Xs"),
      // making TPM saturation transparent to the report. Retries are
      // logged inline so a chronic offender is still visible.
      const { value: result, retries } = await runWithBackoff(
        () =>
          run(agent, [...history, { role: 'user', content: userText }], {
            context: runCtx,
          }),
        {
          onRetry: (attempt, waitMs) => {
            process.stderr.write(
              `    ⚠ 429 rate limit — waiting ${waitMs}ms before retry ${attempt}\n`,
            );
          },
        },
      );
      totalRetries += retries;

      // E.g, result.newItems = [
      //   { type: 'tool_call_item', rawItem: { name: 'get_weather', arguments: '{"city":"Athens"}', callId: '1' }, agent: { name: 'weather-agent', ... } },
      //   { type: 'tool_call_output_item', rawItem: { callId: '1' }, output: '{"temperature":25,"condition":"sunny"}', agent: { name: 'weather-agent', ... } },
      // ]
      for (const item of result.newItems) {
        if (item.type === 'tool_call_item') {
          recordToolCall(item, toolCalls, indexByCallId);
        } else if (item.type === 'tool_call_output_item') {
          attachToolCallOutput(item, toolCalls, indexByCallId);
        }
      }

      // After each turn, `finalText` and `lastAgent` reflect the LAST turn.
      // That's what `expect` will see — same shape as single-turn cases.
      finalText = (result.finalOutput as string | undefined) ?? '';
      lastAgent = result.lastAgent?.name ?? '(unknown)';
      // Thread the conversation history into the next turn so the agent can
      // see the prior context. This is how the app's /api/agent route works.
      history = result.history;
    }

    // Fold tool-level errors into `errored` so cases don't pass vacuously
    // when the tool returned an error envelope (e.g. Neon idle → 500 →
    // `{error, code}`). Without this, downstream assertions like "options
    // equal min(requested, available)" collapse to 0 === 0 and mask the
    // real failure. Only the standard `{error: string, code: string}` shape
    // from apiErrorResponse counts — anything else stays a normal output.
    const toolErrors = collectToolErrors(toolCalls);
    if (toolErrors.length > 0) {
      const toolErrPart = `tool errors: ${toolErrors.join('; ')}`;
      errored = errored ? `${errored} | ${toolErrPart}` : toolErrPart;
    }
  } catch (err) {
    const classified = classifyThrownError(err);
    guardrailTripped = classified.guardrailTripped;
    errored = classified.errored;
  }

  // Return the accumulated output for this case, which the caller will hand to the case's `expect(...)` for assertion checking.
  return {
    toolCalls,
    finalText,
    lastAgent,
    guardrailTripped,
    errored,
    // Accumulated 429 retries across all turns. Surfaced on the case's
    // timing line by the runner so chronic TPM offenders stay visible
    // even when the case passes on retry.
    retries: totalRetries,
  };
}

// Record a tool_call_item into toolCalls and index its callId so the
// matching tool_call_output_item can be spliced back on when it arrives.
function recordToolCall(
  item: { rawItem: unknown; agent: { name: string } },
  toolCalls: CaseOutput['toolCalls'],
  indexByCallId: Map<string, number>,
): void {
  // rawItem has `name` and `arguments` (a JSON string in the standard
  // OpenAI format). Parse args when we can so cases can assert on
  // structured content (e.g. `args.return_date`).
  // E.g, rawItem = { name: 'get_weather', arguments: '{"city":"Athens"}', callId: '1' }
  // So, in this example, raw is { name: 'get_weather', arguments: '{"city":"Athens"}', callId: '1' }
  const raw = item.rawItem as {
    name?: string;
    arguments?: unknown;
    callId?: string;
    call_id?: string;
    id?: string;
  };

  const callId = raw.callId ?? raw.call_id ?? raw.id;

  // E.g, raw.arguments = '{"city":"Athens"}' (a JSON string) or just 'Athens' (a plain string).
  let args: unknown = raw.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // leave as string
    }
  }

  // At this point, args = { city: 'Athens' } (a parsed object) or just 'Athens' (a plain string).

  // Record the tool call in the output so cases can assert on it.
  // We have to subtract 1 because push() returns the new length, not the index.
  const index =
    toolCalls.push({
      name: raw.name ?? '(unknown)',
      args,
      agent: item.agent.name,
    }) - 1;

  if (callId) indexByCallId.set(callId, index);
  // now indexByCallId = { '1' => 0 } for this example, so when the output arrives we can pair it with its call.
}

// Pair a tool_call_output_item back onto its tool_call by callId.
// `unwrapToolOutput` strips the MCP content envelope down to the raw
// string the REST API returned; best-effort JSON parse into
// `parsedOutput` for structured asserts.
function attachToolCallOutput(
  item: { rawItem: unknown; output: unknown },
  toolCalls: CaseOutput['toolCalls'],
  indexByCallId: Map<string, number>,
): void {
  // In this case, item.rawItem = { callId: '1' } and item.output = '{"temperature":25,"condition":"sunny"}'.
  const outRaw = item.rawItem as {
    callId?: string;
    call_id?: string;
    id?: string;
  };

  const callId = outRaw.callId ?? outRaw.call_id ?? outRaw.id;

  // E.g, if item.output = '{"temperature":25,"condition":"sunny"}', then output = '{"temperature":25,"condition":"sunny"}' (a string) and parsedOutput = { temperature: 25, condition: 'sunny' } (an object).
  const output = unwrapToolOutput(item.output);
  let parsedOutput: unknown = undefined;
  try {
    parsedOutput = JSON.parse(output);
  } catch {
    // leave undefined — tool returned non-JSON text
  }

  // Pair the output with its call in toolCalls. If we can't find the callId, we just skip it — this shouldn't happen unless the MCP is misbehaving.
  const idx = callId ? indexByCallId.get(callId) : undefined;
  if (idx !== undefined) {
    toolCalls[idx] = { ...toolCalls[idx], output, parsedOutput };
  }
}

// Scan toolCalls for the standard `{error, code}` error envelope from
// apiErrorResponse and format each as "name → code: error". Anything
// else stays a normal output.
//
// E.g, toolCalls = [
//   { name: 'get_weather', args: { city: 'Athens' }, agent: 'weather-agent', output: '{"temperature":25,"condition":"sunny"}', parsedOutput: { temperature: 25, condition: 'sunny' } },
//   { name: 'get_forecast', args: { city: 'Athens', days: 3 }, agent: 'weather-agent', output: '{"error":"City not found","code":"404"}', parsedOutput: { error: 'City not found', code: '404' } },
// ]
// In this example, the second tool call returned an error envelope, so we fold that into `errored` for the case output.
// In this particular example, toolErrors = ['get_forecast → 404: City not found'], and errored = 'tool errors: get_forecast → 404: City not found'.
function collectToolErrors(toolCalls: CaseOutput['toolCalls']): string[] {
  return toolCalls
    .filter(
      (tc) =>
        tc.parsedOutput != null &&
        typeof tc.parsedOutput === 'object' &&
        'error' in (tc.parsedOutput as object) &&
        'code' in (tc.parsedOutput as object),
    )
    .map((tc) => {
      const p = tc.parsedOutput as { error?: unknown; code?: unknown };
      return `${tc.name} → ${String(p.code)}: ${String(p.error)}`;
    });
}

// Classify a thrown error into either a guardrail trip (expected
// outcome for some cases — surface as first-class output) or an
// unexpected error (network, MCP, model call, etc. — surfaced as
// `errored` so cases can assert on them if desired).
function classifyThrownError(err: unknown): {
  guardrailTripped?: string;
  errored?: string;
} {
  // Guardrail trips are expected outcomes for some cases — surface them
  // as first-class output rather than errors so cases can assert on them.
  if (
    err instanceof InputGuardrailTripwireTriggered ||
    err instanceof OutputGuardrailTripwireTriggered
  ) {
    // The guardrail trip message is in `err.result.output.outputInfo.message`
    const info = err.result?.output?.outputInfo as
      | { message?: unknown }
      | undefined;

    // If the message is a string, use it; otherwise, fall back to the error's message.
    return {
      guardrailTripped:
        typeof info?.message === 'string' ? info.message : err.message,
    };
  }
  // Unexpected errors (network, MCP, model call, etc.) are surfaced as
  // `errored` so cases can assert on them if desired.
  return { errored: (err as Error)?.message ?? String(err) };
}
