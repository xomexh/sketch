export const skillCategoryValues = [
  "crm",
  "comms",
  "research",
  "ops",
  "productivity",
  "sales",
  "marketing",
  "finance",
  "hr",
  "engineering",
  "design",
  "analytics",
  "security",
  "legal",
  "support",
  "onboarding",
  "reporting",
  "integrations",
  "ai",
  "workflows",
] as const;

export type SkillCategory = (typeof skillCategoryValues)[number];

export const skillCategoryValueSet: ReadonlySet<string> = new Set(skillCategoryValues);
