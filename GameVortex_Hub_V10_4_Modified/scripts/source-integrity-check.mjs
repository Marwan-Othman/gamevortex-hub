import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "package.json", "next.config.mjs", "tsconfig.json", "prisma/schema.prisma",
  "lib/auth.ts", "lib/prisma.ts", "lib/security.ts", "scripts/validate-env.mjs",
  "prisma/migrations/migration_lock.toml",
  "prisma/migrations/20260819090000_v10_hardening/migration.sql"
];
const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) { console.error("Missing required source files:", missing); process.exit(1); }
const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
if (!schema.includes('sessionVersion Int @default(1)')) throw new Error('sessionVersion field missing from Prisma schema');
const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260819090000_v10_hardening/migration.sql"), "utf8");
if (!migration.includes('ADD COLUMN "sessionVersion"')) throw new Error('V10 session migration missing');
const envExample = fs.existsSync('.env.production.example') ? fs.readFileSync('.env.production.example','utf8') : '';
for (const key of ['DATABASE_URL','AUTH_SECRET','APP_ORIGIN','OWNER_EMAIL','OWNER_POINTS_PER_USD','OWNER_MIN_WITHDRAW_POINTS']) {
  if (!envExample.match(new RegExp(`^${key}=`, 'm'))) throw new Error(`Missing ${key} from production env example`);
}
console.log('Source integrity: PASS');
