import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { ArrowLeft, LifeBuoy, SendHorizontal } from "lucide-react"
import type { SupportConversation, SupportMessage } from "../../api"
import type { Lang } from "../../types"
import TelegramBackButton from "../../components/telegram/TelegramBackButton"
import { t } from "../../utils/i18n"
import "./SupportPage.css"

interface SupportPageProps {
  lang: Lang
  onBack: () => void
  fetchConversation: () => Promise<{ conversation: SupportConversation | null }>
  fetchMessages: (params?: { limit?: number; before_id?: number }) => Promise<{ items: SupportMessage[] }>
  sendMessage: (message: string) => Promise<SupportMessage>
  markRead: () => Promise<void>
}

const pageSize = 50

function formatDateTime(raw: string, lang: Lang): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ""
  const locale = lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US"
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function mergeMessages(prev: SupportMessage[], next: SupportMessage[]): SupportMessage[] {
  if (next.length === 0) return prev
  const byID = new Map<number, SupportMessage>()
  for (const item of prev) byID.set(Number(item.id), item)
  for (const item of next) byID.set(Number(item.id), item)
  return Array.from(byID.values()).sort((a, b) => Number(a.id) - Number(b.id))
}

export default function SupportPage({
  lang,
  onBack,
  fetchConversation,
  fetchMessages,
  sendMessage,
  markRead,
}: SupportPageProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sending, setSending] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [conversation, setConversation] = useState<SupportConversation | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState("")
  const [error, setError] = useState("")

  const statusLabel = useMemo(() => {
    if (!conversation || conversation.status === "open") return t("support.statusOpen", lang)
    return t("support.statusClosed", lang)
  }, [conversation, lang])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = listRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
  }, [])

  const markReadIfNeeded = useCallback((items: SupportMessage[]) => {
    const hasUnreadIncoming = items.some(item => item.sender_type !== "user" && !item.read_by_user)
    if (!hasUnreadIncoming) return
    markRead()
      .then(() => {
        setMessages(prev =>
          prev.map(item => item.sender_type === "user" ? item : { ...item, read_by_user: true })
        )
      })
      .catch(() => {
        // Keep UI responsive even if marking read fails.
      })
  }, [markRead])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [conversationRes, messagesRes] = await Promise.all([
        fetchConversation(),
        fetchMessages({ limit: pageSize }),
      ])
      setConversation(conversationRes.conversation)
      setMessages(messagesRes.items || [])
      setHasMore((messagesRes.items || []).length >= pageSize)
      markReadIfNeeded(messagesRes.items || [])
      window.requestAnimationFrame(() => scrollToBottom())
    } catch (err: any) {
      setError(err?.message || t("support.loadFailed", lang))
    } finally {
      setLoading(false)
    }
  }, [fetchConversation, fetchMessages, lang, markReadIfNeeded, scrollToBottom])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const [conversationRes, messagesRes] = await Promise.all([
          fetchConversation(),
          fetchMessages({ limit: pageSize }),
        ])
        setConversation(conversationRes.conversation)
        setMessages(prev => mergeMessages(prev, messagesRes.items || []))
        markReadIfNeeded(messagesRes.items || [])
      } catch {
        // Ignore poll errors; user can continue typing/retrying.
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [fetchConversation, fetchMessages, markReadIfNeeded])

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const firstID = Number(messages[0]?.id || 0)
    if (!Number.isFinite(firstID) || firstID <= 0) {
      setHasMore(false)
      return
    }
    setLoadingMore(true)
    setError("")

    const element = listRef.current
    const previousHeight = element?.scrollHeight || 0

    try {
      const res = await fetchMessages({ limit: pageSize, before_id: firstID })
      const page = res.items || []
      setMessages(prev => mergeMessages(page, prev))
      setHasMore(page.length >= pageSize)
      window.requestAnimationFrame(() => {
        if (!element) return
        const nextHeight = element.scrollHeight
        const delta = nextHeight - previousHeight
        if (delta > 0) {
          element.scrollTop += delta
        }
      })
    } catch (err: any) {
      setError(err?.message || t("support.loadFailed", lang))
    } finally {
      setLoadingMore(false)
    }
  }, [fetchMessages, hasMore, lang, loadingMore, messages])

  const handleSubmit = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return

    setSending(true)
    setError("")
    try {
      const created = await sendMessage(text)
      setDraft("")
      setMessages(prev => mergeMessages(prev, [created]))
      setConversation(prev => {
        const nowISO = created.created_at
        if (!prev) {
          return {
            id: created.conversation_id,
            status: "open",
            created_at: nowISO,
            updated_at: nowISO,
            last_message_at: nowISO,
            last_message_text: created.body,
            last_message_from: "user",
            unread_for_user: 0,
            unread_for_admin: 1,
            total_message_count: 1,
          }
        }
        return {
          ...prev,
          status: "open",
          updated_at: nowISO,
          last_message_at: nowISO,
          last_message_text: created.body,
          last_message_from: "user",
          total_message_count: prev.total_message_count + 1,
        }
      })
      window.requestAnimationFrame(() => scrollToBottom("smooth"))
    } catch (err: any) {
      setError(err?.message || t("support.sendFailed", lang))
    } finally {
      setSending(false)
    }
  }, [draft, scrollToBottom, sendMessage, sending, lang])

  const handleDraftKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    void handleSubmit()
  }

  return (
    <div className="support-page">
      <header className="support-header">
        <TelegramBackButton
          onBack={onBack}
          fallbackClassName="support-back-btn"
          fallbackAriaLabel={t("support.back", lang)}
          fallbackChildren={<ArrowLeft size={18} />}
        />
        <div className="support-header-main">
          <h2 className="support-title">{t("support.title", lang)}</h2>
          <p className="support-subtitle">{t("support.subtitle", lang)}</p>
        </div>
        <div className={`support-status-chip ${conversation?.status === "closed" ? "closed" : "open"}`}>
          <LifeBuoy size={13} />
          <span>{statusLabel}</span>
        </div>
      </header>

      <div className="support-thread" ref={listRef}>
        {loading ? (
          <div className="support-empty">{t("support.loading", lang)}</div>
        ) : (
          <>
            {hasMore ? (
              <button
                type="button"
                className="support-load-more"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t("support.loading", lang) : t("support.loadMore", lang)}
              </button>
            ) : null}
            {messages.length === 0 ? (
              <div className="support-empty">{t("support.empty", lang)}</div>
            ) : (
              messages.map(item => {
                const fromUser = item.sender_type === "user"
                return (
                  <article key={item.id} className={`support-message ${fromUser ? "from-user" : "from-admin"}`}>
                    <div className="support-message-meta">
                      <span>{fromUser ? t("support.you", lang) : item.sender_admin_username || t("support.agent", lang)}</span>
                      <time>{formatDateTime(item.created_at, lang)}</time>
                    </div>
                    <div className="support-message-body">{item.body}</div>
                  </article>
                )
              })
            )}
          </>
        )}
      </div>

      <div className="support-compose">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKeyDown}
          placeholder={t("support.placeholder", lang)}
          rows={3}
          maxLength={2000}
          disabled={sending}
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={sending || draft.trim().length === 0}
        >
          <SendHorizontal size={16} />
          <span>{sending ? t("support.sending", lang) : t("support.send", lang)}</span>
        </button>
      </div>

      {error ? <p className="support-error">{error}</p> : null}
    </div>
  )
}
