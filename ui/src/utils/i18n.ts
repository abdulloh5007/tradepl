import type { Lang } from "../types"
import en from "../i18n/en.json"
import ru from "../i18n/ru.json"
import uz from "../i18n/uz.json"

type Dict = Record<string, string>

const translations: Record<Lang, Dict> = {
    en,
    ru,
    uz
}

export function t(key: string, lang: Lang = "en"): string {
    return translations[lang]?.[key] || translations.en[key] || key
}

export { translations }
