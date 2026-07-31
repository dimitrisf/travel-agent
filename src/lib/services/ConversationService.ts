import type { AgentInputItem } from '@openai/agents';
import type { Prisma } from '@prisma/client';
import type {
  ConversationRepository,
  ConversationSummary,
  ConversationWithMessages,
} from '../repositories/ConversationRepository';
import { ConversationServiceError } from './ConversationServiceError';

// Public shape of a loaded conversation — metadata + a decoded history
// array ready to feed into the agent's run() call. Callers don't touch
// raw Message rows.
export type LoadedConversation = {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  history: AgentInputItem[];
};

// Title auto-generated from the first user message. Kept short so it fits
// the header dropdown's single-line row. Newlines collapsed to spaces.
const TITLE_MAX_LENGTH = 60;

// Derive a title from the first user message in the seed history. Returns
// null if no user message is found or the first user message is empty.
// E.g, items = [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi' }]
// then returns 'Hello'. If the first user message is longer than TITLE_MAX_LENGTH, it truncates and adds an ellipsis.
function deriveTitle(items: AgentInputItem[]): string | null {
  for (const item of items) {
    if (isUserTurn(item)) {
      // First, collapse whitespace and trim so we don't return a title of just spaces or newlines. Then, if the text is too long, truncate and add an ellipsis.
      const text = item.content.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      return text.length > TITLE_MAX_LENGTH
        ? text.slice(0, TITLE_MAX_LENGTH - 1) + '…'
        : text;
    }
  }
  return null;
}

// Narrow AgentInputItem to the user-turn shape. The SDK's union is loose
// (any object with a `role` field, roughly) — this filter is what lets
// deriveTitle safely reach into `.content` as a string.
function isUserTurn(
  item: AgentInputItem,
): item is { role: 'user'; content: string } {
  if (!item || typeof item !== 'object') return false;
  const shape = item as { role?: unknown; content?: unknown };
  return shape.role === 'user' && typeof shape.content === 'string';
}

export class ConversationService {
  constructor(private readonly repo: ConversationRepository) {}

  // Load an existing conversation with ownership check. Cross-user access
  // returns CONVERSATION_NOT_FOUND (same shape as truly-missing) so id
  // enumeration can't discover which ones exist under other users.
  async loadForUser(input: {
    id: string;
    userId: string;
  }): Promise<LoadedConversation> {
    const row = await this.repo.findById(input.id);

    if (!row || row.userId !== input.userId) {
      throw new ConversationServiceError(
        `Conversation ${input.id} not found.`,
        'CONVERSATION_NOT_FOUND',
      );
    }

    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      history: extractHistory(row),
    };
  }

  async listForUser(input: {
    userId: string;
    limit?: number;
  }): Promise<ConversationSummary[]> {
    return this.repo.listByUser(input.userId, { limit: input.limit });
  }

  // Cheap ownership check for the agent route's per-turn validation. Same
  // 404-on-cross-tenant shape as loadForUser but skips the messages load.
  async assertOwnership(input: { id: string; userId: string }): Promise<void> {
    const meta = await this.repo.findMetaById(input.id);
    if (!meta || meta.userId !== input.userId) {
      throw new ConversationServiceError(
        `Conversation ${input.id} not found.`,
        'CONVERSATION_NOT_FOUND',
      );
    }
  }

  // Create an empty conversation and derive its title from the first user
  // message in the caller-provided seed history. Called from the agent
  // route on the first turn of a fresh conversation (no id yet). Returns
  // the new id so the client can navigate to /c/[id].
  async create(input: {
    userId: string;
    seedHistory: AgentInputItem[];
  }): Promise<{ id: string }> {
    const title = deriveTitle(input.seedHistory);
    return this.repo.create({ userId: input.userId, title });
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

    await this.repo.appendMessages({
      conversationId: input.conversationId,
      // AgentInputItem values are already JSON-serializable — the SDK
      // deals in the same shape it sends to the OpenAI API. Prisma's
      // InputJsonValue only rejects non-serializable things (undefined,
      // functions), which the SDK never emits.
      items: input.newItems as unknown as Prisma.InputJsonValue[],
    });
  }
}

// Message.data is a JSON blob per the schema comment — decode each row
// back into an AgentInputItem. Prisma types the value as JsonValue; the
// double-cast asserts we know the shape by construction (we only ever
// wrote AgentInputItems to it).
function extractHistory(row: ConversationWithMessages): AgentInputItem[] {
  return row.messages.map((m) => m.data as unknown as AgentInputItem);
}
