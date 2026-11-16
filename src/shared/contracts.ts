export interface Workspace {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface MockServer {
  id: string
  workspaceId: string
  type: 'email'
  name: string
  createdAt: string
  running: boolean
  endpoint: string | null
}

export interface EmailMessage {
  id: string
  workspaceId: string
  folder: string
  fromName: string
  fromEmail: string
  toEmail: string
  subject: string
  body: string
  sentAt: string
  parentEmailId: string | null
}

export interface ExecutionEvent {
  id: string
  workspaceId: string
  serverName: string
  toolName: string
  input: Record<string, unknown>
  output: unknown
  durationMs: number
  success: boolean
  error: string | null
  createdAt: string
}

export interface InitialState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  servers: MockServer[]
  events: ExecutionEvent[]
  emails: EmailMessage[]
}

export interface MockariumApi {
  getInitialState(): Promise<InitialState>
  createWorkspace(name: string): Promise<Workspace>
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>
  selectWorkspace(workspaceId: string): Promise<InitialState>
  deleteWorkspace(workspaceId: string): Promise<void>
  addEmailServer(workspaceId: string): Promise<MockServer>
  startEmailServer(workspaceId: string, serverId: string): Promise<MockServer>
  stopEmailServer(workspaceId: string, serverId: string): Promise<MockServer>
  resetEmailServer(workspaceId: string): Promise<void>
  getEmails(workspaceId: string, folder?: string): Promise<EmailMessage[]>
  getEvents(workspaceId: string, limit?: number): Promise<ExecutionEvent[]>
  onExecutionEvent(callback: (event: ExecutionEvent) => void): () => void
}
