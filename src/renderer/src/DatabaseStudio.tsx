import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Database,
  GitBranch,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Table2,
  Trash2
} from 'lucide-react'
import type {
  DatabaseField,
  DatabaseFieldType,
  DatabaseModel,
  DatabaseRecord,
  DatabaseTable,
  MockServer
} from '../../shared/contracts'
import { ToolExplorer } from './ToolExplorer'

const fieldTypes: Array<{ value: DatabaseFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'date', label: 'Date' },
  { value: 'relation', label: 'Link to table' }
]

interface EditableRecord extends DatabaseRecord {
  localId: string
  isNew: boolean
  dirty: boolean
}

interface DatabaseStudioProps {
  model: DatabaseModel | null
  server: MockServer | null
  busy: boolean
  revision: number
  onAddServer: () => void
  onToggleServer: () => void
  onReset: () => void
  onCopyEndpoint: () => void
  onCopyConfig: () => void
  onOpenInspector: () => void
  onSaveModel: (model: DatabaseModel) => Promise<DatabaseModel>
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function uniqueName(label: string, names: string[]): string {
  const base = (slug(label) || 'field').slice(0, 35)
  if (!names.includes(base)) return base
  let suffix = 2
  while (names.includes(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function defaultValue(field: DatabaseField): unknown {
  switch (field.type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'relation':
      return null
    default:
      return ''
  }
}

function makeEditable(record: DatabaseRecord): EditableRecord {
  return {
    ...record,
    localId: record.id,
    isNew: false,
    dirty: false
  }
}

function makeDraft(table: DatabaseTable): EditableRecord {
  return {
    id: '',
    localId: crypto.randomUUID(),
    isNew: true,
    dirty: true,
    values: Object.fromEntries(
      table.fields.map((field) => [field.name, defaultValue(field)])
    )
  }
}

function recordTitle(record: DatabaseRecord, table: DatabaseTable): string {
  const titleField = table.fields.find(
    (field) =>
      field.type === 'text' ||
      field.type === 'email' ||
      field.type === 'relation'
  )
  const value = titleField ? record.values[titleField.name] : undefined
  if (typeof value === 'string') return value
  const firstValue = Object.values(record.values)[0]
  return typeof firstValue === 'string' || typeof firstValue === 'number'
    ? String(firstValue)
    : record.id
}

export function DatabaseStudio({
  model,
  server,
  busy,
  revision,
  onAddServer,
  onToggleServer,
  onReset,
  onCopyEndpoint,
  onCopyConfig,
  onOpenInspector,
  onSaveModel
}: DatabaseStudioProps) {
  const [modelState, setModelState] = useState<{
    source: DatabaseModel | null
    value: DatabaseModel | null
  }>(() => ({ source: model, value: model }))
  if (modelState.source !== model) {
    setModelState({ source: model, value: model })
  }
  const draftModel = modelState.value
  const setDraftModel: Dispatch<SetStateAction<DatabaseModel | null>> = (
    update
  ) => {
    setModelState((current) => ({
      source: current.source,
      value: typeof update === 'function' ? update(current.value) : update
    }))
  }
  const [selectedTableName, setSelectedTableName] = useState('')
  const [rows, setRows] = useState<EditableRecord[]>([])
  const [relatedRows, setRelatedRows] = useState<
    Record<string, DatabaseRecord[]>
  >({})
  const [loadedDataKey, setLoadedDataKey] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  const [savingRecordId, setSavingRecordId] = useState<string | null>(null)
  const [modelError, setModelError] = useState('')
  const [recordError, setRecordError] = useState('')
  const [newTableLabel, setNewTableLabel] = useState('')
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<DatabaseFieldType>('text')
  const [relationshipTarget, setRelationshipTarget] = useState('')

  const selectedTable = useMemo(
    () =>
      draftModel?.tables.find((table) => table.name === selectedTableName) ??
      draftModel?.tables[0] ??
      null,
    [draftModel, selectedTableName]
  )
  const relationshipTargets =
    draftModel?.tables.filter((table) => table.name !== selectedTable?.name) ??
    []
  const relationshipTargetName = relationshipTargets.some(
    (table) => table.name === relationshipTarget
  )
    ? relationshipTarget
    : (relationshipTargets[0]?.name ?? '')
  const workspaceId = server?.workspaceId ?? ''
  const tableName = selectedTable?.name ?? ''
  const persistedTableNames = new Set(model?.tables.map((table) => table.name))
  const relationNamesKey = [
    ...new Set(
      selectedTable?.fields
        .filter((field) => field.type === 'relation' && field.relationTo)
        .map((field) => field.relationTo!)
        .filter((name) => persistedTableNames.has(name)) ?? []
    )
  ]
    .sort()
    .join(',')
  const currentDataKey =
    workspaceId && tableName
      ? `${workspaceId}/${tableName}/${revision}/${model?.tables.map((table) => table.name).join(',') ?? ''}/${relationNamesKey}`
      : ''
  const recordsLoading =
    currentDataKey !== '' && loadedDataKey !== currentDataKey

  useEffect(() => {
    let active = true
    if (!workspaceId || !tableName) return
    const relatedTableNames = relationNamesKey
      ? relationNamesKey.split(',')
      : []
    const requestKey = currentDataKey
    void Promise.all([
      window.mockarium.getDatabaseRecords(workspaceId, tableName),
      ...relatedTableNames.map((name) =>
        window.mockarium.getDatabaseRecords(workspaceId, name)
      )
    ])
      .then(([tableRows, ...relationRows]) => {
        if (!active) return
        setRecordError('')
        setLoadedDataKey(requestKey)
        setRows(tableRows.map(makeEditable))
        setRelatedRows(
          Object.fromEntries(
            relatedTableNames.map((name, index) => [
              name,
              relationRows[index] ?? []
            ])
          )
        )
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadedDataKey(requestKey)
          setRows([])
          setRelatedRows({})
          setRecordError(
            error instanceof Error ? error.message : 'Could not load records.'
          )
        }
      })

    return () => {
      active = false
    }
  }, [workspaceId, tableName, relationNamesKey, currentDataKey, revision])

  const modelChanged =
    !!model &&
    !!draftModel &&
    JSON.stringify(model) !== JSON.stringify(draftModel)

  const updateTable = (tableName: string, change: Partial<DatabaseTable>) => {
    setDraftModel((current) =>
      current
        ? {
            ...current,
            tables: current.tables.map((table) =>
              table.name === tableName ? { ...table, ...change } : table
            )
          }
        : current
    )
  }

  const updateField = (
    tableName: string,
    fieldId: string,
    change: Partial<DatabaseField>
  ) => {
    setDraftModel((current) =>
      current
        ? {
            ...current,
            tables: current.tables.map((table) =>
              table.name === tableName
                ? {
                    ...table,
                    fields: table.fields.map((field) =>
                      field.id === fieldId ? { ...field, ...change } : field
                    )
                  }
                : table
            )
          }
        : current
    )
  }

  const addTable = () => {
    if (
      !draftModel ||
      !newTableLabel.trim() ||
      draftModel.tables.length >= 12
    ) {
      return
    }
    const name = uniqueName(
      newTableLabel,
      draftModel.tables.map((table) => table.name)
    )
    const fieldName = uniqueName('name', [])
    const field: DatabaseField = {
      id: crypto.randomUUID(),
      name: fieldName,
      label: 'Name',
      type: 'text',
      required: true
    }
    const table: DatabaseTable = {
      id: name,
      name,
      label: newTableLabel.trim(),
      fields: [field]
    }
    setDraftModel({ ...draftModel, tables: [...draftModel.tables, table] })
    setSelectedTableName(name)
    setNewTableLabel('')
  }

  const addField = () => {
    if (
      !draftModel ||
      !selectedTable ||
      !newFieldLabel.trim() ||
      selectedTable.fields.length >= 20 ||
      (newFieldType === 'relation' && draftModel.tables.length < 2)
    ) {
      return
    }
    const name = uniqueName(newFieldLabel, [
      'id',
      ...selectedTable.fields.map((field) => field.name)
    ])
    const relationTo =
      newFieldType === 'relation'
        ? draftModel.tables.find((table) => table.name !== selectedTable.name)
            ?.name
        : undefined
    const field: DatabaseField = {
      id: crypto.randomUUID(),
      name,
      label: newFieldLabel.trim(),
      type: newFieldType,
      required: false,
      ...(relationTo ? { relationTo } : {})
    }
    updateTable(selectedTable.name, {
      fields: [...selectedTable.fields, field]
    })
    setNewFieldLabel('')
  }

  const addRelationship = () => {
    if (!draftModel || !selectedTable || selectedTable.fields.length >= 20) {
      return
    }
    const target = draftModel.tables.find(
      (table) => table.name === relationshipTargetName
    )
    if (!target || target.name === selectedTable.name) return
    const label = target.label.endsWith('ies')
      ? `${target.label.slice(0, -3)}y`
      : target.label.endsWith('s') && !target.label.endsWith('ss')
        ? target.label.slice(0, -1)
        : target.label
    const matchingField = selectedTable.fields.find(
      (field) =>
        field.type !== 'relation' &&
        (field.name === slug(label) ||
          field.label.trim().toLowerCase() === label.toLowerCase())
    )
    if (matchingField) {
      if (
        rows.some((row) => {
          const value = row.values[matchingField.name]
          return value !== undefined && value !== null && value !== ''
        })
      ) {
        setModelError(
          `The “${matchingField.label}” field already contains values. Clear them first, or add a separate relationship field.`
        )
        return
      }
      setModelError('')
      updateField(selectedTable.name, matchingField.id, {
        type: 'relation',
        relationTo: target.name
      })
      return
    }
    const name = uniqueName(label, [
      'id',
      ...selectedTable.fields.map((field) => field.name)
    ])
    updateTable(selectedTable.name, {
      fields: [
        ...selectedTable.fields,
        {
          id: crypto.randomUUID(),
          name,
          label,
          type: 'relation',
          required: false,
          relationTo: target.name
        }
      ]
    })
  }

  const removeField = (field: DatabaseField) => {
    if (!selectedTable || selectedTable.fields.length <= 1) return
    if (
      rows.length > 0 &&
      !window.confirm(
        `Remove “${field.label}” and its saved values from ${selectedTable.label}?`
      )
    ) {
      return
    }
    updateTable(selectedTable.name, {
      fields: selectedTable.fields.filter(
        (candidate) => candidate.id !== field.id
      )
    })
  }

  const removeTable = (table: DatabaseTable) => {
    if (!draftModel || draftModel.tables.length <= 1) return
    if (
      !window.confirm(
        `Remove the empty table “${table.label}”? Tables with records cannot be removed.`
      )
    ) {
      return
    }
    setDraftModel({
      ...draftModel,
      tables: draftModel.tables.filter((candidate) => candidate.id !== table.id)
    })
  }

  const saveModel = async () => {
    if (!draftModel) return
    setSavingModel(true)
    setModelError('')
    try {
      const saved = await onSaveModel(draftModel)
      setDraftModel(saved)
    } catch (error) {
      setModelError(
        error instanceof Error ? error.message : 'Could not save this model.'
      )
    } finally {
      setSavingModel(false)
    }
  }

  const updateCell = (localId: string, fieldName: string, value: unknown) => {
    setRows((current) =>
      current.map((row) =>
        row.localId === localId
          ? {
              ...row,
              values: { ...row.values, [fieldName]: value },
              dirty: true
            }
          : row
      )
    )
  }

  const saveRow = async (row: EditableRecord) => {
    if (!selectedTable || !server) return
    setSavingRecordId(row.localId)
    setRecordError('')
    try {
      const saved = await window.mockarium.saveDatabaseRecord(
        server.workspaceId,
        selectedTable.name,
        row.isNew ? null : row.id,
        row.values
      )
      setRows((current) =>
        current.map((candidate) =>
          candidate.localId === row.localId ? makeEditable(saved) : candidate
        )
      )
    } catch (error) {
      setRecordError(
        error instanceof Error ? error.message : 'Could not save this record.'
      )
    } finally {
      setSavingRecordId(null)
    }
  }

  const deleteRow = async (row: EditableRecord) => {
    if (!selectedTable || !server) return
    if (row.isNew) {
      setRows((current) =>
        current.filter((candidate) => candidate.localId !== row.localId)
      )
      return
    }
    if (!window.confirm('Delete this simulated record?')) return
    setRecordError('')
    try {
      await window.mockarium.deleteDatabaseRecord(
        server.workspaceId,
        selectedTable.name,
        row.id
      )
      setRows((current) =>
        current.filter((candidate) => candidate.localId !== row.localId)
      )
    } catch (error) {
      setRecordError(
        error instanceof Error ? error.message : 'Could not delete this record.'
      )
    }
  }

  if (!server || !model || !draftModel) {
    return (
      <div className="database-studio">
        <section className="database-welcome">
          <div className="database-welcome-copy">
            <span className="eyebrow">YOUR FIRST DATABASE, MADE VISUAL</span>
            <h2>Give your agent a little world to work in.</h2>
            <p>
              Start with a friendly business database. Shape the tables, fields,
              and relationships, then watch a real agent explore and update the
              simulated data.
            </p>
            <button
              className="button button-primary"
              type="button"
              onClick={onAddServer}
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              Create my starter database
            </button>
            <span className="database-welcome-footnote">
              <ShieldCheck size={14} /> Safe sample data. No real accounts or
              production systems.
            </span>
          </div>
          <div className="database-visual-preview" aria-hidden="true">
            <div className="preview-table preview-companies">
              <div>
                <span />
                <span />
              </div>
              <strong>Companies</strong>
              <small>name · industry</small>
            </div>
            <div className="preview-table preview-contacts">
              <div>
                <span />
                <span />
              </div>
              <strong>Contacts</strong>
              <small>name · email · company</small>
            </div>
            <div className="preview-table preview-deals">
              <div>
                <span />
                <span />
              </div>
              <strong>Deals</strong>
              <small>name · amount · company</small>
            </div>
            <svg viewBox="0 0 360 235" role="presentation">
              <path d="M170 58 C228 58 219 117 261 117" />
              <path d="M170 166 C226 166 221 117 261 117" />
              <circle cx="170" cy="58" r="4" />
              <circle cx="170" cy="166" r="4" />
              <circle cx="261" cy="117" r="4" />
            </svg>
          </div>
        </section>
        <div className="database-template-note">
          <div className="template-spark">
            <Sparkles size={15} />
          </div>
          <div>
            <strong>Starter world: a tiny client pipeline</strong>
            <span>
              Three connected tables, six believable sample records, and safe
              tools your agent can use right away.
            </span>
          </div>
          <div className="template-pills">
            <span>Companies</span>
            <span>Contacts</span>
            <span>Deals</span>
          </div>
        </div>
      </div>
    )
  }

  const selectedRows = rows
  const relationshipCount = draftModel.tables.reduce(
    (count, table) =>
      count + table.fields.filter((field) => field.type === 'relation').length,
    0
  )

  return (
    <div className="database-studio">
      <section className="database-studio-banner">
        <div className="database-banner-icon">
          <Database size={19} />
        </div>
        <div className="database-banner-copy">
          <span className="eyebrow">DATABASE STUDIO · CLIENT PIPELINE</span>
          <h2>A small world, ready for your agent.</h2>
          <p>Remix the model. Edit the sample data. Let your agent explore.</p>
        </div>
        <div className="database-banner-stats">
          <span>
            <strong>{draftModel.tables.length}</strong> tables
          </span>
          <span>
            <strong>{relationshipCount}</strong> links
          </span>
          <span>
            <strong>{rows.filter((row) => !row.isNew).length}</strong> records
            here
          </span>
        </div>
      </section>

      <section className="database-connection-row">
        <div className="database-connection-card panel">
          <div className="database-connection-icon">
            <Database size={17} />
          </div>
          <div className="database-connection-copy">
            <span className="eyebrow">REAL AGENT · FAKE DATABASE</span>
            <strong>
              {server.running
                ? 'Your database is ready to explore'
                : 'Start the database for your agent'}
            </strong>
            <span>
              {modelChanged
                ? 'Save your model changes before starting or stopping the server.'
                : 'Only this workspace’s simulated records are available. No raw SQL or production connection.'}
            </span>
          </div>
          <span
            className={`tag-status ${server.running ? 'tag-running' : 'tag-stopped'}`}
          >
            <span className="status-dot" />
            {server.running ? 'Running' : 'Stopped'}
          </span>
          <button
            className="button button-primary studio-server-button"
            type="button"
            onClick={onToggleServer}
            disabled={busy || modelChanged}
            title={
              modelChanged
                ? 'Save your model changes before starting or stopping the server'
                : undefined
            }
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : server.running ? (
              <Square size={13} />
            ) : (
              <ArrowRight size={14} />
            )}
            {server.running ? 'Stop database server' : 'Start database server'}
          </button>
          {server.running && (
            <button
              className="button button-secondary"
              type="button"
              onClick={onOpenInspector}
            >
              <Activity size={14} /> Inspector
            </button>
          )}
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={onReset}
          >
            <RotateCcw size={14} /> Restore starter
          </button>
        </div>
        {server.running && server.endpoint && (
          <div className="database-endpoint panel">
            <div>
              <span className="eyebrow">STREAMABLE HTTP · LOOPBACK ONLY</span>
              <code>{server.endpoint}</code>
            </div>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={onCopyEndpoint}
            >
              <Copy size={13} /> Copy URL
            </button>
            <button
              className="button button-quiet button-small"
              type="button"
              onClick={onCopyConfig}
            >
              <Copy size={13} /> Copy config
            </button>
          </div>
        )}
      </section>

      <section className="database-model-map panel">
        <div className="database-map-heading">
          <div>
            <span className="eyebrow">YOUR DATA MODEL</span>
            <h3>Connected at a glance</h3>
          </div>
          <span className="map-hint">
            <GitBranch size={13} /> Relationships
          </span>
        </div>
        <div className="database-map-flow">
          {draftModel.tables.map((table) => (
            <div className="database-map-step" key={table.id}>
              <button
                type="button"
                className={`database-map-node ${selectedTable?.name === table.name ? 'selected' : ''}`}
                onClick={() => setSelectedTableName(table.name)}
              >
                <span className="database-map-node-icon">
                  <Table2 size={15} />
                </span>
                <span>
                  <strong>{table.label}</strong>
                  <small>{table.fields.length} fields</small>
                </span>
              </button>
            </div>
          ))}
          {draftModel.tables.flatMap((table) =>
            table.fields
              .filter(
                (field) =>
                  field.type === 'relation' &&
                  draftModel.tables.some(
                    (target) => target.name === field.relationTo
                  )
              )
              .map((field) => {
                const target = draftModel.tables.find(
                  (candidate) => candidate.name === field.relationTo
                )
                return target ? (
                  <span className="database-map-link" key={field.id}>
                    <GitBranch size={12} />
                    {table.label}
                    <ArrowRight size={12} />
                    {target.label}
                  </span>
                ) : null
              })
          )}
          <span className="database-map-add">
            <Plus size={14} /> Add a table below
          </span>
        </div>
      </section>

      <div className="database-studio-grid">
        <aside className="panel database-schema-panel">
          <div className="database-panel-heading">
            <div>
              <span className="eyebrow">DESIGNER</span>
              <h3>Shape your tables</h3>
            </div>
            <span className="designer-count">
              {draftModel.tables.length}/12
            </span>
          </div>
          <div className="database-table-list">
            {draftModel.tables.map((table) => (
              <button
                className={`database-table-choice ${selectedTable?.name === table.name ? 'active' : ''}`}
                key={table.id}
                type="button"
                onClick={() => setSelectedTableName(table.name)}
              >
                <span className="table-choice-icon">
                  <Table2 size={15} />
                </span>
                <span className="table-choice-label">
                  <strong>{table.label}</strong>
                  <small>
                    {table.fields.length} fields · {table.name}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <div className="add-table-form">
            <label htmlFor="new-table-name">New table</label>
            <div>
              <input
                id="new-table-name"
                value={newTableLabel}
                onChange={(event) => setNewTableLabel(event.target.value)}
                placeholder="e.g. Projects"
                maxLength={60}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addTable()
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Add table"
                onClick={addTable}
                disabled={
                  !newTableLabel.trim() || draftModel.tables.length >= 12
                }
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div className="database-tool-tip">
            <CircleHelp size={14} />
            <span>Table names become the agent’s safe, structured tools.</span>
          </div>
        </aside>

        <section className="database-workbench">
          {selectedTable && (
            <>
              <div className="panel database-field-panel">
                <div className="database-panel-heading field-panel-heading">
                  <div className="field-table-title">
                    <span className="table-choice-icon">
                      <Table2 size={16} />
                    </span>
                    <div>
                      <span className="eyebrow">TABLE DESIGN</span>
                      <input
                        className="table-label-input"
                        aria-label="Table display name"
                        value={selectedTable.label}
                        maxLength={60}
                        onChange={(event) =>
                          updateTable(selectedTable.name, {
                            label: event.target.value
                          })
                        }
                      />
                      <small className="table-name-code">
                        {selectedTable.name}
                      </small>
                    </div>
                  </div>
                  <div className="field-panel-actions">
                    {draftModel.tables.length > 1 && (
                      <button
                        className="button button-quiet button-small danger-quiet"
                        type="button"
                        onClick={() => removeTable(selectedTable)}
                        disabled={rows.some((row) => !row.isNew)}
                        title={
                          rows.some((row) => !row.isNew)
                            ? 'Delete the table records before removing this table'
                            : 'Remove this table'
                        }
                      >
                        <Trash2 size={13} /> Remove table
                      </button>
                    )}
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      disabled={!modelChanged || savingModel}
                      onClick={() => void saveModel()}
                    >
                      {savingModel ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Save size={14} />
                      )}
                      {savingModel
                        ? 'Saving'
                        : modelChanged
                          ? 'Save model'
                          : 'Saved'}
                    </button>
                  </div>
                </div>
                {modelError && (
                  <div className="database-inline-error">{modelError}</div>
                )}
                <div className="database-field-list">
                  <div className="database-field-header">
                    <span>FIELD</span>
                    <span>TYPE</span>
                    <span>REQUIRED</span>
                    <span />
                  </div>
                  {selectedTable.fields.map((field) => (
                    <div className="database-field-row" key={field.id}>
                      <div className="database-field-name">
                        <input
                          value={field.label}
                          aria-label={`${field.name} field label`}
                          maxLength={60}
                          onChange={(event) =>
                            updateField(selectedTable.name, field.id, {
                              label: event.target.value
                            })
                          }
                        />
                        <code>{field.name}</code>
                      </div>
                      <div className="database-type-control">
                        <select
                          aria-label={`${field.label} field type`}
                          value={field.type}
                          onChange={(event) => {
                            const type = event.target.value as DatabaseFieldType
                            const target =
                              type === 'relation'
                                ? draftModel.tables.find(
                                    (table) => table.name !== selectedTable.name
                                  )?.name
                                : undefined
                            updateField(selectedTable.name, field.id, {
                              type,
                              ...(type === 'relation'
                                ? { relationTo: target }
                                : { relationTo: undefined })
                            })
                          }}
                        >
                          {fieldTypes.map((type) => (
                            <option
                              key={type.value}
                              value={type.value}
                              disabled={
                                type.value === 'relation' &&
                                draftModel.tables.length < 2
                              }
                            >
                              {type.label}
                            </option>
                          ))}
                        </select>
                        {field.type === 'relation' && (
                          <select
                            aria-label={`${field.label} linked table`}
                            value={field.relationTo ?? ''}
                            onChange={(event) =>
                              updateField(selectedTable.name, field.id, {
                                relationTo: event.target.value || undefined
                              })
                            }
                          >
                            <option value="">Choose table…</option>
                            {draftModel.tables
                              .filter(
                                (table) => table.name !== selectedTable.name
                              )
                              .map((table) => (
                                <option key={table.name} value={table.name}>
                                  {table.label}
                                </option>
                              ))}
                          </select>
                        )}
                      </div>
                      <label className="required-toggle">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            updateField(selectedTable.name, field.id, {
                              required: event.target.checked
                            })
                          }
                        />
                        <span>{field.required ? 'Yes' : 'No'}</span>
                      </label>
                      <button
                        className="icon-button field-remove"
                        type="button"
                        aria-label={`Remove ${field.label} field`}
                        title="Remove field and saved values"
                        disabled={selectedTable.fields.length <= 1}
                        onClick={() => removeField(field)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="add-field-form">
                  <input
                    aria-label="New field name"
                    placeholder="Add a field, e.g. renewal date"
                    value={newFieldLabel}
                    maxLength={60}
                    onChange={(event) => setNewFieldLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addField()
                    }}
                  />
                  <select
                    aria-label="New field type"
                    value={newFieldType}
                    onChange={(event) =>
                      setNewFieldType(event.target.value as DatabaseFieldType)
                    }
                  >
                    {fieldTypes.map((type) => (
                      <option
                        key={type.value}
                        value={type.value}
                        disabled={
                          type.value === 'relation' &&
                          draftModel.tables.length < 2
                        }
                      >
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button-quiet button-small"
                    type="button"
                    onClick={addField}
                    disabled={
                      !newFieldLabel.trim() || selectedTable.fields.length >= 20
                    }
                  >
                    <Plus size={14} /> Add field
                  </button>
                </div>
                <div className="add-relationship-form">
                  <div>
                    <GitBranch size={14} />
                    <span>
                      <strong>Link this table to another</strong>
                      <small>Add a relationship field</small>
                    </span>
                  </div>
                  <select
                    aria-label="Choose a table to link"
                    value={relationshipTargetName}
                    onChange={(event) =>
                      setRelationshipTarget(event.target.value)
                    }
                  >
                    <option value="">Choose table…</option>
                    {relationshipTargets.map((table) => (
                      <option key={table.name} value={table.name}>
                        {table.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button-quiet button-small"
                    type="button"
                    onClick={addRelationship}
                    disabled={
                      !relationshipTargetName ||
                      selectedTable.fields.length >= 20 ||
                      draftModel.tables.length < 2
                    }
                  >
                    <Plus size={14} /> Add link
                  </button>
                </div>
              </div>

              <div className="panel database-record-panel">
                <div className="database-record-heading">
                  <div>
                    <span className="eyebrow">SAMPLE DATA</span>
                    <h3>
                      {selectedTable.label}{' '}
                      <span>
                        {rows.filter((row) => !row.isNew).length} records
                      </span>
                    </h3>
                  </div>
                  <div className="record-heading-actions">
                    <button
                      className="button button-quiet button-small"
                      type="button"
                      onClick={() =>
                        setRows((current) => [
                          ...current,
                          makeDraft(selectedTable)
                        ])
                      }
                      disabled={modelChanged}
                      title={
                        modelChanged
                          ? 'Save your model changes before editing records'
                          : undefined
                      }
                    >
                      <Plus size={14} /> Add record
                    </button>
                  </div>
                </div>
                <p className="database-record-subtitle">
                  Make the mock feel real. Changes here are what the agent will
                  see.
                </p>
                {recordError && (
                  <div className="database-inline-error">{recordError}</div>
                )}
                <div className="database-data-scroll">
                  {recordsLoading ? (
                    <div className="database-record-empty">
                      <LoaderCircle className="spin" size={18} /> Loading
                      records…
                    </div>
                  ) : selectedRows.length === 0 ? (
                    <div className="database-record-empty">
                      <Table2 size={18} />
                      <span>
                        No records yet. Add one or let your agent create it.
                      </span>
                    </div>
                  ) : (
                    <table className="database-data-table">
                      <thead>
                        <tr>
                          <th>RECORD</th>
                          {selectedTable.fields.map((field) => (
                            <th key={field.id}>
                              {field.label}
                              {field.required && (
                                <span className="required-mark"> *</span>
                              )}
                            </th>
                          ))}
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRows.map((row) => (
                          <tr
                            key={row.localId}
                            className={row.isNew ? 'new-record-row' : ''}
                          >
                            <td>
                              <code>{row.isNew ? 'New record' : row.id}</code>
                            </td>
                            {selectedTable.fields.map((field) => (
                              <td key={field.id}>
                                <RecordCell
                                  field={field}
                                  value={row.values[field.name]}
                                  options={
                                    field.relationTo
                                      ? (relatedRows[field.relationTo] ?? [])
                                      : []
                                  }
                                  targetTable={
                                    field.relationTo
                                      ? (draftModel.tables.find(
                                          (table) =>
                                            table.name === field.relationTo
                                        ) ?? null)
                                      : null
                                  }
                                  disabled={modelChanged}
                                  onChange={(value) =>
                                    updateCell(row.localId, field.name, value)
                                  }
                                />
                              </td>
                            ))}
                            <td>
                              <div className="record-row-actions">
                                <button
                                  className="icon-button record-save"
                                  type="button"
                                  aria-label={
                                    row.isNew ? 'Create record' : 'Save record'
                                  }
                                  title={
                                    row.dirty
                                      ? 'Save changes'
                                      : 'No unsaved changes'
                                  }
                                  disabled={
                                    modelChanged ||
                                    !row.dirty ||
                                    savingRecordId === row.localId
                                  }
                                  onClick={() => void saveRow(row)}
                                >
                                  {savingRecordId === row.localId ? (
                                    <LoaderCircle className="spin" size={14} />
                                  ) : row.dirty ? (
                                    <Save size={14} />
                                  ) : (
                                    <Check size={14} />
                                  )}
                                </button>
                                <button
                                  className="icon-button record-delete"
                                  type="button"
                                  aria-label="Delete record"
                                  title="Delete record"
                                  onClick={() => void deleteRow(row)}
                                  disabled={modelChanged}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <ToolExplorer key={server.id} server={server} />
      <div className="database-safe-note">
        <ShieldCheck size={15} />
        <span>
          <strong>Mock-safe by design.</strong> The agent gets structured tools,
          never raw SQL. Records are isolated to this workspace and resettable.
        </span>
      </div>
    </div>
  )
}

function RecordCell({
  field,
  value,
  options,
  targetTable,
  disabled,
  onChange
}: {
  field: DatabaseField
  value: unknown
  options: DatabaseRecord[]
  targetTable: DatabaseTable | null
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  if (field.type === 'boolean') {
    return (
      <select
        className="database-cell-input"
        aria-label={field.label}
        disabled={disabled}
        value={value === true ? 'true' : 'false'}
        onChange={(event) => onChange(event.target.value === 'true')}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (field.type === 'relation') {
    return (
      <select
        className="database-cell-input"
        aria-label={field.label}
        disabled={disabled}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Choose record…</option>
        {options.map((record) => (
          <option value={record.id} key={record.id}>
            {targetTable ? recordTitle(record, targetTable) : record.id}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      className="database-cell-input"
      aria-label={field.label}
      disabled={disabled}
      type={
        field.type === 'number'
          ? 'number'
          : field.type === 'email'
            ? 'email'
            : field.type === 'date'
              ? 'date'
              : 'text'
      }
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(event) => {
        const next =
          field.type === 'number'
            ? event.target.value === ''
              ? null
              : Number(event.target.value)
            : event.target.value
        onChange(next)
      }}
    />
  )
}
