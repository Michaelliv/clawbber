/**
 * Mercury OTEL — lightweight OpenTelemetry trace exporter.
 *
 * Zero dependencies. Buffers spans in memory, flushes via OTLP HTTP JSON.
 * Fire-and-forget fetch — fully non-blocking.
 *
 * Usage:
 *   const tracer = createTracer({ endpoint, serviceName });
 *   const span = tracer.startSpan("my.operation", parentSpanId);
 *   span.attr("key", "value");
 *   span.event("something.happened");
 *   span.end();
 *   // ... later:
 *   tracer.shutdown();
 */

import { hostname, userInfo } from "node:os";

// ── OTLP wire types ──────────────────────────────────────────────────

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  events: OtlpEvent[];
  status: { code: number; message?: string };
}

export interface OtlpAttribute {
  key: string;
  value: { stringValue?: string; intValue?: string; doubleValue?: string; boolValue?: boolean };
}

export interface OtlpEvent {
  name: string;
  timeUnixNano: string;
  attributes: OtlpAttribute[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowNano(): string {
  return `${BigInt(Date.now()) * 1_000_000n}`;
}

export function otelAttr(key: string, value: string | number | boolean): OtlpAttribute {
  if (typeof value === "string") return { key, value: { stringValue: value } };
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (Number.isInteger(value)) return { key, value: { intValue: String(value) } };
  return { key, value: { doubleValue: String(value) } };
}

// ── Span handle ──────────────────────────────────────────────────────

export interface SpanHandle {
  readonly id: string;
  readonly traceId: string;
  attr(key: string, value: string | number | boolean): void;
  event(name: string, attrs?: Record<string, string | number | boolean>): void;
  end(ok?: boolean): void;
}

// ── Tracer ───────────────────────────────────────────────────────────

export interface TracerConfig {
  endpoint: string;
  serviceName?: string;
  flushIntervalMs?: number;
  resourceAttrs?: Record<string, string>;
}

export interface Tracer {
  /** Generate a new trace ID. */
  newTraceId(): string;
  /** Start a span. Returns a handle to add attributes/events and end it. */
  startSpan(name: string, traceId: string, parentSpanId?: string): SpanHandle;
  /** Flush buffered spans immediately. */
  flush(): void;
  /** Flush and stop the periodic flush interval. */
  shutdown(): Promise<void>;
}

/** No-op tracer for when OTEL is disabled. */
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

export function createTracer(config: TracerConfig): Tracer {
  if (!config.endpoint) return NOOP_TRACER;

  const endpoint = config.endpoint;
  const serviceName = config.serviceName ?? "mercury";
  const flushMs = config.flushIntervalMs ?? 5000;

  const resourceAttrs: OtlpAttribute[] = [
    otelAttr("service.name", serviceName),
    otelAttr("host.name", hostname()),
    otelAttr("user.name", userInfo().username),
  ];
  if (config.resourceAttrs) {
    for (const [k, v] of Object.entries(config.resourceAttrs)) {
      resourceAttrs.push(otelAttr(k, v));
    }
  }

  const buffer: OtlpSpan[] = [];

  function flush(): void {
    if (buffer.length === 0) return;
    const spans = buffer.splice(0);
    const payload = {
      resourceSpans: [{
        resource: { attributes: resourceAttrs },
        scopeSpans: [{
          scope: { name: "mercury-otel", version: "1.0.0" },
          spans,
        }],
      }],
    };
    fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }

  const interval = setInterval(flush, flushMs);

  function startSpan(name: string, trId: string, parentSpanId?: string): SpanHandle {
    const id = randomHex(8);
    const span: OtlpSpan = {
      traceId: trId,
      spanId: id,
      parentSpanId,
      name,
      kind: 1,
      startTimeUnixNano: nowNano(),
      endTimeUnixNano: "0",
      attributes: [],
      events: [],
      status: { code: 0 },
    };

    return {
      id,
      traceId: trId,
      attr(key, value) { span.attributes.push(otelAttr(key, value)); },
      event(evName, attrs) {
        const evAttrs = attrs
          ? Object.entries(attrs).map(([k, v]) => otelAttr(k, v))
          : [];
        span.events.push({ name: evName, timeUnixNano: nowNano(), attributes: evAttrs });
      },
      end(ok = true) {
        span.endTimeUnixNano = nowNano();
        span.status = { code: ok ? 1 : 2 };
        buffer.push(span);
      },
    };
  }

  return {
    newTraceId: () => randomHex(16),
    startSpan,
    flush,
    async shutdown() {
      clearInterval(interval);
      flush();
      await new Promise((r) => setTimeout(r, 200));
    },
  };
}
