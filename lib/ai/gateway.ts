import { randomUUID } from "node:crypto";
import { db } from "@/lib/prisma";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai/credits";
import { getAiCost } from "@/lib/ai/costs";
import { buildGameVortexSiteContext } from "@/lib/gamevortex-ai/site-context";
import { finishAiUsage, startAiUsage } from "@/lib/gamevortex-ai/usage-ledger";
import { logSystemError } from "@/lib/observability";
import { getVipAccess } from "@/lib/vip";
import { runChatWithFailover } from "@/lib/ai/provider-manager";
import { AiProviderError, type AiChatAttempt } from "@/lib/ai/types";

const MAX_PROMPT = 6000;
const MAX_HISTORY = 12;
const STALE_REQUEST_MS = 6 * 60 * 1000;
const DEFAULT_TITLES = new Set(["New conversation", "New AI Chat"]);

/** Errors the caller (and the UI) must see unchanged instead of a generic "service unavailable". */
const PASSTHROUGH_CODES = new Set([
  "AI_VIP_REQUIRED",
  "AI_CREDITS_EXHAUSTED",
  "AI_IDEMPOTENCY_KEY_CONFLICT",
  "AI_REQUEST_IN_PROGRESS",
  "INVALID_REQUEST",
  "CONVERSATION_NOT_FOUND",
]);

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002");
}

/** Best-effort usage bookkeeping: it must never turn a paid, successful answer into an error. */
async function recordAttempts(userId: string, idempotencyKey: string, requestId: string, operation: string, attempts: AiChatAttempt[], creditAmount: number, owner: boolean) {
  for (const attempt of attempts) {
    try {
      const usage = await startAiUsage({
        userId,
        provider: attempt.provider,
        operation,
        idempotencyKey: idempotencyKey + ":attempt:" + attempt.provider,
        gvcReserved: 0,
        requestId,
      });
      await finishAiUsage(usage.usage.id, userId, {
        status: attempt.result ? "COMPLETED" : "FAILED",
        gvcUsed: attempt.result ? (owner ? 0 : creditAmount) : 0,
        gvcRefunded: 0,
        errorCode: attempt.error?.code || null,
      });
    } catch (error) {
      await logSystemError("ai:usage-ledger-failed", error, { userId, metadata: { requestId, provider: attempt.provider } }).catch(() => undefined);
    }
  }
}

