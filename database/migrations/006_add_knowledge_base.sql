-- 自建知识库台账与 RBAC。原文件存 MinIO，向量分块存 Qdrant，本表保存可审计事实。
INSERT INTO auth_permissions (code, name)
VALUES
    ('knowledge:read', '使用企业知识库'),
    ('knowledge:manage', '管理企业知识库')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- 管理员自动获得全部知识库权限。
INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth_roles role
CROSS JOIN auth_permissions permission
WHERE role.code = 'admin'
  AND permission.code IN ('knowledge:read', 'knowledge:manage')
ON CONFLICT DO NOTHING;

-- 普通用户可以检索“所有人可见”的文档，但不能上传和管理。
INSERT INTO auth_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM auth_roles role
JOIN auth_permissions permission ON permission.code = 'knowledge:read'
WHERE role.code = 'user'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(150) NOT NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'public',
    status VARCHAR(20) NOT NULL DEFAULT 'processing',
    object_key TEXT,
    file_size BIGINT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    checksum CHAR(64),
    error_message TEXT,
    created_by INTEGER NOT NULL REFERENCES app_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT knowledge_documents_title_not_blank CHECK (char_length(btrim(title)) > 0),
    CONSTRAINT knowledge_documents_visibility_valid CHECK (visibility IN ('public', 'admin')),
    CONSTRAINT knowledge_documents_status_valid CHECK (status IN ('processing', 'ready', 'failed')),
    CONSTRAINT knowledge_documents_file_size_valid CHECK (file_size > 0),
    CONSTRAINT knowledge_documents_chunk_count_valid CHECK (chunk_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_created_at
    ON knowledge_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_visibility_status
    ON knowledge_documents (visibility, status);
