import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { commitStage, planTask } from "../dist/index.js";

const ITERATIONS = 6;
const TARGET_MS = 300;
const enforce = process.argv.includes("--enforce");
const temporary = mkdtempSync(path.join(os.tmpdir(), "commit-discipline-benchmark-"));

function git(repository, args) {
  execFileSync("git", args, { cwd: repository, stdio: "ignore", windowsHide: true });
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

try {
  const measurements = [];
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const repository = path.join(temporary, `repo-${iteration}`);
    mkdirSync(repository);
    git(repository, ["init", "-b", "main"]);
    git(repository, ["config", "user.name", "Performance Benchmark"]);
    git(repository, ["config", "user.email", "benchmark@example.invalid"]);
    writeFileSync(path.join(repository, "baseline.txt"), "baseline\n", "utf8");
    git(repository, ["add", "baseline.txt"]);
    git(repository, ["commit", "-m", "test: baseline"]);
    await planTask(
      {
        description: "Benchmark Git overhead",
        stages: [
          { id: "one", title: "One", description: "Measured stage", files: ["baseline.txt"] },
          { id: "two", title: "Two", description: "Unused stage", files: ["two.txt"] },
        ],
      },
      { cwd: repository },
    );
    writeFileSync(path.join(repository, "baseline.txt"), "baseline\none\n", "utf8");

    const startedAt = performance.now();
    const result = await commitStage(
      { stage: "one", message: `perf: measurement ${iteration}` },
      { cwd: repository },
    );
    const elapsedMs = performance.now() - startedAt;
    measurements.push(elapsedMs - result.test.durationMs);
  }

  const samples = measurements.slice(1);
  const medianMs = median(samples);
  const report = {
    platform: process.platform,
    node: process.version,
    targetMs: TARGET_MS,
    warmupMs: Number(measurements[0].toFixed(2)),
    samplesMs: samples.map((value) => Number(value.toFixed(2))),
    medianMs: Number(medianMs.toFixed(2)),
    passed: medianMs < TARGET_MS,
    enforced: enforce,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (enforce && !report.passed) process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
