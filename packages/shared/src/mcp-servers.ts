/** MCP server record as returned by the API. */
export interface McpServerRecord {
  id: string;
  type: string | null;
  slug: string;
  displayName: string;
  url: string;
  apiUrl: string | null;
  credentials: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
}

/** App from an integration provider's catalog. */
export interface IntegrationApp {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
}

/** A user's connection to an app via an integration provider. */
export interface IntegrationConnection {
  id: string;
  providerId: string;
  appId: string;
  appName: string;
  icon?: string;
  accountName?: string;
  status: "active" | "error" | "expired";
  createdAt: string;
}

/** Pagination info for cursor-based pagination. */
export interface PageInfo {
  endCursor: string | null;
  hasMore: boolean;
}
