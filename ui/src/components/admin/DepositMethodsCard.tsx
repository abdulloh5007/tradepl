import { useCallback, useEffect, useMemo, useState } from "react"
import { CreditCard } from "lucide-react"
import type { DepositPaymentMethod } from "./types"
import type { Lang } from "../../types"
import { t } from "../../utils/i18n"
import PaymentMethodIcon from "../accounts/PaymentMethodIcon"
import {
  formatMethodInputForEditing,
  methodFormatExample,
  validateAndNormalizeMethodInput,
} from "../../utils/paymentMethodFormats"

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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
              const enabled = method.details.trim().length > 0
              return (
                <div key={method.id} className={`deposit-method-card ${enabled ? "enabled" : "disabled"}`}>
                  <div className="deposit-method-card-head">
                    <span className="deposit-method-title">
                      <PaymentMethodIcon methodID={method.id} size={14} className="deposit-method-icon-media" /> {methodTitle(method, lang)}
                    </span>
                    <span className="deposit-method-state">{enabled ? t("manage.depositMethods.stateEnabled", lang) : t("manage.depositMethods.stateDisabled", lang)}</span>
                  </div>
                  <input
                    className="deposit-method-input"
                    placeholder={methodFormatExample(method.id)}
                    value={method.details}
                    onChange={(e) => {
                      const value = formatMethodInputForEditing(method.id, e.target.value)
                      setMethods((prev) => prev.map((item) => item.id === method.id
                        ? { ...item, details: value, enabled: value.trim().length > 0 }
                        : item))
                      setFieldErrors((prev) => ({ ...prev, [method.id]: "" }))
                    }}
                    onBlur={(e) => {
                      const value = String(e.target.value || "").trim()
                      if (!value) {
                        setFieldErrors((prev) => ({ ...prev, [method.id]: "" }))
                        return
                      }
                      const check = validateAndNormalizeMethodInput(method.id, value)
                      if (!check.valid) {
                        setFieldErrors((prev) => ({ ...prev, [method.id]: t("manage.depositMethods.invalid", lang) }))
                        return
                      }
                      setMethods((prev) => prev.map((item) => item.id === method.id ? { ...item, details: check.normalized } : item))
                      setFieldErrors((prev) => ({ ...prev, [method.id]: "" }))
                    }}
                  />
                  <div className="deposit-method-hint">
                    {t("manage.depositMethods.format", lang).replace("{format}", methodFormatExample(method.id))}
                  </div>
                  {fieldErrors[method.id] ? (
                    <div className="deposit-method-error">{fieldErrors[method.id]}</div>
                  ) : null}
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
                  const nextErrors: Record<string, string> = {}
                  const normalizedMethods = methods.map((m) => {
                    const value = String(m.details || "").trim()
                    if (!value) return { id: m.id, details: "" }
                    const check = validateAndNormalizeMethodInput(m.id, value)
                    if (!check.valid) {
                      nextErrors[m.id] = t("manage.depositMethods.invalid", lang)
                      return { id: m.id, details: value }
                    }
                    return { id: m.id, details: check.normalized }
                  })
                  if (Object.keys(nextErrors).length > 0) {
                    setFieldErrors(nextErrors)
                    throw new Error(t("manage.depositMethods.invalid", lang))
                  }

                  setFieldErrors({})
                  const payload = { methods: normalizedMethods }
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
