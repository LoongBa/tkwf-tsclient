import { type Transport, type ExternalLoginResult } from "./transport";
import { DomainClientError } from "./domain-client-error";
import { ServiceProxy } from "./service-proxy";
import type { ChainablePromise } from "./chainable";
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

/**
 * V1.0.12: 外部 IdP（JWT）会话——与 sessionKey 会话并列的独立形态（零 flag 判别：形态即字段存在性）。
 * `expiresAt` 为 SDK 计算的 unix 毫秒（Date.now() + expiresIn * 1000），
 * 与服务端 GraphQL LoginPayload.expiresAt（ISO 字符串）语义不同源（M11）。
 */
export interface ExternalSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;   // unix ms
}

export interface DomainClientUserOptions {
  transport: Transport;
  /** Storage interface for session persistence. Falls back to memory if omitted. */
  storage?: Storage;
  /** Key used to persist session in storage. Must be unique per business domain. */
  storageKey: string;
  /**
   * Map of GraphQL field names to subfield selection strings.
   * Passed through to ServiceProxy for Use() auto-selection.
   */
  selectionMap?: Record<string, string>;
  /**
   * Map of GraphQL field names to per-variable GraphQL type declarations.
   * Passed through to ServiceProxy for Use() variable type declarations.
   */
  variableTypesMap?: Record<string, Record<string, string>>;
  /**
   * Map of GraphQL field names to their authoritative operation kind ('query' | 'mutation').
   * V1.0.11（G16 根治）：codegen 产物（消费端 ts-client.g.ts `operationKinds`，由 schema 根类型
   * 权威判定生成，见 schema-parser.buildOperationKinds）。判定优先级最高——命中即直接决定操作类型，
   * 不再走前缀启发式。与 selectionMap/variableTypesMap 同源同代。
   */
  operationKinds?: Readonly<Record<string, "query" | "mutation">>;
  /** Mutation field names that don't match the prefix heuristic (e.g. "ping", "logout").
   *  V1.0.11 起为向后兼容兜底：Use() 构造 ServiceProxy 时与内置 EXPLICIT_MUTATIONS 合并
   *  （new Set([...EXPLICIT_MUTATIONS, ...this.explicitMutations])），仅影响未接线 operationKinds 的路径。 */
  explicitMutations?: ReadonlySet<string>;
  /** V1.0.11：关闭废弃前缀启发式的单次告警（透传 ServiceProxy）。 */
  suppressHeuristicWarning?: boolean;
  /**
   * V4.5: 默认使用安全登录（Challenge-Response）。
   * true:  loginAs() 内部自动走 loginSecure()
   * false: loginAs() 走原有 loginByPassword()（明文过 SSL）
   * 默认: true
   */
  useSecureLogin?: boolean;
  /**
   * V1.0.12: 外部 IdP 登录专用 REST 通道（N1）——GraphQL 主传输下 loginByExternal/refreshJwt 的能力兜底。
   * 见 DomainHostClientOptions.externalLoginTransport 的说明。优先级：
   * externalLoginTransport > 主 transport 的 loginByExternal?/refreshToken? 能力方法 > 守卫抛 EXTERNAL_LOGIN_FAILED。
   */
  externalLoginTransport?: Transport;
}

export class DomainClientUser {
  private transport: Transport;
  private storage: Storage;
  private storageKey: string;
  private selectionMap?: Record<string, string>;
  private variableTypesMap?: Record<string, Record<string, string>>;
  private operationKinds?: Readonly<Record<string, "query" | "mutation">>;
  private explicitMutations?: ReadonlySet<string>;
  private suppressHeuristicWarning?: boolean;
  private _useSecureLogin: boolean;
  private externalLoginTransport?: Transport;  // V1.0.12（N1）

