/**
 * V4.5: AuthCrypto — Web Crypto API 封装。
 *
 * 设计原则：
 * - 零外部依赖：使用浏览器原生 crypto.subtle / Node.js 18+ globalThis.crypto.subtle
 * - Tree-shakeable：可独立导入，不依赖 DomainClientUser
 * - 可在 Web Worker 中运行（纯计算，无 DOM 依赖）
 *
 * 提供的操作：
 *   pbkdf2(password, saltHex, iterations) → Uint8Array (32 bytes)
 *   hmac(keyBytes, tokenBase64)           → string (hex)
 *   randomSalt()                          → string (hex, 32 bytes)
 *   bytesToHex / hexToBytes / base64ToBytes
 */

// ---------------------------------------------------------------------------
// Core crypto operations
// ---------------------------------------------------------------------------

/**
 * PBKDF2-HMAC-SHA256 密钥派生。
 * 与服务器端 ChallengeTokenService 的 HMAC-SHA256 配对使用。
 *
 * @param password  用户输入的密码
 * @param saltHex   十六进制 salt（服务器返回，32 bytes = 64 hex chars）
 * @param iterations 迭代次数（服务器返回，默认 600000）
 * @returns 32 bytes 的派生密钥
 */
export async function pbkdf2(
  password: string,
  saltHex: string,
  iterations: number,
): Promise<Uint8Array> {
  const salt = hexToBytes(saltHex).buffer as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" } as Pbkdf2Params,
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * HMAC-SHA256 签名。
 * 客户端用 clientHash 签名整个 challengeToken。
 *
 * @param keyBytes     PBKDF2 输出的 32 bytes
 * @param tokenBase64  服务器返回的自签名 challenge token（base64）
 * @returns hex 编码的 HMAC 签名（64 hex chars = 32 bytes）
 */
export async function hmac(
  keyBytes: Uint8Array,
  tokenBase64: string,
): Promise<string> {
  const token = base64ToBytes(tokenBase64).buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" } as HmacImportParams,
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, token);
  return bytesToHex(new Uint8Array(signature));
}

/**
 * 生成 32 bytes 随机 salt（hex 编码）。
 * 用于注册时客户端生成 salt。
 */
export function randomSalt(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Uint8Array → lowercase hex */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** lowercase hex → Uint8Array */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}

/** base64 → Uint8Array */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// AuthCrypto namespace export (for tree-shaking / Worker usage)
// ---------------------------------------------------------------------------

export const AuthCrypto = {
  pbkdf2,
  hmac,
  randomSalt,
  bytesToHex,
  hexToBytes,
  base64ToBytes,
} as const;

export type AuthCryptoApi = typeof AuthCrypto;