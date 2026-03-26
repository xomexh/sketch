import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDashboardAuth } from "@/routes/dashboard";
import { ArrowDownIcon, ArrowUpIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { useEffect, useMemo, useState } from "react";
import { Chart } from "react-chartjs-2";
import { dashboardRoute } from "./dashboard";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Filler);

export const usageRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/usage",
  component: UsagePage,
});

type TimePeriod = "Week" | "Month" | "Quarter";
type AdminTab = "team" | "my-usage";

const PERIOD_MAP: Record<TimePeriod, "weekly" | "monthly" | "quarterly"> = {
  Week: "weekly",
  Month: "monthly",
  Quarter: "quarterly",
};

// --- Components ---

function UsagePage() {
  const auth = useDashboardAuth();
  const isAdmin = auth.role === "admin";
  const [activeTab, setActiveTab] = useState<AdminTab>("team");
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("Month");

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div>
        <h1 className="text-[22px] font-medium">{isAdmin ? "Usage" : "My usage"}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {isAdmin
            ? "Monitor your workspace activity and team adoption."
            : "Your personal activity with Sketch this week."}
        </p>
      </div>

      {isAdmin ? (
        <>
          <div className="mt-6 flex items-center gap-6 border-b border-border">
            <TabButton label="Team" isActive={activeTab === "team"} onClick={() => setActiveTab("team")} />
            <TabButton label="My usage" isActive={activeTab === "my-usage"} onClick={() => setActiveTab("my-usage")} />
          </div>

          {activeTab === "team" ? (
            <TeamView timePeriod={timePeriod} onTimePeriodChange={setTimePeriod} />
          ) : (
            <PersonalView timePeriod={timePeriod} onTimePeriodChange={setTimePeriod} />
          )}
        </>
      ) : (
        <PersonalView timePeriod={timePeriod} onTimePeriodChange={setTimePeriod} />
      )}
    </div>
  );
}

