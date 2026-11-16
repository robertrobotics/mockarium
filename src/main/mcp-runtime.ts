import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage
} from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { ExecutionEvent, MockServer } from '../shared/contracts'
import { AppDatabase } from './database'
import { registerEmailTools } from './email-service'

interface RunningServer {
  workspaceId: string
  server: HttpServer
  endpoint: string
  sessions: Set<() => Promise<void>>
}

export class McpRuntime {
  private readonly running = new Map<string, RunningServer>()

  constructor(
    private readonly database: AppDatabase,
    private readonly onExecutionEvent: (event: ExecutionEvent) => void
  ) {}

  async startEmailServer(
    workspaceId: string,
    serverId: string
  ): Promise<MockServer> {
    const storedServer = this.database.getEmailServer(workspaceId)
    if (!storedServer || storedServer.id !== serverId) {
      throw new Error('Email mock server was not found in this workspace.')
    }

    const existing = this.running.get(serverId)
    if (existing) return this.asMockServer(storedServer, existing.endpoint)

    const sessions = new Set<() => Promise<void>>()
    const httpServer = createServer((request, response) => {
      void this.handleRequest(request, response, workspaceId, sessions)
    })

    const address = await new Promise<{ address: string; port: number }>(
      (resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.off('error', reject)
          const boundAddress = httpServer.address()
          if (!boundAddress || typeof boundAddress === 'string') {
            reject(new Error('Could not determine the MCP server address.'))
            return
          }
          resolve(boundAddress)
        })
      }
    )
    const endpoint = `http://127.0.0.1:${address.port}/mcp`
    this.running.set(serverId, {
      workspaceId,
      server: httpServer,
      endpoint,
      sessions
    })
    return this.asMockServer(storedServer, endpoint)
  }

  async stopEmailServer(
    workspaceId: string,
    serverId: string
  ): Promise<MockServer> {
    const storedServer = this.database.getEmailServer(workspaceId)
    if (!storedServer || storedServer.id !== serverId) {
      throw new Error('Email mock server was not found in this workspace.')
    }
    const active = this.running.get(serverId)
    if (active) {
      if (active.workspaceId !== workspaceId)
        throw new Error('Server workspace mismatch.')
      this.running.delete(serverId)
      await Promise.all(
        [...active.sessions].map((closeSession) => closeSession())
      )
      await new Promise<void>((resolve, reject) => {
        active.server.close((error) => (error ? reject(error) : resolve()))
      })
    }
    return this.asMockServer(storedServer, null)
  }

  async stopWorkspace(workspaceId: string): Promise<void> {
    const servers = [...this.running.entries()].filter(
      ([, active]) => active.workspaceId === workspaceId
    )
    await Promise.all(
      servers.map(([serverId]) => this.stopEmailServer(workspaceId, serverId))
    )
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.running.entries()].map(([serverId, active]) =>
        this.stopEmailServer(active.workspaceId, serverId)
      )
    )
  }

  getServer(workspaceId: string, serverId: string): MockServer | null {
    const storedServer = this.database.getEmailServer(workspaceId)
    if (!storedServer || storedServer.id !== serverId) return null
    const active = this.running.get(serverId)
    return this.asMockServer(storedServer, active?.endpoint ?? null)
  }

  isWorkspaceRunning(workspaceId: string): boolean {
    return [...this.running.values()].some(
      (server) => server.workspaceId === workspaceId
    )
  }

  private async handleRequest(
    request: IncomingMessage,
    response: import('node:http').ServerResponse,
    workspaceId: string,
    sessions: Set<() => Promise<void>>
  ): Promise<void> {
    if (request.url !== '/mcp') {
      response.writeHead(404).end('Not found')
      return
    }
    if (request.method !== 'POST' && request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET, POST' }).end('Method not allowed')
      return
    }
    if (!isAllowedOrigin(request.headers.origin)) {
      response.writeHead(403).end('Forbidden origin')
      return
    }
    const transport = new StreamableHTTPServerTransport()
    const mcpServer = registerEmailTools(
      this.database,
      workspaceId,
      this.onExecutionEvent
    )
    let closePromise: Promise<void> | null = null
    const closeSession = (): Promise<void> => {
      if (!closePromise) {
        sessions.delete(closeSession)
        closePromise = mcpServer.close()
      }
      return closePromise
    }
    try {
      await mcpServer.connect(transport)
      await transport.handleRequest(request, response)
      if (
        request.method === 'GET' &&
        !response.destroyed &&
        !response.writableEnded
      ) {
        sessions.add(closeSession)
        response.once('close', () => {
          void closeSession().catch((error: unknown) => {
            console.error('Failed to close MCP client stream.', error)
          })
        })
        return
      }
    } catch (error) {
      console.error('MCP request handling failed.', error)
      if (!response.headersSent)
        response.writeHead(500).end('MCP request failed')
      else response.destroy(error instanceof Error ? error : undefined)
    }
    await closeSession().catch((error: unknown) => {
      console.error('Failed to close request-scoped MCP server.', error)
    })
  }

  private asMockServer(
    stored: Omit<MockServer, 'running' | 'endpoint'>,
    endpoint: string | null
  ): MockServer {
    return { ...stored, running: endpoint !== null, endpoint }
  }
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      loopbackHosts.has(parsed.hostname.toLowerCase()) &&
      parsed.username === '' &&
      parsed.password === ''
    )
  } catch {
    return false
  }
}
