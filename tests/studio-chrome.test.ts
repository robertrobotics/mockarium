import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Server } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import type { MockServer } from '../src/shared/contracts'
import { StudioConnection } from '../src/renderer/src/StudioChrome'

function renderConnection(
  type: MockServer['type'],
  running: boolean,
  overrides: Partial<ComponentProps<typeof StudioConnection>> = {}
): string {
  return renderToStaticMarkup(
    createElement(StudioConnection, {
      server: {
        id: 'server-id',
        workspaceId: 'workspace-id',
        type,
        name: type,
        createdAt: '2025-03-10T08:30:00Z',
        running,
        endpoint: 'http://127.0.0.1:12345/mcp'
      },
      icon: Server,
      busy: false,
      safety: 'Local only',
      onToggleServer: vi.fn(),
      onCopyEndpoint: vi.fn(),
      onCopyConfig: vi.fn(),
      onOpenInspector: vi.fn(),
      onReset: vi.fn(),
      ...overrides
    })
  )
}

describe('shared studio connection', () => {
  it.each(['email', 'database', 'calendar'] as const)(
    'shows the live %s endpoint and copy actions alongside its status',
    (type) => {
      const markup = renderConnection(type, true)
      const encodedConfig = /<pre>(.*?)<\/pre>/s.exec(markup)?.[1]
      expect(encodedConfig).toBeDefined()
      const config = JSON.parse(encodedConfig!.replaceAll('&quot;', '"'))
      expect(config).toEqual({
        mcpServers: {
          [`mockarium-${type}`]: {
            type: 'http',
            url: 'http://127.0.0.1:12345/mcp'
          }
        }
      })
      expect(markup).toContain(`Stop ${type} server`)
      expect(markup).toContain('role="status"')
      expect(markup).toContain('Running')
      expect(markup).toContain('<code>http://127.0.0.1:12345/mcp</code>')
      expect(markup.indexOf('<code>')).toBeLessThan(markup.indexOf('<details'))
      const buttons = markup.match(/<button\b[^]*?<\/button>/g) ?? []
      const copyButtons = buttons.filter((item) =>
        /Copy URL|Copy config/.test(item)
      )
      expect(copyButtons.length).toBeGreaterThanOrEqual(2)
      for (const button of copyButtons) {
        expect(button).not.toContain('disabled')
      }
    }
  )

  it('hides a stale endpoint and disables copying when stopped', () => {
    const markup = renderConnection('email', false)
    expect(markup).not.toContain('http://127.0.0.1:12345/mcp')
    expect(markup).not.toContain('<pre>')
    expect(markup).toContain('Start email server')
    const buttons = markup.match(/<button\b[^]*?<\/button>/g) ?? []
    expect(buttons.find((button) => button.includes('Copy URL'))).toContain(
      'disabled=""'
    )
    expect(buttons.find((button) => button.includes('Copy config'))).toContain(
      'disabled=""'
    )
  })

  it('explains a missing endpoint for a running server', () => {
    const markup = renderConnection('calendar', true, {
      server: {
        id: 'server-id',
        workspaceId: 'workspace-id',
        type: 'calendar',
        name: 'Calendar',
        createdAt: '2025-03-10T08:30:00Z',
        running: true,
        endpoint: null
      }
    })
    expect(markup).toContain('The server endpoint is unavailable.')
    expect(markup).not.toContain(
      'Start the server to reveal its local endpoint.'
    )
  })

  it('explains why starting is blocked without disabling endpoint copies', () => {
    const markup = renderConnection('database', true, {
      toggleDisabled: true,
      disabledReason: 'Save your model changes first.'
    })
    const buttons = markup.match(/<button\b[^]*?<\/button>/g) ?? []
    expect(
      buttons.find((button) => button.includes('Stop database server'))
    ).toContain('disabled=""')
    expect(markup).toContain(
      'class="studio-connection-hint">Save your model changes first.</span>'
    )
    expect(buttons.find((button) => button.includes('Copy URL'))).not.toContain(
      'disabled'
    )
  })
})
