import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { broadcaster } from '../ws/broadcaster.js'
import { newEventId, newCorrelationId, createLogger } from '@claude-ui/shared'
import type { EventEnvelope } from '@claude-ui/protocol'

const logger = createLogger({ name: 'sdk:stream-adapter' })

interface EmitContext {
  sessionId: string
  projectId: string
  runnerId: string
  correlationId: string
}

function makeEnvelope(
  ctx: EmitContext,
  type: string,
  payload: Record<string, unknown>,
): EventEnvelope {
  const seq = broadcaster.nextSeq(ctx.sessionId)
  return {
    id: newEventId(),
    type,
    ts: new Date().toISOString(),
    sessionId: ctx.sessionId,
    projectId: ctx.projectId,
    runnerId: ctx.runnerId,
    mode: 'sdk',
    correlationId: ctx.correlationId,
    seq,
    payload,
  }
}

export function emitEvent(ctx: EmitContext, type: string, payload: Record<string, unknown>): void {
  const envelope = makeEnvelope(ctx, type, payload)
  broadcaster.broadcast(ctx.sessionId, { type: 'event', event: envelope, seq: envelope.seq })
}

export function adaptSdkMessage(
  msg: SDKMessage,
  ctx: EmitContext,
  onSdkSessionId: (id: string) => void,
): void {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        onSdkSessionId(msg.session_id)
        emitEvent(ctx, 'session.created', {
          sdkSessionId: msg.session_id,
          model: msg.model,
          permissionMode: msg.permissionMode,
          mcpServers: msg.mcp_servers,
        })
      }
      break

    case 'assistant': {
      // Emit tool.requested for each tool_use block
      for (const block of msg.message.content) {
        if (block.type === 'tool_use') {
          emitEvent(ctx, 'tool.requested', {
            toolName: block.name,
            toolUseId: block.id,
            input: block.input as Record<string, unknown>,
          })
        }
      }
      // Emit full assistant message
      const textContent = (msg.message.content as Array<{ type: string; text?: string }>)
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('')
      emitEvent(ctx, 'assistant.message', {
        text: textContent,
        inputTokens: msg.message.usage?.input_tokens ?? 0,
        outputTokens: msg.message.usage?.output_tokens ?? 0,
      })
      break
    }

    case 'stream_event': {
      // Streaming deltas (only with includePartialMessages: true)
      const raw = msg.event
      if (raw.type === 'content_block_delta' && raw.delta.type === 'text_delta') {
        emitEvent(ctx, 'assistant.delta', { delta: raw.delta.text })
      }
      break
    }

    case 'result':
      if (msg.subtype === 'success') {
        emitEvent(ctx, 'session.ended', {
          reason: 'completed',
          costUsd: msg.total_cost_usd,
          usage: msg.usage,
        })
      } else {
        emitEvent(ctx, 'session.error', {
          code: msg.subtype,
          message: msg.result ?? 'Unknown error',
        })
      }
      break

    default:
      logger.debug({ msgType: (msg as { type: string }).type }, 'Unhandled SDK message type')
  }
}
