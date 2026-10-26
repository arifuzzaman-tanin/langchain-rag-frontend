const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const API_PREFIX = `${API_BASE_URL}/api/v1`

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface DocumentItem {
  document_id: string
  filename: string
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'expired'
  created_at: string
  expires_at: string
  page_count: number | null
  chunk_count: number | null
  error_code: string | null
  error_message: string | null
}

export interface Conversation {
  conversation_id: string
  document_ids: string[]
  title: string | null
  created_at: string
  updated_at: string
}

export interface Citation {
  citation_id: string
  document_id: string
  filename: string
  page: number
  chunk_id: string
  excerpt: string | null
}

export interface Message {
  message_id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  sequence: number
  created_at: string
}

interface ApiError {
  error?: {
    message?: string
    details?: unknown
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options)
  } catch {
    throw new Error(`Cannot reach the API${API_BASE_URL ? ` at ${API_BASE_URL}` : ''}. Make sure the backend is running.`)
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = (await response.json()) as ApiError
      if (body.error?.message) message = body.error.message
    } catch {
      // Keep the HTTP status message when the server did not return a JSON error.
    }
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function getDocuments() {
  return request<Page<DocumentItem>>(`${API_PREFIX}/documents?limit=100&offset=0`)
}

export function uploadDocument(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<DocumentItem>(`${API_PREFIX}/documents`, { method: 'POST', body: form })
}

export function deleteDocument(documentId: string) {
  return request<void>(`${API_PREFIX}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' })
}

export function getConversations(limit = 100, offset = 0) {
  return request<Page<Conversation>>(`${API_PREFIX}/conversations?limit=${limit}&offset=${offset}`)
}

export function createConversation(documentIds: string[]) {
  return request<Conversation>(`${API_PREFIX}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_ids: documentIds }),
  })
}

export function deleteConversation(conversationId: string) {
  return request<void>(`${API_PREFIX}/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
}

export function getMessages(conversationId: string) {
  return request<Page<Message>>(
    `${API_PREFIX}/conversations/${encodeURIComponent(conversationId)}/messages?limit=100&offset=0`,
  )
}

export function askQuestion(input: { question: string; document_ids: string[]; conversation_id?: string }) {
  return request<{ answer: string; conversation_id: string; citations: Citation[]; request_id: string }>(
    `${API_PREFIX}/chat/ask`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function getHealth() {
  return request<{ status: string; checks?: Record<string, boolean> }>('/health/ready')
}
