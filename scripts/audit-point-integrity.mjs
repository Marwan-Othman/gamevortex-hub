import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = ["app", "components", "lib", "scripts"];
const suspicious = [];
const directUserPointWrite = /(?:user\.(?:update|updateMany)\(|tx\.user\.(?:update|updateMany)\()[\s\S]{0,800}?\bpoints\s*:/m;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".next") walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const rel = path.relative(root, full).replaceAll(path.sep, "/");
    if (rel === "lib/points.ts") continue;
    const source = fs.readFileSync(full, "utf8");
    if (directUserPointWrite.test(source)) suspicious.push(rel);
  }
}

for (const rootDir of roots) walk(path.join(root, rootDir));

if (suspicious.length) {
  console.error("Point integrity audit: FAIL");
  for (const file of suspicious) console.error(`- direct User.points write outside lib/points.ts: ${file}`);
  process.exit(1);
}

console.log("Point integrity audit: PASS");