  sessionKey: string | null = null;
  isAuthenticated: boolean = false;
  userName: string | null = null;
  displayName: string | null = null;
  /** V1.0.12: 外部 IdP（JWT）会话——与 sessionKey 互斥（至多一个非 null，N3），零 flag 判别。 */
  externalSession: ExternalSession | null = null;

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
    this.variableTypesMap = options.variableTypesMap;
    this.operationKinds = options.operationKinds;
    this.explicitMutations = options.explicitMutations;
    this.suppressHeuristicWarning = options.suppressHeuristicWarning;
    this._useSecureLogin = options.useSecureLogin ?? true;
    this.externalLoginTransport = options.externalLoginTransport;  // V1.0.12（N1）
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
      // V1.0.12: 外部 IdP（JWT）会话——形态即字段存在性（零 flag 判别，M4）。
      if (state.externalSession?.accessToken) {
        this.externalSession = {
          accessToken: state.externalSession.accessToken,
          refreshToken: state.externalSession.refreshToken ?? "",
          expiresAt: typeof state.externalSession.expiresAt === "number" ? state.externalSession.expiresAt : 0,
        };
        this.isAuthenticated = true;
        // N2: JWT 会话无 userName/displayName（服务端 TokenResponse wire 无此字段）——存 null，消费方按需另调 profile API
        this.userName = null;
        this.displayName = null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Save session state to storage */
  private persist(): void {
    // V1.0.12: 两形态至多一个非 null（N3 互斥不变量）；任一存在则写，否则清除
    if (this.sessionKey || this.externalSession) {
      this.storage.setItem(
        this.storageKey,
        JSON.stringify({
          sessionKey: this.sessionKey,
          userName: this.sessionKey ? this.userName : null,
          displayName: this.sessionKey ? this.displayName : null,
          // V1.0.12：JWT 会话字段（仅外部 IdP 登录时非空）——旧持久化数据无此键，restore 兼容
          externalSession: this.externalSession,
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
      this.externalSession = null;  // V1.0.12（N3）：形态切换互斥——GraphQL 登录清旧 JWT 会话
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
      this.externalSession = null;  // V1.0.12（N3）：形态切换互斥——GraphQL 登录清旧 JWT 会话
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
      variableTypes: { input: "LoginContextInput!" },
      variables: {
        input: {
          userName,
          credential,
          loginFrom: context?.loginFrom ?? "PC_WEB",
          authType: context?.authType ?? "PASSWORD",
          authInfo: context?.authInfo,
          deviceId: context?.deviceId,
        },
      },
      selection: "success userName displayName sessionKey accessToken refreshToken expiresAt deviceId",
    });

    const payload = result.loginByContext;
    if (payload.success) {
      this.sessionKey = payload.sessionKey ?? null;
      this.isAuthenticated = true;
      this.userName = payload.userName ?? null;
      this.displayName = payload.displayName ?? null;
      this.externalSession = null;  // V1.0.12（N3）：形态切换互斥——GraphQL 登录清旧 JWT 会话
      this.persist();
    }
    return payload;
  }

  // ── V1.0.12: 外部 IdP 登录（JWT 会话）──

  /**
   * 解析外部 IdP 登录携带通道：externalLoginTransport（N1 注入）优先，其次主 transport 的能力方法
   * `loginByExternal?`/`refreshToken?`（P3 能力即注册，null 即不支持）。两者皆无 → 返回 null（守卫硬失败）。
   */
  private getExternalChannel(): Transport | null {
    // 注入通道优先（GraphQL 主传输下能力兜底，N1）
    if (this.externalLoginTransport) return this.externalLoginTransport;
    const t = this.transport as Transport;
    if (t.loginByExternal || t.refreshToken) return t;
    return null;
  }

  /**
   * V1.0.12：外部 IdP 登录——对接认证中心 `POST {base}{urlMap["loginByExternal"]}`（默认
   * `/api/auth/login/external/{channelType}`）。Guest 语义（游客帧，服务端 `.AllowAnonymous()`）。
   *
   * - channelType：自由字符串（wechat_oauth / qq_oauth / alipay_oauth / oidc…，+ 扩展侧 ticket 变体）
   * - parameters：原样透传（含 code/channel_id/state/ticket 等平台协议字段）
   * - 成功 → externalSession{accessToken/refreshToken/expiresAt} 持久化（会话升级；N3 清旧 sessionKey）
   * - 失败 → 抛 DomainClientError（INVALID_ARGUMENT / EXTERNAL_LOGIN_FAILED / JWT_SESSION_INVALID / 服务端透传）
   */
  async loginByExternal(
    channelType: string,
    parameters: Record<string, string>,
    options?: { signal?: AbortSignal },
  ): Promise<ExternalLoginResult> {
    // 前置守卫（P7 缺省=守卫硬失败，不静默；不送服务端）
    if (!channelType || !channelType.trim()) {
      throw new DomainClientError(
        "External login failed: channelType must be a non-empty string.",
        "INVALID_ARGUMENT",
      );
    }
    if (!parameters.code && !parameters.ticket) {
      throw new DomainClientError(
        "External login failed: 'code' (or 'ticket' for the ticket channel) parameter is required.",
        "INVALID_ARGUMENT",
      );
    }

    const channel = this.getExternalChannel();
    if (!channel || !channel.loginByExternal) {
      throw new DomainClientError(
        "External IdP login requires a REST channel. Configure DomainHostClientOptions.externalLoginTransport " +
        "or use transportType: 'rest' (GraphQL transport does not register loginByExternal).",
        "EXTERNAL_LOGIN_FAILED",
      );
    }

    const result = await channel.loginByExternal({
      channelType: channelType.trim(),
      parameters,
      signal: options?.signal,
    });

    // 守卫：wire 契约缺 AccessToken（含 casing 错误——服务端返 snake_case 时 accessToken undefined）→ 显式错误
    if (!result.accessToken) {
      throw new DomainClientError(
        "External IdP login response is missing 'accessToken' (server TokenResponse wire is camelCase).",
        "JWT_SESSION_INVALID",
      );
    }

    // N3 互斥：外部登录成功 → 清旧 GraphQL 会话，落 JWT 会话
    this.sessionKey = null;
    this.externalSession = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + result.expiresIn * 1000,  // M11：秒 → unix ms（SDK 计算）
    };
    this.isAuthenticated = true;
    this.userName = null;       // N2：JWT 会话无显示名（wire 无此字段），消费方按需另调 profile API
    this.displayName = null;
    this.persist();
    return result;
  }

  /**
   * V1.0.12：外部 IdP 会话显式续期（P5 显式，不做自动隐式 refresh）。
   *
   * - 成功 → 更新 externalSession 持久化
   * - 4xx（refresh token 失效/被撤销）→ 抛 JWT_SESSION_INVALID + 清 externalSession（强制重登；
   *   不触发 onUnauthorized 二次——防循环；S4 语义分层）
   * - 网络失败（NETWORK_ERROR/TIMEOUT/CANCELLED）→ 保留 externalSession（access 仍可用至过期），原样抛错
   */
  async refreshJwt(signal?: AbortSignal): Promise<ExternalLoginResult> {
    if (!this.externalSession) {
      throw new DomainClientError(
        "External session refresh failed: no active JWT session.",
        "JWT_SESSION_INVALID",
      );
    }
    const channel = this.getExternalChannel();
    if (!channel || !channel.refreshToken) {
      throw new DomainClientError(
        "External IdP refresh requires a REST channel. Configure DomainHostClientOptions.externalLoginTransport " +
        "or use transportType: 'rest'.",
        "EXTERNAL_LOGIN_FAILED",
      );
    }

    try {
      const result = await channel.refreshToken({
        refreshToken: this.externalSession.refreshToken,
        signal,
      });

      // 成功 → 更新会话（refresh rotation：新 token 对 + 新 expiresAt）
      this.externalSession = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresAt: Date.now() + result.expiresIn * 1000,
      };
      this.persist();
      return result;
    } catch (err) {
      // M7/S4（Oracle 代码审核 M1）：JWT_SESSION_INVALID = refresh token 已失效/被撤销 → 清 externalSession
      // + persist——"强制重登"语义；若不清理，用户保持 isAuthenticated + 携失效 Bearer → 401 AUTH_EXPIRED →
      // 消费端再调 refreshJwt → 同一失效 refresh token → 死循环（"不触发 onUnauthorized 二次"依赖清会话）。
      // 网络失败（NETWORK_ERROR/TIMEOUT/CANCELLED）与 service 内其他 4xx 业务码保持原样抛错（S4 分层）。
      if (err instanceof DomainClientError && err.code === "JWT_SESSION_INVALID") {
        this.externalSession = null;
        this.isAuthenticated = false;
        this.persist();
      }
      throw err;
    }
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
      selection: "challengeToken salt iterations",
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
      authType: "SECURE_PASSWORD",
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
    const clientHashBytes = await cryptoImpl.pbkdf2(password, salt, iters);
    const clientHash = cryptoImpl.bytesToHex(clientHashBytes);

    const result = await this.transport.execute<{
      registerSecure: RegisterResult;
    }>({
      field: "registerSecure",
      type: "query",
      variableTypes: { input: "RegisterSecureInput!" },
      variables: {
        input: {
          userName,
          clientHash,
          salt,
        },
      },
      selection: "success message",
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
          bearerToken: this.bearerAuthorization,  // V1.0.12: JWT 会话 logout 同样携带
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
        type: "mutation", // V1.0.11（Oracle S4）特例：ping 硬编码 mutation 直调 transport，不经 ServiceProxy.isMutation——operationKinds 不改变此路径；须与 schema Mutation 权威保持一致
        sessionKey: this.sessionKey ?? undefined,
        bearerToken: this.bearerAuthorization,  // V1.0.12: JWT 会话 ping 同样携带
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
      bearerToken: this.bearerAuthorization,  // V1.0.12: JWT 会话
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
      bearerToken: this.bearerAuthorization,  // V1.0.12: JWT 会话
      signal: options?.signal,
    });
  }

  private clearLocalState(): void {
    this.sessionKey = null;
    this.isAuthenticated = false;
    this.userName = null;
    this.displayName = null;
    this.externalSession = null;  // V1.0.12: 同步清理 JWT 会话（M4 配套——防登出后残留重写陈旧会话）
    this.storage.removeItem(this.storageKey);
  }

  /** V1.0.12: JWT 会话 Bearer 凭据（传输携带点取值源；无会话时为 undefined）。 */
  private get bearerAuthorization(): string | undefined {
    return this.externalSession?.accessToken ?? undefined;
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
      this.bearerAuthorization,  // V1.0.12: JWT 会话 Bearer 透传（M6）
    );
  }

