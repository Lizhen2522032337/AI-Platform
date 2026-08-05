# LangGraph 生产分析 Agent 架构

## 1. 第一阶段目标

保留现有 React、Nginx、NestJS、RabbitMQ、Worker 和 NDJSON 流式协议，只把
FastAPI 内部从固定问答流水线升级为受控 LangGraph Agent。第一阶段支持：

1. 生产问题分析：根据 Dify 知识、批准的 PostgreSQL/DB2 查询和多轮对话形成原因分析。
2. 报表生成：严格按用户明确指定的格式生成 Markdown、Word、PDF、Excel、JSON
   或 CSV；未指定格式时才使用 Planner 的默认集合，文件保存到 MinIO 并通过归属鉴权接口下载。
3. 管理员平台数据整理：根据自然语言生成受限 PostgreSQL 查询，例如整理当前所有平台用户。

用户可在前端按会话选择 PostgreSQL 或 DB2。DB2 未配置时 Agent 仍可使用 Dify 和大模型，但必须明确说明缺少生产数据，不能
虚构查询结果。通知 Tool 默认关闭，确定渠道和审批规则后才能启用。

## 2. 数据流程

```text
React -> Nginx -> NestJS -> RabbitMQ -> Worker -> FastAPI /process
                                                |
                                                v
                                      LangGraph Supervisor
                                        /              \
                           Incident Planner       Report Planner
                                      \              /
                                       Dify Knowledge Tool
                                                |
                         Fixed Query Tool / Admin Dynamic SQL Tool
                                                |
                                      Evidence Context Builder
                                                |
                                      DeepSeek / Qwen Stream
                                                |
                             Report Tool -> File Tool -> MinIO
                                                |
                              Notification Tool (default disabled)
```

Supervisor 当前使用稳定关键词分流；故障分析、报表生成、平台数据查询三个 Planner 使用选定的大模型生成结构化计划。
后续可以继续增加设备、批次、质量、接口、库存等领域 Planner，而不改变外围协议。

平台数据查询会识别用户、账号、角色和权限等目标，并直接进入受控数据库节点，不请求无关的 Dify 生产知识。管理员请求在动态表结构可用时必须生成 `dynamic_query`；若模型遗漏查询或生成的 SQL 未通过预校验，Planner 会改用最小安全用户清单查询，执行器仍会再次进行完整 AST 校验。查询成功后由后端确定性渲染 Markdown 表格，不再让第二次模型调用重新判断数据库证据是否存在。

## 3. 安全边界

- 普通用户只能选择 `database-catalog.json` 中批准的 `query_id`，不能提交动态 SQL。
- 只有服务端确认具有 `users:manage` 权限的管理员，Planner 才能生成一条动态 PostgreSQL 查询；客户端不能自行声明该权限。
- 动态 SQL 使用 SQL AST 校验，只允许管理员通过 `SELECT/WITH` 查询
  `public.ai_tasks`、`public.app_users` 与 `public.auth_roles` 的白名单字段；
  任务回答、对象存储 Key、密码哈希等字段不开放，并禁止 `SELECT *`、递归 CTE、
  未批准函数、跨 Schema、系统表、写入、DDL 和多语句。
- `password_hash`、`username_normalized`、`token_version` 不会提供给 Planner，执行层也会再次拒绝访问。
- 前台轨迹会显示动态 SQL 权限是否可用、是否生成查询以及执行行数，但不会显示 SQL 正文和数据正文。
- SQL 必须以 `SELECT` 或 `WITH` 开头，并拒绝写入、DDL、CALL 和多语句。
- 同一 `query_id` 可配置 `postgresql` 和 `db2` 两套 SQL；Planner 只能看到当前选择方言可用的查询。
- 所有参数使用 `:参数名`，执行器转换为对应驱动的绑定参数，不进行字符串拼接。
- 两种数据库账号都应由 DBA 配置为只读；PostgreSQL 执行器还会强制开启只读事务。
- 单次 Agent 查询数量、单条查询超时和返回行数均有限制。
- 动态查询也会强制只读事务、查询超时和独立行数上限；日志只记录 SQL 指纹、表名、行数和状态，不记录 SQL 正文、参数值、数据正文和密钥。
- Dify 文本和数据库数据都被视为不可信证据，不能覆盖系统指令。
- 通知同时要求用户明确提出、服务已启用、自动发送已启用，三项缺一不可。
- DB2 DSN、Webhook 和 Dify/LLM Key 只在虚拟机 `/etc/enterprise-ai-platform/`。

## 4. 外部配置文件

### 4.1 Agent 与数据库密钥

真实文件：`/etc/enterprise-ai-platform/agent.env`，权限必须为 `600`。

