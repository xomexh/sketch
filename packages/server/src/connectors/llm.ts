import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
/**
 * Lightweight LLM client for enrichment tasks (tagging, summarization).
 *
 * Separate from the Claude Agent SDK (which is for full agent conversations).
 * Uses @anthropic-ai/sdk or @anthropic-ai/bedrock-sdk depending on config.
 *
 * Reads provider config from environment (set by applyLlmEnvFromSettings).
 * Model defaults to Haiku for cost efficiency on structured extraction tasks.
 */
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
/** Bedrock uses a different model ID format. */
const BEDROCK_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

export interface LlmCallOptions {
  maxTokens?: number;
}

export interface LlmCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type LlmCallFn = (prompt: string, opts?: LlmCallOptions) => Promise<LlmCallResult>;

/**
 * Create an LLM call function for enrichment tasks.
 * Auto-detects Bedrock vs direct Anthropic API from environment.
 */
export function createLlmCallFn(): LlmCallFn {
  const useBedrock = process.env.CLAUDE_CODE_USE_BEDROCK === "1";

  if (useBedrock) {
    const client = new AnthropicBedrock({
      awsAccessKey: process.env.AWS_ACCESS_KEY_ID ?? "",
      awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
      awsRegion: process.env.AWS_REGION ?? "us-east-1",
    });

    return async (prompt: string, opts?: LlmCallOptions): Promise<LlmCallResult> => {
      const response = await client.messages.create({
        model: BEDROCK_MODEL,
        max_tokens: opts?.maxTokens ?? 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      return {
        text: textBlock?.text ?? "{}",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    };
  }

  const client = new Anthropic();

  return async (prompt: string, opts?: LlmCallOptions): Promise<LlmCallResult> => {
    const response = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: opts?.maxTokens ?? 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    return {
      text: textBlock?.text ?? "{}",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  };
}
