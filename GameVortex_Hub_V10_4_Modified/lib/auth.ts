import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './prisma';
import { Role } from '@prisma/client';

const COOKIE = 'gv_session';
const TTL = 60 * 60 * 24 * 7;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('AUTH_SECRET_NOT_CONFIGURED');
  return value;
}
function b64(value: string) { return Buffer.from(value).toString('base64url'); }
function unb64(value: string) { return Buffer.from(value, 'base64url').toString('utf8'); }
function safeEqual(a:string,b:string) {
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
export function hashPassword(password: string) {
  if (password.length < 10) throw new Error('PASSWORD_TOO_SHORT');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, expected] = encoded.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  try {
    const actual = scryptSync(password, salt, 64);
    const target = Buffer.from(expected, 'hex');
    return target.length === actual.length && timingSafeEqual(actual, target);
  } catch { return false; }
}
function sign(payload: string) { return createHmac('sha256', secret()).update(payload).digest('base64url'); }
function token(userId: string, sessionVersion: number) {
  const exp = Math.floor(Date.now()/1000) + TTL;
  const payload = b64(JSON.stringify({ sub:userId, sv:sessionVersion, exp }));
  return `${payload}.${sign(payload)}`;
}
function readToken(value?: string) {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !safeEqual(sign(payload),signature)) return null;
  try {
    const data = JSON.parse(unb64(payload)) as {sub?:string,sv?:number,exp?:number};
    if (!data.sub || !Number.isInteger(data.sv) || !data.exp || data.exp < Math.floor(Date.now()/1000)) return null;
    return { id: data.sub, sessionVersion: data.sv };
  } catch { return null; }
}
export async function createSession(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  if (!user) throw new Error('UNAUTHORIZED');
  const store = await cookies();
  store.set(COOKIE, token(userId, user.sessionVersion), { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', path:'/', maxAge:TTL });
}
export async function destroySession() { const store = await cookies(); store.delete(COOKIE); }
export async function requireUser() {
  const store = await cookies();
  const tokenData = readToken(store.get(COOKIE)?.value);
  if (!tokenData) throw new Error('UNAUTHORIZED');
  const user = await db.user.findUnique({ where:{id: tokenData.id} });
  if (!user || user.sessionVersion !== tokenData.sessionVersion) throw new Error('UNAUTHORIZED');
  return user;
}
export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== Role.SUPER_ADMIN) throw new Error('FORBIDDEN');
  const configuredOwner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (configuredOwner && user.email.toLowerCase() !== configuredOwner) throw new Error('FORBIDDEN');
  if (process.env.NODE_ENV === 'production' && !configuredOwner) throw new Error('OWNER_EMAIL_NOT_CONFIGURED');
  return user;
}
