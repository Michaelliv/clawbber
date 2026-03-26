/**
 * Mercury OTEL — lightweight OpenTelemetry trace exporter.
 *
 * Zero dependencies. Buffers spans in memory, flushes via OTLP HTTP JSON.
 * Fire-and-forget fetch — fully non-blocking.
 *
 * Usage:
 *   const tracer = createTracer({ endpoint: "http://localhost:4318" });
 *   const span = tracer.startSpan("my.op", tracer.newTraceId());
 *   span.attr("key", "value");
 *   span.end();
 *   await tracer.shutdown();
 */

import { hostname, userInfo } from "node:os";

// ── Public API ───────────────────────────────────────────────────────

export interface SpanHandle {
  readonly id: string;
  readonly traceId: string;
  attr(key: string, value: string | number | boolean): void;
  event(name: string, attrs?: Record<string, string | number | boolean>): void;
  end(ok?: boolean): void;
}

export interface Tracer {
  newTraceId(): string;
  startSpan(name: string, traceId: string, parentSpanId?: string): SpanHandle;
  flush(): void;
  shutdown(): Promise<void>;
}

export interface TracerConfig {
  endpoint: string;
  serviceName?: string;
  flushIntervalMs?: number;
  resourceAttrs?: Record<string, string>;
}

// ── No-op implementation (when disabled) ─────────────────────────────

const NOOP_SPAN: SpanHandle = {
  id: "",
  traceId: "",
  attr() {},
  event() {},
  end() {},
};

const NOOP_TRACER: Tracer = {
  newTraceId: () => "",
  startSpan: () => NOOP_SPAN,
  flush() {},
  async shutdown() {},
};

// ── Factory ──────────────────────────────────────────────────────────

export function createTracer(config: TracerConfig): Tracer {
  if (!config.endpoint) return NOOP_TRACER;

  const endpoint = config.endpoint;
  const serviceName = config.serviceName ?? "mercury";
  const flushMs = config.flushIntervalMs ?? 5000;

  const resourceAttrs = [
    kv("service.name", serviceName),
    kv("host.name", hostname()),
    kv("user.name", userInfo().username),
    ...Object.entries(config.resourceAttrs ?? {}).map(([k, v]) => kv(k, v)),
  ];

  const buffer: WireSpan[] = [];

  function flush(): void {
    if (buffer.length === 0) return;
    const spans = buffer.splice(0);
    fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: resourceAttrs },
          scopeSpans: [{ scope: { name: "mercury", version: "1.0.0" }, spans }],
        }],
      }),
    }).catch(() => {});
  }

  const interval = setInterval(flush, flushMs);
  interval.unref(); // Don't keep the process alive just for flushing

  function startSpan(name: string, traceId: string, parentSpanId?: string): SpanHandle {
    const id = hex(8);
    const attrs: WireAttr[] = [];
    const events: WireEvent[] = [];
    const startNano = nowNano();

    return {
      id,
      traceId,
      attr(key, value) { attrs.push(kv(key, value)); },
      event(evName, evAttrs) {
        events.push({
          name: evName,
          timeUnixNano: nowNano(),
          attributes: evAttrs ? Object.entries(evAttrs).map(([k, v]) => kv(k, v)) : [],
        });
      },
      end(ok = true) {
        buffer.push({
          traceId, spanId: id, parentSpanId, name,
          kind: 1, // INTERNAL
          startTimeUnixNano: startNano,
          endTimeUnixNano: nowNano(),
          attributes: attrs,
          events,
          status: { code: ok ? 1 : 2 },
        });
      },
    };
  }

  return {
    newTraceId: () => hex(16),
    startSpan,
    flush,
    async shutdown() {
      clearInterval(interval);
      flush();
      await new Promise((r) => setTimeout(r, 200));
    },
  };
}

// ── OTLP wire format (internal) ──────────────────────────────────────

interface WireSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: WireAttr[];
  events: WireEvent[];
  status: { code: number };
}

interface WireAttr {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: string; boolValue?: boolean };
}

interface WireEvent {
  name: string;
  timeUnixNano: string;
  attributes: WireAttr[];
}

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowNano(): string {
  return `${BigInt(Date.now()) * 1_000_000n}`;
}

function kv(key: string, value: string | number | boolean): WireAttr {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  return { key, value: { doubleValue: String(value) } };
}
