import { useMemo, useState } from 'react'
import type { ExecutionTraceStep, TaskStatus } from '../types/task'

interface ExecutionTraceProps {
  steps: ExecutionTraceStep[]
  status: TaskStatus
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.max(0, Math.round(milliseconds))}ms`
  const seconds = Math.round(milliseconds / 100) / 10
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

function statusIcon(stepStatus: ExecutionTraceStep['status']) {
  if (stepStatus === 'completed') return '✓'
  if (stepStatus === 'failed') return '×'
  if (stepStatus === 'skipped') return '–'
  return ''
}

export function ExecutionTrace({ steps, status }: ExecutionTraceProps) {
  // 执行中的轨迹默认展开；任务完成后用户可折叠，避免历史对话过长。
  const [open, setOpen] = useState(status === 'queued' || status === 'processing')

  const visibleSteps = useMemo<ExecutionTraceStep[]>(() => {
    if (steps.length > 0) return steps
    if (status === 'queued') {
      return [{
        id: 'queued',
        title: '等待异步执行器接收任务',
        detail: '任务已写入队列',
        kind: 'stage',
        status: 'running',
      }]
    }
    if (status === 'processing') {
      return [{
        id: 'processing',
        title: '正在准备执行过程',
        kind: 'stage',
        status: 'running',
      }]
    }
    return []
  }, [status, steps])

  if (visibleSteps.length === 0) return null

  const completedCount = visibleSteps.filter(
    (step) => step.status === 'completed' || step.status === 'skipped',
  ).length
  const elapsed = visibleSteps.reduce((total, step) => total + (step.durationMs ?? 0), 0)
  const summary = status === 'failed'
    ? `执行失败 · ${visibleSteps.length} 个步骤`
    : status === 'completed'
      ? `已处理 ${elapsed ? formatDuration(elapsed) : ''} · ${visibleSteps.length} 个步骤`
      : `正在执行 ${completedCount}/${visibleSteps.length}`

  return (
    <section className={`execution-trace ${status}`} aria-label="本次执行过程">
      <button
        aria-expanded={open}
        className="trace-summary"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="trace-summary-signal" aria-hidden="true" />
        <span>{summary.replace('  ·', ' ·')}</span>
        <span className={`trace-chevron ${open ? 'open' : ''}`} aria-hidden="true">›</span>
      </button>

      {open && (
        <div className="trace-list" aria-live={status === 'processing' ? 'polite' : 'off'}>
          {visibleSteps.map((step) => (
            <div className={`trace-step ${step.status}`} key={step.id}>
              <span className="trace-step-icon" aria-hidden="true">
                {step.status === 'running'
                  ? <span className="trace-spinner" />
                  : statusIcon(step.status)}
              </span>
              <div className="trace-step-content">
                <div className="trace-step-heading">
                  <span>{step.title}</span>
                  {typeof step.durationMs === 'number' && (
                    <time>{formatDuration(step.durationMs)}</time>
                  )}
                </div>
                {step.kind === 'tool' && step.toolName && (
                  <div className="trace-tool-call">
                    <span className="trace-tool-glyph" aria-hidden="true">›_</span>
                    <code>{step.toolName}</code>
                  </div>
                )}
                {step.detail && <p>{step.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
