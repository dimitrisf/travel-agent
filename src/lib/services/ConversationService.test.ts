import { describe, it, expect, vi } from 'vitest';
import { ConversationService } from './ConversationService';
import { ConversationServiceError } from './ConversationServiceError';
import type {
  ConversationRepository,
  ConversationWithMessages,
} from '../repositories/ConversationRepository';
import type { AgentInputItem } from '@openai/agents';

function mockRepo(
  overrides: Partial<ConversationRepository> = {},
): ConversationRepository {
  return {
    findById: vi.fn(),
    findMetaById: vi.fn(),
    listByUser: vi.fn(),
    create: vi.fn(),
    createWithMessages: vi.fn(),
    setShared: vi.fn(),
    appendMessages: vi.fn(),
    ...overrides,
  } as unknown as ConversationRepository;
}

// Prisma-shaped row factory. Only the fields ConversationService reads
// are typed; unused Prisma fields cast through unknown.
function row(
  overrides: Partial<ConversationWithMessages> = {},
): ConversationWithMessages {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: 'Test conversation',
    shared: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    messages: [],
    ...overrides,
  } as unknown as ConversationWithMessages;
}

// ─── loadForViewer ─────────────────────────────────────────────────

describe('ConversationService.loadForViewer', () => {
  it('returns full view with isOwner=true when viewerId matches userId', async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(row({ userId: 'user-1' })),
    });
    const service = new ConversationService(repo);

    const result = await service.loadForViewer({
      id: 'conv-1',
      viewerId: 'user-1',
    });

    expect(result).not.toBeNull();
    expect(result!.isOwner).toBe(true);
    expect(result!.id).toBe('conv-1');
  });

  it('returns view with isOwner=false for a non-owner viewer of a shared conv', async () => {
    const repo = mockRepo({
      findById: vi
        .fn()
        .mockResolvedValue(row({ userId: 'user-1', shared: true })),
    });
    const service = new ConversationService(repo);

    const result = await service.loadForViewer({
      id: 'conv-1',
      viewerId: 'user-2',
    });

    expect(result).not.toBeNull();
    expect(result!.isOwner).toBe(false);
  });

  it('returns null when non-owner tries to view an unshared conv', async () => {
    const repo = mockRepo({
      findById: vi
        .fn()
        .mockResolvedValue(row({ userId: 'user-1', shared: false })),
    });
    const service = new ConversationService(repo);

    const result = await service.loadForViewer({
      id: 'conv-1',
      viewerId: 'user-2',
    });

    expect(result).toBeNull();
  });

  it('returns null when anon viewer tries to view an unshared conv', async () => {
    const repo = mockRepo({
      findById: vi
        .fn()
        .mockResolvedValue(row({ userId: 'user-1', shared: false })),
    });
    const service = new ConversationService(repo);

    const result = await service.loadForViewer({
      id: 'conv-1',
      viewerId: null,
    });

    expect(result).toBeNull();
  });

  it('anon viewer CAN view a shared conv (isOwner=false)', async () => {
    const repo = mockRepo({
      findById: vi
        .fn()
        .mockResolvedValue(row({ userId: 'user-1', shared: true })),
    });
    const service = new ConversationService(repo);

    const result = await service.loadForViewer({
      id: 'conv-1',
      viewerId: null,
    });

    expect(result).not.toBeNull();
    expect(result!.isOwner).toBe(false);
  });

  it('returns null when the conversation is not found', async () => {
    const repo = mockRepo({
      findById: vi.fn().mockResolvedValue(null),
    });
    const service = new ConversationService(repo);

    const result = await service.loadForViewer({
      id: 'missing',
      viewerId: 'user-1',
    });

    expect(result).toBeNull();
  });
});

// ─── assertOwnership ───────────────────────────────────────────────

describe('ConversationService.assertOwnership', () => {
  it('resolves silently when the caller owns the conversation', async () => {
    const repo = mockRepo({
      findMetaById: vi.fn().mockResolvedValue({ id: 'c1', userId: 'user-1' }),
    });
    const service = new ConversationService(repo);

    await expect(
      service.assertOwnership({ id: 'c1', userId: 'user-1' }),
    ).resolves.toBeUndefined();
  });

  it('throws CONVERSATION_NOT_FOUND for a missing conversation', async () => {
    const repo = mockRepo({
      findMetaById: vi.fn().mockResolvedValue(null),
    });
    const service = new ConversationService(repo);

    await expect(
      service.assertOwnership({ id: 'missing', userId: 'user-1' }),
    ).rejects.toMatchObject({
      name: 'ConversationServiceError',
      code: 'CONVERSATION_NOT_FOUND',
    });
  });

  it('throws CONVERSATION_NOT_FOUND for a cross-tenant caller (same shape as missing — no info leak)', async () => {
    const repo = mockRepo({
      findMetaById: vi.fn().mockResolvedValue({ id: 'c1', userId: 'user-1' }),
    });
    const service = new ConversationService(repo);

    await expect(
      service.assertOwnership({ id: 'c1', userId: 'user-2' }),
    ).rejects.toBeInstanceOf(ConversationServiceError);
  });
});

