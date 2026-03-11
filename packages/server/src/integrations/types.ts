import type { IntegrationApp, IntegrationConnection, PageInfo } from "@sketch/shared";
/**
 * Server-side integration types.
 * Shared types (IntegrationApp, IntegrationConnection, PageInfo) are imported
 * from @sketch/shared. This file keeps only the server-only runtime interface
 * and credential validation schemas.
 */
import { z } from "zod";

export type { IntegrationApp, IntegrationConnection, PageInfo };

export interface IntegrationProvider {
  listApps(query?: string, limit?: number, after?: string): Promise<{ apps: IntegrationApp[]; pageInfo: PageInfo }>;
  initiateConnection(userEmail: string, appId: string, callbackUrl: string): Promise<{ redirectUrl: string }>;
  listConnections(userEmail: string): Promise<IntegrationConnection[]>;
  removeConnection(userEmail: string, connectionId: string): Promise<void>;
}

export const canvasCredentialsSchema = z.object({
  apiKey: z.string().min(1),
});
