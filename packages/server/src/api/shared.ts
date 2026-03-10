import type { Context } from "hono";
import type { Config } from "../config";
import type { SmtpConfig } from "../email";

export function resolveBaseUrl(c: Context, config: Config): string {
  if (config.BASE_URL) return config.BASE_URL.replace(/\/+$/, "");
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export function getSmtpConfig(settings: {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_from: string | null;
}): SmtpConfig | null {
  if (
    !settings.smtp_host ||
    !settings.smtp_port ||
    !settings.smtp_user ||
    !settings.smtp_password ||
    !settings.smtp_from
  )
    return null;
  return {
    host: settings.smtp_host,
    port: settings.smtp_port,
    user: settings.smtp_user,
    password: settings.smtp_password,
    from: settings.smtp_from,
  };
}
