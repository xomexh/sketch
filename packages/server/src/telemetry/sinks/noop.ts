import type { EventSink } from "../emitter";
import type { TelemetryEvent } from "../types";

export class NoopSink implements EventSink {
  readonly name = "noop";
  emit(_event: TelemetryEvent): void {}
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
