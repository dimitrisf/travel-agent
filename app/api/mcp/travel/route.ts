import { createMcpApiClient } from '@/mcp/mcpApiClient';
import { createMcpHttpHandler } from '@/mcp/mcpHttpHandler';
import { makeSearchFlightsToolSpec } from '@/mcp/tools/travel/searchFlightsToolSpec';
import { makeSearchHotelsToolSpec } from '@/mcp/tools/travel/searchHotelsToolSpec';
import { makeProposeBookingToolSpec } from '@/mcp/tools/travel/proposeBookingToolSpec';
import { makeGetBookingToolSpec } from '@/mcp/tools/travel/getBookingToolSpec';
import { makeCancelBookingToolSpec } from '@/mcp/tools/travel/cancelBookingToolSpec';
import { getDefaultAppBase } from '@/utils/appBase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Loopback base — the tool handlers reach the flight/hotel Route Handlers
// living in the same Next.js process. The trip through localhost (or the
// Vercel deployment URL) keeps the layer story crisp (MCP wraps REST) at
// the cost of a few milliseconds.
const BASE = process.env.TRAVEL_API_BASE ?? getDefaultAppBase();
const { callApi, postApi } = createMcpApiClient(BASE);

// Deliberately not exposing `confirm_booking` to the agent. The user must click "Confirm" in the chat UI to actually reserve inventory. The agent should only propose bookings and let the user confirm them.

export const POST = createMcpHttpHandler({
  name: 'travel',
  version: '1.0.0',
  tools: [
    makeSearchFlightsToolSpec(callApi),
    makeSearchHotelsToolSpec(callApi),
    makeProposeBookingToolSpec(postApi),
    makeGetBookingToolSpec(callApi),
    makeCancelBookingToolSpec(postApi),
  ],
});
