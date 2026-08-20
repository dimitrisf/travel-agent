import type { AgentInputItem } from '@openai/agents';
import type { Prisma } from '@prisma/client';
import type {
  ConversationRepository,
  ConversationSummary,
  ConversationWithMessages,
} from '../repositories/ConversationRepository';
import { userTurnContentText } from '../../utils/userTurnContentText';
import { ConversationServiceError } from './ConversationServiceError';
import { internalErrorFactory } from './CodedServiceError';

// Public shape of a loaded conversation — metadata + a decoded history
// array ready to feed into the agent's run() call. Callers don't touch
// raw Message rows.
export type LoadedConversation = {
  id: string;
  userId: string;
  title: string | null;
  shared: boolean;
  createdAt: Date;
  updatedAt: Date;
  history: AgentInputItem[];
};

// Viewer-side variant. Same fields plus a computed isOwner flag. Callers
// use isOwner to decide UI affordances (Share button visible? input
// disabled? banner shown?) without re-comparing viewerId to userId.
export type ConversationView = LoadedConversation & { isOwner: boolean };

// Title auto-generated from the first user message. Kept short so it fits
// the header dropdown's single-line row. Newlines collapsed to spaces.
const TITLE_MAX_LENGTH = 60;

// Derive a title from the first user message in the seed history. Returns
// null if no user message is found or the first user message is empty.
// E.g, items = [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]
// then returns 'Hello'. If the first user message is longer than TITLE_MAX_LENGTH, it truncates and adds an ellipsis.
function deriveTitle(items: AgentInputItem[]): string | null {
  for (const item of items) {
    const raw = extractUserTurnText(item);
    if (raw === null) continue;
    // First, collapse whitespace and trim so we don't return a title of just spaces or newlines. Then, if the text is too long, truncate and add an ellipsis.
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // Iterate by code point (Array.from uses the string iterator) —
    // NOT by UTF-16 code unit. `text.slice(0, N)` operates on code
    // units and can split a surrogate pair mid-emoji, leaving a lone
    // high-surrogate at the end. That surfaces as `�` in the header
    // dropdown and gets rejected by strict JSON serializers. Length
    // check moves to codePoints.length for the same reason. Complex
    // grapheme clusters (ZWJ sequences, flag emojis) can still split,
    // but no invalid code unit ever ships.
    const codePoints = Array.from(text);
    return codePoints.length > TITLE_MAX_LENGTH
      ? codePoints.slice(0, TITLE_MAX_LENGTH - 1).join('') + '…'
      : text;
  }
  return null;
}

// Wraps the shared content-text helper (see userTurnContentText.ts) with
// the role check and null semantics deriveTitle wants. Reading through
// `unknown` deliberately avoids coupling to AgentInputItem's user-turn
// variant — the SDK's typed content union changes across versions.
function extractUserTurnText(item: AgentInputItem): string | null {
  if (!item || typeof item !== 'object') return null;

  const shape = item as { role?: unknown; content?: unknown };

  if (shape.role !== 'user') return null;

  const text = userTurnContentText(shape.content);

  return text.length > 0 ? text : null;
}

export class ConversationService {
  constructor(private readonly repo: ConversationRepository) {}

