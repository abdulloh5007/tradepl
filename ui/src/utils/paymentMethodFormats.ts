const cardMethodIDs = new Set(["visa_sum", "mastercard", "visa_usd", "humo", "uzcard"])

const paypalEmailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const btcAddressRegex = /^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/
const usdtTrc20Regex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const usdtErc20Regex = /^0x[a-fA-F0-9]{40}$/
const tonBounceRegex = /^(EQ|UQ)[A-Za-z0-9_-]{46}$/
const tonRawRegex = /^-?\d+:[a-fA-F0-9]{64}$/

export type MethodValidationCode =
  | "required"
  | "card_digits"
  | "paypal_email"
  | "btc_address"
  | "usdt_address"
  | "ton_address"

export type MethodValidationResult = {
  valid: boolean
  normalized: string
  code?: MethodValidationCode
}

const digitsOnly = (value: string) => String(value || "").replace(/\D+/g, "")

const formatCardDigits = (digits: string) => {
  if (!digits) return ""
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim()
}

export const methodFormatExample = (methodID: string) => {
  const id = String(methodID || "").trim().toLowerCase()
  if (cardMethodIDs.has(id)) return "1234 5678 9012 3456"
  if (id === "paypal") return "name@example.com"
  if (id === "btc") return "bc1q... or 1.../3..."
  if (id === "usdt") return "T... (TRC20) or 0x... (ERC20)"
  if (id === "ton") return "EQ... / UQ... / raw"
  return "—"
}

export const formatMethodInputForEditing = (methodID: string, raw: string) => {
  const id = String(methodID || "").trim().toLowerCase()
  const value = String(raw || "")
  if (cardMethodIDs.has(id)) {
    return formatCardDigits(digitsOnly(value).slice(0, 16))
  }
  if (id === "paypal") {
    return value.replace(/\s+/g, "").slice(0, 120).toLowerCase()
  }
  if (id === "btc" || id === "usdt" || id === "ton") {
    return value.replace(/\s+/g, "").slice(0, 128)
  }
  return value
}

export const validateAndNormalizeMethodInput = (methodID: string, raw: string): MethodValidationResult => {
  const id = String(methodID || "").trim().toLowerCase()
  const value = String(raw || "").trim()
  if (!value) return { valid: false, normalized: "", code: "required" }

  if (cardMethodIDs.has(id)) {
    const digits = digitsOnly(value)
    if (digits.length !== 16) return { valid: false, normalized: formatCardDigits(digits.slice(0, 16)), code: "card_digits" }
    return { valid: true, normalized: formatCardDigits(digits) }
  }

  if (id === "paypal") {
    const email = value.replace(/\s+/g, "").toLowerCase()
    if (!paypalEmailRegex.test(email)) return { valid: false, normalized: email, code: "paypal_email" }
    return { valid: true, normalized: email }
  }

  if (id === "btc") {
    const addr = value.replace(/\s+/g, "")
    if (!btcAddressRegex.test(addr)) return { valid: false, normalized: addr, code: "btc_address" }
    return { valid: true, normalized: addr }
  }

  if (id === "usdt") {
    const addr = value.replace(/\s+/g, "")
    if (!usdtTrc20Regex.test(addr) && !usdtErc20Regex.test(addr)) return { valid: false, normalized: addr, code: "usdt_address" }
    return { valid: true, normalized: addr }
  }

  if (id === "ton") {
    const addr = value.replace(/\s+/g, "")
    if (!tonBounceRegex.test(addr) && !tonRawRegex.test(addr)) return { valid: false, normalized: addr, code: "ton_address" }
    return { valid: true, normalized: addr }
  }

  return { valid: true, normalized: value }
}

