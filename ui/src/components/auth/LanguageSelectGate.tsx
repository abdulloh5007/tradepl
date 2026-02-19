import type { Lang } from "../../types"
import { t } from "../../utils/i18n"

interface LanguageSelectGateProps {
  lang: Lang
  onSelect: (lang: Lang) => void
}

const languageOptions: Array<{ value: Lang; label: string }> = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "uz", label: "O'zbek" },
]

export default function LanguageSelectGate({ lang, onSelect }: LanguageSelectGateProps) {
  return (
    <div className="language-gate">
      <div className="language-gate-card">
        <h1 className="language-gate-title">{t("languageGate.title", lang)}</h1>
        <div className="language-gate-options" role="list">
          {languageOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className="language-gate-option"
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
