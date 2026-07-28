-- 记录用户选择的模型供应商、实际模型和最终回答，便于审计与查询。
ALTER TABLE ai_tasks
    ADD COLUMN IF NOT EXISTS model_provider VARCHAR(20) NOT NULL DEFAULT 'deepseek',
    ADD COLUMN IF NOT EXISTS model_name TEXT,
    ADD COLUMN IF NOT EXISTS answer TEXT;

-- PostgreSQL 没有 ADD CONSTRAINT IF NOT EXISTS，使用系统表保证迁移可重复执行。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ai_tasks_model_provider_valid'
          AND conrelid = 'ai_tasks'::regclass
    ) THEN
        ALTER TABLE ai_tasks
            ADD CONSTRAINT ai_tasks_model_provider_valid
            CHECK (model_provider IN ('deepseek', 'qwen'));
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_model_provider
    ON ai_tasks (model_provider);
