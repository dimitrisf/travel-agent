import { NextRequest } from 'next/server';

// Small helper that turns a set of tool specs into a Next.js POST handler
// speaking MCP over JSON-RPC (Streamable HTTP transport, stateless mode).
//
// The MCP wire protocol is well-defined but small; rather than adapting the
// SDK's transport class to Next.js's Web Request/Response, we handle the
// half-dozen methods we need directly. Trade-off: reimplement a bit of the
// protocol; gain: no impedance mismatch with the App Router.
//
// Methods handled:
//   - initialize             — client handshake; returns capabilities + serverInfo
//   - notifications/*        — no-response acknowledgements (202 Accepted)
//   - ping                   — returns {}
//   - tools/list             — returns the tool catalogue
//   - tools/call             — invokes a tool handler by name

const PROTOCOL_VERSION = '2024-11-05';

export type ToolContent = { type: 'text'; text: string };
// The result of a tool invocation is a list of content items, which can be
// text, images, or other types. For now we only support text, but the MCP
// protocol allows for more content types in the future.
export type ToolResult = { content: ToolContent[]; isError?: boolean };

// A tool spec describes a single tool that can be invoked via the MCP protocol.
// It includes the tool's name, title, description, input schema, and a handler
// function that will be called when the tool is invoked. The handler function
// takes a record of input arguments and returns a promise that resolves to a
// ToolResult.
export type McpToolSpec = {
  name: string;
  title?: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: false;
  };
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
};

// JSON-RPC 2.0 request and response types. The MCP protocol is built on top of
// JSON-RPC 2.0, so we need to define the request and response types here. The
// request type includes the JSON-RPC version, an optional id, the method name,
// and optional parameters. The response type includes the JSON-RPC version,
// the id of the request, and either a result or an error.
type JsonRpcId = number | string | null;
type JsonRpcRequest = {
  jsonrpc?: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
};

// The createMcpHttpHandler function takes a configuration object that includes the server's name, version, and a list of tool specs. It returns an async function that handles POST requests to the MCP endpoint. The handler function parses the request body as JSON, checks the method name, and dispatches to the appropriate handler for each method. It returns a JSON-RPC response with either a result or an error.
export function createMcpHttpHandler(config: {
  name: string;
  version: string;
  tools: McpToolSpec[];
}) {
  const { name, version, tools } = config;
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  return async function POST(req: NextRequest): Promise<Response> {
    let body: JsonRpcRequest;
    try {
      // Parse the request body as JSON. If parsing fails, return a JSON-RPC error response with code -32700 (Parse error).
      body = (await req.json()) as JsonRpcRequest;
    } catch {
      return jsonError(null, -32700, 'Parse error');
    }

    // Notifications carry no id and expect no response body.
    // E.g., a client may send "notifications/tool/started" to indicate that a tool invocation has started, and the server should acknowledge with a 202 Accepted response.
    if (body.id === undefined && body.method?.startsWith('notifications/')) {
      return new Response(null, { status: 202 });
    }

    switch (body.method) {
      // Handle the "initialize" method, which is used for client handshake. It returns the protocol version, capabilities (currently only tools), and server information (name and version).
      // E.g., a client may send "initialize" to indicate that it is ready to communicate with the server, and the server should respond with its capabilities and information.
      case 'initialize':
        return jsonResult(body.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name, version },
        });

      case 'ping':
        // Handle the "ping" method, which is used to check if the server is alive. It returns an empty object as a response.
        return jsonResult(body.id, {});

      case 'tools/list':
        // Handle the "tools/list" method, which returns the list of available tools. It maps over the tools array and returns an array of tool specifications (name, title, description, input schema).
        return jsonResult(body.id, {
          tools: tools.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case 'tools/call': {
        // Handle the "tools/call" method, which is used to invoke a specific tool. It extracts the tool name and arguments from the request, looks up the tool in the toolsByName map, and calls the tool's handler function. If the tool is not found, it returns a JSON-RPC error with code -32601 (Method not found).
        const params = body.params as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const tool = params.name ? toolsByName.get(params.name) : undefined;
        if (!tool) {
          return jsonError(
            body.id,
            -32601,
            `Tool not found: ${params.name ?? ''}`,
          );
        }
        try {
          // Call the tool's handler function with the provided arguments. If the handler throws an error, catch it and return a JSON-RPC error response with code -32603 (Internal error).
          const result = await tool.handler(params.arguments ?? {});
          return jsonResult(body.id, result);
        } catch (err) {
          return jsonError(
            body.id,
            -32603,
            (err as Error).message ?? 'Tool execution failed',
          );
        }
      }

      default:
        // Handle unknown methods by returning a JSON-RPC error with code -32601 (Method not found).
        return jsonError(
          body.id,
          -32601,
          `Unknown method: ${body.method ?? '(none)'}`,
        );
    }
  };
}

// Helper functions to create JSON-RPC responses. The jsonResult function creates a successful response with a result, while the jsonError function creates an error response with a code and message. The jsonResponse function is a low-level helper that creates a Response object with the given payload serialized as JSON.

// E.g., it returns a Response with status 200 and Content-Type application/json, containing the JSON-RPC response object.
function jsonResult(
  id: number | string | undefined,
  result: unknown,
): Response {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, result });
}

function jsonError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): Response {
  return jsonResponse({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
