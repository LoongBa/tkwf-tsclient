export { DomainClientError, toErrorCode } from "./domain-client-error";
export type { ErrorCode } from "./domain-client-error";

export { GraphQLTransport } from "./transport";
export { RestTransport } from "./rest-transport";
export type { RestTransportOptions } from "./rest-transport";
export type {
  Transport,
  TransportOptions,
  SignHandler,
  RequestContext,
  ResponseContext,
} from "./transport";

export { ChainablePromise, ChainableBuilder } from "./chainable";
export type { CallbackOptions } from "./chainable";

export { QueryString } from "./query-string";
export type { QueryStringFieldOptions, QueryStringSchema, ParsedResult } from "./query-string";

export { Pager } from "./pager";
export type { PagerOptions } from "./pager";

export { ServiceProxy } from "./service-proxy";
export type { ServiceProxyOptions, GlobalErrorHandler } from "./service-proxy";

export { DomainClientUser } from "./domain-client-user";
export type { DomainClientUserOptions, LoginPayload, PingResult, ChallengeResponse, RegisterResult } from "./domain-client-user";

export { DomainHostClient } from "./domain-host-client";
export type { DomainHostClientOptions, PongHandler } from "./domain-host-client";

// V4.5
export { AuthCrypto, pbkdf2, hmac, randomSalt, bytesToHex, hexToBytes, base64ToBytes } from "./crypto";
export type { AuthCryptoApi } from "./crypto";

// V4.9.20 — QueryBuilder 链式查询
export { QueryBuilderBase, deriveResolverField, registerQueryBuilder, createQueryBuilder, resetQueryBuilderRegistry, getQueryBuilderFactory, LeafNode, CompoundNode } from "./query-builder";
export type { QueryBuilderFactory } from "./query-builder";
export { PagedResponse, PageInfoData } from "./query-builder-types";
export type {
  PredicateNode, StringFieldOperators, NumberFieldOperators,
  DateFieldOperators, BooleanFieldOperators, SortNode,
} from "./query-builder-types";
