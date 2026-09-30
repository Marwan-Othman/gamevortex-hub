/**
 * Internal GameVortex AI media adapter.
 *
 * The production chat brain is the self-hosted GameVortex AI runtime.
 * This module intentionally contains no third-party media provider integration.
 *
 * The current runtime contract is text/chat only, so image/video generation
 * remains fail-closed until an independent media runtime is added.
 */
export type ImageResult = { requestId: string; url: string; model: string };
export type VideoCreateResult = { taskId: string; model: string };
export type VideoStatusResult = { status?: string; file_id?: string; base_resp?: { status_msg?: string } };

const ERROR = "AI_MEDIA_INTERNAL_RUNTIME_NOT_CONFIGURED";

export async function generateImage(_prompt: string, _aspectRatio = "9:16"): Promise<ImageResult> {
  throw new Error(ERROR);
}

export async function createVideo(_prompt: string, _model?: string): Promise<VideoCreateResult> {
  throw new Error(ERROR);
}

export async function getVideoStatus(_taskId: string): Promise<VideoStatusResult> {
  throw new Error(ERROR);
}

export async function retrieveFile(_fileId: string): Promise<string> {
  throw new Error(ERROR);
}
