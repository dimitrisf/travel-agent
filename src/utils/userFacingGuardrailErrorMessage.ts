import {
  InputGuardrailTripwireTriggered,
  OutputGuardrailTripwireTriggered,
} from '@openai/agents';

// Translate a thrown error into a user-facing string. For guardrail tripwires
// the SDK's default `.message` is a JSON dump like:
//   'Input guardrail triggered: {"verdict":"OFF_TOPIC","userText":"…","message":"…"}'
// which we'd rather not put in front of a user. Our own guardrails put a
// friendly sentence in `outputInfo.message` — pull that out instead when
// present. Anything that isn't a guardrail trip falls through to the standard
// `.message` (or a String coercion as a last resort).
//
// Phase 5 of the Guardrails stage will replace this with a dedicated
// `guardrail_blocked` SSE frame and matching UI treatment; until then this
// helper feeds a plain `'error'` frame.
export function userFacingGuardrailErrorMessage(err: unknown): string {
  if (
    err instanceof InputGuardrailTripwireTriggered ||
    err instanceof OutputGuardrailTripwireTriggered
  ) {
    const info = err.result?.output?.outputInfo as
      | { message?: unknown }
      | undefined;
    if (typeof info?.message === 'string') return info.message;
  }
  return (err as Error)?.message ?? String(err);
}
