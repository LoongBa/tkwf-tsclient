import { DomainClientError } from "./domain-client-error";

export interface CallbackOptions {
  quiet?: boolean;
  tag?: string;
}

/**
 * ChainablePromise — A thenable class that supports `await`, `.onSuccess()`, and `.onError()`.
 * Delegates to an internal Promise (does NOT extend Promise to avoid subclassing issues).
 */
export class ChainablePromise<T> {
  private promise: Promise<T>;
  private globalErrorHandler?: (error: DomainClientError) => void;
  private _handled = false;

  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: unknown) => void,
    ) => void,
    globalErrorHandler?: (error: DomainClientError) => void,
  ) {
    this.promise = new Promise<T>(executor);
    this.globalErrorHandler = globalErrorHandler;
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    let p = this.promise;
    if (this.globalErrorHandler && !this._handled) {
      p = p.catch((err) => {
        const domainErr =
          err instanceof DomainClientError
            ? err
            : new DomainClientError(String(err), "UNKNOWN", err);
        this.globalErrorHandler!(domainErr);
        throw domainErr;
      });
    }
    return p.then(onfulfilled as any, onrejected as any);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected);
  }

  onSuccess(fn: (data: T) => void, _opts?: CallbackOptions): this {
    this.promise = this.promise.then((d) => {
      fn(d);
      return d;
    });
    return this;
  }

  onError(fn: (err: DomainClientError) => void, _opts?: CallbackOptions): this {
    this.promise = this.promise.catch((err) => {
      this._handled = true;
      const domainErr =
        err instanceof DomainClientError
          ? err
          : new DomainClientError(String(err), "UNKNOWN", err);
      fn(domainErr);
      throw domainErr;
    });
    return this;
  }
}

/**
 * ChainableBuilder — NOT thenable, callback-only. For use with Call().
 */
export class ChainableBuilder<T> {
  private promise: Promise<T>;

  constructor(
    executor: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason?: unknown) => void,
    ) => void,
  ) {
    this.promise = new Promise<T>(executor);
  }

  onSuccess(fn: (data: T) => void, _opts?: CallbackOptions): this {
    this.promise = this.promise.then((d) => {
      fn(d);
      return d;
    });
    return this;
  }

  onError(fn: (err: DomainClientError) => void, _opts?: CallbackOptions): this {
    this.promise = this.promise.catch((err) => {
      const domainErr =
        err instanceof DomainClientError
          ? err
          : new DomainClientError(String(err), "UNKNOWN", err);
      fn(domainErr);
    }) as Promise<T>;
    return this;
  }
}
