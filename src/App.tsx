import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import {
  ChatCircleDots,
  CheckCircle,
  CloudArrowUp,
  FilePdf,
  FileText,
  PaperPlaneTilt,
  Plus,
  Robot,
  Trash,
  X,
} from '@phosphor-icons/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  askQuestion,
  createConversation,
  deleteConversation,
  deleteDocument,
  getConversations,
  getDocuments,
  getHealth,
  getMessages,
  uploadDocument,
  type Citation,
  type Conversation,
  type DocumentItem,
  type Message,
} from './api'
import './App.css'

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
}

function getHistoryGroup(value: string) {
  const date = new Date(value)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const daysAgo = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000)

  if (daysAgo <= 0) return { key: 'today', label: 'Today' }
  if (daysAgo === 1) return { key: 'yesterday', label: 'Yesterday' }
  if (daysAgo < 7) return { key: 'week', label: 'Previous 7 days' }
  return { key: 'older', label: 'Older' }
}

function App() {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [health, setHealth] = useState<'checking' | 'ready' | 'offline'>('checking')
  const [busy, setBusy] = useState(false)
  const [clearingHistory, setClearingHistory] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)
  const autoSelectDocumentIdsRef = useRef(new Set<string>())

  const readyDocuments = useMemo(
    () => documents.filter((document) => document.status === 'ready'),
    [documents],
  )

  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.document_id, document])),
    [documents],
  )

  const groupedConversations = useMemo(() => {
    const sorted = [...conversations]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

    return sorted.reduce<Array<{ key: string; label: string; items: Conversation[] }>>((groups, conversation) => {
      const group = getHistoryGroup(conversation.updated_at)
      const existing = groups.find((item) => item.key === group.key)
      if (existing) existing.items.push(conversation)
      else groups.push({ ...group, items: [conversation] })
      return groups
    }, [])
  }, [conversations])

  const refreshDocuments = useCallback(async () => {
    const page = await getDocuments()
    setDocuments(page.items)

    const uploadedReadyIds = page.items
      .filter((document) => document.status === 'ready' && autoSelectDocumentIdsRef.current.has(document.document_id))
      .map((document) => document.document_id)

    if (uploadedReadyIds.length > 0) {
      uploadedReadyIds.forEach((documentId) => autoSelectDocumentIdsRef.current.delete(documentId))
      setSelectedDocumentIds((current) => [...new Set([...current, ...uploadedReadyIds])])
      setActiveConversation(null)
      setMessages([])
    }

    page.items
      .filter((document) => document.status === 'failed' || document.status === 'expired')
      .forEach((document) => autoSelectDocumentIdsRef.current.delete(document.document_id))
  }, [])

  const refreshConversations = useCallback(async () => {
    const page = await getConversations()
    setConversations(page.items)
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      const result = await getHealth()
      setHealth(result.status === 'ready' ? 'ready' : 'offline')
    } catch {
      setHealth('offline')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void Promise.all([refreshDocuments(), refreshConversations(), refreshHealth()]).catch((cause: unknown) => {
      console.error('Could not load initial API data.', cause)
    })
  }, [refreshConversations, refreshDocuments, refreshHealth])

  useEffect(() => {
    if (!documents.some((document) => document.status === 'queued' || document.status === 'processing')) return
    const timer = window.setInterval(() => {
      void refreshDocuments().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not refresh documents.')
      })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [documents, refreshDocuments])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages, busy])

  const toggleDocument = (documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId],
    )
    if (activeConversation) {
      setActiveConversation(null)
      setMessages([])
    }
  }

  const uploadPdf = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.')
      return
    }
    setUploading(true)
    setError('')
    try {
      const result = await uploadDocument(file)
      autoSelectDocumentIdsRef.current.add(result.document_id)
      await refreshDocuments()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The PDF could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }

  const handleUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('pdf') as HTMLInputElement | null
    const file = fileInput?.files?.[0]
    if (!file) return
    void uploadPdf(file).finally(() => form.reset())
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void uploadPdf(file)
  }

  const handleDeleteDocument = async (documentId: string) => {
    if (!window.confirm('Delete this PDF and its related conversations?')) return
    setError('')
    try {
      await deleteDocument(documentId)
      autoSelectDocumentIdsRef.current.delete(documentId)
      setSelectedDocumentIds((ids) => ids.filter((id) => id !== documentId))
      if (activeConversation?.document_ids.includes(documentId)) {
        setActiveConversation(null)
        setMessages([])
      }
      await Promise.all([refreshDocuments(), refreshConversations()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The PDF could not be deleted.')
    }
  }

  const handleNewConversation = async () => {
    if (selectedDocumentIds.length === 0) {
      setError('Select at least one ready PDF to start a chat.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const conversation = await createConversation(selectedDocumentIds)
      setActiveConversation(conversation)
      setMessages([])
      await refreshConversations()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a conversation.')
    } finally {
      setBusy(false)
    }
  }

  const openConversation = async (conversation: Conversation) => {
    setBusy(true)
    setError('')
    try {
      const page = await getMessages(conversation.conversation_id)
      setActiveConversation(conversation)
      setSelectedDocumentIds(conversation.document_ids)
      setMessages(page.items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load this conversation.')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteConversation = async (conversation: Conversation) => {
    if (!window.confirm('Delete this conversation?')) return
    setError('')
    try {
      await deleteConversation(conversation.conversation_id)
      if (activeConversation?.conversation_id === conversation.conversation_id) {
        setActiveConversation(null)
        setMessages([])
      }
      await refreshConversations()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the conversation.')
    }
  }

  const handleClearHistory = async () => {
    if (!window.confirm('Clear all conversation history? This cannot be undone.')) return

    setClearingHistory(true)
    setError('')
    try {
      const allConversations: Conversation[] = []
      let offset = 0

      while (true) {
        const page = await getConversations(100, offset)
        allConversations.push(...page.items)
        offset += page.items.length
        if (page.items.length === 0 || allConversations.length >= page.total) break
      }

      const results = await Promise.allSettled(
        allConversations.map((conversation) => deleteConversation(conversation.conversation_id)),
      )
      const deletedIds = new Set(
        allConversations
          .filter((_, index) => results[index].status === 'fulfilled')
          .map((conversation) => conversation.conversation_id),
      )

      if (activeConversation && deletedIds.has(activeConversation.conversation_id)) {
        setActiveConversation(null)
        setMessages([])
      }

      await refreshConversations()
      const failedCount = results.length - deletedIds.size
      if (failedCount > 0) {
        setError(`Cleared ${deletedIds.size} conversations, but ${failedCount} could not be deleted.`)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear conversation history.')
      await refreshConversations().catch(() => undefined)
    } finally {
      setClearingHistory(false)
    }
  }

  const handleAsk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return
    if (selectedDocumentIds.length === 0) {
      setError('Select at least one ready PDF before asking a question.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await askQuestion({
        question: trimmedQuestion,
        document_ids: selectedDocumentIds,
        conversation_id: activeConversation?.conversation_id,
      })
      setQuestion('')
      await Promise.all([refreshDocuments(), refreshConversations()])
      const conversation = (await getConversations()).items.find(
        (item) => item.conversation_id === response.conversation_id,
      )
      if (conversation) setActiveConversation(conversation)
      const page = await getMessages(response.conversation_id)
      setMessages(page.items)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your question could not be answered.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true"><FileText weight="duotone" /></div>
        <div className="brand-copy">
          <h1>PDF Chat Assistant</h1>
          <p>Ask questions about your PDFs</p>
        </div>
        <span className={`connection-dot ${health}`} title={`API ${health}`} aria-label={`API ${health}`} />
      </header>

      {error && (
        <div className="notice" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X /></button>
        </div>
      )}

      <div className={`workspace ${documents.length === 0 ? 'without-sidebar' : ''}`}>
        {documents.length > 0 && <aside className="sidebar">
          <section className="documents-section">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">Library</span>
                <h2>Documents</h2>
              </div>
              <span className="item-count" aria-label={`${documents.length} documents`}>{documents.length}</span>
            </div>
            <form className="upload-form" onSubmit={handleUpload}>
              <label
                className={`file-drop ${dragging ? 'dragging' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <span className="upload-icon"><CloudArrowUp weight="regular" /></span>
                <span className="upload-copy">
                  <strong>{uploading ? 'Uploading…' : 'Add a PDF'}</strong>
                  <small>{uploading ? 'Preparing your document' : 'Drop here or click to browse · 50 MB max'}</small>
                </span>
                <input
                  name="pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={uploading}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                />
              </label>
              <button className="sr-only" type="submit">Upload PDF</button>
            </form>

            <div className="document-list">
              {documents.map((document) => {
                const selectable = document.status === 'ready'
                const selected = selectedDocumentIds.includes(document.document_id)
                return (
                  <article className={`document-card ${selected ? 'selected' : ''}`} key={document.document_id}>
                    <button className="document-select" type="button" disabled={!selectable} aria-pressed={selected} onClick={() => toggleDocument(document.document_id)}>
                      <span className="file-icon"><FilePdf weight="fill" /><small>PDF</small></span>
                      <span className="document-info">
                        <strong title={document.filename}>{document.filename}</strong>
                        <span className={`document-status ${document.status}`}>
                          {document.status === 'ready' && <CheckCircle weight="fill" />}
                          {document.status === 'ready' ? 'Ready to chat' : document.status}
                        </span>
                      </span>
                      {document.page_count && <span className="page-count">{document.page_count} pages</span>}
                    </button>
                    <button className="document-menu" type="button" aria-label={`Delete ${document.filename}`} title="Delete PDF" onClick={() => void handleDeleteDocument(document.document_id)}>
                      <Trash weight="duotone" />
                    </button>
                    {document.error_message && <p className="document-error">{document.error_message}</p>}
                  </article>
                )
              })}
            </div>
          </section>

          {conversations.length > 0 && (
            <section className="recent-section">
              <div className="recent-heading">
                <div>
                  <span className="section-eyebrow">History</span>
                  <h2>Chat history</h2>
                </div>
                <div className="history-heading-actions">
                  <span className="item-count" aria-label={`${conversations.length} conversations`}>{conversations.length}</span>
                  <button className="clear-history" type="button" disabled={busy || clearingHistory} onClick={() => void handleClearHistory()}>
                    {clearingHistory ? 'Clearing\u2026' : 'Clear all'}
                  </button>
                </div>
              </div>

              <button className="new-conversation" type="button" disabled={busy || clearingHistory || selectedDocumentIds.length === 0} onClick={() => void handleNewConversation()}>
                <Plus weight="bold" />
                <span>New chat</span>
              </button>

              <div className="conversation-list" aria-label="Chat history">
                {groupedConversations.map((group) => (
                  <section className="conversation-group" key={group.key}>
                    <div className="conversation-group-heading">
                      <h3>{group.label}</h3>
                      <span>{group.items.length}</span>
                    </div>
                    {group.items.map((conversation) => {
                      const isActive = activeConversation?.conversation_id === conversation.conversation_id
                      const relatedDocuments = conversation.document_ids
                        .map((id) => documentsById.get(id)?.filename)
                        .filter((filename): filename is string => Boolean(filename))
                      const documentLabel = relatedDocuments.length === 0
                        ? `${conversation.document_ids.length} ${conversation.document_ids.length === 1 ? 'document' : 'documents'}`
                        : relatedDocuments.length === 1
                          ? relatedDocuments[0]
                          : `${relatedDocuments[0]} +${relatedDocuments.length - 1}`

                      return (
                        <div className={`conversation-row ${isActive ? 'active' : ''}`} key={conversation.conversation_id}>
                          <button type="button" className="conversation-open" disabled={clearingHistory} onClick={() => void openConversation(conversation)} aria-current={isActive ? 'true' : undefined}>
                            <span className="conversation-icon"><ChatCircleDots weight={isActive ? 'fill' : 'regular'} /></span>
                            <span className="conversation-copy">
                              <span className="conversation-title">{conversation.title || 'PDF conversation'}</span>
                              <span className="conversation-meta">
                                <span title={relatedDocuments.join(', ')}>{documentLabel}</span>
                                <b aria-hidden="true">&middot;</b>
                                <time dateTime={conversation.updated_at}>{group.key === 'today' ? formatTime(conversation.updated_at) : formatHistoryDate(conversation.updated_at)}</time>
                              </span>
                            </span>
                          </button>
                          <button type="button" className="conversation-delete" disabled={clearingHistory} aria-label={`Delete ${conversation.title || 'conversation'}`} title="Delete conversation" onClick={() => void handleDeleteConversation(conversation)}><Trash /></button>
                        </div>
                      )
                    })}
                  </section>
                ))}
              </div>
            </section>
          )}
        </aside>}

        <section className={`chat-panel ${messages.length === 0 ? 'empty' : ''}`}>
          <div className="chat-transcript" ref={transcriptRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-icon"><Robot weight="duotone" /></div>
                <h3>Ask your document anything</h3>
                <p>{readyDocuments.length > 0 ? 'Select a ready PDF, then type your question below.' : 'Upload a PDF to start asking grounded questions.'}</p>
                {documents.length === 0 && (
                  <form className="upload-form chat-upload-form" onSubmit={handleUpload}>
                    <label
                      className={`file-drop chat-file-drop ${dragging ? 'dragging' : ''}`}
                      onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={() => setDragging(false)}
                      onDrop={handleDrop}
                    >
                      <span className="upload-icon"><CloudArrowUp weight="regular" /></span>
                      <span className="upload-copy">
                        <strong>{uploading ? 'Uploading…' : 'Add a PDF'}</strong>
                        <small>{uploading ? 'Preparing your document' : 'Drop here or click to browse · 50 MB max'}</small>
                      </span>
                      <input
                        name="pdf"
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={uploading}
                        onChange={(event) => event.currentTarget.form?.requestSubmit()}
                      />
                    </label>
                    <button className="sr-only" type="submit">Upload PDF</button>
                  </form>
                )}
              </div>
            ) : (
              <div className="message-list">
                {messages.map((message) => (
                  <article className={`message ${message.role}`} key={message.message_id}>
                    {message.role === 'assistant' && <div className="message-avatar"><Robot weight="duotone" /></div>}
                    <div className="message-stack">
                      <div className="message-bubble">
                        {message.role === 'assistant' ? (
                          <div className="message-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <p>{message.content}</p>
                        )}
                        {message.role === 'assistant' && message.citations?.length > 0 && <CitationList citations={message.citations} />}
                      </div>
                      <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                    </div>
                  </article>
                ))}
                {busy && <div className="thinking"><span /><span /><span /></div>}
              </div>
            )}
          </div>
          <form className="ask-form" onSubmit={handleAsk}>
            <label className="sr-only" htmlFor="question">Ask a question about your PDF</label>
            <textarea
              id="question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about your PDF..."
              maxLength={4000}
              rows={1}
              disabled={busy || selectedDocumentIds.length === 0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
            />
            <button className="send-button" disabled={busy || !question.trim() || selectedDocumentIds.length === 0} type="submit">
              <PaperPlaneTilt weight="regular" /> <span>{busy ? 'Working…' : 'Send'}</span>
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}

function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <div className="citations">
      {citations.map((citation) => (
        <details className="citation" key={`${citation.document_id}-${citation.chunk_id}`}>
          <summary><FileText /> <span>Source: {citation.filename}</span><b>·</b><span>Page {citation.page}</span></summary>
          {citation.excerpt && <p>{citation.excerpt}</p>}
        </details>
      ))}
    </div>
  )
}

export default App
