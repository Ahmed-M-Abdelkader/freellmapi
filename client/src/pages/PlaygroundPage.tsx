import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  keyCount: number
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  meta?: {
    platform?: string
    model?: string
    latency?: number
    fallbackAttempts?: number
  }
}

interface ChatThread {
  id: string
  title: string
  createdAt: number
  messages: ChatMessage[]
  model: string
}

const THREADS_KEY = 'playground-threads'
const ACTIVE_KEY = 'playground-active-thread'

function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function makeThread(model = 'auto'): ChatThread {
  return { id: crypto.randomUUID(), title: 'New chat', createdAt: Date.now(), messages: [], model }
}

function initState(): { threads: ChatThread[]; activeId: string } {
  const stored = loadThreads()
  const threads = stored.length > 0 ? stored : [makeThread()]
  const savedActive = localStorage.getItem(ACTIVE_KEY) ?? ''
  const activeId = threads.find(t => t.id === savedActive) ? savedActive : threads[0].id
  return { threads, activeId }
}

export default function PlaygroundPage() {
  const init = useState(() => initState())[0]
  const [threads, setThreads] = useState<ChatThread[]>(init.threads)
  const [activeId, setActiveId] = useState<string>(init.activeId)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)
  const activeThread = threads.find(t => t.id === activeId) ?? threads[0]
  const messages = activeThread?.messages ?? []
  const selectedModel = activeThread?.model ?? 'auto'

  useEffect(() => {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads))
  }, [threads])

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
  }, [activeId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const patchThread = useCallback((id: string, patch: Partial<ChatThread>) => {
    setThreads(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const handleNewChat = () => {
    const t = makeThread(activeThread?.model ?? 'auto')
    setThreads(prev => [t, ...prev])
    setActiveId(t.id)
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleDeleteThread = (id: string) => {
    setThreads(prev => {
      const next = prev.filter(t => t.id !== id)
      if (id === activeId) {
        if (next.length > 0) {
          setActiveId(next[0].id)
          return next
        }
        const fresh = makeThread()
        setActiveId(fresh.id)
        return [fresh]
      }
      return next
    })
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading || !activeThread) return

    const threadId = activeThread.id
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...activeThread.messages, userMsg]
    const title = activeThread.messages.length === 0
      ? text.slice(0, 42) + (text.length > 42 ? '…' : '')
      : activeThread.title

    patchThread(threadId, { messages: newMessages, title })
    setInput('')
    setLoading(true)
    inputRef.current?.focus()

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const body: { messages: { role: string; content: string }[]; model?: string } = {
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      }
      if (activeThread.model !== 'auto') body.model = activeThread.model

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        patchThread(threadId, {
          messages: [...newMessages, { role: 'assistant', content: `Error: ${err.error?.message ?? 'Unknown error'}` }],
        })
        return
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2)
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      patchThread(threadId, {
        messages: [...newMessages, {
          role: 'assistant',
          content,
          meta: {
            platform: via?.platform,
            model: via?.model,
            latency,
            fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
          },
        }],
      })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      patchThread(threadId, {
        messages: [...newMessages, { role: 'assistant', content: `Error: ${errMsg}` }],
      })
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const activeModelLabel = selectedModel === 'auto'
    ? 'Auto (fallback chain)'
    : availableModels.find(m => m.modelId === selectedModel)?.displayName ?? selectedModel

  return (
    <div className="flex gap-3 h-[calc(100vh-8rem)]">

      {/* ── Threads pane ── */}
      <aside className="w-52 flex-shrink-0 flex flex-col gap-1 overflow-hidden">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 shrink-0"
          onClick={handleNewChat}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
          New chat
        </Button>

        <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5 min-h-0">
          {threads.map(t => (
            <button
              key={t.id}
              onClick={() => { setActiveId(t.id); setInput('') }}
              className={`group w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors flex items-center gap-1 ${
                t.id === activeId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
            >
              <span className="truncate flex-1 leading-snug">{t.title}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={e => { e.stopPropagation(); handleDeleteThread(t.id) }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 rounded p-0.5 hover:text-destructive"
                aria-label="Delete thread"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <Select
            value={selectedModel}
            onValueChange={v => activeThread && patchThread(activeThread.id, { model: v ?? 'auto' })}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (fallback chain)</SelectItem>
              {availableModels.map(m => (
                <SelectItem key={m.modelDbId} value={m.modelId}>
                  <span className="flex items-center gap-2">
                    <span>{m.displayName}</span>
                    <span className="text-xs text-muted-foreground">{m.platform}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => activeThread && patchThread(activeThread.id, { messages: [], title: 'New chat' })}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Message list + input */}
        <div className="flex-1 flex flex-col rounded-lg border bg-card overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center">
                <div className="space-y-2 max-w-sm">
                  <p className="text-base font-medium">Send a message to get started.</p>
                  <p className="text-sm text-muted-foreground">
                    Using <span className="text-foreground">{activeModelLabel}</span>. Switch models above.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                      {msg.meta && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px] opacity-70 tabular-nums">
                          {msg.meta.platform && <span>{msg.meta.platform}</span>}
                          {msg.meta.model && <span className="font-mono">· {msg.meta.model}</span>}
                          {msg.meta.latency != null && <span>· {msg.meta.latency} ms</span>}
                          {msg.meta.fallbackAttempts != null && msg.meta.fallbackAttempts > 0 && (
                            <span>· {msg.meta.fallbackAttempts} fallback{msg.meta.fallbackAttempts > 1 ? 's' : ''}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-2xl px-4 py-3">
                      <div className="flex gap-1">
                        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <div className="border-t bg-background/50 p-3">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (⏎ to send, ⇧⏎ for newline)"
                rows={1}
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[40px] max-h-[160px]"
                style={{ height: 'auto', overflow: 'hidden' }}
                onInput={e => {
                  const el = e.target as HTMLTextAreaElement
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
              />
              <Button onClick={handleSend} disabled={loading || !input.trim()} size="default">
                {loading ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
