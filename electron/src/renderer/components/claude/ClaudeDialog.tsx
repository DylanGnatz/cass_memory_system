import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useUIStore } from '../../stores/ui-store'
import MarkdownRenderer from '../content/MarkdownRenderer'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  toolsUsed?: string[]
}

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: 'Searched knowledge',
  read_document: 'Read document'
}

export default function ClaudeDialog(): React.ReactElement {
  const { currentView } = useUIStore()
  const [isOpen, setIsOpen] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Check availability on mount
  useEffect(() => {
    window.electronAPI.claudeAvailable().then(setAvailable)
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Build document context from current view
  const getDocumentContext = useCallback((): string | undefined => {
    // Context is passed to Claude so it knows what the user is looking at.
    // The actual content is fetched by the main process from the IPC call.
    const view = currentView
    if (view.type === 'knowledge') return `User is viewing knowledge page: ${view.slug}`
    if (view.type === 'session') return `User is viewing session note: ${view.id}`
    if (view.type === 'digest') return `User is viewing digest: ${view.date}`
    return undefined
  }, [currentView])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)

    try {
      const result = await window.electronAPI.claudeSend(text, getDocumentContext())
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.response,
        toolsUsed: result.toolsUsed
      }])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to get response'}`
      }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [input, sending, getDocumentContext])

  const handleReset = useCallback(async () => {
    await window.electronAPI.claudeReset()
    setMessages([])
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // Toggle with Cmd+J
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className={`claude-panel ${isOpen ? 'claude-panel--open' : ''}`}>
      {/* Toggle bar — always visible */}
      <button className="claude-panel__toggle" onClick={() => setIsOpen(!isOpen)}>
        <span className="claude-panel__toggle-label">
          <span className="claude-panel__toggle-icon">{isOpen ? '\u25BE' : '\u25B4'}</span>
          Claude
        </span>
        <span className="claude-panel__toggle-shortcut">&#x2318;J</span>
      </button>

      {/* Expandable body */}
      {isOpen && (
        <div className="claude-panel__body">
          {available === false ? (
            <div className="claude-panel__unavailable">
              Set <code>ANTHROPIC_API_KEY</code> in your environment to enable Claude.
            </div>
          ) : (
            <>
              {/* Message history */}
              <div className="claude-panel__messages" ref={scrollRef}>
                {messages.length === 0 && (
                  <div className="claude-panel__empty">
                    Ask Claude about your knowledge base. It can search and read documents to answer questions.
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`claude-msg claude-msg--${msg.role}`}>
                    <div className="claude-msg__sender">
                      {msg.role === 'user' ? 'You' : 'Claude'}
                    </div>
                    <div className="claude-msg__content">
                      {msg.role === 'assistant' ? (
                        <MarkdownRenderer content={msg.content} className="claude-msg__markdown" />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                    </div>
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="claude-msg__tools">
                        {msg.toolsUsed.map((tool, j) => (
                          <span key={j} className="claude-msg__tool-badge">
                            {TOOL_LABELS[tool] || tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {sending && (
                  <div className="claude-msg claude-msg--assistant">
                    <div className="claude-msg__sender">Claude</div>
                    <div className="claude-msg__thinking">
                      <span className="claude-msg__dot" />
                      <span className="claude-msg__dot" />
                      <span className="claude-msg__dot" />
                    </div>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="claude-panel__input-row">
                <textarea
                  ref={inputRef}
                  className="claude-panel__input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about your knowledge base..."
                  rows={1}
                  disabled={sending}
                />
                <button
                  className="claude-panel__send"
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                >
                  &#x2191;
                </button>
                {messages.length > 0 && (
                  <button
                    className="claude-panel__reset"
                    onClick={handleReset}
                    title="Reset conversation"
                  >
                    &#x21BB;
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
