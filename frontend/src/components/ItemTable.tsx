import type { Item } from '../types/item'

interface ItemTableProps {
  items: Item[]
  busy: boolean
  onDelete: (item: Item) => void
  onEdit: (item: Item) => void
}
function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

export function ItemTable({ items, busy, onDelete, onEdit }: ItemTableProps) {
  if (items.length === 0) {
    return <div className="empty-state">暂无记录，请先创建一条数据。</div>
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>说明</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td className="mono">#{item.id}</td>
              <td className="item-name">{item.name}</td>
              <td>{item.description || <span className="muted">无说明</span>}</td>
              <td className="time-cell">{formatTime(item.updatedAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() => onEdit(item)}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    className="button small danger"
                    disabled={busy}
                    onClick={() => onDelete(item)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
