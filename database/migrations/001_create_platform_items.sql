-- 三套后端共享同一张业务表，迁移脚本只需在目标数据库执行一次。
CREATE TABLE IF NOT EXISTS platform_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT platform_items_name_not_blank CHECK (char_length(btrim(name)) > 0),
    CONSTRAINT platform_items_description_length CHECK (char_length(description) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_platform_items_id_desc
    ON platform_items (id DESC);
