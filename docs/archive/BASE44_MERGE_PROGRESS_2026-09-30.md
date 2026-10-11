# GameVortex Hub + Base44 Reference Merge

This working copy keeps GameVortex Hub as the official project. Base44 is used only as a reference for UI composition, AI interaction patterns, multilingual behavior, voice UX, and media presentation.

## Applied in this pass
- Strengthened the independent GameVortex AI system prompt using the real Base44 `aiChat` behavior as a reference.
- Preserved server-side AI runtime isolation and existing protected-route filtering.
- Expanded multilingual behavior to follow the user's latest language.
- Added explicit rules for programming help and truthful capability boundaries.
- Expanded sensitive-site request detection without exposing secrets or moving Base44 SDK dependencies into the official project.

## Deliberately not copied
- `@base44/sdk`
- Base44 authentication
- Base44 database/storage
- Base44 Core InvokeLLM/GenerateImage/GenerateVideo calls
- FAL.ai or MiniMax

## Current limitation
The official project's independent media adapter is fail-closed for image/video generation until an independent image/video runtime is deliberately selected and deployed. The UI and media persistence/deletion contracts already exist; no fake provider has been inserted.

## Continued work
- Revalidated the independent Ollama-compatible gateway with all 4 automated gateway checks: PASS.
- Revalidated source-integrity checks: PASS.
- Hardened conversation-level custom instructions so they are explicitly lower priority than the immutable GameVortex security/privacy/authorization rules.
- Confirmed there are no remaining Base44 SDK imports or runtime dependencies in the official project.
- Confirmed the independent media endpoint remains fail-closed rather than pretending image/video generation is available without a real independent runtime.

## Verification limitation
- Full `npm ci` / Next.js production build could not be completed in this workspace because dependency installation did not finish within the available execution window. Therefore this working copy is not being labeled as production-ready yet.
