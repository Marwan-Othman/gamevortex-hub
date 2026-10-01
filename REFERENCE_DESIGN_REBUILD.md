# GameVortex Hub Reference Design Rebuild

This build applies the approved GameVortex visual direction across the existing application without replacing business logic.

## Visual system
- Deep black / midnight background
- Electric violet primary identity
- Cyan utility accents
- Gold premium actions
- Glassmorphism panels
- Neon borders and restrained glow
- Compact gaming cards
- Responsive desktop/tablet/mobile layouts
- Arabic RTL and English LTR preserved

## Scope
The global reference layer is loaded last from `app/redesign.css`, so existing routes inherit the same visual system. Standalone module styles were also aligned for:
- Authentication
- VIP
- Gamer profile
- Admin

No API routes, Prisma models, trading logic, payment logic, authentication logic, or environment secrets were intentionally changed by this visual pass.
