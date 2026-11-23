import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Database,
  Ellipsis,
  FileText,
  FolderOpen,
  Gauge,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  Mail,
  Moon,
  Play,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  Wrench,
  X,
  Zap
} from 'lucide-react'
import type {
  DatabaseModel,
  EmailMessage,
  ExecutionEvent,
  InitialState,
  MockServer,
  Workspace
} from '../../shared/contracts'
import { CalendarStudio } from './CalendarStudio'
import { DatabaseStudio } from './DatabaseStudio'
import { EmailStudio } from './EmailStudio'

type Page =
  | 'Overview'
  | 'Email Studio'
  | 'Database Studio'
  | 'Calendar Studio'
  | 'Scenarios'
  | 'Live Inspector'
  | 'Test Runs'
  | 'Settings'
type DialogMode = 'create' | 'rename' | null

const navigation: Array<{
  label: Page
  icon: typeof LayoutDashboard
  section: string
}> = [
  { label: 'Overview', icon: LayoutDashboard, section: 'Workspace' },
  { label: 'Email Studio', icon: Mail, section: 'Workspace' },
  { label: 'Database Studio', icon: Database, section: 'Workspace' },
  { label: 'Calendar Studio', icon: CalendarDays, section: 'Workspace' },
  { label: 'Scenarios', icon: FileText, section: 'Testing' },
  { label: 'Live Inspector', icon: Activity, section: 'Testing' },
  { label: 'Test Runs', icon: Gauge, section: 'Testing' },
  { label: 'Settings', icon: Settings, section: 'Preferences' }
]

const notReadyPages: Partial<
  Record<Page, { title: string; description: string }>