// ─── setShared ─────────────────────────────────────────────────────

describe('ConversationService.setShared', () => {
  it('calls repo.setShared when the owner requests it', async () => {
    const setShared = vi.fn().mockResolvedValue({ shared: true });
    const repo = mockRepo({
      findMetaById: vi.fn().mockResolvedValue({ id: 'c1', userId: 'user-1' }),
      setShared,
    });
    const service = new ConversationService(repo);

    const result = await service.setShared({
      id: 'c1',
      userId: 'user-1',
      shared: true,
    });

    expect(result).toEqual({ shared: true });
    expect(setShared).toHaveBeenCalledWith({ id: 'c1', shared: true });
  });

  it('does not call repo.setShared when the caller is not the owner', async () => {
    const setShared = vi.fn();
    const repo = mockRepo({
      findMetaById: vi.fn().mockResolvedValue({ id: 'c1', userId: 'user-1' }),
      setShared,
    });
    const service = new ConversationService(repo);

    await expect(
      service.setShared({ id: 'c1', userId: 'user-2', shared: true }),
    ).rejects.toBeInstanceOf(ConversationServiceError);
    expect(setShared).not.toHaveBeenCalled();
  });
});

// ─── create (title derivation) ─────────────────────────────────────

describe('ConversationService.create', () => {
  const userTurn = (content: string): AgentInputItem =>
    ({ role: 'user', content }) as unknown as AgentInputItem;

  const assistantTurn = (content: string): AgentInputItem =>
    ({ role: 'assistant', content }) as unknown as AgentInputItem;

  it('derives title from the first user message', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [userTurn('Plan a trip to Berlin')],
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'Plan a trip to Berlin',
    });
  });

  it('skips assistant/tool turns and uses the first USER message', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [
        assistantTurn('Hi there'),
        userTurn('The actual first user turn'),
      ],
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'The actual first user turn',
    });
  });

  it('truncates long titles with an ellipsis at 60 chars', async () => {
    const long = 'x'.repeat(200);
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [userTurn(long)],
    });

    const title = create.mock.calls[0][0].title as string;
    expect(title.length).toBe(60);
    expect(title.endsWith('…')).toBe(true);
  });

  it('accepts the array-content shape ({role:"user", content:[{type:"input_text", text:"..."}]}) that newer @openai/agents versions emit', async () => {
    // Regression: isUserTurn used to require typeof content === 'string'
    // and silently skipped every array-shaped user turn. A seed history
    // produced by a newer SDK version ended up with deriveTitle → null
    // and the header dropdown showing "Untitled conversation".
    const arrayShapedUserTurn = {
      role: 'user',
      content: [
        { type: 'input_text', text: 'plan a trip' },
        { type: 'input_image', image: 'https://example.com/x.png' },
        { type: 'input_text', text: 'starting in Berlin' },
      ],
    } as unknown as AgentInputItem;
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [arrayShapedUserTurn],
    });

    // Concatenates the two input_text parts (skips input_image).
    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'plan a trip starting in Berlin',
    });
  });

  it('does not split a surrogate pair when truncating (emoji at the boundary)', async () => {
    // Regression: text.slice(0, 59) operates on UTF-16 code units, so
    // a message where a 🎉 (U+1F389 = surrogate pair) sits astride
    // indices 58/59 would be sliced to keep the high surrogate and
    // drop the low surrogate — persisted title contains a lone
    // U+D83C rendered as '�…' in browsers and rejected by strict
    // JSON serializers. Fix iterates by code point.
    const prefix = 'a'.repeat(58); // fills indices 0..57
    const message = `${prefix}🎉tail`; // 🎉 lives at code-unit 58/59
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [userTurn(message)],
    });

    const title = create.mock.calls[0][0].title as string;
    // Not empty, not undefined, and no lone surrogate anywhere.
    expect(typeof title).toBe('string');
    for (const ch of title) {
      const code = ch.codePointAt(0)!;
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
    expect(title.endsWith('…')).toBe(true);
  });

  it('collapses whitespace and trims before truncating', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [userTurn('  hello\n\n   world  ')],
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'hello world',
    });
  });

  it('returns null title when no user message is present', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [assistantTurn('assistant only')],
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: null,
    });
  });

  it('returns null title when the first user message is empty/whitespace', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    await service.create({
      userId: 'user-1',
      titleSource: [userTurn('   \n\t  ')],
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: null,
    });
  });

  it('returns null title for empty-content user turn shapes (empty string, empty array, array of only non-text parts)', async () => {
    // Pins the observable behavior after the shared-helper refactor:
    // extractUserTurnText's internal contract shifted (empty content
    // now returns null instead of '' from the wrapper), but deriveTitle
    // treats both identically. If a future refactor of
    // userTurnContentText silently drifts (e.g. joins with something
    // other than '', starts returning a placeholder), this test would
    // catch it via the outer title output.
    const create = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ create });
    const service = new ConversationService(repo);

    // Three shapes that all mean "user turn with no usable text":
    const emptyStringTurn = { role: 'user', content: '' } as unknown as AgentInputItem;
    const emptyArrayTurn = { role: 'user', content: [] } as unknown as AgentInputItem;
    const nonTextPartsTurn = {
      role: 'user',
      content: [
        { type: 'input_image', image: 'https://example.com/x.png' },
      ],
    } as unknown as AgentInputItem;

    for (const turn of [emptyStringTurn, emptyArrayTurn, nonTextPartsTurn]) {
      create.mockClear();
      await service.create({
        userId: 'user-1',
        // Follow the empty user turn with an assistant turn so we know
        // deriveTitle actually walked past it — it should still return
        // null because no user turn in the batch has extractable text.
        titleSource: [turn, assistantTurn('hi')],
      });
      expect(create).toHaveBeenCalledWith({ userId: 'user-1', title: null });
    }
  });
});

