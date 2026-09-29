/**
 * Optional AI media providers.
 *
 * GameVortex does not require external image/video provider credentials.
 * These functions intentionally fail closed until a supported provider is
 * explicitly configured and implemented.
 */

export async function generateImage(_prompt: string, _aspectRatio = '9:16'): Promise<never> {
  throw new Error('AI_IMAGE_PROVIDER_DISABLED');
}

export async function createVideo(_prompt: string, _model?: string): Promise<never> {
  throw new Error('AI_VIDEO_PROVIDER_DISABLED');
}

export async function getVideoStatus(_taskId: string): Promise<never> {
  throw new Error('AI_VIDEO_PROVIDER_DISABLED');
}

export async function retrieveFile(_fileId: string): Promise<never> {
  throw new Error('AI_VIDEO_PROVIDER_DISABLED');
}
