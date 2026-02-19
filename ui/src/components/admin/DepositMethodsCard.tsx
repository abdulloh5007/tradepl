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

const DEFAULT_METHOD_MIN_USD = "10.00"
const DEFAULT_METHOD_MAX_USD = "1000.00"

const methodTitle = (method: DepositPaymentMethod, lang: Lang) => {
  const key = `accounts.paymentMethod.${method.id}`
  const translated = t(key, lang)
  if (translated !== key) return translated
  return method.title
}

const sanitizeAmountInput = (value: string) => {
  const cleaned = String(value || "").replace(/\s+/g, "").replace(/,/g, ".").replace(/[^\d.]/g, "")
  const firstDot = cleaned.indexOf(".")
  if (firstDot === -1) return cleaned
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "")
}

const toPositiveAmount = (value: string): number | null => {
  const n = Number(String(value || "").trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

const normalize = (items?: DepositPaymentMethod[] | null): DepositPaymentMethod[] => {
  const map = new Map<string, DepositPaymentMethod>()
  for (const item of items || []) {
    const id = String(item?.id || "").trim().toLowerCase()
    if (!id) continue
    const minAmount = toPositiveAmount(String(item?.min_amount_usd || "").replace(",", ".")) ?? Number(DEFAULT_METHOD_MIN_USD)
    const maxAmount = toPositiveAmount(String(item?.max_amount_usd || "").replace(",", ".")) ?? Number(DEFAULT_METHOD_MAX_USD)
    const normalizedMin = minAmount.toFixed(2)
    const normalizedMax = Math.max(maxAmount, minAmount).toFixed(2)
    map.set(id, {
      id,
      title: String(item?.title || id).trim(),
      details: String(item?.details || "").trim(),
      enabled: Boolean(item?.enabled),
      min_amount_usd: normalizedMin,
      max_amount_usd: normalizedMax,
    })
  }
  return methodOrder.map((id) => {
    const existing = map.get(id)
    if (existing) return existing
    return {
      id,
      title: id.toUpperCase(),
      details: "",
      enabled: false,
      min_amount_usd: DEFAULT_METHOD_MIN_USD,
      max_amount_usd: DEFAULT_METHOD_MAX_USD,
    }
  })
}

export default function DepositMethodsCard({ lang, baseUrl, headers, canAccess }: DepositMethodsCardProps) {
  const [methods, setMethods] = useState<DepositPaymentMethod[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const activeCount = useMemo(() => methods.filter((m) => m.enabled).length, [methods])

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
              const enabled = method.enabled
              return (
                <div key={method.id} className={`deposit-method-card ${enabled ? "enabled" : "disabled"}`}>
                  <div className="deposit-method-card-head">
                    <span className="deposit-method-title">
                      <PaymentMethodIcon methodID={method.id} size={14} className="deposit-method-icon-media" /> {methodTitle(method, lang)}
                    </span>
                    <div className="deposit-method-head-controls">
                      <span className="deposit-method-state">{enabled ? t("manage.depositMethods.stateEnabled", lang) : t("manage.depositMethods.stateDisabled", lang)}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        className={`deposit-method-toggle ${enabled ? "enabled" : ""}`}
                        onClick={() => {
                          setMethods((prev) => prev.map((item) => item.id === method.id
                            ? { ...item, enabled: !item.enabled }
                            : item))
                          setFieldErrors((prev) => ({ ...prev, [method.id]: "" }))
                        }}
                      >
                        <span className="deposit-method-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                  <input
                    className="deposit-method-input"
                    placeholder={methodFormatExample(method.id)}
                    value={method.details}
                    onChange={(e) => {
                      const value = formatMethodInputForEditing(method.id, e.target.value)
                      setMethods((prev) => prev.map((item) => item.id === method.id
                        ? { ...item, details: value }
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
                  <div className="deposit-method-limits-grid">
                    <label className="deposit-method-limit-field">
                      <span>{t("manage.depositMethods.minAmount", lang)}</span>
                      <input
                        className="deposit-method-input"
                        inputMode="decimal"
                        value={String(method.min_amount_usd || "")}
                        onChange={(e) => {
                          const value = sanitizeAmountInput(e.target.value)
                          setMethods((prev) => prev.map((item) => item.id === method.id
                            ? { ...item, min_amount_usd: value }
                            : item))
                          setFieldErrors((prev) => ({ ...prev, [method.id]: "" }))
                        }}
                        onBlur={(e) => {
                          const parsed = toPositiveAmount(e.target.value)
                          if (parsed == null) return
                          setMethods((prev) => prev.map((item) => item.id === method.id
                            ? { ...item, min_amount_usd: parsed.toFixed(2) }
                            : item))
                        }}
                      />
                    </label>
                    <label className="deposit-method-limit-field">
                      <span>{t("manage.depositMethods.maxAmount", lang)}</span>
                      <input
                        className="deposit-method-input"
                        inputMode="decimal"
                        value={String(method.max_amount_usd || "")}
                        onChange={(e) => {
                          const value = sanitizeAmountInput(e.target.value)
                          setMethods((prev) => prev.map((item) => item.id === method.id
                            ? { ...item, max_amount_usd: value }
                            : item))
                          setFieldErrors((prev) => ({ ...prev, [method.id]: "" }))
                        }}
                        onBlur={(e) => {
                          const parsed = toPositiveAmount(e.target.value)
                          if (parsed == null) return
                          setMethods((prev) => prev.map((item) => item.id === method.id
                            ? { ...item, max_amount_usd: parsed.toFixed(2) }
                            : item))
                        }}
                      />
                    </label>
                  </div>
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
                    if (m.enabled && !value) {
                      nextErrors[m.id] = t("manage.depositMethods.requiredDetailsEnabled", lang)
                    }
                    let normalizedDetails = value
                    if (value) {
                      const check = validateAndNormalizeMethodInput(m.id, value)
                      if (!check.valid) {
                        nextErrors[m.id] = t("manage.depositMethods.invalid", lang)
                      } else {
                        normalizedDetails = check.normalized
                      }
                    }
                    const minAmount = toPositiveAmount(String(m.min_amount_usd || "").replace(",", "."))
                    const maxAmount = toPositiveAmount(String(m.max_amount_usd || "").replace(",", "."))
                    if (minAmount == null || maxAmount == null) {
                      nextErrors[m.id] = t("manage.depositMethods.invalidLimits", lang)
                    } else if (maxAmount < minAmount) {
                      nextErrors[m.id] = t("manage.depositMethods.invalidLimitsRange", lang)
                    }
                    return {
                      id: m.id,
                      details: normalizedDetails,
                      enabled: Boolean(m.enabled),
                      min_amount_usd: minAmount == null ? DEFAULT_METHOD_MIN_USD : minAmount.toFixed(2),
                      max_amount_usd: maxAmount == null ? DEFAULT_METHOD_MAX_USD : maxAmount.toFixed(2),
                    }
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