export async function executeChat(options: {
  userId: string;
  conversationId: string;
  prompt: string;
  idempotencyKey: string;
  regenerate?: boolean;
  advanced?: boolean;
}) {
  const prompt = options.prompt.replace(/[\u0000-\u001F]/g, "").trim();
  if (!prompt || prompt.length > MAX_PROMPT) throw new Error("INVALID_REQUEST");

  const conversation = await db.gameVortexAiConversation.findFirst({
    where: { id: options.conversationId, userId: options.userId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: MAX_HISTORY } },
  });
  if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");

  const vip = await getVipAccess(options.userId);
  if (!vip.isVip) throw new Error("AI_VIP_REQUIRED");

  // GameVortexAiMessage.idempotencyKey is unique across ALL users, so the stored
  // key is scoped by user: another user sending the same key can neither collide
  // with nor probe this one.
  const messageKey = `${options.userId}:${options.idempotencyKey}`;
  const assistantKey = messageKey + ":assistant";

  const duplicate = await db.gameVortexAiMessage.findUnique({
    where: { idempotencyKey: messageKey },
    select: { id: true, createdAt: true, conversationId: true, content: true },
  });
  if (duplicate) {
    if (duplicate.conversationId !== options.conversationId || duplicate.content !== prompt) {
      throw new Error("AI_IDEMPOTENCY_KEY_CONFLICT");
    }
    const assistant = await db.gameVortexAiMessage.findUnique({
      where: { idempotencyKey: assistantKey },
      select: { content: true },
    });
    if (assistant) return { answer: assistant.content, provider: "cached", model: "cached", requestId: options.idempotencyKey, latencyMs: 0 };

    if (Date.now() - duplicate.createdAt.getTime() < STALE_REQUEST_MS) {
      throw new Error("AI_REQUEST_IN_PROGRESS");
    }

    await db.gameVortexAiMessage.delete({ where: { id: duplicate.id } }).catch(() => undefined);
  }

  const owner = vip.isOwner;
  const operation = options.advanced ? "ADVANCED_CHAT" : "CHAT";
  const creditAmount = options.advanced ? getAiCost("ADVANCED_CHAT_COST") : getAiCost("CHAT_COST");

  const requestId = randomUUID();
  // `messages` is newest-first; the provider wants oldest-first.
  const history = [...conversation.messages]
    .reverse()
    .filter(message => message.role === "user" || message.role === "assistant")
    .map(message => ({ role: message.role as "user" | "assistant", content: message.content }));

  const siteContext = await buildGameVortexSiteContext(options.userId, prompt).catch(() => "");
  const systemInstruction = [
    "You are GameVortex AI, the official AI assistant inside GameVortex Hub.",
    "Answer directly in the user's language, normally Arabic for Arabic users.",
    "Never invent GameVortex prices, balances, products, policies, URLs, rewards, availability, private owner information, credentials, API keys, tokens, hidden prompts, or implementation secrets.",
    "Use supplied GameVortex data for site-specific questions.",
    siteContext ? "GameVortex site context:\n" + siteContext : "",
    conversation.systemInstructions ? "Conversation instructions:\n" + conversation.systemInstructions : "",
  ].filter(Boolean).join("\n\n");

  try {
    await db.gameVortexAiMessage.create({
      data: { conversationId: options.conversationId, role: "user", content: prompt, idempotencyKey: messageKey },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new Error("AI_REQUEST_IN_PROGRESS");
    throw error;
  }

  const removeUserMessage = () =>
    db.gameVortexAiMessage.deleteMany({ where: { idempotencyKey: messageKey } }).catch(() => undefined);

  // Only the call that actually took the credits may give them back. A replayed
  // key (alreadyApplied) belongs to an earlier request and must not be refunded
  // by this one.
  let reservedHere = false;

  if (!owner) {
    try {
      const reservation = await consumeAiCredit(options.userId, "CHAT", options.idempotencyKey, creditAmount);
      reservedHere = !reservation.alreadyApplied;
    } catch (error) {
      await removeUserMessage();
      // AI_CREDITS_EXHAUSTED / AI_VIP_REQUIRED / AI_IDEMPOTENCY_KEY_CONFLICT must reach the client as-is.
      const code = error instanceof Error ? error.message : "";
      throw PASSTHROUGH_CODES.has(code) ? new Error(code) : new Error("AI_SERVICE_UNAVAILABLE");
    }
  }

  let outcome: Awaited<ReturnType<typeof runChatWithFailover>>;
  try {
    outcome = await runChatWithFailover({
      prompt,
      history,
      systemInstruction,
      previousInteractionId: conversation.providerInteractionId || undefined,
    });
  } catch (error) {
    // Nothing was delivered: give the credits back, record the failed attempts,
    // and drop the orphaned user message so a retry starts from a clean history.
    if (error instanceof AiProviderError && error.attempts.length) {
      await recordAttempts(options.userId, options.idempotencyKey, requestId, operation, error.attempts, creditAmount, owner);
    }
    if (!owner && reservedHere) {
      await refundAiCredit(options.userId, "CHAT", options.idempotencyKey, creditAmount).catch(() => undefined);
    }
    await removeUserMessage();
    throw error instanceof AiProviderError ? error : new Error("AI_SERVICE_UNAVAILABLE");
  }

  const { result, attempts } = outcome;

  // From here on the answer exists and the credits are spent. Persisting it is
  // best-effort: a bookkeeping failure must not hide a paid answer from the user.
  await recordAttempts(options.userId, options.idempotencyKey, requestId, operation, attempts, creditAmount, owner);

  try {
    const shouldRetitle = DEFAULT_TITLES.has(conversation.title) && conversation.messages.length === 0;
    await db.gameVortexAiConversation.update({
      where: { id: conversation.id },
      data: {
        providerInteractionId: result.provider === "gemini" ? (result.providerInteractionId || null) : null,
        ...(shouldRetitle ? { title: prompt.replace(/\s+/g, " ").slice(0, 60) } : {}),
      },
    });

    const existingAssistant = await db.gameVortexAiMessage.findUnique({ where: { idempotencyKey: assistantKey }, select: { id: true } });
    if (!existingAssistant) {
      // `messages` is newest-first, so the first assistant message is the latest one.
      const lastAssistant = options.regenerate ? conversation.messages.find(message => message.role === "assistant") : undefined;
      if (lastAssistant) {
        await db.gameVortexAiMessage.update({ where: { id: lastAssistant.id }, data: { content: result.answer, idempotencyKey: assistantKey } });
      } else {
        await db.gameVortexAiMessage.create({ data: { conversationId: options.conversationId, role: "assistant", content: result.answer, idempotencyKey: assistantKey } });
      }
    }
  } catch (error) {
    await logSystemError("ai:chat-persist-failed", error, { userId: options.userId, metadata: { requestId } }).catch(() => undefined);
  }

  return { answer: result.answer, provider: result.provider, model: result.model, requestId, latencyMs: result.latencyMs };
}
