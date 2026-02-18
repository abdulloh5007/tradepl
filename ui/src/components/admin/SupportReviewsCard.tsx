import { useCallback, useEffect, useMemo, useState } from "react"
import { LifeBuoy, Lock, Send, User } from "lucide-react"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

type SupportConversation = {
  id: string
  user_id?: string
  user_email?: string
  user_display_name?: string
  status: "open" | "closed" | string
  created_at: string
  updated_at: string
  last_message_at: string
  last_message_text: string
  last_message_from: "user" | "admin" | "system" | string
  unread_for_user: number
  unread_for_admin: number
  total_message_count: number
}

type SupportMessage = {
  id: number
  conversation_id: string
  sender_type: "user" | "admin" | "system" | string
  sender_admin_username?: string
  body: string
  read_by_user: boolean
  read_by_admin: boolean
  created_at: string
}

interface SupportReviewsCardProps {
  lang: Lang
  baseUrl: string
  headers: Record<string, string>
  canAccess: boolean
}

const pageLimit = 50

const formatDateTime = (value: string, lang: Lang): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const locale = lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US"
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export default function SupportReviewsCard({ lang, baseUrl, headers, canAccess }: SupportReviewsCardProps) {
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open")
  const [conversations, setConversations] = useState<SupportConversation[]>([])
  const [selectedConversationID, setSelectedConversationID] = useState("")
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")

  const selectedConversation = useMemo(
    () => conversations.find(item => item.id === selectedConversationID) || null,
    [conversations, selectedConversationID]
  )

  const fetchConversations = useCallback(async () => {
    if (!canAccess) return
    setLoadingConversations(true)
    setError("")
    try {
      const url = `${baseUrl}/v1/admin/support/conversations?status=${statusFilter}&limit=100`
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || t("manage.support.error.loadConversations", lang))
      }
      const data = await res.json().catch(() => null)
      const items: SupportConversation[] = Array.isArray(data?.items) ? data.items : []
      setConversations(items)
      setSelectedConversationID(prev => {
        if (prev && items.some(item => item.id === prev)) return prev
        return items[0]?.id || ""
      })
    } catch (err: any) {
      setError(err?.message || t("manage.support.error.loadConversations", lang))
      setConversations([])
      setSelectedConversationID("")
    } finally {
      setLoadingConversations(false)
    }
  }, [canAccess, baseUrl, headers, statusFilter, lang])

  const fetchMessages = useCallback(async (conversationID: string) => {
    if (!canAccess || !conversationID) return
    setLoadingMessages(true)
    setError("")
    try {
      const url = `${baseUrl}/v1/admin/support/messages?conversation_id=${encodeURIComponent(conversationID)}&limit=${pageLimit}`
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || t("manage.support.error.loadMessages", lang))
      }
      const data = await res.json().catch(() => null)
      const items: SupportMessage[] = Array.isArray(data?.items) ? data.items : []
      setMessages(items)
      await fetch(`${baseUrl}/v1/admin/support/conversations/${encodeURIComponent(conversationID)}/read`, {
        method: "POST",
        headers,
      }).catch(() => null)
      setConversations(prev =>
        prev.map(item => item.id === conversationID ? { ...item, unread_for_admin: 0 } : item)
      )
    } catch (err: any) {
      setError(err?.message || t("manage.support.error.loadMessages", lang))
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }, [canAccess, baseUrl, headers, lang])

  useEffect(() => {
    void fetchConversations()
  }, [fetchConversations])

  useEffect(() => {
    if (!selectedConversationID) {
      setMessages([])
      return
    }
    void fetchMessages(selectedConversationID)
  }, [selectedConversationID, fetchMessages])

  const sendReply = async () => {
    const message = draft.trim()
    if (!message || !selectedConversationID || sending) return
    setSending(true)
    setError("")
    try {
      const res = await fetch(`${baseUrl}/v1/admin/support/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          conversation_id: selectedConversationID,
          message,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || t("manage.support.error.sendReply", lang))
      }
      setDraft("")
      await fetchMessages(selectedConversationID)
      await fetchConversations()
    } catch (err: any) {
      setError(err?.message || t("manage.support.error.sendReply", lang))
    } finally {
      setSending(false)
    }
  }

  const setConversationStatus = async (status: "open" | "closed") => {
    if (!selectedConversationID) return
    setError("")
    try {
      const res = await fetch(`${baseUrl}/v1/admin/support/conversations/${encodeURIComponent(selectedConversationID)}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || t("manage.support.error.updateStatus", lang))
      }
      setConversations(prev => prev.map(item => item.id === selectedConversationID ? { ...item, status } : item))
    } catch (err: any) {
      setError(err?.message || t("manage.support.error.updateStatus", lang))
    }
  }

  if (!canAccess) {
    return (
      <div className="admin-card full-width">
        <div className="admin-card-header">
          <Lock size={18} />
          <h2>{t("manage.support.title", lang)}</h2>
        </div>
        <div className="no-events">
          <Lock size={18} />
          <span>{t("manage.support.noAccess", lang)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-card full-width">
      <div className="admin-card-header">
        <LifeBuoy size={18} />
        <h2>{t("manage.support.title", lang)}</h2>
      </div>

      <div className="support-review-toolbar">
        <label htmlFor="support-status-filter">{t("manage.support.filter", lang)}</label>
        <select
          id="support-status-filter"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "open" | "closed" | "all")}
        >
          <option value="open">{t("manage.support.status.open", lang)}</option>
          <option value="closed">{t("manage.support.status.closed", lang)}</option>
          <option value="all">{t("manage.support.status.all", lang)}</option>
        </select>
        <button type="button" className="system-health-refresh" onClick={() => void fetchConversations()} disabled={loadingConversations}>
          {t("manage.system.refresh", lang)}
        </button>
      </div>

      {error ? <div className="system-health-error">{error}</div> : null}

      <div className="support-review-grid">
        <div className="support-review-conversations">
          {loadingConversations ? (
            <div className="no-events"><span>{t("common.loading", lang)}</span></div>
          ) : conversations.length === 0 ? (
            <div className="no-events"><span>{t("manage.support.empty", lang)}</span></div>
          ) : (
            conversations.map(conversation => {
              const selected = conversation.id === selectedConversationID
              const displayName = (conversation.user_display_name || "").trim() || (conversation.user_email || "").trim() || conversation.user_id || "—"
              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`support-conversation-item ${selected ? "active" : ""}`}
                  onClick={() => setSelectedConversationID(conversation.id)}
                >
                  <div className="support-conversation-top">
                    <strong>{displayName}</strong>
                    <span className={`support-status-badge ${conversation.status === "closed" ? "closed" : "open"}`}>
                      {conversation.status === "closed" ? t("manage.support.status.closed", lang) : t("manage.support.status.open", lang)}
                    </span>
                  </div>
                  <p>{conversation.last_message_text || "—"}</p>
                  <div className="support-conversation-bottom">
                    <span>{formatDateTime(conversation.last_message_at, lang)}</span>
                    {conversation.unread_for_admin > 0 ? (
                      <span className="support-unread-badge">{conversation.unread_for_admin}</span>
                    ) : null}
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="support-review-thread">
          {!selectedConversation ? (
            <div className="no-events">
              <User size={18} />
              <span>{t("manage.support.selectConversation", lang)}</span>
            </div>
          ) : (
            <>
              <div className="support-thread-header">
                <div>
                  <strong>{(selectedConversation.user_display_name || "").trim() || selectedConversation.user_email || selectedConversation.user_id}</strong>
                  <span>{selectedConversation.user_email || selectedConversation.user_id}</span>
                </div>
                <div className="support-thread-actions">
                  <button
                    type="button"
                    className="mode-btn"
                    onClick={() => void setConversationStatus("open")}
                    disabled={selectedConversation.status === "open"}
                  >
                    {t("manage.support.openConversation", lang)}
                  </button>
                  <button
                    type="button"
                    className="mode-btn"
                    onClick={() => void setConversationStatus("closed")}
                    disabled={selectedConversation.status === "closed"}
                  >
                    {t("manage.support.closeConversation", lang)}
                  </button>
                </div>
              </div>

              <div className="support-thread-messages">
                {loadingMessages ? (
                  <div className="no-events"><span>{t("common.loading", lang)}</span></div>
                ) : messages.length === 0 ? (
                  <div className="no-events"><span>{t("manage.support.emptyMessages", lang)}</span></div>
                ) : (
                  messages.map(message => {
                    const userSide = message.sender_type === "user"
                    return (
                      <article key={message.id} className={`support-thread-message ${userSide ? "user" : "admin"}`}>
                        <div className="support-thread-message-meta">
                          <span>{userSide ? t("manage.support.sender.user", lang) : (message.sender_admin_username || t("manage.support.sender.support", lang))}</span>
                          <time>{formatDateTime(message.created_at, lang)}</time>
                        </div>
                        <p>{message.body}</p>
                      </article>
                    )
                  })
                )}
              </div>

              <div className="support-thread-compose">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t("manage.support.replyPlaceholder", lang)}
                  rows={3}
                  maxLength={2000}
                />
                <button type="button" className="add-event-btn" onClick={() => void sendReply()} disabled={sending || !draft.trim()}>
                  <Send size={16} />
                  <span>{sending ? t("manage.support.sending", lang) : t("manage.support.sendReply", lang)}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
