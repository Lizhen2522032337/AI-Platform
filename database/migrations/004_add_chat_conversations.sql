-- ChatGPT 风格会话：一个会话包含多条 ai_tasks，每条任务代表一轮“用户问题 + 助手回答”。
CREATE TABLE IF NOT EXISTS chat_conversations (
    id SERIAL PRIMARY KEY,
    title VARCHAR(120) NOT NULL DEFAULT '新对话',
    model_provider VARCHAR(20) NOT NULL DEFAULT 'deepseek',
    created_by INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chat_conversations_model_provider_valid
        CHECK (model_provider IN ('deepseek', 'qwen'))
);

ALTER TABLE ai_tasks
    ADD COLUMN IF NOT EXISTS conversation_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ai_tasks_conversation_id_fkey'
          AND conrelid = 'ai_tasks'::regclass
    ) THEN
        ALTER TABLE ai_tasks
            ADD CONSTRAINT ai_tasks_conversation_id_fkey
            FOREIGN KEY (conversation_id)
            REFERENCES chat_conversations(id)
            ON DELETE CASCADE;
    END IF;
END;
$$;

-- 把已有单轮任务各自转换成一个历史会话，避免升级后旧记录从界面消失。
DO $$
DECLARE
    old_task RECORD;
    new_conversation_id INTEGER;
BEGIN
    FOR old_task IN
        SELECT id, prompt, model_provider, created_by, created_at, updated_at
        FROM ai_tasks
        WHERE conversation_id IS NULL
          AND created_by IS NOT NULL
        ORDER BY id
    LOOP
        INSERT INTO chat_conversations (
            title, model_provider, created_by, created_at, updated_at
        ) VALUES (
            LEFT(regexp_replace(btrim(old_task.prompt), '[[:space:]]+', ' ', 'g'), 120),
            old_task.model_provider,
            old_task.created_by,
            old_task.created_at,
            old_task.updated_at
        ) RETURNING id INTO new_conversation_id;

        UPDATE ai_tasks
        SET conversation_id = new_conversation_id
        WHERE id = old_task.id;
    END LOOP;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_owner_updated
    ON chat_conversations (created_by, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_conversation_id
    ON ai_tasks (conversation_id, id);
