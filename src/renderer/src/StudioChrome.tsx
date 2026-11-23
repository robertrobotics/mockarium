import { useEffect, useRef } from 'react'
import {
  Activity,
  ChevronDown,
  Copy,
  LoaderCircle,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Square,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { MockServer } from '../../shared/contracts'

interface StudioHeaderProps {
  name: string
  icon: LucideIcon
  title: string
  description: string
  stats: Array<{ value: number; label: string }>
  onSetup: () => void
  setupDisabled?: boolean
}

export function StudioHeader({
  name,
  icon: Icon,
  title,
  description,
  stats,
  onSetup,
  setupDisabled
}: StudioHeaderProps) {
  return (
    <section className="studio-banner" aria-label={`${name} studio overview`}>
      <div className="studio-banner-icon">
        <Icon size={20} />
      </div>
      <div className="studio-banner-copy">
        <span className="eyebrow studio-design-label">
          DESIGN · {name} Studio
        </span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="studio-banner-stats">
        {stats.map(({ value, label }) => (
          <span key={label}>
            <strong>{value}</strong> {label}
          </span>
        ))}
      </div>
      <button
        className="button button-secondary studio-setup-button"
        type="button"
        onClick={onSetup}
        disabled={setupDisabled}
      >
        <Settings2 size={16} /> {name} setup
      </button>
    </section>
  )
}

interface StudioConnectionProps {
  server: MockServer
  icon: LucideIcon
  busy: boolean
  toggleDisabled?: boolean
  disabledReason?: string | undefined
  resetDisabled?: boolean
  safety: string
  onToggleServer: () => void
  onCopyEndpoint: () => void
  onCopyConfig: () => void
  onOpenInspector: () => void
  onReset: () => void
}

export function StudioConnection({
  server,
  icon: Icon,
  busy,
  toggleDisabled,
  disabledReason,
  resetDisabled,
  safety,
  onToggleServer,
  onCopyEndpoint,
  onCopyConfig,
  onOpenInspector,
  onReset
}: StudioConnectionProps) {
  const endpoint = server.running ? server.endpoint : null
  const menuRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      const menu = menuRef.current
      if (
        menu?.open &&
        event.target instanceof Node &&
        !menu.contains(event.target)
      ) {
        menu.open = false
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = menuRef.current
      if (event.key === 'Escape' && menu?.open) {
        menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  return (
    <div
      className="studio-server-controls"
      role="group"
      aria-label={`${server.name} server connection`}
    >
      <div className="studio-server-state">
        <span
          className={`tag-status ${server.running ? 'tag-running' : 'tag-stopped'}`}
          role="status"
        >
          <span className="status-dot" />
          {server.running ? 'Running' : 'Stopped'}
        </span>
        <span
          className="studio-server-transport"
          aria-label="Streamable HTTP server"
        >
          Streamable HTTP
        </span>
      </div>
      <button
        className="button button-primary studio-server-button"
        type="button"
        onClick={onToggleServer}
        disabled={busy || toggleDisabled}
        title={disabledReason}
        aria-describedby={
          disabledReason ? 'studio-server-disabled-reason' : undefined
        }
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : server.running ? (
          <Square size={14} />
        ) : (
          <Play size={16} />
        )}
        {server.running ? 'Stop' : 'Start'} {server.type} server
      </button>
      {endpoint && (
        <>
          <div className="studio-server-endpoint" title={endpoint}>
            <code>{endpoint}</code>
            <button
              className="icon-button"
              type="button"
              aria-label="Copy URL"
              title="Copy URL"
              onClick={onCopyEndpoint}
            >
              <Copy size={14} />
            </button>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={onCopyConfig}
          >
            <Copy size={14} /> Copy config
          </button>
        </>
      )}
      <details className="studio-connection-menu" ref={menuRef}>
        <summary className="button button-secondary studio-connection-trigger">
          <Wrench size={14} /> Connection <ChevronDown size={13} />
        </summary>
        <div className="panel studio-connection-popover">
          <div className="studio-connection-title">
            <div className="studio-connection-icon">
              <Icon size={19} />
            </div>
            <div>
              <span className="eyebrow">AGENT CONNECTION</span>
              <h3>{server.name} mock server</h3>
            </div>
          </div>
          <div className="studio-endpoint">
            <div className="studio-endpoint-address">
              <span className="eyebrow">STREAMABLE HTTP MCP ENDPOINT</span>
              {endpoint ? (
                <code>{endpoint}</code>
              ) : (
                <span className="studio-endpoint-placeholder">
                  {server.running
                    ? 'The server endpoint is unavailable.'
                    : 'Start the server to reveal its local endpoint.'}
                </span>
              )}
            </div>
            <div className="studio-endpoint-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={onCopyEndpoint}
                disabled={!endpoint}
              >
                <Copy size={14} /> Copy URL
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={onCopyConfig}
                disabled={!endpoint}
              >
                <Copy size={14} /> Copy config
              </button>
            </div>
          </div>
          <div className="studio-connection-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={onOpenInspector}
            >
              <Activity size={14} /> Live Inspector
            </button>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => {
                if (menuRef.current) {
                  menuRef.current.open = false
                  menuRef.current.querySelector('summary')?.focus()
                }
                onReset()
              }}
              disabled={busy || resetDisabled}
            >
              <RotateCcw size={14} /> Restore starter{' '}
              {server.type === 'email' ? 'mailbox' : server.type}
            </button>
            <span className="studio-connection-safety">
              <ShieldCheck size={14} /> {safety}
            </span>
          </div>
          <details className="studio-connection-details">
            <summary>
              <Wrench size={14} /> Connection settings
            </summary>
            <div className="studio-connection-details-content">
              <p>
                Use Streamable HTTP with the local endpoint in your MCP client.
                Client configuration formats vary. This server is available only
                on this device.
              </p>
              {endpoint ? (
                <div className="connection-config">
                  <div className="connection-config-head">
                    <span>Generic HTTP client configuration</span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={onCopyConfig}
                    >
                      <Copy size={13} /> Copy config
                    </button>
                  </div>
                  <pre>
                    {JSON.stringify(
                      {
                        mcpServers: {
                          [`mockarium-${server.type}`]: {
                            type: 'http',
                            url: endpoint
                          }
                        }
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              ) : (
                <p>Start the server to reveal its client configuration.</p>
              )}
            </div>
          </details>
        </div>
      </details>
      {disabledReason && (
        <span
          id="studio-server-disabled-reason"
          className="studio-connection-hint"
        >
          {disabledReason}
        </span>
      )}
    </div>
  )
}
