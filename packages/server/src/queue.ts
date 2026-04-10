/**
 * Per-channel in-memory message queue.
 * Ensures sequential processing — one agent run at a time per channel.
 * Errors in work items are caught to prevent unhandled rejections.
 */

export class ChannelQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  enqueue(work: () => Promise<void>): void {
    this.queue.push(work);
    this.processNext();
  }

  /**
   * Runs the next work item. Errors are caught here rather than propagated — callers are
   * expected to handle errors inside their work function; this catch exists solely to
   * prevent an unhandled rejection from stalling the queue.
   */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const work = this.queue.shift();
    if (!work) return;
    try {
      await work();
    } catch (err) {
      console.error("Unhandled error in queue work item:", err);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }
}

export class QueueManager {
  private queues = new Map<string, ChannelQueue>();

  getQueue(channelId: string): ChannelQueue {
    let queue = this.queues.get(channelId);
    if (!queue) {
      queue = new ChannelQueue();
      this.queues.set(channelId, queue);
    }
    return queue;
  }
}
