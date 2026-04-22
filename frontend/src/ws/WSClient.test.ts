import { afterEach, describe, expect, it, vi } from "vitest";
import { WSClient } from "./WSClient.js";

/** Minimal WebSocket mock for exercising queue + reconnect behaviour without a browser. */
function installWebSocketMock() {
  const instances: MockSocket[] = [];

  class MockSocket {
    static OPEN = 1;
    url: string;
    readyState = 0;
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sent: string[] = [];

    constructor(url: string) {
      this.url = url;
      instances.push(this);
      queueMicrotask(() => {
        this.readyState = MockSocket.OPEN;
        this.onopen?.();
      });
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }

    emit(data: string) {
      this.onmessage?.({ data });
    }
  }

  vi.stubGlobal("WebSocket", MockSocket);
  return { instances: instances as MockSocket[], MockSocket };
}

describe("WSClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("queues outbound messages until open, then flushes", async () => {
    const { instances } = installWebSocketMock();
    const client = new WSClient("ws://test/ws");

    client.send("ping", { n: 1 });
    expect(instances[0]?.sent.length ?? 0).toBe(0);

    await new Promise((r) => setTimeout(r, 0));
    expect(instances[0]!.sent.length).toBeGreaterThanOrEqual(1);
    const msg = JSON.parse(instances[0]!.sent[0]!);
    expect(msg.type).toBe("ping");
    expect(msg.payload).toEqual({ n: 1 });
  });

  it("delivers parsed messages to typed listeners", async () => {
    const { instances } = installWebSocketMock();
    const client = new WSClient("ws://test/ws");
    await new Promise((r) => setTimeout(r, 0));

    const received: unknown[] = [];
    client.on("hello", (p) => received.push(p));

    instances[0]!.emit(JSON.stringify({ type: "hello", payload: { x: 1 } }));
    expect(received).toEqual([{ x: 1 }]);
  });

  it("emits __connected after open", async () => {
    installWebSocketMock();
    const client = new WSClient("ws://test/ws");
    let fired = false;
    client.on("__connected", () => { fired = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(fired).toBe(true);
  });
});
