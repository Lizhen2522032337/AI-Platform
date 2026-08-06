# 自建 RAG 知识库

## 功能边界

- 只有拥有 `knowledge:manage` 权限的管理员能进入“知识库管理”、上传、修改可见范围和删除文档。
- 文档可标记为“所有人可见”或“仅管理员可见”。普通用户检索时只会命中前者；管理员可以同时检索两类文档。
- 当前支持 PDF、DOCX、TXT、Markdown、CSV 和 JSON。扫描版 PDF 暂未包含 OCR，需先转换为可搜索文本。
- PostgreSQL 保存文档台账，MinIO 保存原文件，Qdrant 保存文档分块、向量和访问控制字段。

## 数据链路

```text
管理员上传
  -> NestJS 校验权限、格式并创建台账
  -> FastAPI 提取文本、分块、调用 Embedding
  -> MinIO 保存原文件
  -> Qdrant 写入向量与 visibility 元数据

用户提问
  -> NestJS 根据服务器端权限生成 allowAdminKnowledge
  -> Worker 转交 FastAPI
  -> Qdrant 在检索阶段执行 visibility 过滤
  -> 语义相似度 + 关键词覆盖率重排
  -> 选取 Top-K 片段注入模型上下文
```

可见范围不是在检索完成后由前端隐藏，而是在 Qdrant 查询过滤器中执行。这样“仅管理员可见”的文档不会进入普通用户的候选集或模型上下文。

## 服务器配置

动态参数固定放在：

```text
/etc/enterprise-ai-platform/knowledge-base.json
```

部署脚本在文件不存在时，会根据仓库内的 `deploy/knowledge-base.example.json` 创建默认文件。FastAPI 在每次上传和检索前重新读取该文件，因此修改以下参数无需重启服务：

| 参数 | 含义 | 生效范围 |
| --- | --- | --- |
| `enabled` | 是否启用知识库 | 下一次检索/上传 |
| `chunk_size` | 新文档分块字符数 | 后续上传，旧文档需重建索引 |
| `chunk_overlap` | 相邻分块重叠字符数 | 后续上传，旧文档需重建索引 |
| `top_k` | 最终返回片段数 | 下一次检索 |
| `candidate_multiplier` | 向量候选数相对 Top-K 的倍数 | 下一次检索 |
| `score_threshold` | 最低向量相似度 | 下一次检索 |
| `semantic_weight` | 重排时语义分数权重，关键词权重为 `1 - semantic_weight` | 下一次检索 |
| `max_context_chars` | 注入模型上下文的最大字符数 | 下一次检索 |
| `max_file_bytes` | 允许上传的最大文件字节数 | 下一次上传 |
| `embedding_batch_size` | 单次 Embedding 请求的分块数 | 下一次上传 |

修改示例：

```bash
sudo vi /etc/enterprise-ai-platform/knowledge-base.json
sudo python3 -m json.tool /etc/enterprise-ai-platform/knowledge-base.json >/dev/null
```

`collection_name` 虽然也在该文件中，但不应作为日常热调参数；切换集合不会迁移现有文档，需要执行完整重建索引。

## Embedding 配置

Embedding 服务地址、密钥、模型和向量维度放在：

```text
/etc/enterprise-ai-platform/llm.env
```

至少配置：

```dotenv
EMBEDDING_API_KEY=替换为真实密钥
EMBEDDING_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSION=1024
EMBEDDING_REQUEST_TIMEOUT_SECONDS=60
```

Embedding 模型和维度决定 Qdrant 集合结构，不能像检索参数一样随意热切换。变更后必须重启 FastAPI，并对已有知识文档重建索引。

## 上线与检查

执行 `deploy/scripts/update-all.sh` 时会自动检查配置文件是否存在、权限是否安全及 JSON 是否有效，并执行数据库迁移。上线后可按以下顺序验收：

1. 管理员进入“知识库管理”，分别上传一份“所有人可见”和一份“仅管理员可见”的文档。
2. 等待文档状态变为“可用”，针对文档内容提问。
3. 使用普通用户再次提问，确认只能召回“所有人可见”的内容。
4. 修改 `top_k` 或 `score_threshold` 后直接再次提问，确认无需重启即可生效。

