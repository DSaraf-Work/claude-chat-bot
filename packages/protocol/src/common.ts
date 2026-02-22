import { z } from 'zod'

export const EventEnvelopeSchema = z.object({
  id: z.string(),
  seq: z.number(),
  type: z.string(),
  ts: z.string().datetime(),
  sessionId: z.string(),
  projectId: z.string(),
  runnerId: z.string(),
  mode: z.enum(['sdk', 'pty']),
  correlationId: z.string().optional(),
  payload: z.record(z.unknown()),
})
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>
