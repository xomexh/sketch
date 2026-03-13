/**
 * Git worktree helper for isolated feature development.
 *
 * Create: pnpm worktree:create <branch>
 *   - Creates ../sketch-<branch> worktree on a new branch tracking origin/main
 *   - Symlinks .env from main repo, inits .planning submodule (skips if no access)
 *   - Installs dependencies
 *
 * Remove: pnpm worktree:remove <branch>
 *   - Removes the worktree and deletes the local branch
 *
 * List: pnpm worktree:list
 *   - Lists all active worktrees
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

  console.log("Initializing .planning submodule...");
  try {
    run("git submodule update --init .planning", worktreeDir);
  } catch {
    console.log("Skipping .planning (private repo, no access). Worktree will work without it.");
  }

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

  console.log("Cleaning up submodule...");
  try {
    run("git submodule deinit --force .planning", worktreeDir);
  } catch {
    // Submodule was never initialized, nothing to clean up
  }

  run(`git worktree remove --force ${worktreeDir}`);
  run(`git branch -d ${branch}`);

  console.log("\nDone!");
}

function list() {
  run("git worktree list");
}

const action = process.argv[2];
const branch = process.argv[3];

if (action === "list") {
  list();
} else if (action === "create" || action === "remove") {
  if (!branch) {
    console.error(`Usage: pnpm worktree:${action} <branch>`);
    process.exit(1);
  }
  action === "create" ? create(branch) : remove(branch);
} else {
  console.error("Usage: pnpm worktree:create <branch> | pnpm worktree:remove <branch> | pnpm worktree:list");
  process.exit(1);
}
