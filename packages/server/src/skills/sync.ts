/**
 * Syncs featured skills from the sketch-skills GitHub repo into the local Claude skills directory.
 * Clones on first run, pulls on subsequent runs. Non-fatal: logs a warning and continues on any failure.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "../logger";

const SKILLS_REPO = "https://github.com/canvasxai/sketch-skills.git";
const SKILLS_CACHE = join(homedir(), ".sketch", "skills-repo");
const SKILLS_TARGET = join(homedir(), ".claude", "skills");

export async function syncFeaturedSkills(logger: Logger): Promise<void> {
  try {
    if (existsSync(SKILLS_CACHE)) {
      execSync("git pull --ff-only", { cwd: SKILLS_CACHE, stdio: "pipe" });
      logger.info("Updated featured skills from remote");
    } else {
      mkdirSync(join(homedir(), ".sketch"), { recursive: true });
      execSync(`git clone --depth 1 ${SKILLS_REPO} ${SKILLS_CACHE}`, { stdio: "pipe" });
      logger.info("Cloned featured skills repo");
    }

    const manifestPath = join(SKILLS_CACHE, "manifest.json");
    if (!existsSync(manifestPath)) {
      logger.warn("No manifest.json found in skills repo, skipping skill copy");
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    mkdirSync(SKILLS_TARGET, { recursive: true });

    for (const [id, skill] of Object.entries<{ path: string }>(manifest.skills)) {
      const src = join(SKILLS_CACHE, skill.path);
      const dest = join(SKILLS_TARGET, id);
      if (existsSync(src)) {
        cpSync(src, dest, { recursive: true });
      }
    }

    logger.info({ count: Object.keys(manifest.skills).length }, "Synced featured skills");
  } catch (err) {
    logger.warn({ err }, "Failed to sync featured skills, continuing with existing skills");
  }
}
