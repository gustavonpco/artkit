// Web-standard APIs available in every runtime the core supports (browsers, Node 22+, edge, workers).
// The core compiles without the DOM lib on purpose (spec §5.3); only this minimal surface is declared.

export {};

declare global {
  class TextEncoder {
    encode(input?: string): Uint8Array<ArrayBuffer>;
  }

  class TextDecoder {
    constructor(label?: string);
    decode(input?: Uint8Array): string;
  }

  class URL {
    constructor(url: string, base?: string);
    readonly hostname: string;
    readonly protocol: string;
    readonly href: string;
  }

  interface AbortSignal {
    readonly aborted: boolean;
    readonly reason: unknown;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  }

  var AbortSignal: {
    prototype: AbortSignal;
    timeout(ms: number): AbortSignal;
    any(signals: AbortSignal[]): AbortSignal;
  };

  interface SubtleCrypto {
    digest(algorithm: 'SHA-256', data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
  }

  interface Crypto {
    getRandomValues<T extends Uint8Array>(array: T): T;
    readonly subtle: SubtleCrypto;
  }

  var crypto: Crypto;

  function structuredClone<T>(value: T): T;
  function btoa(data: string): string;
  function atob(data: string): string;
  function setTimeout(handler: () => void, timeout?: number): unknown;

  var console: {
    log(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
  };
}
