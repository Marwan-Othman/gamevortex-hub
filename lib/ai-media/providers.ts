/**
 * Optional AI media providers.
 *
 * GameVortex does not require external image/video provider credentials.
 * These functions intentionally fail closed until a supported provider is
 * explicitly configured and implemented.
 */

export type ImageResult = { requestId: string; url: string; model: string };
export type VideoCreateResult = { taskId: string; model: string };
export type VideoStatusResult = { status?: string; file_id?: string; base_resp?: { status_msg?: string } };

export async function generateImage(_prompt: string, _aspectRatio = '9:16'): Promise<ImageResult> {
  throw new Error('AI_IMAGE_PROVIDER_DISABLED');
}

export async function createVideo(_prompt: string, _model?: string): Promise<VideoCreateResult> {
  throw new Error('AI_VIDEO_PROVIDER_DISABLED');
}

export async function getVideoStatus(_taskId: string): Promise<VideoStatusResult> {
  throw new Error('AI_VIDEO_PROVIDER_DISABLED');
}

export async function retrieveFile(_fileId: string): Promise<string> {
  throw new Error('AI_VIDEO_PROVIDER_DISABLED');
}
