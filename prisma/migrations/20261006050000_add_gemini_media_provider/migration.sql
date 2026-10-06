-- Add the active Gemini media provider without changing existing INTERNAL jobs.
ALTER TYPE "AiMediaProvider" ADD VALUE IF NOT EXISTS 'GEMINI';
