package items

import "time"

// Item 是三套后端共享的业务数据结构。
type Item struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Payload 是创建和完整更新使用的请求体。
type Payload struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}
