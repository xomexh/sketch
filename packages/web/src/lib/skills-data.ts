// ── Types ──────────────────────────────────────────────────

export type SkillCategory =
  | "crm"
  | "comms"
  | "research"
  | "ops"
  | "productivity"
  | "sales"
  | "marketing"
  | "finance"
  | "hr"
  | "engineering"
  | "design"
  | "analytics"
  | "security"
  | "legal"
  | "support"
  | "onboarding"
  | "reporting"
  | "integrations"
  | "ai"
  | "workflows";

export interface SkillSource {
  hub: string;
  stars: number;
  downloads: string;
}

export interface SkillChannelEntry {
  id: string;
  name: string;
  type: "slack" | "whatsapp";
  enabled: boolean;
}

export interface SkillIndividualEntry {
  id: string;
  name: string;
  enabled: boolean;
}

export interface SkillStatusConfig {
  org: boolean;
  channels: SkillChannelEntry[];
  individuals: SkillIndividualEntry[];
}

export interface SkillIntegration {
  integrationId: string;
  name: string;
  iconBg: string;
  iconLetter: string;
  status: "connected" | "error" | "not_connected";
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  category: SkillCategory;
  status: SkillStatusConfig;
  source?: SkillSource;
  iconBg: string;
  iconEmoji: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface ApiSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  category: SkillCategory;
}

// ── Category Definitions ───────────────────────────────────

export const skillCategories: {
  value: SkillCategory;
  label: string;
}[] = [
  { value: "crm", label: "CRM" },
  { value: "comms", label: "Comms" },
  { value: "research", label: "Research" },
  { value: "ops", label: "Ops" },
  { value: "productivity", label: "Productivity" },
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "engineering", label: "Engineering" },
  { value: "design", label: "Design" },
  { value: "analytics", label: "Analytics" },
  { value: "security", label: "Security" },
  { value: "legal", label: "Legal" },
  { value: "support", label: "Support" },
  { value: "onboarding", label: "Onboarding" },
  { value: "reporting", label: "Reporting" },
  { value: "integrations", label: "Integrations" },
  { value: "ai", label: "AI" },
  { value: "workflows", label: "Workflows" },
];

export const categoryMeta: Record<SkillCategory, { iconBg: string; iconEmoji: string }> = {
  crm: { iconBg: "bg-orange-500/15", iconEmoji: "📊" },
  comms: { iconBg: "bg-blue-500/15", iconEmoji: "💬" },
  research: { iconBg: "bg-purple-500/15", iconEmoji: "🔍" },
  ops: { iconBg: "bg-emerald-500/15", iconEmoji: "⚙️" },
  productivity: { iconBg: "bg-amber-500/15", iconEmoji: "⚡" },
  sales: { iconBg: "bg-rose-500/15", iconEmoji: "💰" },
  marketing: { iconBg: "bg-pink-500/15", iconEmoji: "📢" },
  finance: { iconBg: "bg-green-500/15", iconEmoji: "💵" },
  hr: { iconBg: "bg-teal-500/15", iconEmoji: "👥" },
  engineering: { iconBg: "bg-cyan-500/15", iconEmoji: "🛠" },
  design: { iconBg: "bg-violet-500/15", iconEmoji: "🎨" },
  analytics: { iconBg: "bg-indigo-500/15", iconEmoji: "📈" },
  security: { iconBg: "bg-red-500/15", iconEmoji: "🔒" },
  legal: { iconBg: "bg-slate-500/15", iconEmoji: "⚖️" },
  support: { iconBg: "bg-sky-500/15", iconEmoji: "🎧" },
  onboarding: { iconBg: "bg-lime-500/15", iconEmoji: "🚀" },
  reporting: { iconBg: "bg-yellow-500/15", iconEmoji: "📋" },
  integrations: { iconBg: "bg-fuchsia-500/15", iconEmoji: "🔗" },
  ai: { iconBg: "bg-purple-500/15", iconEmoji: "🤖" },
  workflows: { iconBg: "bg-orange-500/15", iconEmoji: "🔄" },
};

// ── Source tag type ───────────────────────────────────────

export interface SkillSourceTag {
  type: "individual" | "channel";
  label: string; // "You" or "#channel-name"
}

// ── Utilities ──────────────────────────────────────────────

export function fromApiSkill(s: ApiSkill): Skill {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    body: s.body,
    category: s.category,
    status: { org: true, channels: [], individuals: [] },
    iconBg: categoryMeta[s.category].iconBg,
    iconEmoji: categoryMeta[s.category].iconEmoji,
    source: undefined,
    lastUsedAt: null,
    createdAt: new Date(),
  };
}

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "1 day ago";
  return `${diffDay} days ago`;
}

export function getCategoryLabel(category: SkillCategory): string {
  const found = skillCategories.find((c) => c.value === category);
  return found?.label ?? category;
}

/** Check if a skill is enabled for anyone */
export function isSkillEnabled(status: SkillStatusConfig): boolean {
  if (status.org) return true;
  if (status.channels.some((c) => c.enabled)) return true;
  if (status.individuals.some((i) => i.enabled)) return true;
  return false;
}

/** Get active channels from a skill status */
export function getActiveChannels(status: SkillStatusConfig): SkillChannelEntry[] {
  return status.channels.filter((c) => c.enabled);
}

/** Get active individuals from a skill status */
export function getActiveIndividuals(status: SkillStatusConfig): SkillIndividualEntry[] {
  return status.individuals.filter((i) => i.enabled);
}

/**
 * Check if a skill is active for a specific user.
 * Active means: org-wide enabled, OR user is in individuals (enabled),
 * OR any channel is enabled (mock: all enabled channels accessible to user).
 */
export function isSkillActiveForUser(status: SkillStatusConfig, userId: string): boolean {
  if (status.org) return true;
  if (status.individuals.some((i) => i.id === userId && i.enabled)) return true;
  if (status.channels.some((c) => c.enabled)) return true;
  return false;
}

/**
 * Get the activation sources for a skill, relative to a specific user.
 * Returns tags in display order: "You" first, then channels alphabetically.
 * Org-wide skills return empty array (no source tags needed).
 */
export function getSkillSourcesForUser(status: SkillStatusConfig, userId: string): SkillSourceTag[] {
  if (status.org) return [];

  const tags: SkillSourceTag[] = [];

  // Check if user is individually assigned
  if (status.individuals.some((i) => i.id === userId && i.enabled)) {
    tags.push({ type: "individual", label: "You" });
  }

  // Add enabled channels, sorted alphabetically
  const enabledChannels = status.channels.filter((c) => c.enabled).sort((a, b) => a.name.localeCompare(b.name));

  for (const ch of enabledChannels) {
    tags.push({ type: "channel", label: ch.name });
  }

  return tags;
}