```ini
AGENT_ENABLED=true
AGENT_MAX_QUERIES=6
AGENT_MAX_EVIDENCE_CHARS=24000

DB2_ENABLED=false
DB2_DSN=DATABASE=...;HOSTNAME=...;PORT=50000;PROTOCOL=TCPIP;UID=...;PWD=...;
DB2_QUERY_TIMEOUT_SECONDS=30
DB2_MAX_ROWS=500

POSTGRES_ENABLED=true
POSTGRES_QUERY_TIMEOUT_SECONDS=30
POSTGRES_MAX_ROWS=500
DYNAMIC_SQL_ENABLED=true
DYNAMIC_SQL_MAX_ROWS=200
DATABASE_CATALOG_FILE=/etc/enterprise-ai-platform/database-catalog.json

REPORT_FILES_ENABLED=true
NOTIFICATION_ENABLED=false
NOTIFICATION_AUTO_SEND=false
NOTIFICATION_WEBHOOK_URL=...
NOTIFICATION_TIMEOUT_SECONDS=10
```

模板：`deploy/agent.env.example`。模板只能包含占位符，不能填写真实值。

PostgreSQL 的 `POSTGRES_HOST/PORT/DB/USER/PASSWORD/SSLMODE` 直接复用
`/etc/enterprise-ai-platform/database.env`，无需在 `agent.env` 重复保存密码。

当前“整理平台用户”使用现有平台 PostgreSQL 连接，无需再提供密码、表名或列名。若以后要开放其他业务表，应先提供表结构和敏感字段说明，再扩充代码中的动态查询白名单；不要把真实连接密码贴进聊天或提交到 Git。

### 4.2 通用业务与查询目录

真实文件：`/etc/enterprise-ai-platform/database-catalog.json`，模板见
`deploy/database-catalog.example.json`。这个目录可以包含表和列名称，但生产环境建议仍
放在仓库外，由业务负责人和 DBA 共同审核。

每条查询至少需要：

- 稳定且唯一的查询 ID；
- 查询用途和返回口径；
- 按数据库类型区分的只读、参数化 SQL；
- 参数名称、类型、格式和是否必填；
- 返回列说明；
- 最大返回行数。

SQL 示例：

```json
"sql": {
  "postgresql": "SELECT * FROM t WHERE created_at >= :start_time LIMIT 500",
  "db2": "SELECT * FROM t WHERE created_at >= :start_time FETCH FIRST 500 ROWS ONLY"
}
```

## 5. 接入业务数据库前必须提供的资料

### P0：缺少就不能安全查询

1. 数据库类型与版本；DB2 需说明 LUW、z/OS 或 IBM i。
2. 主机、端口、数据库名、协议、只读用户名和密码。
3. 是否启用 TLS；若启用，需要 CA/服务器证书、SNI/主机名要求。
4. FastAPI 容器到 DB2 的网络和防火墙验证结果。
5. 允许访问的 Schema、表、视图白名单。
6. 表清单、主键、关联键、时间字段和数据保留周期。
7. 每个字段的业务含义、类型、单位、枚举值、空值含义和是否敏感。
8. 至少一批由 DBA 审核的参数化查询及其预期结果样例。

### P1：缺少会显著降低原因分析准确率

1. 生产业务流程和系统/设备拓扑。
2. 故障、告警、状态、结果码的字典。
3. 批次、工单、设备、产品、时间之间的关联规则。
4. 正常范围、阈值、SLA、统计口径和时区。
5. 典型正常案例、典型故障案例及最终根因。
6. 同一个指标在不同表中的权威来源和延迟。
7. 报表样例、栏目、排序、分组、图表和文件格式要求。

### P2：启用通知前提供

1. 渠道：企业微信、钉钉、邮件、Teams、Slack 或内部接口。
2. Webhook/SMTP/API 认证方式。
3. 收件人和环境映射。
4. 哪些严重级别允许自动通知，哪些必须人工批准。
5. 重试、去重、静默时间和升级规则。

## 6. 当前限制与后续阶段

- 已支持通过 NestJS 归属鉴权接口下载 Markdown、Word、PDF、Excel、JSON 和 CSV；
  明确指定格式时只生成所选文件，历史任务不会自动补生成新增格式。
- 当前 Excel 以报告页和查询数据工作表为主，PDF/Word 采用标准业务报告样式；专用品牌模板和 Excel 图表仍需取得正式模板后扩展。
- 当前任务恢复仍依赖 RabbitMQ/Worker；生产级断点恢复应增加 LangGraph PostgreSQL
  Checkpointer 和人工审批节点。
- 当前查询按 Planner 顺序执行；取得真实业务目录后，可以使用 LangGraph `Send`
  增加受控并行取证和多个领域 Planner。
- Qdrant 中现有 8 维向量是占位实现，不参与 Agent 知识检索。