  /** Create a Use() proxy for async/await-style API calls. */
  Use<TService = Record<string, (...args: unknown[]) => ChainablePromise<unknown>>>(
    _serviceName?: string,
  ): TService {
    const proxy = new ServiceProxy({
      transport: this.transport,
      sessionKey: this.sessionKey,
      bearerToken: this.bearerAuthorization,  // V1.0.12: JWT 会话 Bearer 透传（M6）
      globalErrorHandler: this._globalErrorHandlers.size > 0
        ? (err) => this._globalErrorHandlers.forEach(h => { try { h(err); } catch { /* best-effort */ } })
        : undefined,
      userErrorHandler: (err) => this.handleError(err),
      // V1.0.11（G16 根治）：operationKinds（主权威）透传；explicitMutations 合并内置登录
      // （未接线兜底——undefined 时用 EXPLICIT_MUTATIONS 原引用零拷贝；配置时取并集）
      operationKinds: this.operationKinds,
      explicitMutations: this.explicitMutations
        ? new Set([...EXPLICIT_MUTATIONS, ...this.explicitMutations])
        : EXPLICIT_MUTATIONS,
      suppressHeuristicWarning: this.suppressHeuristicWarning,
      selectionMap: this.selectionMap,
      variableTypesMap: this.variableTypesMap,
    });
    return proxy.createUse() as unknown as TService;
  }

  /**
   * Create a Query-builder proxy for type-safe IQueryable chain queries.
   */
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
