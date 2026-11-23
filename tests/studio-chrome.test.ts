import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Server } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import type { MockServer } from '../src/shared/contracts'
import { OverviewPage } from '../src/renderer/src/App'
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
      expect(markup).toContain('>Streamable HTTP</span>')
      expect(markup.indexOf('>Streamable HTTP</span>')).toBeLessThan(
        markup.indexOf('<details')
      )
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
    expect(markup).toContain('>Streamable HTTP</span>')
    expect(markup.indexOf('>Streamable HTTP</span>')).toBeLessThan(
      markup.indexOf('<details')
    )
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

function renderOverview(
  overrides: Partial<ComponentProps<typeof OverviewPage>> = {}
): string {
  return renderToStaticMarkup(
    createElement(OverviewPage, {
      workspace: {
        id: 'workspace-id',
        name: 'Design lab',
        createdAt: '2025-03-10T08:30:00Z',
        updatedAt: '2025-03-10T08:30:00Z'
      },
      server: null,
      databaseServer: null,
      calendarServer: null,
      events: [],
      onNavigate: vi.fn(),
      onToggleServer: vi.fn(),
      busy: false,
      ...overrides
    })
  )
}

function overviewCard(markup: string, name: string): string {
  return (
    new RegExp(
      `<article[^>]*aria-label="${name} studio"[^>]*>.*?</article>`,
      's'
    ).exec(markup)?.[0] ?? ''
  )
}

describe('workspace overview', () => {
  it('shows each studio’s actual state, transport, and running count', () => {
    const email: MockServer = {
      id: 'email-id',
      workspaceId: 'workspace-id',
      type: 'email',
      name: 'Email',
      createdAt: '2025-03-10T08:30:00Z',
      running: true,
      endpoint: 'http://127.0.0.1:12345/mcp'
    }
    const markup = renderOverview({
      server: email,
      databaseServer: {
        ...email,
        id: 'database-id',
        type: 'database',
        name: 'Database',
        running: false,
        endpoint: null
      }
    })
    const emailCard = overviewCard(markup, 'Email')
    const databaseCard = overviewCard(markup, 'Database')
    const calendarCard = overviewCard(markup, 'Calendar')
    expect(markup).toContain('1<span> / 3</span>')
    expect(emailCard).toContain('Email server: Running')
    expect(databaseCard).toContain('Database server: Not running')
    expect(calendarCard).toContain('Calendar server: Not running')
    expect(emailCard).toContain('Stop Email server')
    expect(databaseCard).toContain('Start Database server')
    expect(calendarCard).toContain('Start Calendar server')
    expect(calendarCard).toContain('First start creates starter data.')
    for (const [name, card] of [
      ['Email', emailCard],
      ['Database', databaseCard],
      ['Calendar', calendarCard]
    ] as const) {
      expect(card).toContain('Streamable HTTP')
      expect(card).toContain('role="status"')
      expect(card).toContain(`Open ${name} Studio`)
      expect(card.match(/<button\b/g)).toHaveLength(2)
      expect(card).toContain('Open studio')
      expect(card).not.toContain('http://127.0.0.1:12345/mcp')
      expect(card).not.toContain('Copy MCP')
    }
  })

  it('keeps every studio accessible before server setup', () => {
    const empty = renderOverview()
    expect(empty).toContain('0<span> / 3</span>')
    for (const name of ['Email', 'Database', 'Calendar']) {
      const card = overviewCard(empty, name)
      expect(card).toContain(`${name} server: Not running`)
      expect(card).toContain('First start creates starter data.')
      expect(card).toContain(`Open ${name} Studio`)
      expect(card).toContain(`Start ${name} server`)
      expect(card).not.toContain('disabled')
      expect(card.match(/<button\b/g)).toHaveLength(2)
    }
  })

  it.each([
    ['Email', 'email', 'server'],
    ['Database', 'database', 'databaseServer'],
    ['Calendar', 'calendar', 'calendarServer']
  ] as const)(
    'shows the correct action for a running or stopped %s server',
    (name, type, prop) => {
      const server: MockServer = {
        id: `${type}-id`,
        workspaceId: 'workspace-id',
        type,
        name,
        createdAt: '2025-03-10T08:30:00Z',
        running: true,
        endpoint: 'http://127.0.0.1:12345/mcp'
      }
      const running = overviewCard(renderOverview({ [prop]: server }), name)
      const stopped = overviewCard(
        renderOverview({ [prop]: { ...server, running: false } }),
        name
      )
      expect(running).toContain(`${name} server: Running`)
      expect(running).toContain(`Stop ${name} server`)
      expect(stopped).toContain(`${name} server: Not running`)
      expect(stopped).toContain(`Start ${name} server`)
    }
  )

  it('disables server actions while an operation is in progress', () => {
    const markup = renderOverview({ busy: true })
    for (const name of ['Email', 'Database', 'Calendar']) {
      const buttons =
        overviewCard(markup, name).match(/<button\b[^]*?<\/button>/g) ?? []
      expect(
        buttons.find((button) => button.includes(`Start ${name} server`))
      ).toContain('disabled=""')
      expect(
        buttons.find((button) => button.includes(`Open ${name} Studio`))
      ).not.toContain('disabled')
    }
  })

  it('leaves the area below the studio cards empty even with recent activity', () => {
    const markup = renderOverview({
      events: [
        {
          id: 'event-id',
          workspaceId: 'workspace-id',
          serverName: 'Database',
          toolName: 'database_list_records',
          input: {},
          output: null,
          durationMs: 42,
          success: false,
          error: null,
          createdAt: '2025-03-10T08:30:00Z'
        }
      ]
    })
    expect(markup).toContain('<strong>1</strong><span>recent tool calls</span>')
    expect(markup).not.toContain('database_list_records')
    expect(markup).not.toContain('Mailbox preview')
    expect(markup).not.toContain('Customize mailbox')
    expect(markup).not.toContain('Reset mock data')
    expect(markup).not.toContain('Live activity')
    expect(markup).toMatch(/<\/article><\/div><\/div>$/)
  })
})
