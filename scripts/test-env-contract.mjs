import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envFiles = ['.env.example', '.env.production.example'];
const sourceRoots = ['app', 'lib', 'scripts'];
const envRefPattern = /process\.env\.([A-Z0-9_]+)/g;
const refs = new Set();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(envRefPattern)) refs.add(match[1]);
  }
}

for (const dir of sourceRoots) walk(path.join(root, dir));

const ignoredRuntimeVars = new Set(['VERCEL_URL']);
const failures = [];

for (const envFile of envFiles) {
  const content = fs.readFileSync(path.join(root, envFile), 'utf8');
  const defined = new Set(
    [...content.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]),
  );
  for (const variable of refs) {
    if (!defined.has(variable) && !ignoredRuntimeVars.has(variable)) {
      failures.push(`${envFile}: ${variable}`);
    }
  }
}

if (failures.length) {
  console.error('Environment contract check: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Environment contract check: PASS');
