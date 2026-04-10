/**
 * Typed configuration loaded from environment variables via zod + dotenv.
 * Fails fast on startup, printing all validation errors at once.
 *
 * Key non-obvious fields:
 * - `BASE_URL` — public-facing origin used for OAuth redirect URIs and email links (e.g. `https://sketch.yourcompany.com`, no trailing slash).
 * - `POSTHOG_API_KEY` — when set, enables LLM analytics via OpenTelemetry → PostHog.
 * - `BOOTSTRAP_*` — managed-seed credentials written to the DB on first boot; empty strings are treated as unset.
 */
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import "dotenv/config";

export const configSchema = z.object({
  DB_TYPE: z.enum(["sqlite", "postgres"]).default("sqlite"),
  SQLITE_PATH: z.string().default("./data/sketch.db"),
  DATABASE_URL: z.string().optional(),

  SLACK_CHANNEL_HISTORY_LIMIT: z.coerce.number().default(5),
  SLACK_THREAD_HISTORY_LIMIT: z.coerce.number().default(50),

  MAX_FILE_SIZE_MB: z.coerce.number().default(20),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(50),

  EXPERIMENTAL_FLAG: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  SLACK_MODE: z.enum(["socket", "http"]).default("socket"),
  SLACK_SIGNING_SECRET: z.string().optional(),

  ENCRYPTION_KEY: z.string().optional(),
  SYSTEM_SECRET: z.string().optional(),

  BOOTSTRAP_ADMIN_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  BOOTSTRAP_ADMIN_PASSWORD_HASH: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  BOOTSTRAP_SLACK_BOT_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),

  MANAGED_URL: z.string().optional(),
  MANAGED_AUTH_SECRET: z.string().optional(),

  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default("https://us.i.posthog.com"),

  CLAUDE_CONFIG_DIR: z.string().default(join(homedir(), ".claude")),
  SKETCH_CONFIG_DIR: z.string().default(join(homedir(), ".sketch")),

  BASE_URL: z.string().optional(),
  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parses and validates environment variables, then resolves relative paths to absolute.
 * Relative `DATA_DIR`, `SQLITE_PATH`, `CLAUDE_CONFIG_DIR`, and `SKETCH_CONFIG_DIR` are
 * resolved against the project root (dirname of `DOTENV_CONFIG_PATH` when set, otherwise
 * `cwd`), so paths work correctly when pnpm runs this from a sub-package directory.
 */
export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid configuration:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const config = result.data;

  const projectRoot = process.env.DOTENV_CONFIG_PATH ? dirname(process.env.DOTENV_CONFIG_PATH) : process.cwd();
  if (!isAbsolute(config.DATA_DIR)) {
    config.DATA_DIR = resolve(projectRoot, config.DATA_DIR);
  }
  if (!isAbsolute(config.SQLITE_PATH)) {
    config.SQLITE_PATH = resolve(projectRoot, config.SQLITE_PATH);
  }
  if (!isAbsolute(config.CLAUDE_CONFIG_DIR)) {
    config.CLAUDE_CONFIG_DIR = resolve(projectRoot, config.CLAUDE_CONFIG_DIR);
  }
  if (!isAbsolute(config.SKETCH_CONFIG_DIR)) {
    config.SKETCH_CONFIG_DIR = resolve(projectRoot, config.SKETCH_CONFIG_DIR);
  }

  return config;
}

/**
 * Semantic validation that can't be expressed in zod schema alone.
 * Checks cross-field dependencies after loadConfig() succeeds.
 */
export function validateConfig(config: Config): void {
  if (config.DB_TYPE === "postgres" && !config.DATABASE_URL) {
    console.error("DB_TYPE=postgres requires DATABASE_URL");
    process.exit(1);
  }
  if (config.SLACK_MODE === "http" && !config.SLACK_SIGNING_SECRET) {
    console.error("SLACK_MODE=http requires SLACK_SIGNING_SECRET");
    process.exit(1);
  }
}
