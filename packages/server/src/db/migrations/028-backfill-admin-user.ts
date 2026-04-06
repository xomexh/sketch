import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Read admin email from settings
  const result = await sql<{ admin_email: string }>`
    SELECT admin_email FROM settings WHERE id = 'default'
  `.execute(db);

  const adminEmail = result.rows[0]?.admin_email;
  if (!adminEmail) return;

  const email = adminEmail.toLowerCase();

  // Check if user already exists with this email
  const existingResult = await sql<{ id: string }>`
    SELECT id FROM users WHERE email = ${email}
  `.execute(db);

  let userId: string;

  if (existingResult.rows[0]) {
    userId = existingResult.rows[0].id;
  } else {
    // Create user row for admin
    userId = crypto.randomUUID();
    const name = email.split("@")[0];
    const now = new Date().toISOString();

    try {
      await sql`
        INSERT INTO users (id, name, email, email_verified_at, type)
        VALUES (${userId}, ${name}, ${email}, ${now}, 'human')
      `.execute(db);
    } catch (err: unknown) {
      // Unique constraint violation -- race condition or unexpected duplicate. Skip.
      if (err instanceof Error && err.message.includes("UNIQUE")) return;
      throw err;
    }
  }

  // Rekey workspace directory: data/workspaces/{email} -> data/workspaces/{uuid}
  const dataDir = process.env.DATA_DIR || "./data";
  const workspacesDir = join(dataDir, "workspaces");
  try {
    const entries = await readdir(workspacesDir);
    if (entries.includes(email) && !entries.includes(userId)) {
      await rename(join(workspacesDir, email), join(workspacesDir, userId));
    }
  } catch {
    // workspaces dir may not exist yet -- nothing to migrate
  }

  // Rekey chat_sessions: workspace_key from email to UUID
  await sql`
    UPDATE chat_sessions SET workspace_key = ${userId} WHERE workspace_key = ${email}
  `.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Cannot safely reverse -- we don't know the original email
}
