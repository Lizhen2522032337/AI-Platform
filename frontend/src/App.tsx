import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, BACKENDS, itemsApi } from './api/items'
import { BackendSelector } from './components/BackendSelector'
import { ItemForm } from './components/ItemForm'
import { ItemTable } from './components/ItemTable'
import type { BackendKey, Item, ItemPayload } from './types/item'
import './App.css'

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message}（${error.code}）`
  }
  return error instanceof Error ? error.message : '发生未知错误。'
}

function App() {
  const [backend, setBackend] = useState<BackendKey>('fastapi')
  const [items, setItems] = useState<Item[]>([])
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const selectedBackend = useMemo(
    () => BACKENDS.find((option) => option.key === backend) ?? BACKENDS[0],
    [backend],
  )

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await itemsApi.list(backend))
    } catch (requestError) {
      setItems([])
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [backend])

  useEffect(() => {
    let active = true
    itemsApi
      .list(backend)
      .then((result) => {
        if (active) {
          setItems(result)
          setError('')
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setItems([])
          setError(errorMessage(requestError))
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [backend])

  function changeBackend(nextBackend: BackendKey) {
    setEditingItem(null)
    setLoading(true)
    setError('')
    setBackend(nextBackend)
  }

  async function saveItem(payload: ItemPayload) {
    setSubmitting(true)
    setError('')
    try {
      if (editingItem) {
        await itemsApi.update(backend, editingItem.id, payload)
      } else {
        await itemsApi.create(backend, payload)
      }
      setEditingItem(null)
      await loadItems()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteItem(item: Item) {
    if (!window.confirm(`确认删除“${item.name}”吗？此操作不可撤销。`)) {
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await itemsApi.remove(backend, item.id)
      if (editingItem?.id === item.id) {
        setEditingItem(null)
      }
      await loadItems()
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">ENTERPRISE AI PLATFORM</p>
          <h1>多后端 CRUD 控制台</h1>
          <p className="hero-copy">
            使用同一个管理界面验证 FastAPI、Gin 和 NestJS 对共享 PostgreSQL
            数据的读写能力。
          </p>
        </div>
        <div className="status-chip">
          <span className="status-dot" />
          当前后端：{selectedBackend.label}
        </div>
      </header>

      <section className="panel backend-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BACKEND ROUTER</p>
            <h2>选择请求后端</h2>
          </div>
          <code>{selectedBackend.baseUrl}</code>
        </div>
        <BackendSelector
          disabled={loading || submitting}
          onChange={changeBackend}
          value={backend}
        />
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <strong>请求失败</strong>
          <span>{error}</span>
          <button className="button small" onClick={() => void loadItems()}>
            重试
          </button>
        </div>
      )}

      <div className="workspace-grid">
        <section className="panel">
          <ItemForm
            editingItem={editingItem}
            key={`${backend}-${editingItem?.id ?? 'new'}`}
            onCancel={() => setEditingItem(null)}
            onSubmit={saveItem}
            submitting={submitting}
          />
        </section>

        <section className="panel records-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SHARED DATABASE</p>
              <h2>数据记录</h2>
            </div>
            <button
              className="button ghost"
              disabled={loading || submitting}
              onClick={() => void loadItems()}
              type="button"
            >
              {loading ? '加载中…' : '刷新'}
            </button>
          </div>

          {loading ? (
            <div className="loading-state">正在从 {selectedBackend.label} 读取数据…</div>
          ) : (
            <ItemTable
              busy={submitting}
              items={items}
              onDelete={(item) => void deleteItem(item)}
              onEdit={setEditingItem}
            />
          )}
        </section>
      </div>
    </main>
  )
}

export default App
