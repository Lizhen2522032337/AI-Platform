-- AI 任务由 NestJS 创建、Worker 更新；所有修改都保留时间戳。
CREATE TABLE IF NOT EXISTS ai_tasks (
    id SERIAL PRIMARY KEY,
    prompt TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    result JSONB,
    error_message TEXT,
    object_key TEXT,
    vector_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_tasks_prompt_not_blank CHECK (char_length(btrim(prompt)) > 0),
    CONSTRAINT ai_tasks_prompt_length CHECK (char_length(prompt) <= 4000),
    CONSTRAINT ai_tasks_status_valid CHECK (
        status IN ('queued', 'processing', 'completed', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_created_at_desc
    ON ai_tasks (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status
    ON ai_tasks (status);
