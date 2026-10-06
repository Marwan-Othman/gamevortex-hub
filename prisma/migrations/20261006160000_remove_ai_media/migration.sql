-- Remove the deferred GameVortex AI image/video persistence layer.
-- Image/video generation will be rebuilt from scratch if enabled in the future.
DROP TABLE IF EXISTS "AiMediaJob";
DROP TYPE IF EXISTS "AiMediaKind";
DROP TYPE IF EXISTS "AiMediaJobStatus";
DROP TYPE IF EXISTS "AiMediaProvider";
