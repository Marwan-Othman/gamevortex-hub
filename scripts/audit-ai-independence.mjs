import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['app', 'components', 'lib', 'prisma/schema.prisma', 'package.json', 'next.config.mjs'];
const forbidden = [
  /@base44\//i,
  /from\s+["'].*base44/i,
  /base44\.functions/i,
  /base44\.integrations/i,
  /FAL_KEY/i,
  /MINIMAX_API_KEY/i,
  /fal\.ai/i,
  /minimax/i,
];
const allowedHistorical = new Set([
  path.normalize('prisma/migrations'),
]);

function filesUnder(input) {
  const absolute = path.join(root, input);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path.relative(root, child)));
    else out.push(child);
  }
  return out;
}

const files = scanRoots.flatMap(filesUnder).filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
const hits = [];
for (const file of files) {
  const relative = path.relative(root, file);
  if (relative.startsWith(`${path.normalize('prisma/migrations')}${path.sep}`)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      hits.push(`${relative}: ${pattern}`);
    }
  }
}

const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const internalProvider = /enum\s+AiMediaProvider\s*\{\s*INTERNAL\s*\}/m.test(schema);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
const forbiddenPackages = Object.keys(deps).filter((name) => /base44|fal|mini|max/i.test(name));

if (hits.length || forbiddenPackages.length || !internalProvider) {
  console.error('AI independence audit: FAIL');
  for (const hit of hits) console.error(`- ${hit}`);
  for (const pkg of forbiddenPackages) console.error(`- forbidden package: ${pkg}`);
  if (!internalProvider) console.error('- prisma/schema.prisma does not define AiMediaProvider as INTERNAL only');
  process.exit(1);
}

console.log('AI independence audit: PASS');
console.log('Runtime source has no Base44/FAL/MiniMax dependency.');
console.log('Current Prisma media provider is INTERNAL only.');
