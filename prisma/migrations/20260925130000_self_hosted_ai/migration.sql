-- Keep existing historical enum values intact; new jobs use only SELF_HOSTED.
ALTER TYPE "AiMediaProvider" ADD VALUE IF NOT EXISTS 'SELF_HOSTED';
