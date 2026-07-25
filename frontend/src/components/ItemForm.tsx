import { useState, type FormEvent } from 'react'
import type { Item, ItemPayload } from '../types/item'

interface ItemFormProps {
  editingItem: Item | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (payload: ItemPayload) => Promise<void>
}

export function ItemForm({
  editingItem,
  submitting,
  onCancel,
  onSubmit,
}: ItemFormProps) {
  const [name, setName] = useState(() => editingItem?.name ?? '')
  const [description, setDescription] = useState(
    () => editingItem?.description ?? '',
  )
  const [validationError, setValidationError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) {
      setValidationError('名称不能为空。')
      return
    }
    if (cleanName.length > 120) {
      setValidationError('名称不能超过 120 个字符。')
      return
    }
    if (description.length > 2000) {
      setValidationError('说明不能超过 2000 个字符。')
      return
    }

    setValidationError('')
    await onSubmit({ name: cleanName, description })
    if (!editingItem) {
      setName('')
      setDescription('')
    }
  }

  return (
    <form className="item-form" onSubmit={handleSubmit}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{editingItem ? 'EDIT ITEM' : 'NEW ITEM'}</p>
          <h2>{editingItem ? `编辑 #${editingItem.id}` : '新增记录'}</h2>
        </div>
        {editingItem && (
          <button className="button ghost" onClick={onCancel} type="button">
            取消编辑
          </button>
        )}
      </div>

      <label>
        名称
        <input
          disabled={submitting}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：设备巡检任务"
          value={name}
        />
      </label>

      <label>
        说明
        <textarea
          disabled={submitting}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="填写记录的详细说明"
          rows={5}
          value={description}
        />
      </label>

      {validationError && <p className="inline-error">{validationError}</p>}

      <button className="button primary" disabled={submitting} type="submit">
        {submitting ? '正在保存…' : editingItem ? '保存修改' : '创建记录'}
      </button>
    </form>
  )
}
