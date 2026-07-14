import {
  InputGuardrailTripwireTriggered,
  MCPServerStreamableHttp,
  OutputGuardrailTripwireTriggered,
  run,
} from '@openai/agents';
import { buildAgentGraph } from '../agents/buildAgentGraph';
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

  try {
    // result is of type RunResult, which has `newItems`, `finalOutput`, and `lastAgent`.
    // newItems is an array of RunItem, which can be ToolCallItem, ModelOutputItem, or other types.
    // finalOutput is the final output of the run, which can be a string or undefined.
    // lastAgent is the agent that produced the final output, which can be undefined.
    const result = await run(agent, [{ role: 'user', content: caseDef.user }]);

    // Pair tool calls with their outputs by callId. `tool_call_item` and
    // its matching `tool_call_output_item` may not be adjacent in
    // `newItems` (parallel tool calls can interleave), so we track each
    // call's index-in-toolCalls by its callId and splice the output back
    // in when it arrives.
    const indexByCallId = new Map<string, number>();
    for (const item of result.newItems) {
      if (item.type === 'tool_call_item') {
        // rawItem has `name` and `arguments` (a JSON string in the standard
        // OpenAI format). Parse args when we can so cases can assert on
        // structured content (e.g. `args.return_date`).
        const raw = item.rawItem as {
          name?: string;
          arguments?: unknown;
          callId?: string;
          call_id?: string;
          id?: string;
        };
        const callId = raw.callId ?? raw.call_id ?? raw.id;
        let args: unknown = raw.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            // leave as string
          }
        }

        // Record the tool call in the output so cases can assert on it.
        const index =
          toolCalls.push({
            name: raw.name ?? '(unknown)',
            args,
            agent: item.agent.name,
          }) - 1;
        if (callId) indexByCallId.set(callId, index);
      } else if (item.type === 'tool_call_output_item') {
        // Pair the output with its call. `unwrapToolOutput` strips the MCP
        // content envelope down to the raw string the REST API returned;
        // best-effort JSON parse into `parsedOutput` for structured asserts.
        const outRaw = item.rawItem as {
          callId?: string;
          call_id?: string;
          id?: string;
        };
        const callId = outRaw.callId ?? outRaw.call_id ?? outRaw.id;
        const output = unwrapToolOutput(item.output);
        let parsedOutput: unknown = undefined;
        try {
          parsedOutput = JSON.parse(output);
        } catch {
          // leave undefined — tool returned non-JSON text
        }
        const idx = callId ? indexByCallId.get(callId) : undefined;
        if (idx !== undefined) {
          toolCalls[idx] = { ...toolCalls[idx], output, parsedOutput };
        }
      }
    }

    finalText = (result.finalOutput as string | undefined) ?? '';
    lastAgent = result.lastAgent?.name ?? '(unknown)';

    // Fold tool-level errors into `errored` so cases don't pass vacuously
    // when the tool returned an error envelope (e.g. Neon idle → 500 →
    // `{error, code}`). Without this, downstream assertions like "options
    // equal min(requested, available)" collapse to 0 === 0 and mask the
    // real failure. Only the standard `{error: string, code: string}` shape
    // from apiErrorResponse counts — anything else stays a normal output.
    const toolErrors = toolCalls
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
    if (toolErrors.length > 0) {
      const toolErrPart = `tool errors: ${toolErrors.join('; ')}`;
      errored = errored ? `${errored} | ${toolErrPart}` : toolErrPart;
    }
  } catch (err) {
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
      guardrailTripped =
        typeof info?.message === 'string' ? info.message : err.message;
    } else {
      // Unexpected errors (network, MCP, model call, etc.) are surfaced as
      // `errored` so cases can assert on them if desired.
      errored = (err as Error)?.message ?? String(err);
    }
  }

  return { toolCalls, finalText, lastAgent, guardrailTripped, errored };
}
