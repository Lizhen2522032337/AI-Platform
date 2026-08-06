import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { knowledgeApi } from '../api/knowledge'
import type { KnowledgeDocument, KnowledgeVisibility } from '../types/knowledge'

function sizeLabel(value: string) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return value
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const statusLabels = { processing: '处理中', ready: '可检索', failed: '失败' }

export function AdminKnowledgePanel() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>('public')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setDocuments(await knowledgeApi.list())
      setError('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '知识文档加载失败')
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return setError('请选择要上传的文档')
    setBusy(true)
    setError('')
    try {
      await knowledgeApi.upload(title.trim(), visibility, file)
      setTitle('')
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '文档上传失败')
    } finally {
      setBusy(false)
    }
  }

  async function updateVisibility(document: KnowledgeDocument, next: KnowledgeVisibility) {
    setBusy(true)
    setError('')
    try {
      await knowledgeApi.updateVisibility(document.id, next)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '可见性更新失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(document: KnowledgeDocument) {
    if (!window.confirm(`确定删除“${document.title}”吗？原文件和全部向量分块都会删除。`)) return
    setBusy(true)
    setError('')
    try {
      await knowledgeApi.delete(document.id)
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '文档删除失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel admin-panel">
      <div className="section-heading">
        <div><p className="eyebrow">RAG KNOWLEDGE BASE</p><h2>企业知识库</h2></div>
        <button className="button ghost" onClick={() => void load()} type="button">刷新</button>
      </div>
      <p className="knowledge-help">仅管理员可以上传和管理。普通用户检索时只能命中“所有人可见”的文档。</p>
      <form className="knowledge-upload-form" onSubmit={upload}>
        <input maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="文档标题" required value={title} />
        <select onChange={(event) => setVisibility(event.target.value as KnowledgeVisibility)} value={visibility}>
          <option value="public">所有人可见</option>
          <option value="admin">仅管理员可见</option>
        </select>
        <input accept=".pdf,.docx,.txt,.md,.csv,.json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} ref={fileInput} required type="file" />
        <button className="button primary" disabled={busy} type="submit">{busy ? '处理中…' : '上传并索引'}</button>
      </form>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="user-table-wrap">
        <table className="user-table knowledge-table">
          <thead><tr><th>文档</th><th>可见性</th><th>状态</th><th>分块</th><th>上传时间</th><th>操作</th></tr></thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id}>
                <td><strong>{document.title}</strong><small>{document.originalFilename} · {sizeLabel(document.fileSize)}</small></td>
                <td>
                  <select disabled={busy || document.status !== 'ready'} onChange={(event) => void updateVisibility(document, event.target.value as KnowledgeVisibility)} value={document.visibility}>
                    <option value="public">所有人可见</option><option value="admin">仅管理员可见</option>
                  </select>
                </td>
                <td><span className={`knowledge-status ${document.status}`}>{statusLabels[document.status]}</span>{document.errorMessage && <small title={document.errorMessage}>查看错误</small>}</td>
                <td>{document.chunkCount}</td>
                <td>{new Date(document.createdAt).toLocaleString('zh-CN')}</td>
                <td><button className="button danger" disabled={busy} onClick={() => void remove(document)} type="button">删除</button></td>
              </tr>
            ))}
            {documents.length === 0 && <tr><td className="knowledge-empty" colSpan={6}>还没有知识文档</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
