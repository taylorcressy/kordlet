import Fastify from "fastify";
import staticFiles from "@fastify/static";
import Ajv from "ajv";
import SQLite from "better-sqlite3";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entries, product, type Actor, type Operation } from "../contracts";
import { DomainError, hash, openStore } from "./store";
import { atomicWrite, canonicalDirectory, type Runtime } from "./paths";

export async function startService(options: {
  mode: Runtime["mode"];
  port?: number;
  assets?: string;
}) {
  const dir = canonicalDirectory();
  // SQLite holds this separate, exclusive file transaction through the service lifetime.
  // The OS releases it on process death, independently of PID metadata.
  const lock = new SQLite(join(dir, "ownership.sqlite"), { timeout: 0 });
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new DomainError(
      "service_owned",
      "A service already owns this data directory.",
    );
  }
  let store: ReturnType<typeof openStore> | undefined;
  const app = Fastify({
    bodyLimit: 4_000_000,
    logger: false,
    exposeHeadRoutes: false,
  });
  const routes: string[] = [];
  app.addHook("onRoute", (route) => {
    for (const method of [route.method].flat())
      routes.push(method + " " + route.url);
  });
  const runtime: Runtime = {
    endpoint: "",
    instance: randomUUID(),
    directory: dir,
    api: product.api,
    contract: product.contract,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    mode: options.mode,
  };
  const files = join(dir, "runtime.json");
  const ownerFile = join(dir, "owner.token");
  const streams = new Set<import("node:http").ServerResponse>();
  const sessions = new Map<string, number>();
  const launches = new Map<string, number>();
  const mintLaunch = () => {
    for (const [key, expires] of launches)
      if (expires < Date.now()) launches.delete(key);
    const token = randomUUID();
    launches.set(token, Date.now() + 300_000);
    return runtime.endpoint + "/#launch=" + token;
  };
  const equal = (a: string, b: string) =>
    timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
  const owner: Actor = { id: "local-owner", kind: "owner" };
  const ajv = new Ajv({
    strict: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  const cookies = (value: string | undefined) =>
    value?.match(/(?:^|;\s*)kordlet_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
  try {
    store = openStore(join(dir, "workspace.sqlite"));
    if (!existsSync(ownerFile))
      writeFileSync(ownerFile, randomUUID() + randomUUID(), {
        mode: 0o600,
        flag: "wx",
      });
    const ownerToken = readFileSync(ownerFile, "utf8");
    const data = store;
    app.addHook("onRequest", async (request, reply) => {
      if (
        request.headers.host !== new URL(runtime.endpoint).host ||
        (request.headers.origin && request.headers.origin !== runtime.endpoint)
      ) {
        return reply
          .code(403)
          .send({
            code: "origin_denied",
            message: "Use the exact loopback address.",
            requestId: request.id,
            retryable: false,
          });
      }
      reply
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .header(
          "content-security-policy",
          "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data:",
        );
    });
    const authenticate = (
      headers: { authorization?: string; cookie?: string; origin?: string },
      mutation: boolean,
    ) => {
      const token = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (token)
        return equal(ownerToken, token) ? owner : data.authenticate(token);
      const session = cookies(headers.cookie);
      if (
        session &&
        (sessions.get(session) ?? 0) > Date.now() &&
        (!mutation || headers.origin === runtime.endpoint)
      )
        return owner;
    };
    app.setErrorHandler((error, request, reply) => {
      const canonical =
        error instanceof DomainError
          ? error
          : new DomainError(
              "invalid_input",
              "Request could not be parsed.",
              typeof error === "object" &&
                error &&
                "statusCode" in error &&
                error.statusCode === 413
                ? 413
                : 400,
            );
      if (
        !(error instanceof DomainError) &&
        !(typeof error === "object" && error && "statusCode" in error)
      ) {
        console.error(error);
        canonical.code = "internal_error";
        canonical.status = 500;
        canonical.message = "Unexpected service error.";
      }
      return reply
        .code(canonical.status)
        .send({
          code: canonical.code,
          message: canonical.message,
          requestId: request.id,
          retryable: canonical.status === 503,
          ...(canonical.currentRevision === undefined
            ? {}
            : { currentRevision: canonical.currentRevision }),
        });
    });
    app.get("/health", async () => runtime);
    app.post("/session/launch", async (request) => {
      if (
        !request.headers.authorization ||
        authenticate(request.headers, true)?.kind !== "owner"
      )
        throw new DomainError(
          "permission_denied",
          "Owner bearer credential required.",
          403,
        );
      return { url: mintLaunch() };
    });
    app.post("/session", async (request, reply) => {
      const token = (request.body as { token?: unknown } | null)?.token;
      if (
        request.headers.origin !== runtime.endpoint ||
        typeof token !== "string" ||
        (launches.get(token) ?? 0) < Date.now()
      )
        throw new DomainError(
          "permission_denied",
          "Run kordlet open for a fresh browser launch link.",
          403,
        );
      launches.delete(token);
      const session = randomUUID();
      sessions.set(session, Date.now() + 86_400_000);
      return reply
        .header(
          "Set-Cookie",
          "kordlet_session=" +
            session +
            "; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400",
        )
        .send({ ok: true });
    });
    for (const [operation, meta] of entries) {
      const input = ajv.compile(meta.input);
      const output = ajv.compile(meta.output);
      app.route({
        method: meta.method,
        url: "/api/v1" + meta.path,
        handler: async (request) => {
          if (
            request.headers["kordlet-contract"] !== undefined &&
            request.headers["kordlet-contract"] !== product.contract
          )
            throw new DomainError(
              "contract_incompatible",
              "This service uses contract " + product.contract + ".",
              426,
            );
          const query = request.query as Record<string, unknown>;
          const path = request.params as Record<string, unknown>;
          const actor = authenticate(request.headers, meta.method !== "GET");
          if (!actor)
            throw new DomainError(
              "unauthorized",
              "Use a valid credential or launch a browser session.",
              401,
            );
          const fields: Record<string, unknown> = Object.create(null);
          const set = (key: string, value: unknown) => {
            if (Object.hasOwn(fields, key))
              throw new DomainError(
                "invalid_input",
                "Repeated field: " + key,
                400,
              );
            fields[key] = value;
          };
          for (const [key, value] of Object.entries(path)) set(key, value);
          if (meta.method === "GET") {
            for (const [key, value] of Object.entries(query)) {
              const definition = (
                meta.input.properties as Record<string, { type?: string }>
              )[key];
              if (typeof value !== "string")
                throw new DomainError(
                  "invalid_input",
                  "Repeated query parameter: " + key,
                  400,
                );
              set(
                key,
                definition?.type === "integer" && /^\d+$/.test(value)
                  ? Number(value)
                  : definition?.type === "boolean" &&
                      ["true", "false"].includes(value)
                    ? value === "true"
                    : value,
              );
            }
          } else {
            if (Object.keys(query).length)
              throw new DomainError(
                "invalid_input",
                "Mutation query parameters are unsupported.",
                400,
              );
            if (request.body !== undefined) {
              if (
                !request.body ||
                typeof request.body !== "object" ||
                Array.isArray(request.body)
              )
                throw new DomainError(
                  "invalid_input",
                  "Expected a JSON object.",
                  400,
                );
              for (const [key, value] of Object.entries(request.body))
                set(key, value);
            }
          }
          if (!input(fields))
            throw new DomainError(
              "invalid_input",
              ajv.errorsText(input.errors),
              400,
            );
          const key = request.headers["idempotency-key"];
          if (
            key !== undefined &&
            (meta.method === "GET" ||
              typeof key !== "string" ||
              !/^[a-zA-Z0-9._-]{1,120}$/.test(key))
          )
            throw new DomainError(
              "invalid_input",
              "Invalid idempotency key.",
              400,
            );
          return data.execute(
            operation,
            fields as never,
            actor,
            key,
            (value) => {
              if (!output(value))
                throw Error(
                  operation + " output: " + ajv.errorsText(output.errors),
                );
            },
          );
        },
      });
    }
    app.get("/stream", async (request, reply) => {
      const actor = authenticate(request.headers, false);
      if (!actor)
        throw new DomainError("unauthorized", "Launch a browser session.", 401);
      const { projectId, cursor: initial } = request.query as {
        projectId?: string;
        cursor?: string;
      };
      if (
        typeof projectId !== "string" ||
        !projectId ||
        projectId.length > 100 ||
        (initial !== undefined &&
          (typeof initial !== "string" || !/^\d+$/.test(initial)))
      )
        throw new DomainError("invalid_input", "Invalid stream query.", 400);
      const header = request.headers["last-event-id"];
      let cursor =
        typeof header === "string" && /^\d+$/.test(header)
          ? Number(header)
          : Number(initial ?? 0);
      if (!Number.isSafeInteger(cursor))
        throw new DomainError("invalid_input", "Invalid event cursor.", 400);
      data.execute(
        "event.list",
        { projectId, cursor, limit: 1 },
        actor,
        undefined,
        () => {},
      );
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      const stream = reply.raw;
      let waiting = false;
      const pump = () => {
        if (!authenticate(request.headers, false)) {
          stream.end();
          return;
        }
        if (waiting || stream.destroyed) return;
        const page = data.execute(
          "event.list",
          { projectId, cursor, limit: 100 },
          actor,
          undefined,
          () => {},
        );
        const last = page.items.at(-1);
        if (last) cursor = last.sequence;
        const frame = last
          ? "id: " + cursor + "\ndata: " + JSON.stringify({ cursor }) + "\n\n"
          : ": keep-alive\n\n";
        if (!stream.write(frame)) {
          waiting = true;
          stream.once("drain", () => {
            waiting = false;
          });
        }
      };
      const timer = setInterval(pump, 1000);
      stream.once("close", () => clearInterval(timer));
      streams.add(stream);
      stream.once("close", () => streams.delete(stream));
      pump();
    });
    if (options.assets && existsSync(options.assets))
      await app.register(staticFiles, {
        root: options.assets,
        index: ["index.html"],
      });
    const host = await app.listen({
      host: "127.0.0.1",
      port: options.port ?? 0,
    });
    runtime.endpoint = host;
    atomicWrite(files, JSON.stringify(runtime));
    return {
      app,
      runtime,
      mintLaunch,
      routes,
      async close() {
        for (const stream of streams) stream.end();
        try {
          await app.close();
        } finally {
          try {
            rmSync(files, { force: true });
          } finally {
            data.db.close();
            lock.close();
          }
        }
      },
    };
  } catch (error) {
    await app.close();
    store?.db.close();
    lock.close();
    throw error;
  }
}
