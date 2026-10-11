-- Repair a production schema drift where screenshots was JSONB although Prisma
-- defines it as String[]. Convert existing JSON arrays without dropping their values.
CREATE OR REPLACE FUNCTION public._gv_jsonb_to_text_array(value jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE result text[];
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'array' THEN
    RETURN ARRAY[]::text[];
  END IF;
  SELECT COALESCE(array_agg(element), ARRAY[]::text[])
  INTO result
  FROM jsonb_array_elements_text(value) AS items(element);
  RETURN result;
END;
$$;

DO $$
DECLARE col_type text;
BEGIN
  SELECT data_type INTO col_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='Game' AND column_name='screenshots';
  IF col_type='jsonb' THEN
    ALTER TABLE "Game" ALTER COLUMN "screenshots" DROP DEFAULT;
    ALTER TABLE "Game" ALTER COLUMN "screenshots" TYPE TEXT[]
      USING public._gv_jsonb_to_text_array("screenshots");
    ALTER TABLE "Game" ALTER COLUMN "screenshots" SET DEFAULT ARRAY[]::TEXT[];
  END IF;

  SELECT data_type INTO col_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='App' AND column_name='screenshots';
  IF col_type='jsonb' THEN
    ALTER TABLE "App" ALTER COLUMN "screenshots" DROP DEFAULT;
    ALTER TABLE "App" ALTER COLUMN "screenshots" TYPE TEXT[]
      USING public._gv_jsonb_to_text_array("screenshots");
    ALTER TABLE "App" ALTER COLUMN "screenshots" SET DEFAULT ARRAY[]::TEXT[];
  END IF;
END $$;

DROP FUNCTION public._gv_jsonb_to_text_array(jsonb);
