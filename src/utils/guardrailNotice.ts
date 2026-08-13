import type { AgentInputItem } from '@openai/agents';

// The single source of truth for the "guardrail notice" AgentInputItem
// shape (Stage 22 backlog #2a). Not part of the SDK's item vocabulary
// — it's OUR custom marker that lets the guardrail-blocked turn:
//   - persist to the DB (via `buildGuardrailBlockedItems`)
//   - hydrate back into a bubble WITH `blockedBy` styling on refresh
//     (via `hydrateChatMessages`)
//
// Because the SDK doesn't know about this shape, any code path that
// hands history to `run()` MUST strip these items first, or the SDK
// may reject the whole turn. Use `stripGuardrailNoticesFromHistory`
// for that — it's the single-point enforcement of the invariant.

// Discriminator value stored in the `type` field.
export const GUARDRAIL_NOTICE_TYPE = 'guardrail_notice';

// Shape of a guardrail-notice item as it lives in the DB and in the
// client-side AgentInputItem[] history state.
export type GuardrailNoticeItem = {
  type: typeof GUARDRAIL_NOTICE_TYPE;
  kind: 'input' | 'output';
  message: string;
};

// Type-guard. Loose on purpose — we accept any object whose `type`
// field matches, since items arrive as JSON-parsed unknowns from the
// DB and we can't rely on prototype chains.
export function isGuardrailNotice(item: unknown): item is GuardrailNoticeItem {
  return (
    // !! is a cheap null/undefined check, and also narrows to object
    !!item &&
    typeof item === 'object' &&
    (item as { type?: unknown }).type === GUARDRAIL_NOTICE_TYPE
  );
}

// Remove all guardrail_notice items from an AgentInputItem[] before it
// gets handed to the SDK's `run()`. The SDK doesn't recognize our
// custom shape and may error / drop the whole turn if it sees one.
//
// Not just belt-and-braces: on refresh, the hydrator loads the DB
// history verbatim into the client's `history` state — including any
// guardrail_notice items. That history flows back to the server on
// the next user prompt, and would reach `run()` unfiltered without
// this helper.
export function stripGuardrailNoticesFromHistory(
  history: AgentInputItem[],
): AgentInputItem[] {
  return history.filter((item) => !isGuardrailNotice(item));
}
