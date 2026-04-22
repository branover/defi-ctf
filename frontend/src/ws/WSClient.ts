type Listener = (payload: unknown) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectDelay = 1000;
  private _url: string;
  private _connected = false;
  private _queue: string[] = [];

  constructor(url: string) {
    this._url = url;
    this._connect();
  }

  on(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  send(type: string, payload: unknown) {
    const msg = JSON.stringify({ type, payload });
    if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this._queue.push(msg);
    }
  }

  private _connect() {
    this.ws = new WebSocket(this._url);

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 1000;
      console.log("[WS] connected");
      for (const msg of this._queue) this.ws!.send(msg);
      this._queue = [];
      this._emit("__connected", null);
    };

    this.ws.onmessage = (e) => {
      try {
        const { type, payload } = JSON.parse(e.data);
        this._emit(type, payload);
      } catch {}
    };

    this.ws.onclose = () => {
      this._connected = false;
      this._emit("__disconnected", null);
      setTimeout(() => this._connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private _emit(type: string, payload: unknown) {
    this.listeners.get(type)?.forEach(fn => fn(payload));
  }
}