  // Load an existing conversation for a viewer. Access rules:
  //   - owner (signed in as userId matching row.userId) → always allowed
  //   - anyone else (signed-in OR anon) → allowed IF row.shared === true
  //   - otherwise → returns null (caller renders 404, no info leak)
  //
  // Returns null rather than throwing so the /c/[id] page can distinguish
  // "not viewable" from "some other error" and choose 404 vs redirect
  // vs throw at the boundary.
  async loadForViewer(input: {
    id: string;
    viewerId: string | null;
  }): Promise<ConversationView | null> {
    let row: ConversationWithMessages | null;
    try {
      row = await this.repo.findById(input.id);
    } catch (err) {
      throw internal('Failed to load conversation.', err);
    }
    if (!row) return null;

    const isOwner = input.viewerId !== null && row.userId === input.viewerId;
    if (!isOwner && !row.shared) return null;

    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      shared: row.shared,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      history: extractHistory(row),
      isOwner,
    };
  }

  async listForUser(input: {
    userId: string;
    limit?: number;
  }): Promise<ConversationSummary[]> {
    try {
      return await this.repo.listByUser(input.userId, { limit: input.limit });
    } catch (err) {
      throw internal('Failed to list conversations.', err);
    }
  }

  // Cheap ownership check for the agent route's per-turn validation. Same
  // 404-on-cross-tenant shape as loadForViewer but skips the messages
  // load. Note: this is still owner-strict (shared conversations do NOT
  // grant write access — only the owner can append turns).
  async assertOwnership(input: { id: string; userId: string }): Promise<void> {
    // If the conversation doesn't exist or the userId doesn't match, throw a 404-shaped error. This is the same shape as loadForViewer's "not viewable" case, so the agent route can treat it uniformly.
    let meta: { id: string; userId: string } | null;
    try {
      meta = await this.repo.findMetaById(input.id);
    } catch (err) {
      throw internal('Failed to verify conversation ownership.', err);
    }

    if (!meta || meta.userId !== input.userId) {
      throw new ConversationServiceError(
        `Conversation ${input.id} not found.`,
        'CONVERSATION_NOT_FOUND',
      );
    }
  }

  // Toggle the shared flag on an existing conversation. Owner-only —
  // cross-tenant callers get the same 404-shaped error as any other
  // owner-scoped operation. Returns the new shared value.
  async setShared(input: {
    id: string;
    userId: string;
    shared: boolean;
  }): Promise<{ shared: boolean }> {
    await this.assertOwnership({ id: input.id, userId: input.userId });

    try {
      return await this.repo.setShared({ id: input.id, shared: input.shared });
    } catch (err) {
      throw internal('Failed to update conversation sharing.', err);
    }
  }

  // Create an empty conversation and derive its title from the first user
  // message in `titleSource`. Does NOT persist the titleSource messages —
  // it's used solely to compute the title. Callers that need messages
  // persisted in the same operation should use createWithSeed() (single
  // atomic write) or follow this call with appendTurn().
  //
  // Called from the agent route on the first turn of a fresh conversation:
  // the id must be returned to the client mid-stream (before the agent
  // finishes producing turn output), so create + appendTurn can't be
  // atomized on that path — they're separated by the whole agent turn.
  async create(input: {
    userId: string;
    titleSource: AgentInputItem[];
  }): Promise<{ id: string }> {
    const title = deriveTitle(input.titleSource);
    try {
      return await this.repo.create({ userId: input.userId, title });
    } catch (err) {
      throw internal('Failed to create conversation.', err);
    }
  }

  // Create a Conversation AND persist the initial history in one
  // transaction. Used by /api/conversations (Phase 3.5 anon-resume path)
  // where the caller has the full history up-front. Atomic — if the
  // message insert fails, the Conversation row is rolled back too, so
  // the header dropdown never sees a titled-but-empty ghost row.
  async createWithSeed(input: {
    userId: string;
    history: AgentInputItem[];
  }): Promise<{ id: string }> {
    const title = deriveTitle(input.history);
    try {
      return await this.repo.createWithMessages({
        userId: input.userId,
        title,
        items: input.history as unknown as Prisma.InputJsonValue[],
      });
    } catch (err) {
      throw internal('Failed to create conversation with seed history.', err);
    }
  }

  // Persist all new items produced by one agent turn. `newItems` is the
  // slice of stream.history added by this turn — user message on top,
  // then whatever function_call / function_call_result / assistant items
  // the agent produced. Order-preserving batch insert.
  async appendTurn(input: {
    conversationId: string;
    newItems: AgentInputItem[];
  }): Promise<void> {
    if (input.newItems.length === 0) return;

    try {
      await this.repo.appendMessages({
        conversationId: input.conversationId,
        // AgentInputItem values are already JSON-serializable — the SDK
        // deals in the same shape it sends to the OpenAI API. Prisma's
        // InputJsonValue only rejects non-serializable things (undefined,
        // functions), which the SDK never emits.
        items: input.newItems as unknown as Prisma.InputJsonValue[],
      });
    } catch (err) {
      throw internal('Failed to append conversation turn.', err);
    }
  }
}

// Wraps unexpected errors (typically Prisma failures from the repo) as
// ConversationServiceError('INTERNAL_ERROR'). See internalErrorFactory
// in CodedServiceError.ts for the shared shape.
const internal = internalErrorFactory(ConversationServiceError);

// Message.data is a JSON blob per the schema comment — decode each row
// back into an AgentInputItem. Prisma types the value as JsonValue; the
// double-cast asserts we know the shape by construction (we only ever
// wrote AgentInputItems to it).
function extractHistory(row: ConversationWithMessages): AgentInputItem[] {
  return row.messages.map((m) => m.data as unknown as AgentInputItem);
}
