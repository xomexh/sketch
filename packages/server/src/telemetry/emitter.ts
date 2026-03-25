/**
 * TelemetryEmitter fans out events to all active sinks.
 * Telemetry must never break the app — per-sink errors are caught and logged.
 */
import type { Logger } from "../logger";
import type { TelemetryEvent } from "./types";

export interface EventSink {
  readonly name: string;
  emit(event: TelemetryEvent): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class TelemetryEmitter {
  private sinks: EventSink[];
  private logger: Logger;

  constructor(sinks: EventSink[], logger: Logger) {
    this.sinks = sinks;
    this.logger = logger;
    const sinkNames = sinks.map((s) => s.name);
    logger.info({ sinks: sinkNames }, "Telemetry emitter initialized");
  }

  emit(event: TelemetryEvent): void {
    for (const sink of this.sinks) {
      try {
        sink.emit(event);
      } catch (err) {
        this.logger.error({ err, sink: sink.name, eventType: event.eventType }, "Telemetry sink error");
      }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.flush()));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.close()));
  }
}
