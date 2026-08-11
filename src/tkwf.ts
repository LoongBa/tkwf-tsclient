import {
  DomainHostClient,
  type DomainHostClientOptions,
  type GlobalErrorHandler as HostGlobalErrorHandler,
  type PongHandler,
} from "./domain-host-client";
import type { DomainClientUser } from "./domain-client-user";
import type {
  SignHandler,
  RequestContext,
  ResponseContext,
} from "./transport";

/**
 * V1.0.4: Tkwf 门面工厂配置。
 *
 * 继承 DomainHostClientOptions 的所有传输/会话配置，
 * 额外把原 DomainHostClient 上通过链式方法设置的钩子
 * （onSign / onGlobalError / onPong / onRequest / onResponse）
 * 以及新增的 onUnauthorized 统一收进一个配置对象。
 */
export interface TkwfConfig extends DomainHostClientOptions {
  /** 未登录/会话过期时的回调（如跳转登录页）。User 访问无本地 session 时触发。 */
  onUnauthorized?: () => void;
  /** 请求签名处理器（对应 DomainHostClient.onSign）。 */
  onSign?: SignHandler;
  /** 请求拦截器（对应 DomainHostClient.onRequest）。 */
  onRequest?: (
    req: RequestContext,
  ) => void | RequestContext | Promise<RequestContext | void>;
  /** 响应拦截器（对应 DomainHostClient.onResponse）。 */
  onResponse?: (res: ResponseContext, req: RequestContext) => void;
  /** 心跳检测配置（对应 DomainHostClient.onPong）。 */
  onPong?: { intervalMinutes: number; handler: PongHandler };
  /** 全局错误处理器（对应 DomainHostClient.onGlobalError）。 */
  onGlobalError?: HostGlobalErrorHandler;
}

const DEFAULT_SCENARIO = "default";

/**
 * V1.0.4: Tkwf 门面工厂。
 *
 * 在 DomainHostClient 之上提供一套集中配置 + 一行调用的静态入口：
 *
 * ```ts
 * // 应用入口 —— 只配置一次
 * Tkwf.configure("default", {
 *   endpoint: "/graphql",
 *   storage: localStorage,
 *   onUnauthorized: () => redirectToLogin(),
 *   onGlobalError: (err) => toast(err.message),
 * });
 *
 * // 页面 —— 一行调用
 * const profile = await Tkwf.User.Use<UserInfoService>().getMyProfile();
 * const list = await Tkwf.Guest.Use<IPublicService>().getProducts();
 *
 * // 多场景切换
 * const user = Tkwf.GetUser("merchant-a");
 * ```
 *
 * User / Guest 语义（Level 0）：
 * - `User`  显式声明"预先验证身份"——内部走 GetUser()，无本地 session 时
 *   触发 onUnauthorized 钩子并抛 AUTH_REQUIRED。
 * - `Guest` 显式声明"不预先验证"——内部走 GetGuest()，直接调用，
 *   是否允许由服务端裁决（返回 401/403 时由 onGlobalError 兜底）。
 */
export class Tkwf {
  private static hosts = new Map<string, DomainHostClient>();
  private static configs = new Map<string, TkwfConfig>();

  private constructor() {} // 纯静态类，禁止实例化

  /** 集中配置。name 为场景名，未指定场景配置时默认使用 "default"。 */
  static configure(name: string, opts: TkwfConfig): void {
    const host = DomainHostClient.init(name, opts);
    if (opts.onSign) host.onSign(opts.onSign);
    if (opts.onRequest) host.onRequest(opts.onRequest);
    if (opts.onResponse) host.onResponse(opts.onResponse);
    if (opts.onPong) host.onPong(opts.onPong.intervalMinutes, opts.onPong.handler);
    if (opts.onGlobalError) host.onGlobalError(opts.onGlobalError);

    this.hosts.set(name, host);
    this.configs.set(name, opts);
  }

  /** 默认场景的认证用户入口。未配置或未登录时抛错/触发钩子。 */
  static get User(): DomainClientUser {
    const host = this.getHost(DEFAULT_SCENARIO);
    try {
      return host.GetUser();
    } catch (err) {
      this.getConfig(DEFAULT_SCENARIO).onUnauthorized?.();
      throw err;
    }
  }

  /** 默认场景的游客入口。不预先验证，直接调用。 */
  static get Guest(): DomainClientUser {
    return this.getHost(DEFAULT_SCENARIO).GetGuest();
  }

  /** 指定场景的认证用户入口（切换场景）。 */
  static GetUser(scenario: string): DomainClientUser {
    const host = this.getHost(scenario);
    try {
      return host.GetUser();
    } catch (err) {
      this.configs.get(scenario)?.onUnauthorized?.();
      throw err;
    }
  }

  /** 指定的场景的游客入口（切换场景）。 */
  static GetGuest(scenario: string): DomainClientUser {
    return this.getHost(scenario).GetGuest();
  }

  /** 清空所有已配置的场景（V1.0.4: 主要供测试/热重载使用）。 */
  static reset(): void {
    this.hosts.clear();
    this.configs.clear();
  }

  private static getHost(scenario: string): DomainHostClient {
    const host = this.hosts.get(scenario);
    if (!host) {
      throw new Error(
        `Tkwf is not configured for scenario "${scenario}".\n` +
          `Call Tkwf.configure("${scenario}", {...}) in your app entry point first.\n` +
          `Example:\n  import { Tkwf } from "@tkwf/tsclient";\n` +
          `  Tkwf.configure("${scenario}", { endpoint: "/graphql" });`,
      );
    }
    return host;
  }

  private static getConfig(scenario: string): TkwfConfig {
    const opts = this.configs.get(scenario);
    if (!opts) {
      throw new Error(
        `Tkwf has no config for scenario "${scenario}". Call Tkwf.configure() first.`,
      );
    }
    return opts;
  }
}