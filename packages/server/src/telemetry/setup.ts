/**
 * OpenTelemetry initialization for Sketch.
 *
 * Creates a TracerProvider with BatchSpanProcessor and the SqliteSpanExporter.
 * Future exporters (OTLP for PostHog/Grafana/Datadog) are added here as
 * additional SpanProcessors — zero changes to instrumentation code.
 */
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { createAgentRunsRepo } from "../db/repositories/agent-runs";
import type { Logger } from "../logger";
import { SqliteSpanExporter } from "./exporters/sqlite";

export function initTelemetry(repo: ReturnType<typeof createAgentRunsRepo>, logger: Logger) {
  const exporter = new SqliteSpanExporter(repo, logger);
  const provider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  provider.register();

  logger.info({ exporters: ["sqlite"] }, "Telemetry initialized (OpenTelemetry)");

  return {
    shutdown: () => provider.shutdown(),
  };
}
