-- 用户、角色和权限采用数据库持久化；密码只保存 scrypt 哈希，不保存明文。
CREATE TABLE IF NOT EXISTS auth_roles (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_role_permissions (
    role_id INTEGER NOT NULL REFERENCES auth_roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES auth_permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS app_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    username_normalized VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES auth_roles(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    token_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT app_users_username_not_blank CHECK (char_length(btrim(username)) > 0),
    CONSTRAINT app_users_display_name_not_blank CHECK (char_length(btrim(display_name)) > 0)
);

INSERT INTO auth_roles (code, name)
VALUES ('admin', '管理员'), ('user', '普通用户')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO auth_permissions (code, name)
VALUES
    ('tasks:create', '创建任务'),
    ('tasks:read:own', '查看自己的任务'),
    ('tasks:read:any', '查看全部任务'),
    ('users:read', '查看用户'),
    ('users:manage', '管理用户')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- 管理员拥有全部权限。
INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth_roles role
CROSS JOIN auth_permissions permission
WHERE role.code = 'admin'
ON CONFLICT DO NOTHING;

-- 普通用户只能创建任务并查看自己的任务。
INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth_roles role
JOIN auth_permissions permission
  ON permission.code IN ('tasks:create', 'tasks:read:own')
WHERE role.code = 'user'
ON CONFLICT DO NOTHING;

ALTER TABLE ai_tasks
    ADD COLUMN IF NOT EXISTS created_by INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ai_tasks_created_by_fkey'
          AND conrelid = 'ai_tasks'::regclass
    ) THEN
        ALTER TABLE ai_tasks
            ADD CONSTRAINT ai_tasks_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES app_users(id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_created_by_created_at
    ON ai_tasks (created_by, created_at DESC);
