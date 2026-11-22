import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import type { DatabaseModel } from '../src/shared/contracts'

const temporaryDirectories: string[] = []

function createDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'mockarium-database-test-'))
  temporaryDirectories.push(directory)
  return new AppDatabase(join(directory, 'test.sqlite'))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Database Studio state', () => {
  it('creates a persistent, workspace-isolated relational starter model', () => {
    const database = createDatabase()
    const first = database.createWorkspace('First')
    const second = database.createWorkspace('Second')
    database.addDatabaseServer(first.id)

    const model = database.getDatabaseModel(first.id)
    expect(model?.tables.map((table) => table.name)).toEqual([
      'companies',
      'contacts',
      'deals'
    ])
    expect(model?.tables[1]?.fields[3]).toMatchObject({
      name: 'company',
      type: 'relation',
      relationTo: 'companies'
    })
    expect(database.getDatabaseRecords(first.id, 'companies')).toHaveLength(2)
    expect(database.getDatabaseRecords(first.id, 'contacts')).toHaveLength(2)
    expect(database.getDatabaseModel(second.id)).toBeNull()
    database.close()
  })

  it('validates fields and relationships, preserves records, and restores the starter world', () => {
    const database = createDatabase()
    const workspace = database.createWorkspace('Studio test')
    database.addDatabaseServer(workspace.id)

    const company = database.saveDatabaseRecord(
      workspace.id,
      'companies',
      null,
      {
        name: 'New Horizon',
        industry: 'Education',
        website: 'horizon.example.test',
        status: 'Prospect'
      }
    )
    const contact = database.saveDatabaseRecord(
      workspace.id,
      'contacts',
      null,
      {
        name: 'Taylor Kim',
        email: 'taylor@example.test',
        role: 'Founder',
        company: company.id
      }
    )

    expect(() =>
      database.deleteDatabaseRecord(workspace.id, 'companies', company.id)
    ).toThrow('still linked from Contacts')
    expect(() =>
      database.saveDatabaseRecord(workspace.id, 'companies', null, {
        name: 'Missing required data',
        surprise: true
      })
    ).toThrow('Unknown field "surprise"')
    expect(() =>
      database.saveDatabaseRecord(workspace.id, 'contacts', null, {
        name: 'Unlinked person',
        email: 'not-an-email',
        company: company.id
      })
    ).toThrow('valid email address')

    const currentModel = database.getDatabaseModel(workspace.id)!
    const customTable = {
      id: 'projects',
      name: 'projects',
      label: 'Projects',
      fields: [
        {
          id: 'project_name',
          name: 'name',
          label: 'Project name',
          type: 'text' as const,
          required: true
        },
        {
          id: 'project_company',
          name: 'company',
          label: 'Company',
          type: 'relation' as const,
          required: true,
          relationTo: 'companies'
        }
      ]
    }
    const editedModel: DatabaseModel = {
      tables: [...currentModel.tables, customTable]
    }
    database.saveDatabaseModel(workspace.id, editedModel)
    const project = database.saveDatabaseRecord(
      workspace.id,
      'projects',
      null,
      {
        name: 'Launch plan',
        company: company.id
      }
    )
    expect(project.values).toEqual({
      name: 'Launch plan',
      company: company.id
    })
    expect(
      database
        .getDatabaseModel(workspace.id)
        ?.tables.find((table) => table.name === 'projects')?.fields[1]
    ).toMatchObject({
      name: 'company',
      type: 'relation',
      relationTo: 'companies'
    })
    expect(() =>
      database.saveDatabaseModel(workspace.id, currentModel)
    ).toThrow('Move or delete the Projects records')

    database.resetDatabase(workspace.id)
    expect(database.getDatabaseModel(workspace.id)?.tables).toHaveLength(3)
    expect(database.getDatabaseRecords(workspace.id, 'companies')).toHaveLength(
      2
    )
    expect(database.getDatabaseRecords(workspace.id, 'contacts')).toHaveLength(
      2
    )
    expect(database.getDatabaseRecords(workspace.id, 'deals')).toHaveLength(2)
    expect(
      database.getDatabaseRecords(workspace.id, 'contacts')
    ).not.toContainEqual(contact)
    database.close()
  })

  it('migrates existing Email-only server catalogs without losing their server', () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'mockarium-database-migration-')
    )
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'legacy.sqlite')
    const legacy = new Database(databasePath)
    legacy.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE mock_servers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type = 'email'),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, type)
      );
      INSERT INTO workspaces VALUES (
        'legacy-workspace', 'Legacy', '2025-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z'
      );
      INSERT INTO mock_servers VALUES (
        'legacy-email', 'legacy-workspace', 'email', 'Email',
        '2025-01-01T00:00:00.000Z'
      );
    `)
    legacy.close()

    const database = new AppDatabase(databasePath)
    expect(database.getEmailServer('legacy-workspace')?.id).toBe('legacy-email')
    expect(database.addDatabaseServer('legacy-workspace').type).toBe('database')
    expect(database.listMockServers()).toHaveLength(2)
    database.close()
  })
})
