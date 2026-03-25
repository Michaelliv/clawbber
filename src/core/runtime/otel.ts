/**
 * Mercury OTEL — pi extension (runs inside pi subprocess)
 *
 * Hooks into pi events and exports traces via the shared otel core.
 * Disabled when MERCURY_OTEL_ENDPOINT is not set.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createTracer, type SpanHandle } from "../otel.js";

export default function (pi: ExtensionAPI) {
  const endpoint = process.env.MERCURY_OTEL_ENDPOINT || "";
  if (!endpoint) return;

  const tracer = createTracer({
    endpoint,
    serviceName: process.env.MERCURY_OTEL_SERVICE || "mercury",
  });

  let currentTraceId = tracer.newTraceId();
  let sessionSpan: SpanHandle | undefined;
  let agentSpan: SpanHandle | undefined;
  let turnSpan: SpanHandle | undefined;
  const toolSpans = new Map<string, SpanHandle>();

  let turnCount = 0;
  let totalToolCalls = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  pi.on("session_start", async (_event, ctx) => {
    currentTraceId = tracer.newTraceId();
    sessionSpan = tracer.startSpan("session", currentTraceId);
    sessionSpan.attr("session.id", ctx.sessionManager.getSessionFile() ?? "ephemeral");
    sessionSpan.attr("session.cwd", ctx.cwd);
    turnCount = 0;
    totalToolCalls = 0;
    totalTokensIn = 0;
    totalTokensOut = 0;
  });

  pi.on("session_shutdown", async () => {
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

  pi.on("agent_start", async () => {
    agentSpan = tracer.startSpan("agent.prompt", currentTraceId, sessionSpan?.id);
  });

  pi.on("agent_end", async (event) => {
    if (agentSpan) {
      agentSpan.attr("agent.messages_count", event.messages?.length ?? 0);
      agentSpan.end();
      agentSpan = undefined;
    }
  });

  pi.on("turn_start", async (event) => {
    turnCount++;
    turnSpan = tracer.startSpan("agent.turn", currentTraceId, agentSpan?.id);
    turnSpan.attr("turn.index", event.turnIndex);
    turnSpan.attr("turn.number", turnCount);
  });

  pi.on("turn_end", async (event) => {
    if (turnSpan) {
      turnSpan.attr("turn.tool_results", event.toolResults?.length ?? 0);
      const msg = event.message as any;
      if (msg?.role === "assistant" && msg?.usage) {
        const input = (msg.usage.input ?? 0) + (msg.usage.cacheRead ?? 0);
        const output = msg.usage.output ?? 0;
        turnSpan.attr("llm.usage.input_tokens", msg.usage.input ?? 0);
        turnSpan.attr("llm.usage.output_tokens", output);
        turnSpan.attr("llm.usage.cache_read_tokens", msg.usage.cacheRead ?? 0);
        turnSpan.attr("llm.usage.cache_write_tokens", msg.usage.cacheWrite ?? 0);
        totalTokensIn += input;
        totalTokensOut += output;
      }
      turnSpan.end();
      turnSpan = undefined;
    }
  });

  pi.on("tool_execution_start", async (event) => {
    totalToolCalls++;
    const span = tracer.startSpan(`tool.${event.toolName}`, currentTraceId, turnSpan?.id);
    span.attr("tool.name", event.toolName);
    span.attr("tool.call_id", event.toolCallId);
    toolSpans.set(event.toolCallId, span);
  });

  pi.on("tool_execution_end", async (event) => {
    const span = toolSpans.get(event.toolCallId);
    if (span) {
      span.attr("tool.is_error", event.isError ?? false);
      span.end(!event.isError);
      toolSpans.delete(event.toolCallId);
    }
  });

  pi.on("model_select", async (event) => {
    if (sessionSpan) {
      const model = `${event.model.provider}/${event.model.id}`;
      sessionSpan.attr("llm.model", model);
      if (event.previousModel) {
        sessionSpan.event("model.changed", {
          "model.previous": `${event.previousModel.provider}/${event.previousModel.id}`,
          "model.current": model,
        });
      }
    }
  });

  pi.on("session_compact", async () => {
    sessionSpan?.event("session.compacted");
  });

}
