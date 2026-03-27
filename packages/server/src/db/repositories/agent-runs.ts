import { randomUUID } from "node:crypto";
import { type Insertable, type Kysely, sql } from "kysely";
import type { DB } from "../schema";

type NewAgentRun = Insertable<DB["agent_runs"]>;
type NewToolCall = Insertable<DB["tool_calls"]>;

export interface MemberSummary {
  totalMessages: number;
  messagesByPlatform: { platform: string; count: number }[];
  totalCostUsd: number;
  totalSkills: number;
}

export interface SkillBreakdown {
  name: string;
  count: number;
}

export interface OrgSummary {
  totalMessages: number;
  messagesByPlatform: { platform: string; count: number }[];
  totalCostUsd: number;
  totalSkills: number;
}

export interface UserBreakdown {
  userId: string;
  userName: string | null;
  userType: string;
  messageCount: number;
  costUsd: number;
  skillCount: number;
  lastRunAt: string | null;
}

export interface DailyBucket {
  date: string;
  messages: number;
  skills: number;
}

export function createAgentRunsRepo(db: Kysely<DB>) {
  return {
    async insertRun(run: Omit<NewAgentRun, "id"> & { id?: string }): Promise<string> {
      const id = run.id ?? randomUUID();
      await db
        .insertInto("agent_runs")
        .values({ ...run, id })
        .execute();
      return id;
    },

    async insertToolCalls(calls: NewToolCall[]): Promise<void> {
      if (calls.length === 0) return;
      await db.insertInto("tool_calls").values(calls).execute();
    },

    async getMemberSummary(userId: string, from: string, to: string): Promise<MemberSummary> {
      const totals = await db
        .selectFrom("agent_runs")
        .select([
          db.fn.count<number>("id").as("totalMessages"),
          sql<number>`ROUND(COALESCE(SUM(cost_usd), 0), 6)`.as("totalCostUsd"),
        ])
        .where("user_id", "=", userId)
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .executeTakeFirstOrThrow();

      const byPlatform = await db
        .selectFrom("agent_runs")
        .select(["platform", db.fn.count<number>("id").as("count")])
        .where("user_id", "=", userId)
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .groupBy("platform")
        .execute();

      const skillTotal = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(sql<number>`COUNT(tc.id)`.as("count"))
        .where("r.user_id", "=", userId)
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("tc.skill_name", "is not", null)
        .executeTakeFirstOrThrow();

      return {
        totalMessages: Number(totals.totalMessages) || 0,
        messagesByPlatform: byPlatform.map((r) => ({
          platform: r.platform,
          count: Number(r.count),
        })),
        totalCostUsd: Number(totals.totalCostUsd) || 0,
        totalSkills: Number(skillTotal.count) || 0,
      };
    },

    async getMemberSkills(userId: string, from: string, to: string): Promise<SkillBreakdown[]> {
      const rows = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(["tc.skill_name", sql<number>`COUNT(tc.id)`.as("count")])
        .where("r.user_id", "=", userId)
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("tc.skill_name", "is not", null)
        .groupBy("tc.skill_name")
        .orderBy("count", "desc")
        .execute();

      return rows.map((r) => ({ name: r.skill_name as string, count: Number(r.count) }));
    },

    async getOrgSummary(from: string, to: string): Promise<OrgSummary> {
      const totals = await db
        .selectFrom("agent_runs")
        .select([
          db.fn.count<number>("id").as("totalMessages"),
          sql<number>`ROUND(COALESCE(SUM(cost_usd), 0), 6)`.as("totalCostUsd"),
        ])
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .executeTakeFirstOrThrow();

      const byPlatform = await db
        .selectFrom("agent_runs")
        .select(["platform", db.fn.count<number>("id").as("count")])
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .groupBy("platform")
        .execute();

      const skillTotal = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(sql<number>`COUNT(tc.id)`.as("count"))
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("tc.skill_name", "is not", null)
        .executeTakeFirstOrThrow();

      return {
        totalMessages: Number(totals.totalMessages) || 0,
        messagesByPlatform: byPlatform.map((r) => ({
          platform: r.platform,
          count: Number(r.count),
        })),
        totalCostUsd: Number(totals.totalCostUsd) || 0,
        totalSkills: Number(skillTotal.count) || 0,
      };
    },

    async getOrgSkills(from: string, to: string): Promise<SkillBreakdown[]> {
      const rows = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(["tc.skill_name", sql<number>`COUNT(tc.id)`.as("count")])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("tc.skill_name", "is not", null)
        .groupBy("tc.skill_name")
        .orderBy("count", "desc")
        .execute();

      return rows.map((r) => ({ name: r.skill_name as string, count: Number(r.count) }));
    },

    async getOrgByUser(from: string, to: string): Promise<UserBreakdown[]> {
      const userRows = await db
        .selectFrom("agent_runs as r")
        .leftJoin("users as u", "u.id", "r.user_id")
        .select([
          "r.user_id as userId",
          "u.name as userName",
          "u.type as userType",
          sql<number>`COUNT(r.id)`.as("messageCount"),
          sql<number>`ROUND(COALESCE(SUM(r.cost_usd), 0), 6)`.as("costUsd"),
          sql<string>`MAX(r.created_at)`.as("lastRunAt"),
        ])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .groupBy(["r.user_id", "u.name", "u.type"])
        .orderBy("costUsd", "desc")
        .execute();

      const skillRows = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(["r.user_id", sql<number>`COUNT(tc.id)`.as("skillCount")])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("tc.skill_name", "is not", null)
        .groupBy("r.user_id")
        .execute();

      const skillMap = new Map(skillRows.map((r) => [r.user_id, Number(r.skillCount)]));

      return userRows.map((r) => ({
        userId: r.userId ?? "unattributed",
        userName: r.userName ?? null,
        userType: r.userType ?? "human",
        messageCount: Number(r.messageCount),
        costUsd: Number(r.costUsd),
        skillCount: skillMap.get(r.userId) ?? 0,
        lastRunAt: r.lastRunAt ?? null,
      }));
    },

    async getDailyBreakdown(userId: string | null, from: string, to: string): Promise<DailyBucket[]> {
      // Query 1: messages per day
      let msgQuery = db
        .selectFrom("agent_runs")
        .select([sql<string>`DATE(created_at)`.as("date"), sql<number>`COUNT(id)`.as("messages")])
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .groupBy(sql`DATE(created_at)`)
        .orderBy(sql`DATE(created_at)`);
      if (userId !== null) {
        msgQuery = msgQuery.where("user_id", "=", userId);
      }
      const msgRows = await msgQuery.execute();

      // Query 2: skills per day (separate to avoid fan-out)
      let skillQuery = db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select([sql<string>`DATE(r.created_at)`.as("date"), sql<number>`COUNT(tc.id)`.as("skills")])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("tc.skill_name", "is not", null)
        .groupBy(sql`DATE(r.created_at)`)
        .orderBy(sql`DATE(r.created_at)`);
      if (userId !== null) {
        skillQuery = skillQuery.where("r.user_id", "=", userId);
      }
      const skillRows = await skillQuery.execute();

      const skillMap = new Map(skillRows.map((r) => [r.date, Number(r.skills)]));

      return msgRows.map((r) => ({
        date: r.date,
        messages: Number(r.messages),
        skills: skillMap.get(r.date) ?? 0,
      }));
    },
  };
}
