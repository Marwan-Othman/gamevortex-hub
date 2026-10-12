import { spawnSync } from "node:child_process";

const environment = process.env.VERCEL_ENV;

if (environment !== "production") {
  console.log(`Skipping database migrations for ${environment || "local/CI"} build; migrations are production-only.`);
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "db:deploy"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error("Could not start Prisma migration deployment:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
