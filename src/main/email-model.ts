import { z } from 'zod'

export const emailProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254)
  })
  .strict()

export const emailFolderSchema = z.string().trim().min(1).max(40)

export const emailContactSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    company: z.string().trim().max(120)
  })
  .strict()

export const emailMessageInputSchema = z
  .object({
    folder: emailFolderSchema,
    fromName: z.string().trim().min(1).max(80),
    fromEmail: z.string().trim().email().max(254),
    toEmail: z.string().trim().email().max(254),
    subject: z.string().trim().min(1).max(300),
    body: z.string().min(1).max(20_000),
    sentAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    parentEmailId: z.string().min(1).max(100).nullable()
  })
  .strict()
