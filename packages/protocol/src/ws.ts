import { z } from 'zod'
import { EventEnvelopeSchema } from './common.js'

// ---------------------------------------------------------------------------
// Client -> Server messages
// ---------------------------------------------------------------------------

export const WsSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  sessionId: z.string(),
  fromSeq: z.number().optional(),
})

export const WsUnsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
  sessionId: z.string(),
})

export const WsPingSchema = z.object({
  type: z.literal('ping'),
  ts: z.string(),
})

export const WsClientMessageSchema = z.discriminatedUnion('type', [
  WsSubscribeSchema,
  WsUnsubscribeSchema,
  WsPingSchema,
])
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>

// ---------------------------------------------------------------------------
// Server -> Client messages
// ---------------------------------------------------------------------------

export const WsEventSchema = z.object({
  type: z.literal('event'),
  event: EventEnvelopeSchema,
  seq: z.number(),
})

export const WsAckSchema = z.object({
  type: z.literal('ack'),
  subscribedSessionId: z.string(),
  currentSeq: z.number(),
})

export const WsPongSchema = z.object({
  type: z.literal('pong'),
  ts: z.string(),
})

export const WsErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
})

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsEventSchema,
  WsAckSchema,
  WsPongSchema,
  WsErrorSchema,
])
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>
