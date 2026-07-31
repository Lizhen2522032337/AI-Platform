-- 记录每个会话最后选择的数据源，以及每轮任务实际使用的数据源，便于审计和重放。
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS database_type VARCHAR(20) NOT NULL DEFAULT 'postgresql';

ALTER TABLE ai_tasks
    ADD COLUMN IF NOT EXISTS database_type VARCHAR(20) NOT NULL DEFAULT 'postgresql';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chat_conversations_database_type_valid'
          AND conrelid = 'chat_conversations'::regclass
    ) THEN
        ALTER TABLE chat_conversations
            ADD CONSTRAINT chat_conversations_database_type_valid
            CHECK (database_type IN ('postgresql', 'db2'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ai_tasks_database_type_valid'
          AND conrelid = 'ai_tasks'::regclass
    ) THEN
        ALTER TABLE ai_tasks
            ADD CONSTRAINT ai_tasks_database_type_valid
            CHECK (database_type IN ('postgresql', 'db2'));
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_database_type
    ON ai_tasks (database_type);
