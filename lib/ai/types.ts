export type AiProvider = "gemini" | "manus";
export type AiOperation = "CHAT" | "IMAGE" | "VIDEO";
export type AiProviderHealth = "ACTIVE" | "DEGRADED" | "RATE_LIMITED" | "QUOTA_EXCEEDED" | "OFFLINE";

export type AiChatMessage = { role: "user" | "assistant"; content: string };
export type AiChatInput = {
  prompt: string;
  history?: AiChatMessage[];
  systemInstruction?: string;
  signal?: AbortSignal;
};

export type AiChatResult = {
  provider: AiProvider;
  model: string;
  answer: string;
  providerRequestId?: string;
  latencyMs: number;
};

export type AiImageInput = {
  prompt: string;
  aspectRatio?: string;
  imageSize?: "512" | "1K" | "2K" | "4K";
  inputImage?: { base64: string; mimeType: string };
  signal?: AbortSignal;
};

export type AiImageResult = {
  provider: AiProvider;
  model: string;
  base64: string;
  mimeType: string;
  providerRequestId?: string;
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
