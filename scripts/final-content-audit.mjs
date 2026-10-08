import fs from "node:fs";
import path from "node:path";
const required = [
  "app/games/page.tsx","app/games/[slug]/page.tsx","app/apps/page.tsx","app/apps/[slug]/page.tsx",
  "app/api/games/route.ts","app/api/apps/route.ts","app/api/apps/[slug]/route.ts",
  "app/api/admin/games/route.ts","app/api/admin/apps/route.ts","app/api/admin/apps/[id]/route.ts",
  "app/admin/content/page.tsx","app/admin/content/ContentManager.tsx","app/admin/content-health/page.tsx",
  "app/api/admin/content-health/route.ts","app/api/admin/content/route.ts","app/api/admin/content/upload/route.ts","prisma/migrations/20260926200000_add_apps_system/migration.sql","prisma/migrations/20261008130000_unify_content_admin/migration.sql",
];
const missing=required.filter(f=>!fs.existsSync(path.join(process.cwd(),f)));
if(missing.length){console.error("Final content audit: FAIL");missing.forEach(x=>console.error("MISSING",x));process.exit(1)}
const schema=fs.readFileSync("prisma/schema.prisma","utf8");
for(const token of ["model App {","model AppPlatform {","model AppCategory {","appPlatforms AppPlatform[]","appCategories AppCategory[]"]){if(!schema.includes(token)){console.error("Final content audit: FAIL missing schema token",token);process.exit(1)}}
const migration=fs.readFileSync("prisma/migrations/20260926200000_add_apps_system/migration.sql","utf8");
for(const token of ['CREATE TABLE "App"','CREATE TABLE "AppPlatform"','CREATE TABLE "AppCategory"']){if(!migration.includes(token)){console.error("Final content audit: FAIL missing migration token",token);process.exit(1)}}
console.log("Final content audit: PASS");
