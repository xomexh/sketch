import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("settings").addColumn("smtp_host", "text").execute();
  await db.schema.alterTable("settings").addColumn("smtp_port", "integer").execute();
  await db.schema.alterTable("settings").addColumn("smtp_user", "text").execute();
  await db.schema.alterTable("settings").addColumn("smtp_password", "text").execute();
  await db.schema.alterTable("settings").addColumn("smtp_from", "text").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("settings").dropColumn("smtp_host").execute();
  await db.schema.alterTable("settings").dropColumn("smtp_port").execute();
  await db.schema.alterTable("settings").dropColumn("smtp_user").execute();
  await db.schema.alterTable("settings").dropColumn("smtp_password").execute();
  await db.schema.alterTable("settings").dropColumn("smtp_from").execute();
}
