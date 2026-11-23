import { useEffect, useState } from 'react'
import { Copy, LoaderCircle, Search, Wrench } from 'lucide-react'
import type { McpToolInfo, MockServer } from '../../shared/contracts'

function schemaObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function inputSummary(value: unknown): string {
  const schema = schemaObject(value)
  const parts: string[] = []
  if (typeof schema.type === 'string') parts.push(schema.type)
  if (typeof schema.format === 'string') parts.push(schema.format)
  if (Array.isArray(schema.enum))
    parts.push(schema.enum.map(String).join(' / '))
  if (schema.default !== undefined)
    parts.push(`default: ${JSON.stringify(schema.default)}`)
  if (typeof schema.minimum === 'number') parts.push(`min: ${schema.minimum}`)
  if (typeof schema.maximum === 'number') parts.push(`max: ${schema.maximum}`)
  if (typeof schema.maxLength === 'number')
    parts.push(`up to ${schema.maxLength} characters`)
  if (typeof schema.description === 'string') parts.push(schema.description)
  return parts.join(' · ') || 'See the input schema below.'
}

export function ToolExplorer({
  server
}: {
  server: MockServer
}): React.JSX.Element {
  const [tools, setTools] = useState<McpToolInfo[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    void window.mockarium
      .getMockServerTools(server.workspaceId, server.id)
      .then((result) => {
        if (active) setTools(result)
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      active = false
    }
  }, [server.workspaceId, server.id, attempt])

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`${label} copied`)
      setError('')
    } catch (caught) {
      setNotice('')
      setError(
        `Could not copy ${label.toLowerCase()}: ${caught instanceof Error ? caught.message : String(caught)}`
      )
    }
  }
  const search = query.trim().toLowerCase()
  const visibleTools =
    tools?.filter((tool) =>
      `${tool.name} ${tool.description} ${Object.keys(tool.inputSchema.properties ?? {}).join(' ')}`
        .toLowerCase()
        .includes(search)
    ) ?? []

  return (
    <section
      className="panel tool-explorer"
      aria-label={`${server.name} available tools`}
    >
      <details className="tool-explorer-disclosure">
        <summary className="tool-explorer-heading">
          <div>
            <span className="eyebrow">
              <Wrench size={12} /> AGENT TOOLKIT
            </span>
            <h3>Explore what your agent can do</h3>
          </div>
          <span className="tool-explorer-summary-actions">
            <span className="tool-explorer-count">
              {tools
                ? `${tools.length} tools`
                : error
                  ? 'Unavailable'
                  : 'Loading…'}
            </span>
            <span className="tool-explorer-disclosure-label" />
          </span>
        </summary>
        <div className="tool-explorer-content">
          <p className="tool-explorer-intro">
            These are the actual tools exposed by this studio. Open a tool to
            see its inputs. They all use the same MCP endpoint, not separate
            URLs.
          </p>
          <div className="tool-explorer-toolbar">
            <label className="tool-explorer-search">
              <Search size={14} />
              <input
                aria-label="Search available tools"
                placeholder="Search tools or inputs…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
              />
            </label>
            <span>
              Available to browse{' '}
              {server.running ? 'while running' : 'before starting the server'}
            </span>
          </div>
          {error && (
            <div className="tool-explorer-error" role="alert">
              {error}
              {!tools && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setError('')
                    setAttempt((value) => value + 1)
                  }}
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {notice && (
            <div className="tool-explorer-notice" role="status">
              {notice}
            </div>
          )}
          {!tools && !error ? (
            <div className="tool-explorer-empty" role="status">
              <LoaderCircle className="spin" size={16} /> Reading tool
              definitions…
            </div>
          ) : tools && visibleTools.length === 0 ? (
            <div className="tool-explorer-empty">
              {tools.length === 0
                ? 'This server exposes no tools.'
                : 'No tools match your search.'}
            </div>
          ) : (
            <div className="tool-explorer-grid">
              {visibleTools.map((tool) => {
                const inputs = Object.entries(tool.inputSchema.properties ?? {})
                const required = new Set(tool.inputSchema.required ?? [])
                return (
                  <details className="tool-explorer-tool" key={tool.name}>
                    <summary>
                      <div className="tool-explorer-tool-title">
                        <code>{tool.name}()</code>
                        <span>
                          {inputs.length
                            ? `${inputs.length} ${inputs.length === 1 ? 'input' : 'inputs'}`
                            : 'No inputs'}
                        </span>
                      </div>
                      <p>{tool.description}</p>
                      <span className="tool-explorer-expand">
                        View inputs &amp; schema
                      </span>
                    </summary>
                    <div className="tool-explorer-tool-body">
                      {inputs.length === 0 ? (
                        <p>
                          No arguments needed. Your agent calls this tool with{' '}
                          <code>{'{}'}</code>.
                        </p>
                      ) : (
                        <dl className="tool-explorer-inputs">
                          {inputs.map(([name, schema]) => (
                            <div key={name}>
                              <dt>
                                <code>{name}</code>
                                <span>
                                  {required.has(name) ? 'Required' : 'Optional'}
                                </span>
                              </dt>
                              <dd>{inputSummary(schema)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                      <div className="tool-explorer-copy-actions">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => void copy(tool.name, 'Tool name')}
                        >
                          <Copy size={12} /> Copy name
                        </button>
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            void copy(
                              JSON.stringify(tool.inputSchema, null, 2),
                              'Input schema'
                            )
                          }
                        >
                          <Copy size={12} /> Copy schema
                        </button>
                      </div>
                      <details className="tool-explorer-schema">
                        <summary>Full input schema · JSON</summary>
                        <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                      </details>
                    </div>
                  </details>
                )
              })}
            </div>
          )}
          <p className="tool-explorer-footnote">
            Customize the mock data and identity in this studio to change what
            these tools return. Tool names and input definitions are built in;
            this view does not run tools or send requests to an external agent.
          </p>
        </div>
      </details>
    </section>
  )
}
