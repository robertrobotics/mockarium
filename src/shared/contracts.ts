export interface Workspace {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface MockServer {
  id: string
  workspaceId: string
  type: 'email' | 'database' | 'calendar'
  name: string
  createdAt: string
  running: boolean
  endpoint: string | null
}

export type DatabaseFieldType =
  'text' | 'email' | 'number' | 'boolean' | 'date' | 'relation'

export interface DatabaseField {
  id: string
  name: string
  label: string
  type: DatabaseFieldType
  required: boolean
  relationTo?: string | undefined
}

export interface DatabaseTable {
  id: string
  name: string
  label: string
  fields: DatabaseField[]
}

export interface DatabaseModel {
  tables: DatabaseTable[]
}

export interface DatabaseRecord {
  id: string
  values: Record<string, unknown>
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

export interface EmailMessageInput {
  folder: string
  fromName: string
  fromEmail: string
  toEmail: string
  subject: string
  body: string
  sentAt: string
  parentEmailId: string | null
}

export interface EmailProfile {
  name: string
  email: string
}

export interface EmailContact {
  name: string
  email: string
  company: string
}

export type CalendarResponse =
  'needsAction' | 'accepted' | 'declined' | 'tentative'

export interface CalendarAttendee {
  email: string
  response: CalendarResponse
}

export interface CalendarProfile {
  name: string
  email: string
  timeZone: string
  workStart: string
  workEnd: string
  currentTime: string
}

export interface CalendarPersonInput {
  name: string
  email: string
  company: string
  timeZone: string
  workStart: string
  workEnd: string
}

export interface CalendarPerson extends CalendarPersonInput {
  id: string
}

export interface CalendarEventInput {
  title: string
  description: string
  location: string
  startAt: string
  endAt: string
  organizerEmail: string
  attendees: CalendarAttendee[]
  status: 'confirmed' | 'cancelled'
}

export interface CalendarEvent extends CalendarEventInput {
  id: string
  updatedAt: string
  updatedBy: 'studio' | 'agent'
}

export interface CalendarState {
  profile: CalendarProfile
  people: CalendarPerson[]
  events: CalendarEvent[]
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

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown> | undefined
    required?: string[] | undefined
    [key: string]: unknown
  }
}

export interface InitialState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  servers: MockServer[]
  events: ExecutionEvent[]
  emails: EmailMessage[]
  databaseModel: DatabaseModel | null
}

export interface MockariumApi {
  getInitialState(): Promise<InitialState>
  createWorkspace(name: string): Promise<Workspace>
  renameWorkspace(workspaceId: string, name: string): Promise<Workspace>
  selectWorkspace(workspaceId: string): Promise<InitialState>
  deleteWorkspace(workspaceId: string): Promise<void>
  addEmailServer(workspaceId: string): Promise<MockServer>
  addDatabaseServer(workspaceId: string): Promise<MockServer>
  startMockServer(workspaceId: string, serverId: string): Promise<MockServer>
  stopMockServer(workspaceId: string, serverId: string): Promise<MockServer>
  getMockServerTools(
    workspaceId: string,
    serverId: string
  ): Promise<McpToolInfo[]>
  resetEmailServer(workspaceId: string): Promise<void>
  getDatabaseModel(workspaceId: string): Promise<DatabaseModel | null>
  saveDatabaseModel(
    workspaceId: string,
    model: DatabaseModel
  ): Promise<DatabaseModel>
  getDatabaseRecords(
    workspaceId: string,
    tableName: string
  ): Promise<DatabaseRecord[]>
  saveDatabaseRecord(
    workspaceId: string,
    tableName: string,
    recordId: string | null,
    values: Record<string, unknown>
  ): Promise<DatabaseRecord>
  deleteDatabaseRecord(
    workspaceId: string,
    tableName: string,
    recordId: string
  ): Promise<void>
  resetDatabase(workspaceId: string): Promise<void>
  getEmailProfile(workspaceId: string): Promise<EmailProfile>
  saveEmailProfile(
    workspaceId: string,
    profile: EmailProfile
  ): Promise<EmailProfile>
  getEmailFolders(workspaceId: string): Promise<string[]>
  addEmailFolder(workspaceId: string, name: string): Promise<string[]>
  deleteEmailFolder(workspaceId: string, name: string): Promise<string[]>
  getEmailContacts(workspaceId: string): Promise<EmailContact[]>
  saveEmailContact(
    workspaceId: string,
    existingEmail: string | null,
    contact: EmailContact
  ): Promise<EmailContact[]>
  deleteEmailContact(
    workspaceId: string,
    email: string
  ): Promise<EmailContact[]>
  saveEmail(
    workspaceId: string,
    emailId: string | null,
    email: EmailMessageInput
  ): Promise<EmailMessage>
  deleteEmail(workspaceId: string, emailId: string): Promise<void>
  getEmails(workspaceId: string, folder?: string): Promise<EmailMessage[]>
  addCalendarServer(workspaceId: string): Promise<MockServer>
  getCalendar(workspaceId: string): Promise<CalendarState | null>
  saveCalendarProfile(
    workspaceId: string,
    profile: CalendarProfile
  ): Promise<CalendarState>
  saveCalendarPerson(
    workspaceId: string,
    personId: string | null,
    person: CalendarPersonInput
  ): Promise<CalendarState>
  deleteCalendarPerson(
    workspaceId: string,
    personId: string
  ): Promise<CalendarState>
  saveCalendarEvent(
    workspaceId: string,
    eventId: string | null,
    event: CalendarEventInput
  ): Promise<CalendarState>
  deleteCalendarEvent(
    workspaceId: string,
    eventId: string
  ): Promise<CalendarState>
  resetCalendar(workspaceId: string): Promise<void>
  getEvents(workspaceId: string, limit?: number): Promise<ExecutionEvent[]>
  onExecutionEvent(callback: (event: ExecutionEvent) => void): () => void
}
