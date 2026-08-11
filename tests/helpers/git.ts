import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../src/platform/process.js";

export interface TestRepository {
  root: string;
  cleanup(): Promise<void>;
}

export async function createTestRepository(name = "repo with spaces ü"): Promise<TestRepository> {
  const parent = await mkdtemp(path.join(os.tmpdir(), "commit-discipline-test-"));
  const root = path.join(parent, name);
  await mkdir(root, { recursive: true });
  await runCommand("git", ["init", "-b", "main"], { cwd: root });
  await runCommand("git", ["config", "user.name", "Commit Discipline Tests"], { cwd: root });
  await runCommand("git", ["config", "user.email", "tests@example.invalid"], { cwd: root });
  await writeFile(path.join(root, "baseline.txt"), "baseline\n", "utf8");
  await runCommand("git", ["add", "baseline.txt"], { cwd: root });
  await runCommand("git", ["commit", "-m", "test: baseline"], { cwd: root });

  return {
    root,
    cleanup: async () => rm(parent, { recursive: true, force: true }),
  };
}
