import type { Prisma, PrismaClient } from '@prisma/client';

// Include shape used by findById — always returns the full message
// history in insertion order so consumers can feed it straight to the
// agent's run() call.
export const conversationInclude = {
  messages: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.ConversationInclude;

// Row shape returned by findById — includes the full message history
export type ConversationWithMessages = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

// Row shape returned by listByUser — no messages, just the metadata the
// header dropdown needs (id, title, updatedAt).
export type ConversationSummary = {
  id: string;
  title: string | null;
  updatedAt: Date;
};

export class ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<ConversationWithMessages | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
  }

  // Metadata-only lookup for ownership checks. Skips the messages relation
  // so `/api/agent` can verify that the caller owns a conversationId
  // without paying for a full history load on every turn.
  async findMetaById(
    id: string,
  ): Promise<{ id: string; userId: string } | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
  }

  // Signed-in user's conversations, most-recently-updated first. Limit
  // defaults to 10 (the header dropdown size); pass a larger number for a
  // future /conversations index page.
  async listByUser(
    userId: string,
    opts?: { limit?: number },
  ): Promise<ConversationSummary[]> {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: opts?.limit ?? 10,
      select: { id: true, title: true, updatedAt: true },
    });
  }

  async create(input: {
    userId: string;
    title: string | null;
  }): Promise<{ id: string }> {
    const row = await this.prisma.conversation.create({
      data: { userId: input.userId, title: input.title },
      select: { id: true },
    });
    return row;
  }

  // Toggle the shared flag. Returns the updated row's shared value so the
  // service can hand it back to the API caller for optimistic UI updates.
  async setShared(input: {
    id: string;
    shared: boolean;
  }): Promise<{ shared: boolean }> {
    return this.prisma.conversation.update({
      where: { id: input.id },
      data: { shared: input.shared },
      select: { shared: true },
    });
  }

  // Batch-insert a list of AgentInputItems as Message rows and bump the
  // parent's updatedAt in the same transaction so the header dropdown
  // sees fresh conversations on top. Prisma.InputJsonValue is what
  // `data: Json` accepts — anything JSON-serializable.
  // This is used by the /api/agent route to append new messages to a
  // conversation without having to load the full history first.
  // E.g., if input = { conversationId: 'abc', items: [ { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' } ] }
  // then this will insert two new Message rows and update the Conversation's updatedAt timestamp in a single transaction.
  // E.g, input = { conversationId: 'abc', items: [] } will do nothing and return immediately.
  // E.g., input = { conversationId: 'abc', items: [ { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'How are you?' } ] } will insert three new Message rows and update the Conversation's updatedAt timestamp.
  // InputJsonValue is a type that represents any valid JSON value, including objects, arrays, strings, numbers, booleans, and null. This allows for flexible message content to be stored in the database.
  async appendMessages(input: {
    conversationId: string;
    items: Prisma.InputJsonValue[];
  }): Promise<void> {
    if (input.items.length === 0) return;

    await this.prisma.$transaction([
      this.prisma.message.createMany({
        // E.g, input = { conversationId: 'abc', items: [ { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' } ] }
        // then data = [ { conversationId: 'abc', data: { role: 'user', content: 'Hi' } }, { conversationId: 'abc', data: { role: 'assistant', content: 'Hello' } } ]
        data: input.items.map((data) => ({
          conversationId: input.conversationId,
          data,
        })),
      }),
      this.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
  }
}
