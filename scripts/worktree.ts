/**
 * Git worktree helper for isolated feature development.
 *
 * Create: pnpm worktree:create <branch>
 *   - Creates ../sketch-<branch> worktree on a new branch tracking origin/main
 *   - Symlinks .env and .planning from main repo
 *   - Installs dependencies
 *
 * Remove: pnpm worktree:remove <branch>
 *   - Removes the worktree and deletes the local branch
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd: string, cwd?: string) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

function create(branch: string) {
  const worktreeDir = resolve(MAIN_REPO, "..", `sketch-${branch}`);

  if (existsSync(worktreeDir)) {
    console.error(`Error: ${worktreeDir} already exists`);
    process.exit(1);
  }

  console.log(`Creating worktree at ${worktreeDir} on branch '${branch}'...\n`);
  run(`git worktree add -b ${branch} ${worktreeDir} origin/main`);

  console.log("\nSymlinking .env...");
  symlinkSync(resolve(MAIN_REPO, ".env"), resolve(worktreeDir, ".env"));

  console.log("Symlinking .planning...");
  rmSync(resolve(worktreeDir, ".planning"), { recursive: true, force: true });
  symlinkSync(resolve(MAIN_REPO, ".planning"), resolve(worktreeDir, ".planning"));

  console.log("\nInstalling dependencies...");
  run("pnpm install", worktreeDir);

  console.log(`\nDone! Worktree ready at ${worktreeDir}`);
  console.log(`  cd ${worktreeDir}`);
}

function remove(branch: string) {
  const worktreeDir = resolve(MAIN_REPO, "..", `sketch-${branch}`);

  if (!existsSync(worktreeDir)) {
    console.error(`Error: ${worktreeDir} does not exist`);
    process.exit(1);
  }

  console.log(`Removing worktree at ${worktreeDir}...\n`);

  console.log("Cleaning up submodule references...");
  rmSync(resolve(worktreeDir, ".planning"), { force: true });
  run("git submodule deinit --force .planning", worktreeDir);

  run(`git worktree remove ${worktreeDir}`);
  run(`git branch -d ${branch}`);

  console.log("\nDone!");
}

const action = process.argv[2];
const branch = process.argv[3];

if (!branch) {
  console.error("Usage: pnpm worktree:create <branch> | pnpm worktree:remove <branch>");
  process.exit(1);
}

if (action === "create") {
  create(branch);
} else if (action === "remove") {
  remove(branch);
} else {
  console.error(`Unknown action: ${action}`);
  process.exit(1);
}
