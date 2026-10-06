export type AiProvider = "gemini" | "manus";
export type AiOperation = "CHAT";
export type AiProviderHealth = "ACTIVE" | "DEGRADED" | "RATE_LIMITED" | "QUOTA_EXCEEDED" | "OFFLINE";

export type AiChatMessage = { role: "user" | "assistant"; content: string };
export type AiChatInput = {
  prompt: string;
  history?: AiChatMessage[];
  systemInstruction?: string;
  previousInteractionId?: string;
  signal?: AbortSignal;
};

export type AiChatResult = {
  provider: AiProvider;
  model: string;
  answer: string;
  providerRequestId?: string;
  providerInteractionId?: string;
  latencyMs: number;
};

export class AiProviderError extends Error {
  readonly provider: AiProvider;
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly failoverable: boolean;

  constructor(options: { provider: AiProvider; code: string; status?: number; retryable?: boolean; failoverable?: boolean }) {
    super(options.code);
    this.name = "AiProviderError";
    this.provider = options.provider;
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.failoverable = options.failoverable ?? false;
  }
}
