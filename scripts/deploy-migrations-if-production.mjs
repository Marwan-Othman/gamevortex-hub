import { spawnSync } from "node:child_process";

const environment = process.env.VERCEL_ENV;

if (environment !== "production") {
  console.log(`Skipping database migrations for ${environment || "local/CI"} build; migrations are production-only.`);
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const maxAttempts = 3;
const retryDelayMs = [3000, 8000];
const transientLockFailure = /P1002|timed out trying to acquire a postgres advisory lock|advisory lock.*timed out|database server was reached but timed out/i;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`Running production database migrations (attempt ${attempt}/${maxAttempts}).`);

  const result = spawnSync(npm, ["run", "db:deploy"], {
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    env: process.env,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (!result.error && result.status === 0) {
    process.exit(0);
  }

  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  const retryable = transientLockFailure.test(output);

  if (!retryable || attempt === maxAttempts) {
    if (result.error) {
      console.error("Could not start Prisma migration deployment:", result.error.message);
    }
    process.exit(result.status ?? 1);
  }

  const delay = retryDelayMs[attempt - 1] ?? retryDelayMs.at(-1);
  console.warn(
    `Prisma migration deployment hit a transient database/advisory-lock timeout. Retrying in ${delay}ms; no migration was marked successful by this wrapper.`,
  );
  await new Promise((resolve) => setTimeout(resolve, delay));
}

process.exit(1);
