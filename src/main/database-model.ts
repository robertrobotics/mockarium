import { z } from 'zod'
import type {
  DatabaseField,
  DatabaseFieldType,
  DatabaseModel,
  DatabaseRecord
} from '../shared/contracts'

const fieldTypes = [
  'text',
  'email',
  'number',
  'boolean',
  'date',
  'relation'
] as const satisfies readonly DatabaseFieldType[]

const fieldSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .refine((value) => value !== 'id', 'The name "id" is reserved.'),
    label: z.string().trim().min(1).max(60),
    type: z.enum(fieldTypes),
    required: z.boolean(),
    relationTo: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,39}$/)
      .optional()
  })
  .strict()

const tableSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().trim().min(1).max(60),
    fields: z.array(fieldSchema).min(1).max(20)
  })
  .strict()

export const databaseModelSchema = z
  .object({ tables: z.array(tableSchema).min(1).max(12) })
  .strict()
  .superRefine((model, context) => {
    const tableNames = new Set<string>()
    const tableIds = new Set<string>()
    for (const [tableIndex, table] of model.tables.entries()) {
      if (tableNames.has(table.name)) {
        context.addIssue({
          code: 'custom',
          path: ['tables', tableIndex, 'name'],
          message: `Table name "${table.name}" is already in use.`
        })
      }
      tableNames.add(table.name)
      if (tableIds.has(table.id)) {
        context.addIssue({
          code: 'custom',
          path: ['tables', tableIndex, 'id'],
          message: `Table ID "${table.id}" is already in use.`
        })
      }
      tableIds.add(table.id)

      const fieldNames = new Set<string>()
      const fieldIds = new Set<string>()
      for (const [fieldIndex, field] of table.fields.entries()) {
        if (fieldNames.has(field.name)) {
          context.addIssue({
            code: 'custom',
            path: ['tables', tableIndex, 'fields', fieldIndex, 'name'],
            message: `Field name "${field.name}" is already in use.`
          })
        }
        fieldNames.add(field.name)
        if (fieldIds.has(field.id)) {
          context.addIssue({
            code: 'custom',
            path: ['tables', tableIndex, 'fields', fieldIndex, 'id'],
            message: `Field ID "${field.id}" is already in use.`
          })
        }
        fieldIds.add(field.id)
        if (field.type === 'relation' && !field.relationTo) {
          context.addIssue({
            code: 'custom',
            path: ['tables', tableIndex, 'fields', fieldIndex, 'relationTo'],
            message: `Choose a table for the "${field.label}" relationship.`
          })
        } else if (
          field.type === 'relation' &&
          !model.tables.some((target) => target.name === field.relationTo)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['tables', tableIndex, 'fields', fieldIndex, 'relationTo'],
            message: `The "${field.label}" relationship points to a missing table.`
          })
        } else if (field.type !== 'relation' && field.relationTo) {
          context.addIssue({
            code: 'custom',
            path: ['tables', tableIndex, 'fields', fieldIndex, 'relationTo'],
            message: 'Only relationship fields can point to another table.'
          })
        }
      }
    }
  })

export function createDatabaseTemplate(): {
  model: DatabaseModel
  records: Record<string, DatabaseRecord[]>
} {
  const model: DatabaseModel = {
    tables: [
      {
        id: 'companies',
        name: 'companies',
        label: 'Companies',
        fields: [
          field('company_name', 'name', 'Company name', 'text', true),
          field('industry', 'industry', 'Industry', 'text'),
          field('website', 'website', 'Website', 'text'),
          field('account_status', 'status', 'Account status', 'text')
        ]
      },
      {
        id: 'contacts',
        name: 'contacts',
        label: 'Contacts',
        fields: [
          field('contact_name', 'name', 'Full name', 'text', true),
          field('contact_email', 'email', 'Email', 'email', true),
          field('contact_role', 'role', 'Role', 'text'),
          field(
            'contact_company',
            'company',
            'Company',
            'relation',
            true,
            'companies'
          )
        ]
      },
      {
        id: 'deals',
        name: 'deals',
        label: 'Deals',
        fields: [
          field('deal_name', 'name', 'Deal name', 'text', true),
          field('deal_amount', 'amount', 'Amount', 'number', true),
          field('deal_stage', 'stage', 'Stage', 'text', true),
          field(
            'deal_company',
            'company',
            'Company',
            'relation',
            true,
            'companies'
          )
        ]
      }
    ]
  }
  return {
    model,
    records: {
      companies: [
        {
          id: 'company_northstar',
          values: {
            name: 'Northstar Labs',
            industry: 'Climate technology',
            website: 'northstarlabs.example.test',
            status: 'Customer'
          }
        },
        {
          id: 'company_brightline',
          values: {
            name: 'Brightline Supply',
            industry: 'Manufacturing',
            website: 'brightline.example.test',
            status: 'Prospect'
          }
        }
      ],
      contacts: [
        {
          id: 'contact_jordan',
          values: {
            name: 'Jordan Lee',
            email: 'jordan.lee@example.test',
            role: 'Operations lead',
            company: 'company_northstar'
          }
        },
        {
          id: 'contact_priya',
          values: {
            name: 'Priya Shah',
            email: 'priya.shah@example.test',
            role: 'Procurement director',
            company: 'company_brightline'
          }
        }
      ],
      deals: [
        {
          id: 'deal_launch',
          values: {
            name: 'Spring launch program',
            amount: 24000,
            stage: 'Proposal',
            company: 'company_northstar'
          }
        },
        {
          id: 'deal_renewal',
          values: {
            name: 'Annual supply renewal',
            amount: 12500,
            stage: 'Negotiation',
            company: 'company_brightline'
          }
        }
      ]
    }
  }
}

export function field(
  id: string,
  name: string,
  label: string,
  type: DatabaseFieldType,
  required = false,
  relationTo?: string
): DatabaseField {
  return {
    id,
    name,
    label,
    type,
    required,
    ...(relationTo ? { relationTo } : {})
  }
}

export function defaultValueForField(fieldDefinition: DatabaseField): unknown {
  switch (fieldDefinition.type) {
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
