// Claude dialog — Anthropic API integration for the knowledge base dialog bar.
// Runs in main process. Manages conversation state and tool fulfillment.

import Anthropic from '@anthropic-ai/sdk'
import { search } from './search'
import { readKnowledgePage, readSessionNote, readDigest } from './file-reader'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeConfig {
  apiKey: string | null
  model?: string
}

let client: Anthropic | null = null
let conversationHistory: Message[] = []

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_knowledge_base',
    description: 'Search the knowledge base for relevant content across knowledge pages, session notes, digests, and transcripts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query text' },
        scope: { type: 'string', enum: ['all', 'knowledge', 'sessions', 'digests'], description: 'Scope to search within' }
      },
      required: ['query']
    }
  },
  {
    name: 'read_document',
    description: 'Read a specific document from the knowledge base. Provide a knowledge page slug, session note ID, or digest date.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['knowledge', 'session', 'digest'], description: 'Document type' },
        id: { type: 'string', description: 'Document identifier (topic slug, session ID, or YYYY-MM-DD date)' }
      },
      required: ['type', 'id']
    }
  }
]

function getClient(apiKey: string): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey })
  }
  return client
}

/** Fulfill a tool call locally. */
async function fulfillTool(name: string, input: any): Promise<string> {
  if (name === 'search_knowledge_base') {
    const results = search(input.query, { scope: input.scope, limit: 10 })
    if (results.length === 0) return 'No results found.'
    return results.map(r => `[${r.type}] ${r.title}\n${r.snippet}`).join('\n\n')
  }

  if (name === 'read_document') {
    if (input.type === 'knowledge') {
      const page = await readKnowledgePage(input.id)
      if (!page) return `Knowledge page "${input.id}" not found.`
      return page.raw
    }
    if (input.type === 'session') {
      const note = await readSessionNote(input.id)
      if (!note) return `Session note "${input.id}" not found.`
      return `# ${note.frontmatter.abstract}\n\n${note.body}`
    }
    if (input.type === 'digest') {
      const content = await readDigest(input.id)
      if (!content) return `Digest for "${input.id}" not found.`
      return content
    }
    return 'Unknown document type.'
  }

  return `Unknown tool: ${name}`
}

/** Check if an API key is configured. */
export function isClaudeAvailable(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY)
}

/** Get the API key from environment. */
function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null
}

/** Reset conversation history. */
export function resetConversation(): void {
  conversationHistory = []
}

/**
 * Send a message to Claude with optional document context.
 * Handles tool_use responses by fulfilling tools locally and continuing.
 */
export async function sendMessage(
  userMessage: string,
  options?: { documentContext?: string }
): Promise<{ response: string; toolsUsed: string[] }> {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set. Configure it in your environment to use the Claude dialog.')
  }

  const anthropic = getClient(apiKey)
  const toolsUsed: string[] = []

  // Build system prompt
  const systemParts = [
    'You are a helpful assistant for browsing and understanding a knowledge base.',
    'The knowledge base contains knowledge pages (organized by topic), session notes (from coding sessions), and daily digests.',
    'Use the provided tools to search and read documents when the user asks questions about their knowledge base.',
    'Keep responses concise and reference specific sources when possible.'
  ]

  if (options?.documentContext) {
    systemParts.push(`\nThe user is currently viewing the following document:\n\n${options.documentContext}`)
  }

  conversationHistory.push({ role: 'user', content: userMessage })

  let messages: Anthropic.MessageParam[] = conversationHistory.map(m => ({
    role: m.role,
    content: m.content
  }))

  // Agentic loop — handle tool_use responses
  let response: Anthropic.Message
  let finalText = ''
  const maxIterations = 5

  for (let i = 0; i < maxIterations; i++) {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemParts.join('\n'),
      tools: TOOLS,
      messages
    })

    // Check if response has tool_use blocks
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    const textBlocks = response.content.filter(b => b.type === 'text')

    if (textBlocks.length > 0) {
      finalText += textBlocks.map(b => (b as Anthropic.TextBlock).text).join('')
    }

    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      break
    }

    // Fulfill tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      const toolBlock = block as Anthropic.ToolUseBlock
      toolsUsed.push(toolBlock.name)
      const result = await fulfillTool(toolBlock.name, toolBlock.input)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result
      })
    }

    // Add assistant message and tool results to conversation
    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults }
    ]
  }

  conversationHistory.push({ role: 'assistant', content: finalText })

  return { response: finalText, toolsUsed }
}
