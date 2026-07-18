import type { Transport } from "./transport";
import { ChainablePromise, ChainableBuilder } from "./chainable";
import type { DomainClientError } from "./domain-client-error";

const MUTATION_PREFIXES = [
  "create", "update", "delete", "add", "remove",
  "lock", "unlock", "reset",
];

function isMutation(name: string, explicitMutations?: ReadonlySet<string>): boolean {
  if (explicitMutations?.has(name)) return true;
  const lower = name.toLowerCase();
  return MUTATION_PREFIXES.some((p) => lower.startsWith(p));
}

function toGraphQLField(name: string): string {
  if (!name) return name;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export type GlobalErrorHandler = (error: DomainClientError) => void;

export interface ServiceProxyOptions {
  transport: Transport;
  sessionKey?: string | null;
  globalErrorHandler?: GlobalErrorHandler;
  /** Map of GraphQL field names to their subfield selection strings.
   *  When provided, the proxy automatically appends `{ selection }` to each request.
   *  When omitted, the caller must provide `selection` directly in Transport.execute(). */
  selectionMap?: Record<string, string>;
  /** Mutation field names that don't match the prefix heuristic (e.g. "ping", "logout").
   *  When provided, these override the prefix-based detection. */
  explicitMutations?: ReadonlySet<string>;
}

export class ServiceProxy {
  private transport: Transport;
  private sessionKey?: string | null;
  private globalErrorHandler?: GlobalErrorHandler;
  private selectionMap?: Record<string, string>;
  private explicitMutations?: ReadonlySet<string>;

  constructor(options: ServiceProxyOptions) {
    this.transport = options.transport;
    this.sessionKey = options.sessionKey;
    this.globalErrorHandler = options.globalErrorHandler;
    this.selectionMap = options.selectionMap;
    this.explicitMutations = options.explicitMutations;
  }

  createUse(): Record<string, (...args: unknown[]) => ChainablePromise<unknown>> {
    return new Proxy(
      {} as Record<string, (...args: unknown[]) => ChainablePromise<unknown>>,
      {
        get: (_target, prop: string | symbol) => {
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            const field = toGraphQLField(prop);
            const type = isMutation(prop, this.explicitMutations) ? "mutation" as const : "query" as const;
            const variables = args[0] as Record<string, unknown> | undefined;
            // args[1] is an optional options bag with { signal?, selection? }
            const options = args.length > 1 && typeof args[1] === "object" && args[1] !== null
              ? (args[1] as { signal?: AbortSignal; selection?: string })
              : undefined;
            const sel = options?.selection ?? this.selectionMap?.[field];

            return new ChainablePromise(
              (resolve, reject) => {
                this.transport
                  .execute({
                    field,
                    type,
                    variables,
                    selection: sel,
                    sessionKey: this.sessionKey ?? undefined,
                    signal: options?.signal,
                  })
                  .then(resolve)
                  .catch(reject);
              },
              this.globalErrorHandler,
            );
          };
        },
      },
    );
  }

  createCall(): Record<string, (...args: unknown[]) => ChainableBuilder<unknown>> {
    return new Proxy(
      {} as Record<string, (...args: unknown[]) => ChainableBuilder<unknown>>,
      {
        get: (_target, prop: string | symbol) => {
          if (typeof prop !== "string") return undefined;
          return (...args: unknown[]) => {
            const field = toGraphQLField(prop);
            const type = isMutation(prop, this.explicitMutations) ? "mutation" as const : "query" as const;
            const variables = args[0] as Record<string, unknown> | undefined;
            // args[1] is an optional options bag with { signal?, selection? }
            const options = args.length > 1 && typeof args[1] === "object" && args[1] !== null
              ? (args[1] as { signal?: AbortSignal; selection?: string })
              : undefined;
            const sel = options?.selection ?? this.selectionMap?.[field];

            return new ChainableBuilder((resolve, reject) => {
              this.transport
                .execute({
                  field,
                  type,
                  variables,
                  selection: sel,
                  sessionKey: this.sessionKey ?? undefined,
                  signal: options?.signal,
                })
                .then(resolve)
                .catch(reject);
            });
          };
        },
      },
    );
  }
}
