import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useTheme } from "@sketch/ui/hooks/use-theme";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { TimePeriod } from "./shared";

const chartConfig = {
  messages: {
    label: "Messages",
    theme: {
      light: "#C8A800",
      dark: "#C8A800",
    },
  },
  skills: {
    label: "Skills triggered",
    theme: {
      light: "#B4B2A9",
      dark: "#444441",
    },
  },
} satisfies ChartConfig;

export function UsageOverTimeChart({
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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { chartData, labelByDate } = useMemo(() => {
    if (!usageData) return { chartData: [], labelByDate: new Map<string, string>() };

    const from = new Date(usageData.period.from);
    const to = new Date(usageData.period.to);
    const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));

    const msgMap = new Map<string, number>();
    const skillMap = new Map<string, number>();
    for (const bucket of usageData.daily_breakdown) {
      msgMap.set(bucket.date, bucket.messages);
      skillMap.set(bucket.date, bucket.skills);
    }

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const data: { date: string; messages: number; skills: number }[] = [];
    const labels = new Map<string, string>();

    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      const dateKey = d.toISOString().slice(0, 10);

      let label: string;
      if (timePeriod === "Week") {
        label = dayNames[d.getUTCDay()];
      } else if (timePeriod === "Quarter") {
        label = i % 7 === 0 ? `W${Math.floor(i / 7) + 1}` : "";
      } else {
        const dayNum = d.getUTCDate();
        label = dayNum % 3 === 1 ? `${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${dayNum}` : "";
      }

      labels.set(dateKey, label);
      data.push({
        date: dateKey,
        messages: msgMap.get(dateKey) ?? 0,
        skills: skillMap.get(dateKey) ?? 0,
      });
    }

    return { chartData: data, labelByDate: labels };
  }, [usageData, timePeriod]);

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
      <ChartContainer config={chartConfig} className="h-[240px] w-full !aspect-auto">
        <AreaChart data={chartData} margin={{ top: 10, right: 4, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="messagesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? "rgba(200,168,0,0.25)" : "rgba(254,237,1,0.28)"} />
              <stop offset="70%" stopColor={isDark ? "rgba(200,168,0,0.06)" : "rgba(254,237,1,0.08)"} />
              <stop offset="100%" stopColor={isDark ? "rgba(200,168,0,0)" : "rgba(254,237,1,0)"} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeWidth={0.5} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fontFamily: "Inter", fontSize: 11 }}
            interval={0}
            tickFormatter={(dateStr) => labelByDate.get(dateStr) ?? ""}
            padding={{ left: 4 }}
          />
          <YAxis axisLine={false} tickLine={false} tick={{ fontFamily: "Inter", fontSize: 10 }} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_value, payload) => {
                  const date = payload?.[0]?.payload?.date;
                  if (date) {
                    return new Date(date).toLocaleDateString("en", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    });
                  }
                  return _value;
                }}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="messages"
            stroke="var(--color-messages)"
            strokeWidth={2}
            fill="url(#messagesGradient)"
            dot={false}
            activeDot={{ r: 4, fill: "#FEED01", stroke: "#C8A800", strokeWidth: 1.5 }}
          />
          <Area
            type="monotone"
            dataKey="skills"
            stroke="var(--color-skills)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="transparent"
            dot={false}
            activeDot={{
              r: 3,
              fill: isDark ? "#040404" : "#ffffff",
              stroke: isDark ? "#5F5E5A" : "#888780",
              strokeWidth: 1.5,
            }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
