import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { loadProjectClaudeSkills } from "../skills/loader";

function getRepoRoot(): string {
  // In dev, server runs with cwd = {repoRoot}/packages/server.
  // In prod, it also runs from the server package directory.
  // Going up two levels yields the repo root.
  return new URL("../../", `file://${process.cwd()}/`).pathname.replace(/\/$/, "");
}

function assertSkillId(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return null;
  // Prevent traversal and keep folder names predictable
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(trimmed)) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  return trimmed;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function skillMdPath(repoRoot: string, id: string): string {
  return join(repoRoot, ".claude", "skills", id, "SKILL.MD");
}

function renderSkillMd(data: { name: string; description: string; category: string; body: string }): string {
  const fm = [
    "---",
    `name: ${data.name}`,
    `description: ${data.description}`,
    `category: ${data.category}`,
    "---",
    "",
  ].join("\n");
  const body = data.body.trim() ? data.body.trimEnd() : "";
  return fm + body + (body.endsWith("\n") || body === "" ? "" : "\n");
}

export function skillsRoutes() {
  const routes = new Hono();

  routes.get("/", (c) => {
    const skills = loadProjectClaudeSkills(getRepoRoot());
    return c.json({ skills });
  });

  routes.get("/:id", (c) => {
    const id = assertSkillId(c.req.param("id"));
    if (!id) return c.json({ error: { code: "BAD_REQUEST", message: "Invalid skill id" } }, 400);

    const skills = loadProjectClaudeSkills(getRepoRoot());
    const skill = skills.find((s) => s.id === id);
    if (!skill) return c.json({ error: { code: "NOT_FOUND", message: "Skill not found" } }, 404);
    return c.json({ skill });
  });

  routes.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      description?: string;
      category?: string;
      body?: string;
      id?: string;
    } | null;

    if (!body || typeof body.name !== "string" || typeof body.body !== "string") {
      return c.json({ error: { code: "BAD_REQUEST", message: "Missing required fields" } }, 400);
    }

    const repoRoot = getRepoRoot();
    const baseId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : slugify(body.name);
    const normalizedBase = assertSkillId(baseId);
    if (!normalizedBase) return c.json({ error: { code: "BAD_REQUEST", message: "Invalid skill id" } }, 400);

    const existing = new Set(loadProjectClaudeSkills(repoRoot).map((s) => s.id));
    let id = normalizedBase;
    let suffix = 2;
    while (existing.has(id)) {
      id = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }

    const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : "productivity";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const md = renderSkillMd({ name: body.name.trim(), description, category, body: body.body });

    const skillDir = join(repoRoot, ".claude", "skills", id);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillMdPath(repoRoot, id), md, "utf-8");

    const skill = loadProjectClaudeSkills(repoRoot).find((s) => s.id === id) ?? null;
    if (!skill) return c.json({ error: { code: "UNKNOWN", message: "Failed to create skill" } }, 500);
    return c.json({ skill }, 201);
  });

  routes.put("/:id", async (c) => {
    const id = assertSkillId(c.req.param("id"));
    if (!id) return c.json({ error: { code: "BAD_REQUEST", message: "Invalid skill id" } }, 400);

    const body = (await c.req.json().catch(() => null)) as {
      name?: string;
      description?: string;
      category?: string;
      body?: string;
    } | null;

    if (!body || typeof body.name !== "string" || typeof body.body !== "string") {
      return c.json({ error: { code: "BAD_REQUEST", message: "Missing required fields" } }, 400);
    }

    const repoRoot = getRepoRoot();
    const existing = loadProjectClaudeSkills(repoRoot).find((s) => s.id === id);
    if (!existing) return c.json({ error: { code: "NOT_FOUND", message: "Skill not found" } }, 404);

    const category =
      typeof body.category === "string" && body.category.trim() ? body.category.trim() : existing.category;
    const description = typeof body.description === "string" ? body.description.trim() : existing.description;
    const md = renderSkillMd({ name: body.name.trim(), description, category, body: body.body });

    writeFileSync(skillMdPath(repoRoot, id), md, "utf-8");

    const skill = loadProjectClaudeSkills(repoRoot).find((s) => s.id === id) ?? null;
    if (!skill) return c.json({ error: { code: "UNKNOWN", message: "Failed to update skill" } }, 500);
    return c.json({ skill });
  });

  routes.delete("/:id", (c) => {
    const id = assertSkillId(c.req.param("id"));
    if (!id) return c.json({ error: { code: "BAD_REQUEST", message: "Invalid skill id" } }, 400);

    const repoRoot = getRepoRoot();
    const existing = loadProjectClaudeSkills(repoRoot).find((s) => s.id === id);
    if (!existing) return c.json({ error: { code: "NOT_FOUND", message: "Skill not found" } }, 404);

    const skillDir = join(repoRoot, ".claude", "skills", id);
    rmSync(skillDir, { recursive: true, force: true });
    return c.json({ success: true });
  });

  return routes;
}