> = {
  Scenarios: {
    title: 'Scenario testing is on the roadmap',
    description:
      'For now, run your agent manually against a mock server and inspect every real tool call here.'
  },
  'Test Runs': {
    title: 'Test run history is coming later',
    description:
      'Execution history is available in Live Inspector. Repeatable scenario runs will build on this foundation.'
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.'
}

function App() {
  const [state, setState] = useState<InitialState | null>(null)
  const [page, setPage] = useState<Page>('Overview')
  const [dialog, setDialog] = useState<DialogMode>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceActionsOpen, setWorkspaceActionsOpen] = useState(false)
  const [folder, setFolder] = useState('Inbox')
  const [events, setEvents] = useState<ExecutionEvent[]>([])
  const [emails, setEmails] = useState<EmailMessage[]>([])
  const [databaseRevision, setDatabaseRevision] = useState(0)
  const [calendarRevision, setCalendarRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [toolFilter, setToolFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [livePaused, setLivePaused] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return window.localStorage.getItem('mockarium-theme') === 'dark'
        ? 'dark'
        : 'light'
    } catch {
      return 'light'
    }
  })

  const activeWorkspace = state?.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId
  )
  const activeServer = state?.servers.find(
    (server) =>
      server.workspaceId === state.activeWorkspaceId && server.type === 'email'
  )
  const activeDatabaseServer = state?.servers.find(
    (server) =>
      server.workspaceId === state.activeWorkspaceId &&
      server.type === 'database'
  )
  const activeCalendarServer = state?.servers.find(
    (server) =>
      server.workspaceId === state.activeWorkspaceId &&
      server.type === 'calendar'
  )

  const refreshState = useCallback(async () => {
    const next = await window.mockarium.getInitialState()
    setState(next)
    setEvents(next.events)
    setEmails(next.emails)
  }, [])

  useEffect(() => {
    void window.mockarium
      .getInitialState()
      .then((next) => {
        setState(next)
        setEvents(next.events)
        setEmails(next.emails)
      })
      .catch((caught: unknown) => setError(messageOf(caught)))
  }, [])

  useEffect(() => {
    return window.mockarium.onExecutionEvent((event) => {
      if (event.workspaceId === state?.activeWorkspaceId) {
        if (!livePaused) {
          setEvents((current) =>
            [event, ...current.filter(({ id }) => id !== event.id)].slice(
              0,
              100
            )
          )
        }
        void window.mockarium
          .getEmails(event.workspaceId)
          .then(setEmails)
          .catch((caught: unknown) => setError(messageOf(caught)))
        if (event.serverName === 'Database') {
          setDatabaseRevision((revision) => revision + 1)
        }
        if (event.serverName === 'Calendar') {
          setCalendarRevision((revision) => revision + 1)
        }
      }
    })
  }, [livePaused, state?.activeWorkspaceId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('mockarium-theme', theme)
    } catch (caught) {
      console.error('Theme preference could not be saved.', caught)
    }
  }, [theme])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  const runAction = useCallback(
    async (action: () => Promise<unknown>, successMessage?: string) => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        await action()
        await refreshState()
        if (successMessage) setNotice(successMessage)
        return true
      } catch (caught) {
        setError(messageOf(caught))
        return false
      } finally {
        setBusy(false)
      }
    },
    [refreshState]
  )

  const selectWorkspace = (workspaceId: string) => {
    setWorkspaceMenuOpen(false)
    setFolder('Inbox')
    setPage('Overview')
    void runAction(async () => {
      const next = await window.mockarium.selectWorkspace(workspaceId)
      setState(next)
      setEvents(next.events)
      setEmails(next.emails)
    })
  }

  const submitWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = workspaceName.trim()
    if (!name) return
    if (dialog === 'rename' && activeWorkspace) {
      const succeeded = await runAction(
        () => window.mockarium.renameWorkspace(activeWorkspace.id, name),
        'Workspace renamed'
      )
      if (!succeeded) return
    } else {
      const succeeded = await runAction(
        () => window.mockarium.createWorkspace(name),
        'Workspace created'
      )
      if (!succeeded) return
    }
    setDialog(null)
    setWorkspaceName('')
  }

  const deleteWorkspace = () => {
    if (!activeWorkspace) return
    if (
      !window.confirm(
        `Delete “${activeWorkspace.name}” and its local mock data? This cannot be undone.`
      )
    ) {
      return
    }
    setWorkspaceActionsOpen(false)
    void runAction(
      () => window.mockarium.deleteWorkspace(activeWorkspace.id),
      'Workspace deleted'
    )
  }

  const addEmailServer = () => {
    const workspaceId = state?.activeWorkspaceId
    if (!workspaceId) return
    void runAction(async () => {
      await window.mockarium.addEmailServer(workspaceId)
    }, 'Email server added')
  }

  const addDatabaseServer = () => {
    const workspaceId = state?.activeWorkspaceId
    if (!workspaceId) return
    void runAction(async () => {
      await window.mockarium.addDatabaseServer(workspaceId)
    }, 'Database studio created')
  }

  const addCalendarServer = () => {
    const workspaceId = state?.activeWorkspaceId
    if (!workspaceId) return
    void runAction(async () => {
      await window.mockarium.addCalendarServer(workspaceId)
    }, 'Calendar studio created')
  }

  const toggleServer = (server: MockServer | null) => {
    if (!server || !state?.activeWorkspaceId) return
    void runAction(
      async () => {
        if (server.running) {
          await window.mockarium.stopMockServer(server.workspaceId, server.id)
        } else {
          await window.mockarium.startMockServer(server.workspaceId, server.id)
        }
      },
      server.running
        ? `${server.name} server stopped`
        : `${server.name} server started`
    )
  }

  const saveDatabaseModel = async (model: DatabaseModel) => {
    const workspaceId = state?.activeWorkspaceId
    if (!workspaceId) throw new Error('Choose a workspace first.')
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const saved = await window.mockarium.saveDatabaseModel(workspaceId, model)
      setState((current) =>
        current ? { ...current, databaseModel: saved } : current
      )
      setNotice('Database model saved')
      return saved
    } catch (caught) {
      setError(messageOf(caught))
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const resetDatabase = async () => {
    if (!activeWorkspace) return
    if (
      !window.confirm(
        'Restore the starter database schema and sample records? This removes your custom tables and records. Tool history will be kept.'
      )
    ) {
      return
    }
    await runAction(
      () => window.mockarium.resetDatabase(activeWorkspace.id),
      'Starter database restored. Tool history was preserved.'
    )
  }

  const resetMailbox = async (): Promise<boolean> => {
    if (!activeWorkspace) return false
    if (
      !window.confirm(
        'Restore the starter mailbox? This replaces your identity, messages, folders, and contacts. Execution history will be kept.'
      )
    ) {
      return false
    }
    return runAction(
      () => window.mockarium.resetEmailServer(activeWorkspace.id),
      'Mailbox reset. Execution history was preserved.'
    )
  }

  const resetCalendar = async (): Promise<boolean> => {
    if (!activeWorkspace) return false
    if (
      !window.confirm(
        'Restore the starter calendar? This replaces the owner, simulated clock, people, and events. Execution history will be kept.'
      )
    ) {
      return false
    }
    return runAction(
      () => window.mockarium.resetCalendar(activeWorkspace.id),
      'Starter calendar restored. Execution history was preserved.'
    )
  }

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setError('')
      setNotice(`${label} copied`)
    } catch {
      setError(
        'Clipboard access was unavailable. Select and copy the text manually.'
      )
    }
  }

  const copyConfig = () => {
    if (!activeServer?.endpoint) return
    const config = {
      mcpServers: {
        'mockarium-email': {
          type: 'http',
          url: activeServer.endpoint
        }
      }
    }
    void copyText(JSON.stringify(config, null, 2), 'Connection configuration')
  }

  const copyDatabaseConfig = () => {
    if (!activeDatabaseServer?.endpoint) return
    const config = {
      mcpServers: {
        'mockarium-database': {
          type: 'http',
          url: activeDatabaseServer.endpoint
        }
      }
    }
    void copyText(JSON.stringify(config, null, 2), 'Connection configuration')
  }

  const copyCalendarConfig = () => {
    if (!activeCalendarServer?.endpoint) return
    const config = {
      mcpServers: {
        'mockarium-calendar': {
          type: 'http',
          url: activeCalendarServer.endpoint
        }
      }
    }
    void copyText(JSON.stringify(config, null, 2), 'Connection configuration')
  }

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase()
    return events.filter((event) => {
      const matchesSearch =
        !query ||
        [
          event.toolName,
          event.serverName,
          JSON.stringify(event.input),
          JSON.stringify(event.output)
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      const matchesTool = !toolFilter || event.toolName === toolFilter
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'success' ? event.success : !event.success)
      return matchesSearch && matchesTool && matchesStatus
    })
  }, [events, search, statusFilter, toolFilter])

  const availableTools = useMemo(
    () => [...new Set(events.map((event) => event.toolName))].sort(),
    [events]
  )

  const exportEvents = async () => {
    if (!activeWorkspace) return
    try {
      const history = await window.mockarium.getEvents(activeWorkspace.id, 1000)
      const payload = JSON.stringify(history, null, 2)
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `mockarium-${activeWorkspace.name}-events.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setNotice('Execution history exported')
    } catch (caught) {
      setError(messageOf(caught))
    }
  }

  const toggleTheme = () =>
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))

  const title = page === 'Live Inspector' ? 'Live Inspector' : page
  const hasRunningServer =
    state?.servers.some(
      (server) =>
        server.workspaceId === state.activeWorkspaceId && server.running
    ) ?? false
  const pageDescription: Record<Page, string> = {
    Overview: 'Your simulated environment, at a glance.',
    'Email Studio': 'Create, connect, and customize your simulated mailbox.',
    'Database Studio':
      'Shape a tiny business database and watch your agent use it.',
    'Calendar Studio':
      'Plan a realistic week and watch your agent schedule around it.',
    Scenarios: 'Define repeatable agent tests.',
    'Live Inspector': 'Observe real MCP tool calls as they happen.',
    'Test Runs': 'Review and compare scenario results.',
    Settings: 'Personalize your local development environment.'
  }
  const upcoming = notReadyPages[page]

  if (!state) {
    return (
      <div className="app-loading">
        <div className="brand-mark">
          <Sparkles size={20} />
        </div>
        <span>Opening your local workspace…</span>
        {error && <p className="error-text">{error}</p>}
        <button
          className="button button-secondary"
          type="button"
          onClick={() =>
            void refreshState().catch((caught: unknown) =>
              setError(messageOf(caught))
            )
          }
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <span className="brand-name">mockarium</span>
          <span className="brand-version">0.1</span>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">
            {activeWorkspace?.name.slice(0, 1).toUpperCase() ?? 'M'}
          </div>
          <button
            className="workspace-select"
            type="button"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            aria-expanded={workspaceMenuOpen}
          >
            <span className="workspace-label">WORKSPACE</span>
            <span className="workspace-name">
              {activeWorkspace?.name ?? 'Choose workspace'}
            </span>
            <ChevronDown className="workspace-chevron" size={14} />
          </button>
          <button
            className="icon-button workspace-add"
            type="button"
            aria-label="Create workspace"
            title="Create workspace"
            onClick={() => {
              setError('')
              setWorkspaceName('')
              setDialog('create')
            }}
          >
            <Plus size={16} />
          </button>
          {workspaceMenuOpen && (
            <div className="workspace-menu">
              <div className="menu-heading">Your workspaces</div>
              {state.workspaces.map((workspace) => (
                <button
                  type="button"
                  className={`workspace-option ${workspace.id === state.activeWorkspaceId ? 'selected' : ''}`}
                  key={workspace.id}
                  onClick={() => selectWorkspace(workspace.id)}
                >
                  <span className="workspace-option-dot" />
                  <span>{workspace.name}</span>
                  {workspace.id === state.activeWorkspaceId && (
                    <Check size={14} />
                  )}
                </button>
              ))}
              <button
                type="button"
                className="menu-action"
                onClick={() => {
                  setWorkspaceMenuOpen(false)
                  setError('')
                  setWorkspaceName('')
                  setDialog('create')
                }}
              >
                <Plus size={14} /> New workspace
              </button>
            </div>
          )}
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          {['Workspace', 'Testing', 'Preferences'].map((section) => (
            <div className="nav-section" key={section}>
              <div className="nav-section-label">{section}</div>
              {navigation
                .filter((item) => item.section === section)
                .map(({ label, icon: Icon }) => (
                  <button
                    className={`nav-item ${page === label ? 'active' : ''}`}
                    type="button"
                    key={label}
                    onClick={() => setPage(label)}
                  >
                    <Icon size={16} strokeWidth={1.8} />
                    <span>{label}</span>
                    {label === 'Live Inspector' && events.length > 0 && (
                      <span className="nav-count">{events.length}</span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={15} />
            <div>
              <strong>Local by design</strong>
              <span>Your data stays on this device</span>
            </div>
          </div>
          <button
            className="sidebar-help"
            type="button"
            onClick={() => setPage('Settings')}
          >
            <CircleHelp size={15} /> Help &amp; settings
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{activeWorkspace?.name ?? 'New workspace'}</span>
            <span className="crumb-slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <div className="environment-pill">
              <span
                className={`status-dot ${hasRunningServer ? 'running' : ''}`}
              />
              {hasRunningServer
                ? 'Mock environment running'
                : 'Mock environment stopped'}
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={
                theme === 'light'
                  ? 'Switch to dark theme'
                  : 'Switch to light theme'
              }
              title={
                theme === 'light'
                  ? 'Switch to dark theme'
                  : 'Switch to light theme'
              }
              onClick={toggleTheme}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            {activeWorkspace && (
              <div className="workspace-actions">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Workspace actions"
                  title="Workspace actions"
                  onClick={() => setWorkspaceActionsOpen((open) => !open)}
                >
                  <Ellipsis size={18} />
                </button>
                {workspaceActionsOpen && (
                  <div className="workspace-menu workspace-actions-menu">
                    <button
                      type="button"
                      className="menu-action"
                      onClick={() => {
                        setWorkspaceActionsOpen(false)
                        setError('')
                        setWorkspaceName(activeWorkspace.name)
                        setDialog('rename')
                      }}
                    >
                      <Wrench size={14} /> Rename workspace
                    </button>
                    <button
                      type="button"
                      className="menu-action danger-text"
                      onClick={deleteWorkspace}
                    >
                      <Trash2 size={14} /> Delete workspace
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <section className="page-scroll">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {activeWorkspace ? 'WORKSPACE' : 'GET STARTED'}
              </div>
              <h1>{title}</h1>
              <p>{pageDescription[page]}</p>
            </div>
            {page === 'Live Inspector' && (
              <div className="inspector-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    if (livePaused && activeWorkspace) {
                      void window.mockarium
                        .getEvents(activeWorkspace.id, 100)
                        .then(setEvents)
                        .catch((caught: unknown) => setError(messageOf(caught)))
                    }
                    setLivePaused((paused) => !paused)
                  }}
                >
                  {livePaused ? <Play size={15} /> : <Square size={14} />}
                  {livePaused ? 'Resume live' : 'Pause live'}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={exportEvents}
                >
                  <ArrowDownToLine size={15} /> Export
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="inline-alert" role="alert">
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError('')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast-notice" role="status">
              {notice}
            </div>
          )}

          {!activeWorkspace ? (
            <EmptyWorkspace
              onCreate={() => {
                setError('')
                setWorkspaceName('')
                setDialog('create')
              }}
            />
          ) : upcoming ? (
            <ComingSoon
              title={upcoming.title}
              description={upcoming.description}
            />
          ) : page === 'Settings' ? (
            <SettingsPage theme={theme} onThemeChange={toggleTheme} />
          ) : page === 'Live Inspector' ? (
            <InspectorPage
              events={filteredEvents}
              allEvents={events}
              selectedEventId={selectedEventId}
              onSelectEvent={setSelectedEventId}
              search={search}
              onSearch={setSearch}
              toolFilter={toolFilter}
              onToolFilter={setToolFilter}
              statusFilter={statusFilter}
              onStatusFilter={setStatusFilter}
              availableTools={availableTools}
              livePaused={livePaused}
            />
          ) : page === 'Email Studio' ? (
            <EmailStudio
              key={activeServer?.workspaceId ?? 'no-email-server'}
              server={activeServer ?? null}
              emails={emails}
              busy={busy}
              onAddServer={addEmailServer}
              onToggleServer={() => toggleServer(activeServer ?? null)}
              onReset={resetMailbox}
              onCopyEndpoint={() =>
                activeServer?.endpoint &&
                void copyText(activeServer.endpoint, 'MCP endpoint')
              }
              onCopyConfig={copyConfig}
              onOpenInspector={() => setPage('Live Inspector')}
              onMailboxChanged={refreshState}
            />
          ) : page === 'Database Studio' ? (
            <DatabaseStudio
              model={state.databaseModel}
              server={activeDatabaseServer ?? null}
              busy={busy}
              revision={databaseRevision}
              onAddServer={addDatabaseServer}
              onToggleServer={() => toggleServer(activeDatabaseServer ?? null)}
              onReset={resetDatabase}
              onCopyEndpoint={() =>
                activeDatabaseServer?.endpoint &&
                void copyText(activeDatabaseServer.endpoint, 'MCP endpoint')
              }
              onCopyConfig={copyDatabaseConfig}
              onOpenInspector={() => setPage('Live Inspector')}
              onSaveModel={saveDatabaseModel}
            />
          ) : page === 'Calendar Studio' ? (
            <CalendarStudio
              key={state.activeWorkspaceId ?? 'no-calendar'}
              workspaceId={state.activeWorkspaceId ?? ''}
              server={activeCalendarServer ?? null}
              busy={busy}
              revision={calendarRevision}
              onAddServer={addCalendarServer}
              onToggleServer={() => toggleServer(activeCalendarServer ?? null)}
              onReset={resetCalendar}
              onCopyEndpoint={() =>
                activeCalendarServer?.endpoint &&
                void copyText(activeCalendarServer.endpoint, 'MCP endpoint')
              }
              onCopyConfig={copyCalendarConfig}
              onOpenInspector={() => setPage('Live Inspector')}
            />
          ) : page === 'Overview' ? (
            <OverviewPage
              workspace={activeWorkspace}
              server={activeServer ?? null}
              events={events}
              emails={emails}
              folder={folder}
              onFolderChange={setFolder}
              onAddServer={addEmailServer}
              onToggleServer={() => toggleServer(activeServer ?? null)}
              onReset={() => void resetMailbox()}
              onCopyEndpoint={() =>
                activeServer?.endpoint &&
                void copyText(activeServer.endpoint, 'MCP endpoint')
              }
              onCopyConfig={copyConfig}
              onNavigate={setPage}
              busy={busy}
            />
          ) : (
            <ComingSoon
              title="Page unavailable"
              description="Choose another section from the navigation."
            />
          )}
        </section>
      </main>

      {dialog && (
        <WorkspaceDialog
          mode={dialog}
          name={workspaceName}
          busy={busy}
          error={error}
          onNameChange={setWorkspaceName}
          onSubmit={submitWorkspace}
          onClose={() => {
            setDialog(null)
            setWorkspaceName('')
            setError('')
          }}
        />
      )}
    </div>
  )
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-workspace">
      <div className="empty-illustration">
        <div className="illustration-grid" />
        <div className="illustration-card">
          <Server size={28} />
        </div>
        <span className="illustration-spark">
          <Sparkles size={18} />
        </span>
      </div>
      <span className="eyebrow">YOUR LOCAL LAB</span>
      <h2>Build a safe place to test</h2>
      <p>
        Create a workspace for mock systems, agent connections, and the tool
        calls you want to inspect.
      </p>
      <button
        className="button button-primary"
        type="button"
        onClick={onCreate}
      >
        <Plus size={16} /> Create your first workspace
      </button>
      <div className="empty-footnote">
        <ShieldCheck size={14} /> No account needed. Your data stays local.
      </div>
    </div>
  )
}

function OverviewPage({
  workspace,
  server,
  events,
  emails,
  folder,
  onFolderChange,
  onAddServer,
  onToggleServer,
  onReset,
  onCopyEndpoint,
  onCopyConfig,
  onNavigate,
  busy
}: {
  workspace: Workspace
  server: MockServer | null
  events: ExecutionEvent[]
  emails: EmailMessage[]
  folder: string
  onFolderChange: (folder: string) => void
  onAddServer: () => void
  onToggleServer: () => void
  onReset: () => void
  onCopyEndpoint: () => void
  onCopyConfig: () => void
  onNavigate: (page: Page) => void
  busy: boolean
}) {
  const latestEvent = events[0]
  const sentCount = emails.filter((email) => email.folder === 'Sent').length
  const inboxCount = emails.filter((email) => email.folder === 'Inbox').length
  return (
    <>
      <div className="welcome-banner">
        <div className="welcome-copy">
          <div className="welcome-icon">
            <Sparkles size={18} />
          </div>
          <div>
            <span className="eyebrow">LOCAL TEST ENVIRONMENT</span>
            <h2>
              {workspace.name}
              <span className="welcome-period">.</span>
            </h2>
            <p>
              Your agent's world is simulated. Production systems stay
              untouched.
            </p>
          </div>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit-core">
            <Mail size={24} />
          </div>
          <span className="orbit-node node-one">
            <Server size={13} />
          </span>
          <span className="orbit-node node-two">
            <Activity size={13} />
          </span>
        </div>
      </div>

      <div className="section-title-row">
        <div>
          <h2 className="section-title">Environment</h2>
          <p className="section-subtitle">
            A snapshot of your active mock systems.
          </p>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() => onNavigate('Email Studio')}
        >
          Open Email Studio <ArrowRight size={14} />
        </button>
      </div>

      <div className="overview-grid">
        <section className="panel server-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon email-icon">
              <Mail size={17} />
            </div>
            <div className="panel-heading-copy">
              <h3>Email</h3>
              <span>Simulated mailbox</span>
            </div>
            {server ? (
              <span
                className={`tag-status ${server.running ? 'tag-running' : 'tag-stopped'}`}
              >
                <span className="status-dot" />{' '}
                {server.running ? 'Running' : 'Stopped'}
              </span>
            ) : (
              <span className="tag-status tag-available">Catalog</span>
            )}
          </div>
          {server ? (
            <>
              <div className="mailbox-summary">
                <div>
                  <strong>{inboxCount}</strong>
                  <span>Inbox</span>
                </div>
                <div>
                  <strong>{sentCount}</strong>
                  <span>Sent</span>
                </div>
                <div>
                  <strong>{events.length}</strong>
                  <span>Tool calls</span>
                </div>
              </div>
              <div className="server-panel-actions">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={onToggleServer}
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : server.running ? (
                    <Square size={13} />
                  ) : (
                    <Play size={15} />
                  )}
                  {server.running ? 'Stop server' : 'Start server'}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => onNavigate('Live Inspector')}
                >
                  <Activity size={15} /> Inspect
                </button>
              </div>
              {server.running && server.endpoint && (
                <div className="endpoint-inline">
                  <code>{server.endpoint}</code>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Copy MCP endpoint"
                    onClick={onCopyEndpoint}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Copy MCP config"
                    onClick={onCopyConfig}
                  >
                    <FileText size={14} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="server-empty">
              <p>
                Add the Email mock to create a realistic inbox for your agent.
              </p>
              <button
                className="button button-primary"
                type="button"
                onClick={onAddServer}
                disabled={busy}
              >
                <Plus size={15} /> Add Email server
              </button>
            </div>
          )}
        </section>

        <section className="panel activity-summary-panel">
          <div className="panel-heading">
            <div className="panel-heading-icon activity-icon">
              <Activity size={17} />
            </div>
            <div className="panel-heading-copy">
              <h3>Live activity</h3>
              <span>Actual MCP tool executions</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Open Live Inspector"
              onClick={() => onNavigate('Live Inspector')}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          {latestEvent ? (
            <div className="latest-event">
              <div className="latest-event-top">
                <span
                  className={`result-indicator ${latestEvent.success ? 'result-success' : 'result-error'}`}
                />
                <strong>{latestEvent.toolName}</strong>
                <span className="event-duration">
                  {latestEvent.durationMs} ms
                </span>
              </div>
              <div className="latest-event-meta">
                <span>
                  {new Date(latestEvent.createdAt).toLocaleTimeString()}
                </span>
                <span>
                  {latestEvent.success
                    ? 'Completed successfully'
                    : latestEvent.error}
                </span>
              </div>
              <pre className="mini-json">
                {JSON.stringify(latestEvent.input, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="activity-empty">
              <span className="activity-empty-mark">
                <Zap size={17} />
              </span>
              <strong>Waiting for your first tool call</strong>
              <span>Connect an MCP client and try a real request.</span>
            </div>
          )}
        </section>
      </div>

      <section className="panel mailbox-panel">
        <div className="mailbox-header">
          <div>
            <h2 className="section-title">Mailbox preview</h2>
            <p className="section-subtitle">
              Changes made by your agent show up here.
            </p>
          </div>
          {server && (
            <div className="mailbox-header-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => onNavigate('Email Studio')}
              >
                <Wrench size={14} /> Customize mailbox
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={onReset}
              >
                <Trash2 size={14} /> Reset mock data
              </button>
            </div>
          )}
        </div>
        {server ? (
          <>
            <div className="mailbox-tabs">
              {['Inbox', 'Sent', 'Drafts'].map((name) => {
                const count = emails.filter(
                  (email) => email.folder === name
                ).length
                return (
                  <button
                    className={`mailbox-tab ${folder === name ? 'active' : ''}`}
                    key={name}
                    type="button"
                    onClick={() => onFolderChange(name)}
                  >
                    {name === 'Inbox' ? (
                      <Inbox size={14} />
                    ) : name === 'Sent' ? (
                      <ArrowRight size={14} />
                    ) : (
                      <FileText size={14} />
                    )}
                    {name}
                    <span>{count}</span>
                  </button>
                )
              })}
            </div>
            <EmailList
              emails={emails.filter((email) => email.folder === folder)}
            />
          </>
        ) : (
          <div className="mailbox-disabled">
            <FolderOpen size={17} />
            <span>Add the Email mock server to preview mailbox data.</span>
          </div>
        )}
      </section>
    </>
  )
}

function EmailList({ emails }: { emails: EmailMessage[] }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (emails.length === 0) {
    return (
      <div className="mailbox-empty-state">
        <div className="mailbox-empty-icon">
          <Mail size={18} />
        </div>
        <strong>This folder is quiet</strong>
        <span>Messages created by your agent will appear here.</span>
      </div>
    )
  }
  const filtered = emails.filter((email) =>
    [email.fromName, email.fromEmail, email.toEmail, email.subject, email.body]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const selected =
    filtered.find((email) => email.id === selectedId) ?? filtered[0]

  return (
    <div className="mailbox-browser">
      <div className="mailbox-browser-toolbar">
        <label className="mailbox-search">
          <Search size={14} />
          <input
            type="search"
            aria-label="Search this mailbox folder"
            placeholder="Search sender, subject, or message"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear mailbox search"
              onClick={() => setQuery('')}
            >
              <X size={13} />
            </button>
          )}
        </label>
        <span className="mailbox-result-count">
          {filtered.length} {filtered.length === 1 ? 'message' : 'messages'}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="mailbox-empty-state mailbox-search-empty">
          <Search size={17} />
          <strong>No matching messages</strong>
          <span>Try a different name, subject, or phrase.</span>
        </div>
      ) : (
        <div className="mailbox-browser-grid">
          <div className="email-list" aria-label="Messages">
            {filtered.map((email) => (
              <button
                className={`email-row ${selected?.id === email.id ? 'selected' : ''}`}
                key={email.id}
                type="button"
                aria-pressed={selected?.id === email.id}
                onClick={() => setSelectedId(email.id)}
              >
                <div className="email-avatar">
                  {(email.folder === 'Sent' ? 'A' : email.fromName)
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
                <div className="email-row-content">
                  <div className="email-row-top">
                    <strong>
                      {email.folder === 'Sent'
                        ? `To ${email.toEmail}`
                        : email.fromName}
                    </strong>
                    <span>
                      {new Date(email.sentAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric'
                      })}
                    </span>
                  </div>
                  <div className="email-subject">{email.subject}</div>
                  <div className="email-excerpt">{email.body}</div>
                </div>
              </button>
            ))}
          </div>
          {selected && (
            <article className="email-preview">
              <div className="email-preview-heading">
                <span className="email-folder-badge">{selected.folder}</span>
                <time dateTime={selected.sentAt}>
                  {new Date(selected.sentAt).toLocaleString(undefined, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </time>
              </div>
              <h3>{selected.subject}</h3>
              <div className="email-address-card">
                <div className="email-avatar email-avatar-large">
                  {selected.fromName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <strong>{selected.fromName}</strong>
                  <span>{selected.fromEmail}</span>
                  <small>To {selected.toEmail}</small>
                </div>
              </div>
              <div className="email-preview-body">{selected.body}</div>
              {selected.parentEmailId && (
                <span className="email-thread-note">
                  <ArrowRight size={12} /> Reply in an existing conversation
                </span>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  )
}

function InspectorPage({
  events,
  allEvents,
  selectedEventId,
  onSelectEvent,
  search,
  onSearch,
  toolFilter,
  onToolFilter,
  statusFilter,
  onStatusFilter,
  availableTools,
  livePaused
}: {
  events: ExecutionEvent[]
  allEvents: ExecutionEvent[]
  selectedEventId: string | null
  onSelectEvent: (id: string | null) => void
  search: string
  onSearch: (value: string) => void
  toolFilter: string
  onToolFilter: (value: string) => void
  statusFilter: string
  onStatusFilter: (value: string) => void
  availableTools: string[]
  livePaused: boolean
}) {
  const selected = allEvents.find((event) => event.id === selectedEventId)
  const successCount = allEvents.filter((event) => event.success).length
  const failureCount = allEvents.length - successCount
  return (
    <>
      <div className="inspector-stats">
        <div className="stat-card">
          <span>Captured calls</span>
          <strong>{allEvents.length}</strong>
          <Activity size={17} />
        </div>
        <div className="stat-card">
          <span>Successful</span>
          <strong>{successCount}</strong>
          <Check size={17} className="stat-good" />
        </div>
        <div className="stat-card">
          <span>Failed</span>
          <strong>{failureCount}</strong>
          <X size={17} className="stat-bad" />
        </div>
        <div className="stat-card">
          <span>Stream</span>
          <strong className="stat-stream">
            {livePaused ? 'Paused' : 'Live'}
          </strong>
          <span className={`status-dot ${livePaused ? '' : 'running'}`} />
        </div>
      </div>
      <div className="panel inspector-panel">
        <div className="inspector-toolbar">
          <label className="search-field">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search calls or arguments…"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => onSearch('')}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <select
            value={toolFilter}
            onChange={(event) => onToolFilter(event.target.value)}
            aria-label="Filter by tool"
          >
            <option value="">All tools</option>
            {availableTools.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilter(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
          <span className="result-count">
            {events.length} {events.length === 1 ? 'result' : 'results'}
          </span>
        </div>
        <div className={`execution-layout ${selected ? 'with-details' : ''}`}>
          <div className="execution-list">
            {events.length === 0 ? (
              <div className="inspector-empty">
                <div className="inspector-empty-icon">
                  <Activity size={20} />
                </div>
                <strong>
                  {allEvents.length
                    ? 'No calls match these filters'
                    : 'The inspector is ready'}
                </strong>
                <span>
                  {allEvents.length
                    ? 'Try changing your search or filters.'
                    : 'Start the Email server and connect an MCP client to see real tool calls here.'}
                </span>
              </div>
            ) : (
              events.map((event) => (
                <button
                  className={`execution-row ${selectedEventId === event.id ? 'selected' : ''}`}
                  type="button"
                  key={event.id}
                  onClick={() =>
                    onSelectEvent(
                      selectedEventId === event.id ? null : event.id
                    )
                  }
                >
                  <span
                    className={`result-indicator ${event.success ? 'result-success' : 'result-error'}`}
                  />
                  <div className="execution-row-main">
                    <div className="execution-row-title">
                      <strong>{event.toolName}</strong>
                      <span>{event.serverName}</span>
                    </div>
                    <div className="execution-row-preview">
                      {JSON.stringify(event.input)}
                    </div>
                  </div>
                  <div className="execution-row-meta">
                    <span>{event.durationMs} ms</span>
                    <time>
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </time>
                  </div>
                </button>
              ))
            )}
          </div>
          {selected && (
            <aside className="event-details">
              <div className="event-details-header">
                <div>
                  <span className="eyebrow">TOOL EXECUTION</span>
                  <h3>{selected.toolName}</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close event details"
                  onClick={() => onSelectEvent(null)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="detail-meta">
                <span
                  className={`detail-status ${selected.success ? 'success' : 'failure'}`}
                >
                  {selected.success ? 'Success' : 'Failed'}
                </span>
                <span>
                  <Clock3 size={12} /> {selected.durationMs} ms
                </span>
                <time>{new Date(selected.createdAt).toLocaleString()}</time>
              </div>
              <JsonBlock title="INPUT ARGUMENTS" value={selected.input} />
              <JsonBlock title="OUTPUT RESULT" value={selected.output} />
              {selected.error && (
                <div className="event-error-detail">
                  <strong>Error</strong>
                  <span>{selected.error}</span>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
      <div className="inspector-footnote">
        <ShieldCheck size={14} /> Only observable MCP tool inputs and results
        are captured. Private model reasoning is never collected.
      </div>
    </>
  )
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="json-block">
      <span className="json-title">{title}</span>
      <pre>{JSON.stringify(value, null, 2) ?? 'null'}</pre>
    </div>
  )
}

function SettingsPage({
  theme,
  onThemeChange
}: {
  theme: 'light' | 'dark'
  onThemeChange: () => void
}) {
  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <div className="settings-card-heading">
          <div className="panel-heading-icon activity-icon">
            <Sun size={16} />
          </div>
          <div>
            <h3>Appearance</h3>
            <span>Choose how Mockarium looks on this device.</span>
          </div>
        </div>
        <div className="settings-control-row">
          <div>
            <strong>Color theme</strong>
            <span>Saved locally in your app preferences.</span>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={onThemeChange}
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </button>
        </div>
      </section>
      <section className="panel settings-card">
        <div className="settings-card-heading">
          <div className="panel-heading-icon email-icon">
            <ShieldCheck size={16} />
          </div>
          <div>
            <h3>Privacy &amp; safety</h3>
            <span>How this local environment handles your data.</span>
          </div>
        </div>
        <div className="privacy-list">
          <div>
            <Check size={14} />
            <span>Workspace data stays on this device.</span>
          </div>
          <div>
            <Check size={14} />
            <span>MCP servers bind to loopback only.</span>
          </div>
          <div>
            <Check size={14} />
            <span>Mock connectors never call production services.</span>
          </div>
          <div>
            <Check size={14} />
            <span>No telemetry or account is required.</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function ComingSoon({
  title,
  description
}: {
  title: string
  description: string
}) {
  return (
    <div className="coming-soon">
      <div className="coming-icon">
        <Clock3 size={19} />
      </div>
      <span className="eyebrow">PLANNED FOR A FUTURE MILESTONE</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="coming-boundary">
        <ShieldCheck size={14} /> This feature is not implemented in the current
        release.
      </div>
    </div>
  )
}

function WorkspaceDialog({
  mode,
  name,
  busy,
  error,
  onNameChange,
  onSubmit,
  onClose
}: {
  mode: Exclude<DialogMode, null>
  name: string
  busy: boolean
  error: string
  onNameChange: (name: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        className="workspace-dialog"
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dialog-title"
      >
        <div className="dialog-top">
          <div className="dialog-icon">
            <FolderOpen size={18} />
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>
        <h2 id="workspace-dialog-title">
          {mode === 'create' ? 'Create a workspace' : 'Rename workspace'}
        </h2>
        <p>
          {mode === 'create'
            ? 'Give your simulated environment a name. You can add mock systems next.'
            : 'Choose a name that helps you find this environment.'}
        </p>
        <label className="form-label" htmlFor="workspace-name">
          Workspace name
        </label>
        <input
          autoFocus
          id="workspace-name"
          className="text-input"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="e.g. Supplier research"
          maxLength={80}
          required
        />
        {error && (
          <div className="dialog-error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={!name.trim() || busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : mode === 'create' ? (
              <Plus size={15} />
            ) : (
              <Check size={15} />
            )}
            {mode === 'create' ? 'Create workspace' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default App
