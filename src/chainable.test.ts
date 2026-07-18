import { describe, it, expect, vi } from "vitest";
import { ChainablePromise, ChainableBuilder } from "./chainable";
import { DomainClientError } from "./domain-client-error";

// ---------------------------------------------------------------------------
// ChainablePromise
// ---------------------------------------------------------------------------
describe("ChainablePromise", () => {
  it("resolves via then", async () => {
    const p = new ChainablePromise<number>((resolve) => resolve(42));
    await expect(p.then((v) => v)).resolves.toBe(42);
  });

  it("rejects via catch", async () => {
    const err = new DomainClientError("fail", "SERVER_ERROR");
    const p = new ChainablePromise<never>((_, reject) => reject(err));
    await expect(p.catch((e) => e)).resolves.toBe(err);
  });

  it("supports await (thenable)", async () => {
    const p = new ChainablePromise<number>((resolve) => resolve(7));
    await expect(p).resolves.toBe(7);
  });

  it("forwards resolved value through then chain", async () => {
    const p = new ChainablePromise<number>((resolve) => resolve(2));
    const result = await p.then((v) => v * 3).then((v) => v + 1);
    expect(result).toBe(7);
  });

  it("calls globalErrorHandler on rejection with DomainClientError", async () => {
    const handler = vi.fn();
    const err = new DomainClientError("auth fail", "AUTH_EXPIRED");
    const p = new ChainablePromise<never>(
      (_, reject) => reject(err),
      handler,
    );

    // The error is re-thrown after the handler, so catch it
    await expect(p.then(() => {})).rejects.toBe(err);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(err);
  });

  it("wraps non-DomainClientError before calling globalErrorHandler", async () => {
    const handler = vi.fn();
    const raw = new Error("network failure");
    const p = new ChainablePromise<never>(
      (_, reject) => reject(raw),
      handler,
    );

    await expect(p.then(() => {})).rejects.toBeInstanceOf(DomainClientError);
    expect(handler).toHaveBeenCalledOnce();
    const passed = handler.mock.calls[0][0] as DomainClientError;
    expect(passed.message).toBe("Error: network failure");
    expect(passed.code).toBe("UNKNOWN");
    expect(passed.cause).toBe(raw);
  });

  it("does not call globalErrorHandler a second time on chained then", async () => {
    const handler = vi.fn();
    const err = new DomainClientError("oops", "SERVER_ERROR");
    const p = new ChainablePromise<never>((_, reject) => reject(err), handler);

    // First call: triggers handler
    await expect(p.then(() => {})).rejects.toBe(err);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second call on the same promise instance (without _handled): handler fires again
    // This is because each .then() creates a new promise chain
    await expect(p.then(() => {})).rejects.toBe(err);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("onSuccess fires callback with resolved data", async () => {
    const spy = vi.fn();
    const p = new ChainablePromise<number>((resolve) => resolve(10));
    p.onSuccess(spy);
    // Wait for microtasks to flush then check spy
    await new Promise(process.nextTick);
    expect(spy).toHaveBeenCalledWith(10);
  });

  it("onError fires callback with DomainClientError and re-throws", async () => {
    const spy = vi.fn();
    const err = new DomainClientError("rate limited", "RATE_LIMITED");
    const p = new ChainablePromise<never>((_, reject) => reject(err));
    p.onError(spy);

    // The onError callback fires but error still propagates
    await expect(p).rejects.toBe(err);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(err);
  });

  it("onError wraps non-DomainClientError before calling callback", async () => {
    const spy = vi.fn();
    const raw = new Error("raw error");
    const p = new ChainablePromise<never>((_, reject) => reject(raw));
    p.onError(spy);

    await expect(p).rejects.toBeInstanceOf(DomainClientError);
    expect(spy).toHaveBeenCalledOnce();
    const passed = spy.mock.calls[0][0] as DomainClientError;
    expect(passed.message).toBe("Error: raw error");
    expect(passed.code).toBe("UNKNOWN");
  });

  it("supports chaining onSuccess then onError", async () => {
    const successSpy = vi.fn();
    const errorSpy = vi.fn();
    const err = new DomainClientError("bad", "VALIDATION_ERROR");

    const p = new ChainablePromise<never>((_, reject) => reject(err));
    p.onSuccess(successSpy).onError(errorSpy);

    await expect(p).rejects.toBe(err);
    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(err);
  });
});

// ---------------------------------------------------------------------------
// ChainableBuilder
// ---------------------------------------------------------------------------
describe("ChainableBuilder", () => {
  it("onSuccess fires callback with resolved data", async () => {
    const spy = vi.fn();
    const builder = new ChainableBuilder<number>((resolve) => resolve(5));
    builder.onSuccess(spy);
    await new Promise(process.nextTick);
    expect(spy).toHaveBeenCalledWith(5);
  });

  it("onError fires callback with wrapped DomainClientError and does NOT re-throw", async () => {
    const spy = vi.fn();
    const raw = new Error("builder error");
    const builder = new ChainableBuilder<never>((_, reject) => reject(raw));
    builder.onError(spy);

    // ChainableBuilder swallows errors (does not re-throw)
    // so waiting for the internal promise should not reject
    await new Promise(process.nextTick);
    expect(spy).toHaveBeenCalledOnce();
    const passed = spy.mock.calls[0][0] as DomainClientError;
    expect(passed.message).toBe("Error: builder error");
    expect(passed.code).toBe("UNKNOWN");
  });

  it("is not thenable (no then property)", () => {
    const builder = new ChainableBuilder<number>((resolve) => resolve(1));
    expect((builder as { then?: unknown }).then).toBeUndefined();
  });
});
