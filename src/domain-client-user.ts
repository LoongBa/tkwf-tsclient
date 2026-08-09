import { type Transport } from "./transport";
import { DomainClientError } from "./domain-client-error";
import { ServiceProxy } from "./service-proxy";
import type { ChainablePromise, ChainableBuilder } from "./chainable";
import { AuthCrypto, type AuthCryptoApi } from "./crypto";
import { QueryBuilderBase, createQueryBuilder } from "./query-builder";

export interface LoginPayload {
  success: boolean;
  userName?: string;
  displayName?: string;
  sessionKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  deviceId?: string;
}

export interface ChallengeResponse {
  challengeToken: string;
  salt: string;
  iterations: number;
}

export interface RegisterResult {
  success: boolean;
  message?: string;
}

export interface PingResult {
  success: boolean;
  isAuthenticated: boolean;
  userName?: string;
  sessionKey?: string;
}

export interface DomainClientUserOptions {
  transport: Transport;
  /** Storage interface for session persistence. Falls back to memory if omitted. */
  storage?: Storage;
  /** Key used to persist session in storage. Must be unique per business domain. */
  storageKey: string;
  /**
   * Map of GraphQL field names to subfield selection strings.
   * Passed through to ServiceProxy for Use()/Call() auto-selection.
   */
  selectionMap?: Record<string, string>;
  /**
   * V4.5: 默认使用安全登录（Challenge-Response）。
   * true:  loginAs() 内部自动走 loginSecure()
   * false: loginAs() 走原有 loginByPassword()（明文过 SSL）
   * 默认: true
   */
  useSecureLogin?: boolean;
}

export class DomainClientUser {
  private transport: Transport;
  private storage: Storage;
  private storageKey: string;
  private selectionMap?: Record<string, string>;
  private _useSecureLogin: boolean;

  sessionKey: string | null = null;
  isAuthenticated: boolean = false;
  userName: string | null = null;
  displayName: string | null = null;

  // ── V4.8.7: 错误处理事件 ──

  /** 认证过期/未登录。应用层应在此事件中跳转登录页。 */
  onAuthRequired?: () => void;

  /** 登录失败（用户名/密码错误）。应用层应在此事件中显示错误提示。 */
  onAuthFailed?: () => void;

  /** 通用服务端错误。应用层应在此事件中记录日志或显示 toast。 */
  onServiceError?: (error: DomainClientError) => void;

  /** 全局错误处理器集合（支持多消费者）。 */
  private _globalErrorHandlers: Set<(error: DomainClientError) => void> = new Set();

  constructor(options: DomainClientUserOptions) {
    this.transport = options.transport;
    this.storage =
      options.storage ??
      (typeof sessionStorage !== "undefined"
        ? sessionStorage
        : createMemoryStorage());
    this.storageKey = options.storageKey;
    this.selectionMap = options.selectionMap;
    this._useSecureLogin = options.useSecureLogin ?? true;
  }

