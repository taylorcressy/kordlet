import {
  entries,
  errorSchema,
  toolName,
  commandName,
  product,
} from "../packages/contracts";
import { tools } from "../apps/mcp";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const check = process.argv.includes("--check");
const base = entries.map(([id, meta]) => ({
  id,
  cli: commandName(id),
  mcp: toolName(id),
  ...meta,
}));
const hash = createHash("sha256").update(JSON.stringify(base)).digest("hex");
const paths: Record<string, Record<string, unknown>> = {};
for (const [id, meta] of entries) {
  const keys = [...meta.path.matchAll(/:([a-zA-Z]+)/g)].map(
    (match) => match[1],
  );
  const properties = meta.input.properties as Record<string, unknown>;
  const required = new Set(meta.input.required ?? []);
  const path = meta.path.replace(/:([a-zA-Z]+)/g, "{$1}");
  const fields = Object.entries(properties).filter(
    ([name]) => !keys.includes(name),
  );
  (paths["/api/v1" + path] ??= {})[meta.method.toLowerCase()] = {
    operationId: id,
    summary: id + " (" + meta.role + ")",
    security: [{ bearerAuth: [] }, { browserSession: [] }],
    parameters: [
      ...keys.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: properties[name],
      })),
      ...(meta.method === "GET"
        ? fields.map(([name, schema]) => ({
            name,
            in: "query",
            required: required.has(name),
            schema,
          }))
        : id === "credential.create"
          ? []
          : [
              {
                name: "Idempotency-Key",
                in: "header",
                required: false,
                schema: { type: "string" },
              },
            ]),
    ],
    ...(meta.method === "GET"
      ? {}
      : {
          requestBody: {
            required: fields.some(([name]) => required.has(name)),
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: Object.fromEntries(fields),
                  ...(fields.some(([name]) => required.has(name))
                    ? {
                        required: fields
                          .filter(([name]) => required.has(name))
                          .map(([name]) => name),
                      }
                    : {}),
                },
              },
            },
          },
        }),
    responses: {
      "200": {
        description: "Canonical result",
        content: { "application/json": { schema: meta.output } },
      },
      default: {
        description: "Canonical error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  };
}
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const files: Record<string, string> = {
  "generated/openapi.json": json({
    openapi: "3.1.1",
    info: { title: product.name, version: product.version },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        browserSession: {
          type: "apiKey",
          in: "cookie",
          name: "kordlet_session",
        },
      },
    },
    paths,
  }),
  "generated/operations.json": json({
    contract: product.contract,
    hash,
    operations: base,
  }),
  "generated/mcp-tools.json": json(tools),
  "docs/api-reference.md":
    "# Public operation reference\n\nGenerated from the canonical registry.\n\n| Operation | REST | CLI | MCP | Role |\n|---|---|---|---|---|\n" +
    base
      .map(
        (o) =>
          "| `" +
          o.id +
          "` | `" +
          o.method +
          " /api/v1" +
          o.path +
          "` | `kordlet " +
          o.cli +
          "` | `" +
          o.mcp +
          "` | " +
          o.role +
          " |",
      )
      .join("\n") +
    "\n",
};
mkdirSync("generated", { recursive: true });
for (const [path, body] of Object.entries(files)) {
  if (check) {
    if (readFileSync(path, "utf8") !== body) {
      console.error("Generated file differs: " + path);
      process.exitCode = 1;
    }
  } else writeFileSync(path, body);
}
