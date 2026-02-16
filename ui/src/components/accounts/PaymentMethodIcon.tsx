import { CreditCard } from "lucide-react"
import visaIcon from "../../assets/payment-methods/visa.svg"
import mastercardIcon from "../../assets/payment-methods/mastercard.svg"
import paypalIcon from "../../assets/payment-methods/paypal.svg"
import uzcardIcon from "../../assets/payment-methods/uzcard.svg"
import humoIcon from "../../assets/payment-methods/humo.svg"
import tonIcon from "../../assets/payment-methods/ton.svg"
import usdtIcon from "../../assets/payment-methods/usdt.svg"
import btcIcon from "../../assets/payment-methods/btc.svg"

type PaymentMethodIconProps = {
  methodID: string
  size?: number
  className?: string
}

const iconSrc = (methodID: string): string | null => {
  const key = String(methodID || "").trim().toLowerCase()
  if (key === "visa_sum" || key === "visa_usd") return visaIcon
  if (key === "mastercard") return mastercardIcon
  if (key === "paypal") return paypalIcon
  if (key === "uzcard") return uzcardIcon
  if (key === "humo") return humoIcon
  if (key === "ton") return tonIcon
  if (key === "usdt") return usdtIcon
  if (key === "btc") return btcIcon
  return null
}

export default function PaymentMethodIcon({ methodID, size = 16, className = "" }: PaymentMethodIconProps) {
  const src = iconSrc(methodID)
  if (!src) {
    return <CreditCard size={size} className={className} />
  }
  return (
    <img
      src={src}
      alt={methodID}
      width={size}
      height={size}
      loading="lazy"
      className={className}
      draggable={false}
    />
  )
}

