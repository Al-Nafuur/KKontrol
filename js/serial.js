/**
 * Minimal Web Serial transport for KKontrol.
 * All communication is local to the browser; no remote service is used.
 */
export class SerialTransport {
  constructor(log = () => {}) {
    this.log = log;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readTask = null;
    this.rx = [];
    this.waiters = [];
    this.closed = false;
  }

  static isSupported() {
    return !!(window.isSecureContext && "serial" in navigator);
  }

  get connected() {
    return !!this.port?.readable && !!this.port?.writable;
  }

  async connect() {
    if (!SerialTransport.isSupported()) {
      throw new Error("WebSerial is unavailable. Open KKontrol over HTTPS in a supported desktop browser (Chrome/Edge recommended). Firefox support can vary by release/build.");
    }
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    this.closed = false;
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.readTask = this.readLoop();
    this.log("Serial port opened at 115200 baud, 8N1.");
  }

  async readLoop() {
    try {
      while (!this.closed && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value?.length) {
          for (const byte of value) this.rx.push(byte);
          this.resolveWaiters();
        }
      }
    } catch (error) {
      if (!this.closed) this.failWaiters(new Error(`Serial read failed: ${error.message}`));
    }
  }

  resolveWaiters() {
    for (let i = 0; i < this.waiters.length;) {
      const waiter = this.waiters[i];
      if (this.rx.length >= waiter.count) {
        this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(Uint8Array.from(this.rx.splice(0, waiter.count)));
      } else {
        i++;
      }
    }
  }

  failWaiters(error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  async write(bytes) {
    if (!this.writer) throw new Error("Serial port is not connected.");
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    await this.writer.write(data);
  }

  readExactly(count, timeoutMs = 3500) {
    if (this.rx.length >= count) return Promise.resolve(Uint8Array.from(this.rx.splice(0, count)));
    return new Promise((resolve, reject) => {
      const waiter = { count, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${count} response byte(s).`));
      }, timeoutMs);
      this.waiters.push(waiter);
      this.resolveWaiters();
    });
  }

  clearInput() {
    this.rx.length = 0;
  }

  async command(bytes, expected, timeoutMs = 3500, label = "command") {
    this.clearInput();
    this.log(`TX ${label}: ${hex(bytes)}`);
    await this.write(bytes);
    if (expected === null) return null;
    const response = await this.readExactly(expected.length, timeoutMs);
    if (!expected.every((b, i) => response[i] === b)) {
      throw new Error(`${label}: unexpected response ${hex(response)} (expected ${hex(expected)}).`);
    }
    this.log(`RX ACK ${label}: ${hex(response)}`);
    return response;
  }

  async disconnect() {
    this.closed = true;
    this.failWaiters(new Error("Serial connection closed."));
    try { await this.reader?.cancel(); } catch { /* device may already be gone */ }
    try { await this.readTask; } catch { /* read loop may have ended with a disconnect */ }
    try { this.reader?.releaseLock(); } catch { /* ignore */ }
    try { this.writer?.releaseLock(); } catch { /* ignore */ }
    this.reader = null;
    this.writer = null;
    this.rx.length = 0;
    if (this.port) {
      try { await this.port.close(); } catch (error) { this.log(`Port close note: ${error.message}`); }
    }
    this.port = null;
    this.log("Serial port closed.");
  }
}

export function hex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join(" ");
}
