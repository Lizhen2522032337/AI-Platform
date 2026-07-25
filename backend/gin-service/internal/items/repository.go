package items

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound 表示目标记录不存在。
var ErrNotFound = errors.New("item not found")

// Repository 定义 HTTP 层依赖的数据操作，便于测试替换。
type Repository interface {
	Health(context.Context) error
	List(context.Context) ([]Item, error)
	Get(context.Context, int) (Item, error)
	Create(context.Context, Payload) (Item, error)
	Update(context.Context, int, Payload) (Item, error)
	Delete(context.Context, int) error
}

// PostgresRepository 使用 pgxpool 操作共享表。
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository 创建 PostgreSQL 仓储。
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// Health 验证连接池可用。
func (r *PostgresRepository) Health(ctx context.Context) error {
	return r.pool.Ping(ctx)
}

// List 按 ID 倒序查询全部记录。
func (r *PostgresRepository) List(ctx context.Context) ([]Item, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, name, description, created_at, updated_at
		FROM platform_items
		ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Item, 0)
	for rows.Next() {
		var item Item
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Description,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// Get 查询单条记录。
func (r *PostgresRepository) Get(ctx context.Context, id int) (Item, error) {
	var item Item
	err := r.pool.QueryRow(ctx, `
		SELECT id, name, description, created_at, updated_at
		FROM platform_items
		WHERE id = $1`, id).Scan(
		&item.ID,
		&item.Name,
		&item.Description,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	return item, normalizeNotFound(err)
}

// Create 创建记录并返回数据库生成的字段。
func (r *PostgresRepository) Create(ctx context.Context, payload Payload) (Item, error) {
	var item Item
	err := r.pool.QueryRow(ctx, `
		INSERT INTO platform_items (name, description)
		VALUES ($1, $2)
		RETURNING id, name, description, created_at, updated_at`,
		payload.Name,
		payload.Description,
	).Scan(
		&item.ID,
		&item.Name,
		&item.Description,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	return item, err
}

// Update 完整更新记录并刷新 updated_at。
func (r *PostgresRepository) Update(
	ctx context.Context,
	id int,
	payload Payload,
) (Item, error) {
	var item Item
	err := r.pool.QueryRow(ctx, `
		UPDATE platform_items
		SET name = $1, description = $2, updated_at = NOW()
		WHERE id = $3
		RETURNING id, name, description, created_at, updated_at`,
		payload.Name,
		payload.Description,
		id,
	).Scan(
		&item.ID,
		&item.Name,
		&item.Description,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	return item, normalizeNotFound(err)
}

// Delete 删除记录，并把零影响行转换为统一 404。
func (r *PostgresRepository) Delete(ctx context.Context, id int) error {
	result, err := r.pool.Exec(ctx, "DELETE FROM platform_items WHERE id = $1", id)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func normalizeNotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