// ─── createWithSeed ────────────────────────────────────────────────

describe('ConversationService.createWithSeed', () => {
  const userTurn = (content: string): AgentInputItem =>
    ({ role: 'user', content }) as unknown as AgentInputItem;

  it('derives title from the first user message in the seed history', async () => {
    // Smoke test: createWithSeed and create both call the same deriveTitle
    // helper today, but they're separate entry points serving different
    // routes (createWithSeed is the Phase 3.5 anon-resume path). Pin the
    // title derivation on this path too so a future refactor that
    // diverges the two — inlines deriveTitle into one of them, adds
    // path-specific logic, etc. — trips this test instead of silently
    // regressing the anon-resume path.
    const createWithMessages = vi.fn().mockResolvedValue({ id: 'c1' });
    const repo = mockRepo({ createWithMessages });
    const service = new ConversationService(repo);

    await service.createWithSeed({
      userId: 'user-1',
      history: [
        userTurn('Plan a trip to Berlin'),
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Sure!' }],
        } as unknown as AgentInputItem,
      ],
    });

    // Assert on the title argument only — items get passed through as-is
    // and are the repo's shape concern, not deriveTitle's.
    const call = createWithMessages.mock.calls[0][0] as {
      userId: string;
      title: string | null;
    };
    expect(call.userId).toBe('user-1');
    expect(call.title).toBe('Plan a trip to Berlin');
  });
});

// ─── appendTurn ────────────────────────────────────────────────────

describe('ConversationService.appendTurn', () => {
  it('no-ops when newItems is empty (no repo call)', async () => {
    const appendMessages = vi.fn();
    const repo = mockRepo({ appendMessages });
    const service = new ConversationService(repo);

    await service.appendTurn({ conversationId: 'c1', newItems: [] });

    expect(appendMessages).not.toHaveBeenCalled();
  });

  it('appends items to the repo when newItems is non-empty', async () => {
    const appendMessages = vi.fn().mockResolvedValue(undefined);
    const repo = mockRepo({ appendMessages });
    const service = new ConversationService(repo);

    const items = [
      { role: 'user', content: 'hi' },
    ] as unknown as AgentInputItem[];

    await service.appendTurn({ conversationId: 'c1', newItems: items });

    expect(appendMessages).toHaveBeenCalledWith({
      conversationId: 'c1',
      items,
    });
  });
});

// ─── listForUser ───────────────────────────────────────────────────

describe('ConversationService.listForUser', () => {
  it('passes userId and limit through to repo.listByUser', async () => {
    const listByUser = vi.fn().mockResolvedValue([]);
    const repo = mockRepo({ listByUser });
    const service = new ConversationService(repo);

    await service.listForUser({ userId: 'user-1', limit: 20 });

    expect(listByUser).toHaveBeenCalledWith('user-1', { limit: 20 });
  });
});
