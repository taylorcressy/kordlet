import {
  product,
  operations,
  type Operation,
  type Input,
  type Output,
} from "../contracts/index.ts";
export type Failure = {
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
  currentRevision?: number;
};
export class ApiError extends Error {
  constructor(public failure: Failure) {
    super(failure.message);
  }
}
export function apiClient(endpoint = "", token?: string, agentSession?: string) {
  return async <K extends Operation>(
    operation: K,
    input: Input<K>,
    key?: string,
  ): Promise<Output<K>> => {
    const meta = operations[operation];
    const remaining = { ...input } as Record<string, unknown>;
    const path = meta.path.replace(/:([a-zA-Z]+)/g, (_, name: string) => {
      const value = remaining[name];
      delete remaining[name];
      if (typeof value !== "string" || !value)
        throw new ApiError({
          code: "invalid_input",
          message: "Missing path field " + name,
          requestId: "client",
          retryable: false,
        });
      return encodeURIComponent(value);
    });
    const query = new URLSearchParams();
    if (meta.method === "GET")
      for (const [k, v] of Object.entries(remaining)) {
        if (v === undefined) continue;
        if (
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean"
        )
          query.set(k, String(v));
        else
          throw new ApiError({
            code: "invalid_input",
            message: "Invalid query value for " + k,
            requestId: "client",
            retryable: false,
          });
      }
    let response: Response;
    try {
      response = await fetch(
        endpoint + "/api/v1" + path + (query.size ? "?" + query : ""),
        {
          method: meta.method,
          headers: {
            "Kordlet-Contract": product.contract,
            ...(agentSession ? { "Kordlet-Agent-Session": agentSession } : {}),
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...(key !== undefined ? { "Idempotency-Key": key } : {}),
            ...(meta.method === "GET"
              ? {}
              : { "Content-Type": "application/json" }),
          },
          body: meta.method === "GET" ? undefined : JSON.stringify(remaining),
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        },
      );
    } catch {
      throw new ApiError({
        code: "service_unavailable",
        message: "Kordlet is offline. Start it with kordlet serve.",
        requestId: "client",
        retryable: true,
      });
    }
    const data = await response.json();
    if (!response.ok) throw new ApiError(data);
    return data;
  };
}
