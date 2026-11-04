// The agent package compiles without DOM or Node libs (it must run in browsers, Node, edge and workers).
// Only the web-standard surface it touches is declared here.

export {};

declare global {
  interface AbortSignal {
    readonly aborted: boolean;
    readonly reason: unknown;
    addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
    removeEventListener(type: 'abort', listener: () => void): void;
  }
}
