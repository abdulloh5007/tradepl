import en from "./i18n/en.json"
import ru from "./i18n/ru.json"
import uz from "./i18n/uz.json"

export type Lang = "ru" | "uz" | "en"

type Dict = Record<string, string>

const dict: Record<Lang, Dict> = { ru, uz, en }

export const languages: Lang[] = ["ru", "uz", "en"]

export const translate = (lang: Lang, key: string) => dict[lang][key] || key