function TabButton({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative pb-3 font-mono text-[11px] uppercase tracking-[0.07em] transition-colors",
        isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {isActive ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-[#FEED01]" /> : null}
    </button>
  );
}

function TimeFilter({ value, onChange }: { value: TimePeriod; onChange: (v: TimePeriod) => void }) {
  const options: TimePeriod[] = ["Week", "Month", "Quarter"];
  return (
    <div className="inline-flex rounded-lg border-[0.5px] border-border bg-card p-0.5 dark:bg-[#111110]">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-md px-3 py-1 text-xs transition-colors",
            value === opt
              ? "bg-accent font-medium text-foreground dark:bg-[#1C1C1A]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// --- Team View ---

function TeamView({
  timePeriod,
  onTimePeriodChange,
}: {
  timePeriod: TimePeriod;
  onTimePeriodChange: (v: TimePeriod) => void;
}) {
  const apiPeriod = PERIOD_MAP[timePeriod];

  const { data } = useQuery({
    queryKey: ["usage", "summary", apiPeriod],
    queryFn: () => api.usage.summary({ period: apiPeriod }),
  });

  const channels = useMemo(() => {
    if (!data) return [];
    return data.messages.by_platform.map((p) => ({
      platform: p.platform as "slack" | "whatsapp" | "email",
      label: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
      count: p.count,
      pct: data.messages.total > 0 ? Math.round((p.count / data.messages.total) * 100) : 0,
    }));
  }, [data]);

  const skills = useMemo(() => {
    if (!data) return [];
    return data.skills.by_skill.map((s) => ({ name: s.name, category: "", count: s.count }));
  }, [data]);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center justify-between">
        <TimeFilter value={timePeriod} onChange={onTimePeriodChange} />
        {data ? (
          <span className="font-mono text-[11px] text-muted-foreground">{formatPeriodLabel(data.period)}</span>
        ) : null}
      </div>

      {/* 3-up metric cards */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard label="Total messages" value={data ? data.messages.total.toLocaleString() : "—"} delta={0} />
        <MetricCard label="Skills triggered" value={data ? data.skills.total.toLocaleString() : "—"} delta={0} />
        <AmountSpentCard value={data?.spend.total_cost_usd ?? 0} periodLabel={timePeriod.toLowerCase()} />
      </div>

      {/* Team adoption table */}
      {data?.by_user ? (
        <div>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Team adoption</p>
          <TeamAdoptionTable users={data.by_user} />
        </div>
      ) : null}

      {/* Activity by channel + Top skills */}
      <div className="grid gap-6 sm:grid-cols-2">
        <ActivityByChannel channels={channels} />
        <TopSkills skills={skills} />
      </div>
    </div>
  );
}

// --- Personal View ---

function PersonalView({
  timePeriod,
  onTimePeriodChange,
}: {
  timePeriod: TimePeriod;
  onTimePeriodChange: (v: TimePeriod) => void;
}) {
  const apiPeriod = PERIOD_MAP[timePeriod];

  const { data } = useQuery({
    queryKey: ["usage", "me", apiPeriod],
    queryFn: () => api.usage.me({ period: apiPeriod }),
  });

  const channels = useMemo(() => {
    if (!data) return [];
    return data.messages.by_platform.map((p) => ({
      platform: p.platform as "slack" | "whatsapp" | "email",
      label: p.platform.charAt(0).toUpperCase() + p.platform.slice(1),
      count: p.count,
      pct: data.messages.total > 0 ? Math.round((p.count / data.messages.total) * 100) : 0,
    }));
  }, [data]);

  const skills = useMemo(() => {
    if (!data) return [];
    return data.skills.by_skill.map((s) => ({ name: s.name, category: "", count: s.count }));
  }, [data]);

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center justify-between">
        <TimeFilter value={timePeriod} onChange={onTimePeriodChange} />
        {data ? (
          <span className="font-mono text-[11px] text-muted-foreground">{formatPeriodLabel(data.period)}</span>
        ) : null}
      </div>

      {/* 2-up metric cards */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Messages handled" value={data ? data.messages.total.toLocaleString() : "—"} delta={0} />
        <AmountSpentCard value={data?.spend.total_cost_usd ?? 0} periodLabel={timePeriod.toLowerCase()} />
      </div>

      {/* Usage over time chart */}
      <UsageOverTimeChart timePeriod={timePeriod} data={data} />

      {/* Activity by channel + Top skills */}
      <div className="grid gap-6 sm:grid-cols-2">
        <ActivityByChannel channels={channels} title="My activity by channel" />
        <TopSkills skills={skills} title="My top skills" />
      </div>
    </div>
  );
}

// --- Metric Cards ---

function MetricCard({
  label,
  value,
  delta,
  deltaLabel,
}: {
  label: string;
  value: string;
  delta: number;
  deltaLabel?: string;
}) {
  const isNegative = delta < 0;
  const isPositive = delta > 0;

  return (
    <div className="rounded-lg bg-card p-4 dark:bg-[#111110]">
      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[26px] font-medium leading-tight">{value}</p>
      {delta !== 0 ? (
        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-[11px]",
            isNegative ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {isPositive ? <ArrowUpIcon size={10} /> : <ArrowDownIcon size={10} />}
          {isNegative ? deltaLabel || `${Math.abs(delta)}%` : deltaLabel || `${delta}%`}
        </p>
      ) : null}
    </div>
  );
}

function AmountSpentCard({ value, periodLabel }: { value: number; periodLabel: string }) {
  const pctOfPlan = Math.min((value / 100) * 100, 100);
  const isAmber = pctOfPlan >= 80;

  return (
    <div className="rounded-lg bg-card p-4 dark:bg-[#111110]">
      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-muted-foreground">Amount spent</p>
      <p className={cn("mt-1 text-[26px] font-medium leading-tight", isAmber && "text-amber-600 dark:text-amber-400")}>
        ${value.toFixed(2)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">this {periodLabel}</p>
      <div className="mt-2 h-[7px] w-full overflow-hidden rounded-[4px] bg-[#B4B2A9] dark:bg-[#4A4840]">
        <div
          className={cn("h-full rounded-[4px] transition-all", isAmber ? "bg-amber-500" : "bg-[#FEED01]")}
          style={{ width: `${pctOfPlan}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[9px] text-muted-foreground">{Math.round(pctOfPlan)}% of plan</p>
    </div>
  );
}

// --- Usage Over Time Chart ---

function useDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function UsageOverTimeChart({
  timePeriod,
  data: usageData,
}: {
  timePeriod: TimePeriod;
  data:
    | {
        period: { from: string; to: string; type: string };
        daily_breakdown: { date: string; messages: number; skills: number }[];
      }
    | undefined;
}) {
  const isDark = useDarkMode();

  const chartData = useMemo(() => {
    if (!usageData) {
      return { labels: [] as string[], messages: [] as number[], skills: [] as number[] };
    }

    const from = new Date(usageData.period.from);
    const to = new Date(usageData.period.to);
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));

    // Build a lookup map from the sparse daily_breakdown
    const msgMap = new Map<string, number>();
    const skillMap = new Map<string, number>();
    for (const bucket of usageData.daily_breakdown) {
      msgMap.set(bucket.date, bucket.messages);
      skillMap.set(bucket.date, bucket.skills);
    }

    // Generate one entry per day in the period, filling zeros for missing days
    const labels: string[] = [];
    const messages: number[] = [];
    const skills: number[] = [];

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10); // YYYY-MM-DD

      if (timePeriod === "Week") {
        labels.push(dayNames[d.getUTCDay()]);
      } else if (timePeriod === "Quarter") {
        // Show week labels: every 7th day gets a label
        labels.push(i % 7 === 0 ? `W${Math.floor(i / 7) + 1}` : "");
      } else {
        // Month: label every 3rd day
        const dayNum = d.getUTCDate();
        labels.push(dayNum % 3 === 1 ? `${d.toLocaleString("en", { month: "short" })} ${dayNum}` : "");
      }

      messages.push(msgMap.get(dateKey) ?? 0);
      skills.push(skillMap.get(dateKey) ?? 0);
    }

    return { labels, messages, skills };
  }, [usageData, timePeriod]);

  const graphData = useMemo(
    () => ({
      labels: chartData.labels,
      datasets: [
        {
          type: "line" as const,
          label: "Messages",
          data: chartData.messages,
          borderColor: "#C8A800",
          backgroundColor: (ctx: {
            chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } };
          }) => {
            const { chart } = ctx;
            const fallback = isDark ? "rgba(200,168,0,0.25)" : "rgba(254,237,1,0.28)";
            if (!chart.chartArea) return fallback;
            const gradient = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
            if (isDark) {
              gradient.addColorStop(0, "rgba(200,168,0,0.25)");
              gradient.addColorStop(0.7, "rgba(200,168,0,0.06)");
              gradient.addColorStop(1, "rgba(200,168,0,0)");
            } else {
              gradient.addColorStop(0, "rgba(254,237,1,0.28)");
              gradient.addColorStop(0.7, "rgba(254,237,1,0.08)");
              gradient.addColorStop(1, "rgba(254,237,1,0)");
            }
            return gradient;
          },
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: "#FEED01",
          pointHoverBackgroundColor: "#FEED01",
          pointBorderColor: "#C8A800",
          pointHoverBorderColor: "#C8A800",
          pointBorderWidth: 1.5,
          fill: true,
          yAxisID: "y",
        },
        {
          type: "line" as const,
          label: "Skills triggered",
          data: chartData.skills,
          borderColor: isDark ? "#444441" : "#B4B2A9",
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [4, 3],
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointBackgroundColor: isDark ? "#040404" : "#ffffff",
          pointHoverBackgroundColor: isDark ? "#040404" : "#ffffff",
          pointBorderColor: isDark ? "#5F5E5A" : "#888780",
          pointHoverBorderColor: isDark ? "#5F5E5A" : "#888780",
          pointBorderWidth: 1.5,
          fill: false,
          yAxisID: "y1",
        },
      ],
    }),
    [chartData, isDark],
  );

  const tickColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
  const gridColor = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? "#1C1C1A" : "#ffffff",
          titleColor: isDark ? "#FAFAF8" : "#040404",
          titleFont: { family: "IBM Plex Mono", size: 10 },
          bodyColor: isDark ? "#9C9A92" : "#5f5e5a",
          bodyFont: { family: "Inter", size: 11 },
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
          borderWidth: 0.5,
          padding: 10,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: tickColor, font: { family: "Inter", size: 11 }, padding: 4 },
        },
        y: {
          position: "left" as const,
          grid: { color: gridColor, lineWidth: 0.5 },
          border: { display: false, dash: [3, 3] },
          ticks: { color: tickColor, font: { family: "Inter", size: 10 } },
        },
        y1: {
          position: "right" as const,
          grid: { display: false },
          border: { display: false },
          ticks: { color: tickColor, font: { family: "Inter", size: 10 } },
        },
      },
    }),
    [isDark, tickColor, gridColor],
  );

  const skillsLegendGradient = isDark
    ? "repeating-linear-gradient(to right, #444441 0px, #444441 4px, transparent 4px, transparent 7px)"
    : "repeating-linear-gradient(to right, #B4B2A9 0px, #B4B2A9 4px, transparent 4px, transparent 7px)";

  if (!usageData) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Usage over time</p>
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-full bg-[#C8A800]" />
            Messages
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ backgroundImage: skillsLegendGradient }} />
            Skills triggered
          </span>
        </div>
      </div>
      <div className="h-[120px]">
        <Chart type="line" data={graphData} options={options} />
      </div>
    </div>
  );
}

// --- Team Adoption Table ---

interface TeamUser {
  userId: string;
  userName: string | null;
  userType: string;
  messageCount: number;
  costUsd: number;
  skillCount: number;
}

type TableFilter = "all" | "members" | "agents";
const ROWS_PER_PAGE = 20;

function TeamAdoptionTable({ users }: { users: TeamUser[] }) {
  const [filter, setFilter] = useState<TableFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filteredUsers = useMemo(() => {
    let list = users;
    if (filter === "members") list = list.filter((u) => u.userType !== "agent");
    if (filter === "agents") list = list.filter((u) => u.userType === "agent");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) => (u.userName ?? u.userId).toLowerCase().includes(q));
    }
    return list;
  }, [users, filter, search]);

  const counts = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = search.trim() ? users.filter((u) => (u.userName ?? u.userId).toLowerCase().includes(q)) : users;
    return {
      all: filtered.length,
      members: filtered.filter((u) => u.userType !== "agent").length,
      agents: filtered.filter((u) => u.userType === "agent").length,
    };
  }, [users, search]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / ROWS_PER_PAGE));
  const pagedUsers = filteredUsers.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  const filterTabs: { key: TableFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "members", label: "Members" },
    { key: "agents", label: "Agents" },
  ];

  function handleFilterChange(f: TableFilter) {
    setFilter(f);
    setPage(1);
  }

  return (
    <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="inline-flex rounded-lg border-[0.5px] border-border bg-card p-0.5 dark:bg-[#111110]">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleFilterChange(tab.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                filter === tab.key
                  ? "bg-accent font-medium text-foreground dark:bg-[#1C1C1A]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "ml-1 text-[10px]",
                  filter === tab.key ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {counts[tab.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative">
          <svg
            width={12}
            height={12}
            viewBox="0 0 256 256"
            fill="currentColor"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          >
            <path d="M229.66,218.34l-50.07-50.07a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.31ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-7 min-w-[180px] rounded-md border-[0.5px] border-border bg-card pl-7 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none dark:bg-[#111110]"
          />
        </div>
      </div>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="px-4 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[0.05em] text-muted-foreground">
              {filter === "agents" ? "Agent" : "Member"}
            </th>
            <th className="px-4 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[0.05em] text-muted-foreground">
              Messages
            </th>
            <th className="px-4 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[0.05em] text-muted-foreground">
              Skills used
            </th>
            <th className="px-4 py-2.5 text-right font-mono text-[10px] font-normal uppercase tracking-[0.05em] text-muted-foreground">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {pagedUsers.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                {search ? <>No results for &ldquo;{search}&rdquo;</> : "No usage data yet"}
              </td>
            </tr>
          ) : (
            pagedUsers.map((user) => (
              <tr
                key={user.userId}
                className="border-b border-border transition-colors last:border-b-0 hover:bg-secondary/50 dark:hover:bg-muted/30"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <AvatarChip
                      name={user.userName ?? user.userId}
                      type={user.userType === "agent" ? "agent" : "member"}
                    />
                    <span className="text-[13px] font-medium">{user.userName ?? user.userId}</span>
                    {user.userType === "agent" ? (
                      <Badge variant="secondary" className="rounded-[4px] px-1.5 py-0 text-[9px]">
                        Agent
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{user.messageCount}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{user.skillCount}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">${user.costUsd.toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {filteredUsers.length > ROWS_PER_PAGE ? (
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-[10px] uppercase text-muted-foreground">
          <span>
            Showing {pagedUsers.length} of {filteredUsers.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <CaretLeftIcon size={12} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setPage(pageNum)}
                  className={cn(
                    "min-w-[24px] rounded px-1.5 py-0.5 font-mono text-[10px]",
                    page === pageNum ? "bg-muted font-medium text-foreground" : "hover:bg-muted",
                  )}
                >
                  {pageNum}
                </button>
              );
            })}
            {totalPages > 5 ? <span className="px-1">...</span> : null}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded p-1 hover:bg-muted disabled:opacity-30"
            >
              <CaretRightIcon size={12} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Shared components ---

function AvatarChip({ name, type = "member" }: { name: string; type?: "member" | "agent" }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={cn(
        "flex size-[24px] shrink-0 items-center justify-center rounded-full text-[9px] font-medium",
        type === "agent"
          ? "border-[0.5px] border-dashed border-muted-foreground/40 bg-muted text-muted-foreground dark:bg-muted/50"
          : "border-[0.5px] border-border bg-muted text-muted-foreground dark:bg-muted/50",
      )}
    >
      {initials}
    </div>
  );
}

function ChannelIcon({ platform }: { platform: "slack" | "whatsapp" | "email" }) {
  if (platform === "slack")
    return (
      <svg width={16} height={16} viewBox="0 0 24 24" className="shrink-0" fill="#4A154B" aria-hidden="true">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
      </svg>
    );
  if (platform === "whatsapp")
    return (
      <svg width={16} height={16} viewBox="0 0 24 24" className="shrink-0" fill="#25D366" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
      </svg>
    );
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      className="shrink-0 text-muted-foreground"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
    </svg>
  );
}

function ActivityByChannel({
  channels,
  title = "Activity by channel",
}: {
  channels: Array<{ platform: "slack" | "whatsapp" | "email"; label: string; count: number; pct: number }>;
  title?: string;
}) {
  const maxCount = Math.max(...channels.map((c) => c.count), 1);

  if (channels.length === 0) {
    return (
      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
        <p className="text-[13px] text-muted-foreground">No channel activity yet</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      <div className="space-y-3">
        {channels.map((ch) => (
          <div key={ch.platform} className="flex items-center gap-2.5">
            <div className="flex w-[90px] items-center gap-2 text-[13px] text-foreground">
              <ChannelIcon platform={ch.platform} />
              <span>{ch.label}</span>
            </div>
            <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-[#B4B2A9] dark:bg-[#4A4840]">
              <div className="h-full rounded-[4px] bg-[#FEED01]" style={{ width: `${(ch.count / maxCount) * 100}%` }} />
            </div>
            <span className="w-[28px] text-right font-mono text-[11px] tabular-nums text-foreground">{ch.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopSkills({
  skills,
  title = "Top skills",
}: {
  skills: Array<{ name: string; category: string; count: number }>;
  title?: string;
}) {
  if (skills.length === 0) {
    return (
      <div>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
        <p className="text-[13px] text-muted-foreground">No skills used yet</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{title}</p>
      <div className="space-y-2.5">
        {skills.map((skill) => (
          <div key={skill.name} className="flex items-center justify-between">
            <div>
              <p className={cn("text-[13px] font-medium", skill.count === 0 && "italic text-muted-foreground")}>
                {skill.name}
              </p>
              {skill.category ? <p className="text-[11px] text-muted-foreground">{skill.category}</p> : null}
            </div>
            <span className="font-mono text-[12px] tabular-nums">
              <span className={cn("font-medium", skill.count === 0 && "text-muted-foreground")}>{skill.count}</span>
              <span className="text-muted-foreground">&times;</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helpers ---

function formatPeriodLabel(period: { from: string; to: string; type: string }): string {
  const from = new Date(period.from);
  const to = new Date(period.to);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${from.toLocaleDateString("en-US", opts)} – ${to.toLocaleDateString("en-US", opts)}`;
}