  /** Restore session from storage */
  restore(): boolean {
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return false;
      const state = JSON.parse(raw);
      if (state.sessionKey) {
        this.sessionKey = state.sessionKey;
        this.isAuthenticated = true;
        this.userName = state.userName ?? null;
        this.displayName = state.displayName ?? null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Save session state to storage */
  private persist(): void {
    if (this.sessionKey) {
      this.storage.setItem(
        this.storageKey,
        JSON.stringify({
          sessionKey: this.sessionKey,
          userName: this.userName,
          displayName: this.displayName,
        }),
      );
    } else {
      this.storage.removeItem(this.storageKey);
    }
  }

  /**
   * Login — 自动选择路径。
   * useSecureLogin=true（默认）: 走 loginSecure()（Challenge-Response）
   * useSecureLogin=false        : 走 loginByPassword()（明文过 SSL）
   */
  async loginAs(
    userName: string,
    password: string,
  ): Promise<LoginPayload> {
    if (this._useSecureLogin) {
      return this.loginSecure(userName, password);
    }
    // 兼容明文路径
    const result = await this.transport.execute<{
      loginByPassword: LoginPayload;
    }>({
      field: "loginByPassword",
      type: "mutation",
      variables: { userName, password },
      selection: "success userName displayName sessionKey accessToken refreshToken expiresAt deviceId",
    });

    const payload = result.loginByPassword;
    if (payload.success) {
      this.sessionKey = payload.sessionKey ?? null;
      this.isAuthenticated = true;
      this.userName = payload.userName ?? null;
      this.displayName = payload.displayName ?? null;
      this.persist();
    }
    return payload;
  }

  /** Login with SMS code */
  async loginBySms(
    mobile: string,
    captcha: string,
  ): Promise<LoginPayload> {
    const result = await this.transport.execute<{
      loginBySms: LoginPayload;
    }>({
      field: "loginBySms",
      type: "mutation",
      variables: { mobile, captcha },
      selection: "success userName displayName sessionKey accessToken refreshToken expiresAt deviceId",
    });

    const payload = result.loginBySms;
    if (payload.success) {
      this.sessionKey = payload.sessionKey ?? null;
      this.isAuthenticated = true;
      this.userName = payload.userName ?? null;
      this.displayName = payload.displayName ?? null;
      this.persist();
    }
    return payload;
  }

  /** Login with auth context (supports password, SMS, QR code, token) */
  async loginByContext(
    userName: string,
    credential: string,
    context?: {
      loginFrom?: string;
      authType?: string;
      authInfo?: string;
      deviceId?: string;
    },
  ): Promise<LoginPayload> {
    const result = await this.transport.execute<{ loginByContext: LoginPayload }>({
      field: "loginByContext",
      type: "mutation",
      variables: {
        input: {
          userName,
          credential,
          loginFrom: context?.loginFrom ?? "PcWeb",
          authType: context?.authType ?? "Password",
          authInfo: context?.authInfo,
          deviceId: context?.deviceId,
        },
      },
      sessionKey: this.sessionKey ?? undefined,
      selection: "success userName displayName sessionKey accessToken refreshToken expiresAt deviceId",
    });

    const payload = result.loginByContext;
    if (payload.success) {
      this.sessionKey = payload.sessionKey ?? null;
      this.isAuthenticated = true;
      this.userName = payload.userName ?? null;
      this.displayName = payload.displayName ?? null;
      this.persist();
    }
    return payload;
  }

  // ── V4.5 Secure Login ──

  /**
   * V4.5: Challenge-Response 安全登录。
   * 自动完成 requestChallenge → PBKDF2 → HMAC → submit 三步握手。
   * 服务端永不接收明文密码。
   *
   * @param options.crypto  可替换的 crypto 实现（如 Web Worker），默认 AuthCrypto
   * @param options.iterations PBKDF2 迭代次数，默认使用服务器返回的值
   * @param options.onProgress 进度回调
   */
  async loginSecure(
    userName: string,
    password: string,
    options?: {
      crypto?: AuthCryptoApi;
      iterations?: number;
      onProgress?: (phase: "hashing" | "signing" | "submitting") => void;
    },
  ): Promise<LoginPayload> {
    const cryptoImpl = options?.crypto ?? AuthCrypto;

    // Step 1: Request challenge
    options?.onProgress?.("hashing");
    const challenge = await this.transport.execute<{
      requestChallenge: ChallengeResponse;
    }>({
      field: "requestChallenge",
      type: "query",
      variables: { userName },
    });

    const { challengeToken, salt, iterations } = challenge.requestChallenge;
    const iters = options?.iterations ?? iterations;

    // Step 2: Compute clientHash = PBKDF2(password, salt, iterations)
    const clientHash = await cryptoImpl.pbkdf2(password, salt, iters);

    // Step 3: Compute response = HMAC(clientHash, challengeToken)
    options?.onProgress?.("signing");
    const response = await cryptoImpl.hmac(clientHash, challengeToken);

    // Step 4: Submit via loginByContext with SecurePassword authType
    options?.onProgress?.("submitting");
    return this.loginByContext(userName, response, {
      authType: "SecurePassword",
      authInfo: challengeToken,
    });
  }

  /**
   * V4.5: 安全注册。
   * 生成随机 salt → PBKDF2 → 提交 clientHash + salt 到服务端。
   * 服务端永不接收明文密码。
   */
  async registerSecure(
    userName: string,
    password: string,
    options?: {
      crypto?: AuthCryptoApi;
      iterations?: number;
    },
  ): Promise<RegisterResult> {
    const cryptoImpl = options?.crypto ?? AuthCrypto;
    const iters = options?.iterations ?? 600000;
    const salt = cryptoImpl.randomSalt();
    const clientHash = await cryptoImpl.pbkdf2(password, salt, iters);

    const result = await this.transport.execute<{
      registerSecure: RegisterResult;
    }>({
      field: "registerSecure",
      type: "query",
      variables: {
        input: {
          userName,
          clientHash: clientHash,
          salt,
        },
      },
    });

    return result.registerSecure;
  }

  /** Logout */
  async logout(broadcast: boolean = false): Promise<void> {
    if (this.isAuthenticated) {
      try {
        await this.transport.execute<{ logout: LoginPayload }>({
          field: "logout",
          type: "mutation",
          variables: { broadcast },
          sessionKey: this.sessionKey ?? undefined,
          selection: "success",
        });
      } catch {
        // Best-effort: clear local state regardless
      }
    }
    this.clearLocalState();
  }

  /** Session heartbeat */
  async ping(): Promise<PingResult | null> {
    try {
      const result = await this.transport.execute<{ ping: PingResult }>({
        field: "ping",
        type: "mutation", // ping 在 EXPLICIT_MUTATIONS 中，属 mutation 类
        sessionKey: this.sessionKey ?? undefined,
        selection: "success isAuthenticated userName sessionKey",
      });
      return result.ping;
    } catch {
      return null;
    }
  }

  /** Generic query (for ad-hoc usage) */
  async query<TData = unknown, TVars = Record<string, unknown>>(
    field: string,
    variables?: TVars,
    options?: { signal?: AbortSignal },
  ): Promise<TData> {
    return this.transport.execute<TData>({
      field,
      type: "query",
      variables: variables as Record<string, unknown> | undefined,
      sessionKey: this.sessionKey ?? undefined,
      signal: options?.signal,
    });
  }

  /** Generic mutation */
  async mutate<TData = unknown, TVars = Record<string, unknown>>(
    field: string,
    variables?: TVars,
    options?: { signal?: AbortSignal },
  ): Promise<TData> {
    return this.transport.execute<TData>({
      field,
      type: "mutation",
      variables: variables as Record<string, unknown> | undefined,
      sessionKey: this.sessionKey ?? undefined,
      signal: options?.signal,
    });
  }

  private clearLocalState(): void {
    this.sessionKey = null;
    this.isAuthenticated = false;
    this.userName = null;
    this.displayName = null;
    this.storage.removeItem(this.storageKey);
  }

  // ── V4.8.7: 错误处理 ──

  /** 注册全局错误处理器（支持多消费者）。 */
  onGlobalError(handler: (error: DomainClientError) => void): this {
    this._globalErrorHandlers.add(handler);
    return this;
  }

  /** 移除全局错误处理器。 */
  offGlobalError(handler: (error: DomainClientError) => void): void {
    this._globalErrorHandlers.delete(handler);
  }

  /**
   * V4.8.7: 处理 DomainClientError，分发到对应的事件。
   * 由 ServiceProxy 在捕获到 DomainClientError 时调用。
   */
  handleError(error: DomainClientError): void {
    // 1. 触发特定事件
    switch (error.code) {
      case "AUTH_REQUIRED":
        this.onAuthRequired?.();
        break;
      case "AUTH_FAILED":
        this.onAuthFailed?.();
        break;
      default:
        this.onServiceError?.(error);
        break;
    }

    // 2. 触发全局错误处理器
    for (const handler of this._globalErrorHandlers) {
      try {
        handler(error);
      } catch {
        // 处理器异常不应影响其他处理器
      }
    }
  }

  /** The transport instance (for Use/Call proxy to leverage) */
  getTransport(): Transport {
    return this.transport;
  }

  /** V4.9.20: 创建实体查询构建器（需先运行 codegen 注册 QueryBuilder 工厂）。 */
  Query<TEntity = any>(
    entityName: string,
    resolverField?: string,
  ): QueryBuilderBase<TEntity, any, any, any> {
    return createQueryBuilder<TEntity>(
      entityName,
      this.transport,
      this.sessionKey ?? undefined,
      resolverField,
    );
  }

  /** @internal Global error handler (set by DomainHostClient) */
  private _globalErrorHandler?: (error: DomainClientError) => void;

  /** Create a Use() proxy for async/await-style API calls. */
  Use<TService = Record<string, (...args: unknown[]) => ChainablePromise<unknown>>>(
    _serviceName?: string,
  ): TService {
    const proxy = new ServiceProxy({
      transport: this.transport,
      sessionKey: this.sessionKey,
      globalErrorHandler: this._globalErrorHandlers.size > 0
        ? (err) => this._globalErrorHandlers.forEach(h => { try { h(err); } catch { /* best-effort */ } })
        : undefined,
      userErrorHandler: (err) => this.handleError(err),
      explicitMutations: EXPLICIT_MUTATIONS,
      selectionMap: this.selectionMap,
    });
    return proxy.createUse() as unknown as TService;
  }

  /** Create a Call() proxy for callback-chain-style API calls. */
  Call(_serviceName: string): Record<string, (...args: unknown[]) => ChainableBuilder<unknown>> {
    const proxy = new ServiceProxy({
      transport: this.transport,
      sessionKey: this.sessionKey,
      userErrorHandler: (err) => this.handleError(err),
      explicitMutations: EXPLICIT_MUTATIONS,
      selectionMap: this.selectionMap,
    });
    return proxy.createCall();
  }

  /**
   * Set the global error handler.
   * Called by DomainHostClient during GetUser()/GetGuest().
   * @internal
   */
  _setGlobalErrorHandler(handler: (error: DomainClientError) => void): void {
    this._globalErrorHandler = handler;
  }
}

/**
 * Mutation field names whose generated methods don't match the
 * ServiceProxy prefix heuristic (create/update/delete/…).
 *
 * MUST be kept in sync with the schema's Mutation type.
 */
const EXPLICIT_MUTATIONS: ReadonlySet<string> = new Set([
  "ping",
  "loginByPassword",
  "loginByContext",
  "loginBySms",
  "loginByQrCode",
  "logout",
  // V4.5
  "requestChallenge",
  "registerSecure",
]);

/** In-memory storage fallback for SSR */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}
