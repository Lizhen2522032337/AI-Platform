import { BACKENDS } from '../api/items'
import type { BackendKey } from '../types/item'

interface BackendSelectorProps {
  value: BackendKey
  disabled?: boolean
  onChange: (backend: BackendKey) => void
}
export function BackendSelector({
  value,
  disabled,
  onChange,
}: BackendSelectorProps) {
  return (
    <div className="backend-grid" role="group" aria-label="选择后端服务">
      {BACKENDS.map((backend) => (
        <button
          className={`backend-card ${value === backend.key ? 'active' : ''}`}
          disabled={disabled}
          key={backend.key}
          onClick={() => onChange(backend.key)}
          type="button"
        >
          <span>{backend.label}</span>
          <small>{backend.description}</small>
        </button>
      ))}
    </div>
  )
}
