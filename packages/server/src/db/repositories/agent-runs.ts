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

export interface GroupBreakdown {
  workspaceKey: string;
  name: string;
  platform: "slack" | "whatsapp";
  messageCount: number;
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
      // Single query: GROUP BY platform gives per-platform counts + cost; totals derived in app code
      // Excludes channel_mention — those are group/channel usage, not personal DM usage
      const byPlatform = await db
        .selectFrom("agent_runs")
        .select([
          "platform",
          sql<number>`COUNT(id)`.as("count"),
          sql<number>`ROUND(COALESCE(SUM(cost_usd), 0), 6)`.as("cost"),
        ])
        .where("user_id", "=", userId)
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .where("context_type", "!=", "channel_mention")
        .groupBy("platform")
        .execute();

      const skillTotal = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(sql<number>`COUNT(tc.id)`.as("count"))
        .where("r.user_id", "=", userId)
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("r.context_type", "!=", "channel_mention")
        .where("tc.skill_name", "is not", null)
        .executeTakeFirstOrThrow();

      let totalMessages = 0;
      let totalCostUsd = 0;
      for (const r of byPlatform) {
        totalMessages += Number(r.count);
        totalCostUsd += Number(r.cost);
      }

      return {
        totalMessages,
        messagesByPlatform: byPlatform.map((r) => ({ platform: r.platform, count: Number(r.count) })),
        totalCostUsd,
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
        .where("r.context_type", "!=", "channel_mention")
        .where("tc.skill_name", "is not", null)
        .groupBy("tc.skill_name")
        .orderBy("count", "desc")
        .execute();

      return rows.map((r) => ({ name: r.skill_name as string, count: Number(r.count) }));
    },

    async getOrgSummary(from: string, to: string): Promise<OrgSummary> {
      // Single query: GROUP BY platform gives per-platform counts + cost; totals derived in app code
      const byPlatform = await db
        .selectFrom("agent_runs")
        .select([
          "platform",
          sql<number>`COUNT(id)`.as("count"),
          sql<number>`ROUND(COALESCE(SUM(cost_usd), 0), 6)`.as("cost"),
        ])
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

      let totalMessages = 0;
      let totalCostUsd = 0;
      for (const r of byPlatform) {
        totalMessages += Number(r.count);
        totalCostUsd += Number(r.cost);
      }

      return {
        totalMessages,
        messagesByPlatform: byPlatform.map((r) => ({ platform: r.platform, count: Number(r.count) })),
        totalCostUsd,
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
      // Exclude channel_mention runs — those are counted in getGroupBreakdown
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
        .where("r.context_type", "!=", "channel_mention")
        .groupBy(["r.user_id", "u.name", "u.type"])
        .orderBy("costUsd", "desc")
        .execute();

      const skillRows = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select(["r.user_id", sql<number>`COUNT(tc.id)`.as("skillCount")])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("r.context_type", "!=", "channel_mention")
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

    async getGroupBreakdown(from: string, to: string): Promise<GroupBreakdown[]> {
      const wsKey = sql<string>`json_extract(r.attributes, '$."sketch.workspace_key"')`;

      // Query 1: messages + last run per workspace_key (channel/group runs only)
      const msgRows = await db
        .selectFrom("agent_runs as r")
        .select([
          wsKey.as("workspaceKey"),
          "r.platform",
          sql<number>`COUNT(r.id)`.as("messageCount"),
          sql<string>`MAX(r.created_at)`.as("lastRunAt"),
        ])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("r.context_type", "=", "channel_mention")
        .where(wsKey, "is not", null)
        .groupBy([wsKey, "r.platform"])
        .orderBy("messageCount", "desc")
        .execute();

      if (msgRows.length === 0) return [];

      // Query 2: skill counts per workspace_key (separate to avoid fan-out)
      const skillRows = await db
        .selectFrom("tool_calls as tc")
        .innerJoin("agent_runs as r", "r.id", "tc.agent_run_id")
        .select([wsKey.as("workspaceKey"), sql<number>`COUNT(tc.id)`.as("skillCount")])
        .where("r.created_at", ">=", from)
        .where("r.created_at", "<", to)
        .where("r.context_type", "=", "channel_mention")
        .where("tc.skill_name", "is not", null)
        .groupBy(wsKey)
        .execute();

      const skillMap = new Map(skillRows.map((r) => [r.workspaceKey, Number(r.skillCount)]));

      // Resolve names: collect slack channel IDs and whatsapp group JIDs
      const slackIds: string[] = [];
      const waJids: string[] = [];
      for (const row of msgRows) {
        const wk = row.workspaceKey;
        if (wk?.startsWith("channel-")) slackIds.push(wk.slice(8));
        else if (wk?.startsWith("wa-group-")) waJids.push(wk.slice(9));
      }

      const channelNames = new Map<string, string>();
      if (slackIds.length > 0) {
        const rows = await db
          .selectFrom("channels")
          .select(["slack_channel_id", "name"])
          .where("slack_channel_id", "in", slackIds)
          .execute();
        for (const r of rows) channelNames.set(r.slack_channel_id, r.name);
      }

      const groupNames = new Map<string, string>();
      if (waJids.length > 0) {
        const rows = await db
          .selectFrom("whatsapp_groups")
          .select(["jid", "name"])
          .where("jid", "in", waJids)
          .execute();
        for (const r of rows) groupNames.set(r.jid, r.name);
      }

      return msgRows.map((r) => {
        const wk = r.workspaceKey ?? "";
        let name = wk;
        let platform: "slack" | "whatsapp" = r.platform as "slack" | "whatsapp";
        if (wk.startsWith("channel-")) {
          const slackId = wk.slice(8);
          name = channelNames.get(slackId) ?? `#${slackId}`;
          platform = "slack";
        } else if (wk.startsWith("wa-group-")) {
          const jid = wk.slice(9);
          name = groupNames.get(jid) ?? jid;
          platform = "whatsapp";
        }
        return {
          workspaceKey: wk,
          name,
          platform,
          messageCount: Number(r.messageCount),
          skillCount: skillMap.get(wk) ?? 0,
          lastRunAt: r.lastRunAt ?? null,
        };
      });
    },

    async getDailyBreakdown(userId: string | null, from: string, to: string): Promise<DailyBucket[]> {
      // Query 1: messages per day (exclude channel_mention for per-user — those are in group breakdown)
      let msgQuery = db
        .selectFrom("agent_runs")
        .select([sql<string>`DATE(created_at)`.as("date"), sql<number>`COUNT(id)`.as("messages")])
        .where("created_at", ">=", from)
        .where("created_at", "<", to)
        .groupBy(sql`DATE(created_at)`)
        .orderBy(sql`DATE(created_at)`);
      if (userId !== null) {
        msgQuery = msgQuery.where("user_id", "=", userId).where("context_type", "!=", "channel_mention");
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
        skillQuery = skillQuery.where("r.user_id", "=", userId).where("r.context_type", "!=", "channel_mention");
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
