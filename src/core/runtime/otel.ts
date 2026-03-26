/**
 * Mercury OTEL — pi extension (runs inside pi subprocess)
 *
 * Hooks pi lifecycle events and exports traces via the shared otel core.
 * Inherits trace context from Mercury host via MERCURY_OTEL_TRACE_ID / _PARENT_SPAN_ID.
 * Disabled when MERCURY_OTEL_ENDPOINT is not set.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createTracer, type SpanHandle } from "../otel.js";

export default function (pi: ExtensionAPI) {
  // Runtime strips MERCURY_ prefix from env vars passed to subprocess
  const endpoint = process.env.OTEL_ENDPOINT || process.env.MERCURY_OTEL_ENDPOINT || "";
  if (!endpoint) return;

  const tracer = createTracer({
    endpoint,
    serviceName: process.env.OTEL_SERVICE || process.env.MERCURY_OTEL_SERVICE || "mercury",
  });

  const parentTraceId = process.env.OTEL_TRACE_ID || "";
  const parentSpanId = process.env.OTEL_PARENT_SPAN_ID || "";
  let traceId = parentTraceId || tracer.newTraceId();

  let sessionSpan: SpanHandle | undefined;
  let agentSpan: SpanHandle | undefined;
  let turnSpan: SpanHandle | undefined;
  const toolSpans = new Map<string, SpanHandle>();
  let turnCount = 0;
  let totalToolCalls = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  // ── Session ────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    if (!parentTraceId) traceId = tracer.newTraceId();
    sessionSpan = tracer.startSpan("pi.session", traceId, parentSpanId || undefined);
    sessionSpan.attr("session.id", ctx.sessionManager.getSessionFile() ?? "ephemeral");
    sessionSpan.attr("session.cwd", ctx.cwd);
    turnCount = 0;
    totalToolCalls = 0;
    totalTokensIn = 0;
    totalTokensOut = 0;
  });

  pi.on("session_shutdown", async () => {
    // Session span may already be ended by agent_end (--print mode)
    if (sessionSpan) {
      sessionSpan.attr("session.turns", turnCount);
      sessionSpan.attr("session.tool_calls", totalToolCalls);
      sessionSpan.attr("session.tokens.input", totalTokensIn);
      sessionSpan.attr("session.tokens.output", totalTokensOut);
      sessionSpan.end();
      sessionSpan = undefined;
    }
    await tracer.shutdown();
  });

  // ── Agent prompt ───────────────────────────────────────────────────

  pi.on("agent_start", async () => {
    agentSpan = tracer.startSpan("pi.agent.prompt", traceId, sessionSpan?.id);
  });

  pi.on("agent_end", async (event) => {
    agentSpan?.attr("agent.messages_count", event.messages?.length ?? 0);
    agentSpan?.end();
    agentSpan = undefined;

    // In --print mode, session_shutdown may not fire before exit.
    // End session span and flush to ensure all spans are exported.
    if (sessionSpan) {
      sessionSpan.attr("session.turns", turnCount);
      sessionSpan.attr("session.tool_calls", totalToolCalls);
      sessionSpan.attr("session.tokens.input", totalTokensIn);
      sessionSpan.attr("session.tokens.output", totalTokensOut);
      sessionSpan.end();
      sessionSpan = undefined;
    }
    tracer.flush();
  });

  // ── Turn (LLM call + tool execution cycle) ─────────────────────────

  pi.on("turn_start", async (event) => {
    turnCount++;
    turnSpan = tracer.startSpan("pi.agent.turn", traceId, agentSpan?.id);
    turnSpan.attr("turn.index", event.turnIndex);
    turnSpan.attr("turn.number", turnCount);
  });

  pi.on("turn_end", async (event) => {
    if (!turnSpan) return;
    turnSpan.attr("turn.tool_results", event.toolResults?.length ?? 0);

    const msg = event.message as any;
    if (msg?.role === "assistant" && msg?.usage) {
      const inputTokens = (msg.usage.input ?? 0) + (msg.usage.cacheRead ?? 0);
      const outputTokens = msg.usage.output ?? 0;
      turnSpan.attr("llm.usage.input_tokens", msg.usage.input ?? 0);
      turnSpan.attr("llm.usage.output_tokens", outputTokens);
      turnSpan.attr("llm.usage.cache_read_tokens", msg.usage.cacheRead ?? 0);
      turnSpan.attr("llm.usage.cache_write_tokens", msg.usage.cacheWrite ?? 0);
      totalTokensIn += inputTokens;
      totalTokensOut += outputTokens;
    }

    turnSpan.end();
    turnSpan = undefined;
  });

  // ── Tools ──────────────────────────────────────────────────────────

  pi.on("tool_execution_start", async (event) => {
    totalToolCalls++;
    const span = tracer.startSpan(`tool.${event.toolName}`, traceId, turnSpan?.id);
    span.attr("tool.name", event.toolName);
    span.attr("tool.call_id", event.toolCallId);
    toolSpans.set(event.toolCallId, span);
  });

  pi.on("tool_execution_end", async (event) => {
    const span = toolSpans.get(event.toolCallId);
    if (!span) return;
    span.attr("tool.is_error", event.isError ?? false);
    span.end(!event.isError);
    toolSpans.delete(event.toolCallId);
  });

  // ── Model & compaction events ──────────────────────────────────────

  pi.on("model_select", async (event) => {
    const model = `${event.model.provider}/${event.model.id}`;
    sessionSpan?.attr("llm.model", model);
    if (event.previousModel) {
      sessionSpan?.event("model.changed", {
        "model.previous": `${event.previousModel.provider}/${event.previousModel.id}`,
        "model.current": model,
      });
    }
  });

  pi.on("session_compact", async () => {
    sessionSpan?.event("session.compacted");
  });
}
