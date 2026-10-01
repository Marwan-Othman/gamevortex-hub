# GameVortex AI Voice + Media Merge

## Included in this update

- Full-screen GameVortex-branded voice mode overlay.
- Persistent microphone button in the AI composer.
- Browser speech recognition and speech synthesis when supported by the device/browser.
- Arabic/English RTL/LTR behavior through the existing locale system.
- AI image/video cards displayed directly below the conversation messages.
- Media history stored against the GameVortex AI conversation.
- User-owned media deletion endpoint with Vercel Blob cleanup when a Blob URL is stored.
- Owner (`SUPER_ADMIN`) bypasses GameVortex application-level image/video credits. Provider and infrastructure limits still apply.
- Server-side protection against requests for private/admin/owner routes, secrets, tokens, environment variables and protected infrastructure details.
- Existing conversation ownership checks remain server-side.

## Important provider status

The repository already contains the external media provider/external video provider provider abstraction, but the provider functions in `lib/ai-media/providers.ts` are intentionally fail-closed in this baseline. The new UI, persistence, ownership, deletion, and security layers are ready, but real image/video generation requires the provider implementation and server-side credentials to be enabled.

Do not put provider keys in Git or any `NEXT_PUBLIC_*` variable.

## Database change

Migration `20260930070000_add_ai_media_conversation` adds `conversationId` to `AiMediaJob` and links it to `GameVortexAiConversation`.
