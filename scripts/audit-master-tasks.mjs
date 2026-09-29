import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exists = (p) => fs.existsSync(path.join(root, p));
const route = (p) => exists(`app/api/${p}/route.ts`);
const page = (p) => exists(`app/${p}/page.tsx`);
const modelText = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const hasModel = (name) => new RegExp(`^model\\s+${name}\\s*\\{`, 'm').test(modelText);

const checks = [
  ['Authentication/session', exists('lib/auth.ts')],
  ['RBAC owner', exists('lib/auth.ts') && fs.readFileSync(path.join(root, 'lib/auth.ts'), 'utf8').includes('Role.SUPER_ADMIN')],
  ['Game search', route('search')],
  ['Recommendations', route('me/recommendations')],
  ['Marketplace', route('marketplace/products')],
  ['Wallet deposits', route('wallet/deposit')],
  ['VIP status', route('vip/status')],
  ['VIP checkout', route('vip/checkout')],
  ['Owner control', route('admin/owner-control') && page('admin/owner-control')],
  ['Owner settings', page('admin/settings')],
  ['Owner users', page('admin/users')],
  ['Owner VIP', page('admin/vip')],
  ['Game Library model', hasModel('GameLibraryItem')],
  ['Favorites model', hasModel('FavoriteGame')],
  ['Wishlist model', hasModel('WishlistGame')],
  ['Achievements model', hasModel('Achievement')],
  ['User achievements model', hasModel('UserAchievement')],
  ['XP model', hasModel('XpEvent')],
  ['Follow model', hasModel('UserFollow')],
  ['Activity model', hasModel('Activity')],
  ['Notifications model', hasModel('Notification')],
  ['Audit log model', hasModel('AuditLog')],
];

console.log('GameVortex Hub master task audit');
console.log('================================');
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'CHECK'}  ${name}`);

console.log('\nExternal integrations require manual verification:');
for (const key of [
  'DATABASE_URL', 'AUTH_SECRET', 'APP_ORIGIN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'STEAM_API_KEY', 'RAWG_API_KEY',
]) {
  console.log(`${process.env[key] ? 'SET' : 'NOT_SET'}  ${key}`);
}
