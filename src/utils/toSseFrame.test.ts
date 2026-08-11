import { describe, it, expect } from 'vitest';
import { toSseFrame } from './toSseFrame';

// Unit tests for the SDK-event → SSE-frame translator. Feeds synthetic
// events at the shape the SDK emits (plain objects with `type` + payload
// fields) and asserts the wire-format frame the client receives. Same
// contract the route's stream loop relies on, exercised without any SSE
// controller.

describe('toSseFrame — agent_updated_stream_event', () => {
  it('emits an agent_updated frame when the agent has a name', () => {
    const event = {
      type: 'agent_updated_stream_event',
      agent: { name: 'WeatherAgent' },
    };
    expect(toSseFrame(event)).toEqual({
      type: 'agent_updated',
      agentName: 'WeatherAgent',
    });
  });

  it('emits null when the agent name is missing', () => {
    expect(
      toSseFrame({ type: 'agent_updated_stream_event', agent: {} }),
    ).toBeNull();
    expect(toSseFrame({ type: 'agent_updated_stream_event' })).toBeNull();
  });
});

describe('toSseFrame — raw_model_stream_event', () => {
  it('emits a text_delta frame for output_text_delta with string delta', () => {
    const event = {
      type: 'raw_model_stream_event',
      data: { type: 'output_text_delta', delta: 'Hello' },
    };
    expect(toSseFrame(event)).toEqual({ type: 'text_delta', delta: 'Hello' });
  });

  it('emits null for non-text data types', () => {
    const event = {
      type: 'raw_model_stream_event',
      data: { type: 'response_started', delta: 'x' },
    };
    expect(toSseFrame(event)).toBeNull();
  });

  it('emits null when delta is not a string', () => {
    const event = {
      type: 'raw_model_stream_event',
      data: { type: 'output_text_delta', delta: 123 as unknown as string },
    };
    expect(toSseFrame(event)).toBeNull();
  });
});

describe('toSseFrame — run_item_stream_event / tool_call_item', () => {
  it('emits a tool_call frame with string args passed through verbatim', () => {
    const event = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_item',
        rawItem: {
          name: 'get_weather',
          arguments: '{"city":"Athens"}',
          callId: 'abc',
        },
      },
    };
    expect(toSseFrame(event)).toEqual({
      type: 'tool_call',
      name: 'get_weather',
      args: '{"city":"Athens"}',
      callId: 'abc',
    });
  });

  it('serializes non-string args to JSON', () => {
    const event = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_item',
        rawItem: { name: 'x', arguments: { a: 1 }, callId: 'y' },
      },
    };
    expect(toSseFrame(event)).toEqual({
      type: 'tool_call',
      name: 'x',
      args: '{"a":1}',
      callId: 'y',
    });
  });

  it('falls back to call_id, then id, when callId is absent', () => {
    const eventSnake = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_item',
        rawItem: { name: 'x', arguments: '{}', call_id: 'from_snake' },
      },
    };
    const eventId = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_item',
        rawItem: { name: 'x', arguments: '{}', id: 'from_id' },
      },
    };
    expect((toSseFrame(eventSnake) as { callId?: string }).callId).toBe(
      'from_snake',
    );
    expect((toSseFrame(eventId) as { callId?: string }).callId).toBe(
      'from_id',
    );
  });

  it('emits null when name or arguments is missing from rawItem', () => {
    const noName = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_item',
        rawItem: { arguments: '{}', callId: 'x' },
      },
    };
    const noArgs = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_item',
        rawItem: { name: 'x', callId: 'x' },
      },
    };
    expect(toSseFrame(noName)).toBeNull();
    expect(toSseFrame(noArgs)).toBeNull();
  });
});

describe('toSseFrame — run_item_stream_event / tool_call_output_item', () => {
  it('emits a tool_output frame with the callId and (unwrapped) output', () => {
    const event = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_output_item',
        rawItem: { callId: 'abc' },
        // Non-MCP shape — passes through unwrapToolOutput unchanged.
        output: '{"tempC":32}',
      },
    };
    const frame = toSseFrame(event);
    expect(frame).toMatchObject({ type: 'tool_output', callId: 'abc' });
    // Output preserved verbatim for non-envelope shapes.
    expect((frame as { output: string }).output).toBe('{"tempC":32}');
  });

  it('unwraps MCP-envelope outputs', () => {
    const event = {
      type: 'run_item_stream_event',
      item: {
        type: 'tool_call_output_item',
        rawItem: { callId: 'abc' },
        output: { content: [{ type: 'text', text: '{"reference":"BKG-1"}' }] },
      },
    };
    const frame = toSseFrame(event);
    expect((frame as { output: string }).output).toBe(
      '{"reference":"BKG-1"}',
    );
  });
});

describe('toSseFrame — unknown / malformed events', () => {
  it('emits null for an unrecognized event type', () => {
    expect(toSseFrame({ type: 'something_else' })).toBeNull();
  });

  it('emits null for null / undefined / non-object inputs', () => {
    expect(toSseFrame(null)).toBeNull();
    expect(toSseFrame(undefined)).toBeNull();
    expect(toSseFrame({})).toBeNull();
  });

  it('emits null for a run_item event whose item is missing', () => {
    expect(toSseFrame({ type: 'run_item_stream_event' })).toBeNull();
  });

  it('emits null for a run_item event with an unrecognized item type', () => {
    expect(
      toSseFrame({
        type: 'run_item_stream_event',
        item: { type: 'something_else_item' },
      }),
    ).toBeNull();
  });
});
