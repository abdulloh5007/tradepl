import { useCallback, useEffect, useMemo, useState } from "react"
import { Banknote, Bitcoin, Coins, CreditCard, Landmark, Wallet } from "lucide-react"
import type { DepositPaymentMethod } from "./types"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

type DepositMethodsCardProps = {
  lang: Lang
  baseUrl: string
  headers: Record<string, string>
  canAccess: boolean
}

const methodOrder = [
  "visa_sum",
  "mastercard",
  "visa_usd",
  "humo",
  "uzcard",
  "paypal",
  "ton",
  "usdt",
  "btc",
]

const methodIcon = (id: string) => {
  const key = String(id || "").toLowerCase()
  if (key === "humo" || key === "uzcard") return Landmark
  if (key === "paypal") return Wallet
  if (key === "ton") return Coins
  if (key === "usdt") return Banknote
  if (key === "btc") return Bitcoin
  return CreditCard
}

const methodTitle = (method: DepositPaymentMethod, lang: Lang) => {
  const key = `accounts.paymentMethod.${method.id}`
  const translated = t(key, lang)
  if (translated !== key) return translated
  return method.title
}

const normalize = (items?: DepositPaymentMethod[] | null): DepositPaymentMethod[] => {
  const map = new Map<string, DepositPaymentMethod>()
  for (const item of items || []) {
    const id = String(item?.id || "").trim().toLowerCase()
    if (!id) continue
    map.set(id, {
      id,
      title: String(item?.title || id).trim(),
      details: String(item?.details || "").trim(),
      enabled: Boolean(String(item?.details || "").trim()),
    })
  }
  return methodOrder.map((id) => {
    const existing = map.get(id)
    if (existing) return existing
    return { id, title: id.toUpperCase(), details: "", enabled: false }
  })
}

export default function DepositMethodsCard({ lang, baseUrl, headers, canAccess }: DepositMethodsCardProps) {
  const [methods, setMethods] = useState<DepositPaymentMethod[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeCount = useMemo(() => methods.filter((m) => m.details.trim().length > 0).length, [methods])

  const load = useCallback(async () => {
    if (!canAccess) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${baseUrl}/v1/admin/deposit-methods`, { headers })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t("manage.depositMethods.errorLoad", lang))
      setMethods(normalize(Array.isArray(body?.methods) ? body.methods : []))
    } catch (e: any) {
      setError(e?.message || t("manage.depositMethods.errorLoad", lang))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, headers, canAccess, lang])

  useEffect(() => {
    if (!canAccess) return
    load()
  }, [canAccess, load])

  if (!canAccess) return null

  return (
    <div className="admin-card full-width">
      <div className="admin-card-header">
        <CreditCard size={18} />
        <h2>{t("manage.depositMethods.title", lang)}</h2>
      </div>

      {error ? <div className="system-health-error">{error}</div> : null}

      {loading ? (
        <div className="no-events">{t("common.loading", lang)}</div>
      ) : (
        <>
          <p className="deposit-methods-desc">{t("manage.depositMethods.desc", lang)}</p>
          <div className="deposit-methods-grid">
            {methods.map((method) => {
              const Icon = methodIcon(method.id)
              const enabled = method.details.trim().length > 0
              return (
                <div key={method.id} className={`deposit-method-card ${enabled ? "enabled" : "disabled"}`}>
                  <div className="deposit-method-card-head">
                    <span className="deposit-method-title"><Icon size={14} /> {methodTitle(method, lang)}</span>
                    <span className="deposit-method-state">{enabled ? t("manage.depositMethods.stateEnabled", lang) : t("manage.depositMethods.stateDisabled", lang)}</span>
                  </div>
                  <textarea
                    className="deposit-method-input"
                    rows={2}
                    placeholder={t("manage.depositMethods.placeholder", lang)}
                    value={method.details}
                    onChange={(e) => {
                      const value = e.target.value
                      setMethods((prev) => prev.map((item) => item.id === method.id
                        ? { ...item, details: value, enabled: value.trim().length > 0 }
                        : item))
                    }}
                  />
                </div>
              )
            })}
          </div>

          <div className="risk-actions">
            <button
              className="add-event-btn"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                setError(null)
                try {
                  const payload = { methods: methods.map((m) => ({ id: m.id, details: m.details.trim() })) }
                  const res = await fetch(`${baseUrl}/v1/admin/deposit-methods`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                  })
                  const body = await res.json().catch(() => null)
                  if (!res.ok) throw new Error(body?.error || t("manage.depositMethods.errorSave", lang))
                  setMethods(normalize(Array.isArray(body?.methods) ? body.methods : []))
                } catch (e: any) {
                  setError(e?.message || t("manage.depositMethods.errorSave", lang))
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving
                ? t("common.saving", lang)
                : t("manage.depositMethods.save", lang).replace("{count}", String(activeCount))}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
