import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  entries,
  errorSchema,
  product,
  projectDiscoveryInstructions,
  reviewInstructions,
  toolName,
} from "../../packages/contracts";
import { ApiError, type apiClient } from "../../packages/client";
import { validInput } from "../../packages/contracts/validation";
export const tools = entries.map(([id, meta]) => ({
  name: toolName(id),
  description: id,
  inputSchema: meta.input,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { result: meta.output, error: errorSchema },
    oneOf: [{ required: ["result"] }, { required: ["error"] }],
  },
  annotations: {
    readOnlyHint: meta.method === "GET",
    destructiveHint: meta.method !== "GET",
  },
})) as Tool[];
export async function runMcp(
  connect: () => Promise<ReturnType<typeof apiClient>>,
) {
  const server = new Server(
    { name: product.cli, version: product.version },
    { capabilities: { tools: {} }, instructions: projectDiscoveryInstructions + " " + reviewInstructions },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    let payload;
    let isError = false;
    try {
      const operation = entries.find(
        ([id]) => toolName(id) === request.params.name,
      );
      if (
        !operation ||
        !validInput(operation[0], request.params.arguments ?? {})
      )
        throw new ApiError({
          code: "invalid_input",
          message: "Arguments do not match the operation schema.",
          requestId: "client",
          retryable: false,
        });
      const key = request.params._meta?.["kordlet.dev/idempotencyKey"];
      if (key !== undefined && typeof key !== "string")
        throw new ApiError({
          code: "invalid_input",
          message: "Idempotency key must be a string.",
          requestId: "client",
          retryable: false,
        });
      const client = await connect();
      payload = {
        result: await client(
          operation[0],
          (request.params.arguments ?? {}) as never,
          key,
        ),
      };
    } catch (error) {
      isError = true;
      payload = {
        error:
          error instanceof ApiError
            ? error.failure
            : {
                code: "internal_error",
                message: "Unexpected adapter error.",
                requestId: "client",
                retryable: false,
              },
      };
    }
    return {
      isError,
      structuredContent: payload,
      content: [{ type: "text", text: JSON.stringify(payload) }],
    };
  });
  await server.connect(new StdioServerTransport());
}
