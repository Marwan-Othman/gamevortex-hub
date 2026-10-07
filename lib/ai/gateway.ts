import { randomUUID } from "node:crypto";
import { db } from "@/lib/prisma";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai/credits";
import { getAiCost } from "@/lib/ai/costs";
import { buildGameVortexSiteContext } from "@/lib/gamevortex-ai/site-context";
import { finishAiUsage, startAiUsage } from "@/lib/gamevortex-ai/usage-ledger";
import { getVipAccess } from "@/lib/vip";
import { runChatWithFailover } from "@/lib/ai/provider-manager";
import { AiProviderError } from "@/lib/ai/types";

const MAX_PROMPT = 6000;
const MAX_HISTORY = 12;

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

  const duplicate = await db.gameVortexAiMessage.findFirst({
    where: { conversationId: options.conversationId, idempotencyKey: options.idempotencyKey },
    select: { id: true },
  });
  if (duplicate) {
    const assistant = await db.gameVortexAiMessage.findFirst({
      where: { conversationId: options.conversationId, role: "assistant", idempotencyKey: options.idempotencyKey + ":assistant" },
      select: { content: true },
    });
    if (assistant) return { answer: assistant.content, provider: "cached", model: "cached", requestId: options.idempotencyKey, latencyMs: 0 };
    throw new Error("AI_REQUEST_IN_PROGRESS");
  }

  const owner = vip.isOwner;
  const creditAmount = options.advanced ? getAiCost("ADVANCED_CHAT_COST") : getAiCost("CHAT_COST");

  const requestId = randomUUID();
  const history = conversation.messages
    .filter(message => message.role === "user" || message.role === "assistant")
    .reverse()
    .map(message => ({ role: message.role as "user" | "assistant", content: message.content }));

  const siteContext = await buildGameVortexSiteContext(options.userId, prompt);
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
      data: { conversationId: options.conversationId, role: "user", content: prompt, idempotencyKey: options.idempotencyKey },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "P2002") {
      throw new Error("AI_REQUEST_IN_PROGRESS");
    }
    throw error;
  }

  try {
    if (!owner) {
      try {
        await consumeAiCredit(options.userId, "CHAT", options.idempotencyKey, creditAmount);
      } catch (error) {
        await db.gameVortexAiMessage.deleteMany({ where: { conversationId: options.conversationId, idempotencyKey: options.idempotencyKey } }).catch(() => undefined);
        throw error;
      }
    }
    const { result, attempts } = await runChatWithFailover({ prompt, history, systemInstruction, previousInteractionId: conversation.providerInteractionId || undefined });
    for (const attempt of attempts) {
      const usage = await startAiUsage({
        userId: options.userId,
        provider: attempt.provider,
        operation: options.advanced ? "ADVANCED_CHAT" : "CHAT",
        idempotencyKey: options.idempotencyKey + ":attempt:" + attempt.provider,
        gvcReserved: 0,
        requestId,
      });
      await finishAiUsage(usage.usage.id, options.userId, {
        status: attempt.result ? "COMPLETED" : "FAILED",
        gvcUsed: attempt.result ? (owner ? 0 : creditAmount) : 0,
        gvcRefunded: 0,
        errorCode: attempt.error?.code || null,
      });
    }

    await db.gameVortexAiConversation.update({
      where: { id: conversation.id },
      data: { providerInteractionId: result.provider === "gemini" ? (result.providerInteractionId || null) : null },
    });

    const existingAssistant = await db.gameVortexAiMessage.findFirst({
      where: { conversationId: options.conversationId, role: "assistant", idempotencyKey: options.idempotencyKey + ":assistant" },
      select: { id: true },
    });
    if (!existingAssistant) {
      if (options.regenerate) {
        const lastAssistant = [...conversation.messages].reverse().find(message => message.role === "assistant");
        if (lastAssistant) {
          await db.gameVortexAiMessage.update({ where: { id: lastAssistant.id }, data: { content: result.answer, idempotencyKey: options.idempotencyKey + ":assistant" } });
        } else {
          await db.gameVortexAiMessage.create({ data: { conversationId: options.conversationId, role: "assistant", content: result.answer, idempotencyKey: options.idempotencyKey + ":assistant" } });
        }
      } else {
        await db.gameVortexAiMessage.create({ data: { conversationId: options.conversationId, role: "assistant", content: result.answer, idempotencyKey: options.idempotencyKey + ":assistant" } });
      }
    }

    return { answer: result.answer, provider: result.provider, model: result.model, requestId, latencyMs: result.latencyMs };
  } catch (error) {
    if (!owner) await refundAiCredit(options.userId, "CHAT", options.idempotencyKey, creditAmount).catch(() => undefined);
    if (error instanceof AiProviderError) throw error;
    throw new Error("AI_SERVICE_UNAVAILABLE");
  }
}
