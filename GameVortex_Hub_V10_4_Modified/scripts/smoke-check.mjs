import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const required = [
  'prisma/schema.prisma',
  'prisma/migrations/migration_lock.toml',
  'prisma/migrations/20260814190000_init/migration.sql',
  'lib/auth.ts',
  'lib/security.ts',
  'lib/payments.ts',
  'app/api/health/route.ts',
  'app/api/auth/login/route.ts',
  'app/api/games/route.ts',
  'app/api/games/[slug]/reviews/route.ts',
  'app/api/me/games/library/route.ts',
  'app/api/me/notifications/route.ts',
  'app/api/me/orders/route.ts',
  'app/api/me/orders/[id]/checkout/route.ts',
  'app/api/me/orders/[id]/keys/route.ts',
  'app/api/admin/products/[id]/keys/route.ts',
  'app/api/payments/webhook/route.ts',
  'app/marketplace/page.tsx',
  'app/orders/page.tsx',
  'components/marketplace/BuyNowButton.tsx',
  'components/marketplace/OrderHistory.tsx',
  'lib/digital-keys.ts',
  'prisma/migrations/20260820070000_digital_key_fulfillment/migration.sql',
  'app/api/ai/chat/route.ts',
  'lib/ai.ts',
  'lib/payouts.ts',
  'scripts/process-withdrawals.mjs',
  'app/api/reports/route.ts',
  'app/api/admin/moderation/route.ts',
  'app/api/admin/games/route.ts',
  'app/admin/games/page.tsx',
  'app/api/auth/register/route.ts',
  'prisma/migrations/20260819090000_v10_hardening/migration.sql',
  'BUILD_INFO_V10.json'
];
const missing = required.filter((x) => !fs.existsSync(path.join(root, x)));
const buildOk = fs.existsSync(path.join(root, '.next', 'BUILD_ID'));
const packageLock = fs.existsSync(path.join(root, 'package-lock.json'));
if (process.env.REQUIRE_LOCKFILE === '1' && !packageLock) { console.error('Missing package-lock.json: run npm run production:bootstrap with registry access.'); process.exit(1); }
if (missing.length) { console.error('Missing:', missing); process.exit(1); }
if (process.env.REQUIRE_BUILD === '1' && !buildOk) { console.error('Missing .next/BUILD_ID: production build has not completed.'); process.exit(1); }
console.log(`GameVortex smoke check: PASS${buildOk ? ' (production build detected)' : ''}${packageLock ? ' (lockfile detected)' : ' (lockfile pending)'}`);
