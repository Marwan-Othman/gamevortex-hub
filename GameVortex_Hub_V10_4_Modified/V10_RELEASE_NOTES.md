# GameVortex Hub V10

## Security
- Sessions now carry a server-checked `sessionVersion`, allowing invalidation.
- Production owner access is bound to `OWNER_EMAIL`; a second SUPER_ADMIN cannot become the owner by role alone.
- Registration is rate-limited, validated and creates a wallet.
- Admin game publishing requires a verified/official source.

## Admin
- Added `/admin/games` and `/api/admin/games`.
- Game deletion is intentionally non-destructive: it unpublishes the game and writes an audit record.

## Validation
The uploaded archive was reviewed structurally. A full production build still requires dependency installation and a real PostgreSQL environment/provider credentials.


## V10.1 Hardening pass
- Tightened production owner bootstrap so a second SUPER_ADMIN cannot be created or ownership transferred automatically.
- Expanded `.env.example` with all optional integration variables referenced by the application.
- Rechecked Prisma migration ordering and V10 sessionVersion migration.
