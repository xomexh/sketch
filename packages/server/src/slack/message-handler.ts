/**
 * Factory for the onMessage callback passed to runAgent(). Handles the
 * first-message-replaces-thinking / subsequent-messages-are-new pattern
 * for both DMs (new top-level message) and channel threads (thread reply).
 *
 * Messages exceeding Slack's 40k char limit are split into chunks.
 * First chunk replaces the "Thinking..." indicator, remaining chunks
 * are posted as follow-up messages.
 */
import { chunkText } from "../formatting/chunking";
import type { SlackBot } from "./bot";

const SLACK_TEXT_LIMIT = 39_000;

export function createSlackMessageHandler(
  slackBot: SlackBot,
  channelId: string,
  thinkingTs: string,
  threadTs?: string,
): (text: string) => Promise<void> {
  let firstCall = true;

  return async (text: string) => {
    const chunks = chunkText(text, SLACK_TEXT_LIMIT);
    for (const chunk of chunks) {
      if (firstCall) {
        await slackBot.updateMessage(channelId, thinkingTs, chunk);
        firstCall = false;
      } else if (threadTs) {
        await slackBot.postThreadReply(channelId, threadTs, chunk);
      } else {
        await slackBot.postMessage(channelId, chunk);
      }
    }
  };
}
