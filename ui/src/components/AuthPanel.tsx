import { motion } from "framer-motion"
import { BadgeCheck, LogIn, UserPlus } from "lucide-react"
import { PanelMotion } from "../types/ui"

type Props = {
  t: (key: string) => string
  panelMotion: PanelMotion
  onRegister: (form: HTMLFormElement) => void
  onLogin: (form: HTMLFormElement) => void
}

export default function AuthPanel({ t, panelMotion, onRegister, onLogin }: Props) {
  return (
    <motion.section className="panel" {...panelMotion}>
      <div className="panel-head">
        <div className="panel-title">
          <BadgeCheck size={16} />
          {t("auth")}
        </div>
      </div>
      <div className="grid two">
        <form
          className="card"
          onSubmit={e => {
            e.preventDefault()
            onRegister(e.currentTarget)
          }}
        >
          <div className="card-title">
            <UserPlus size={16} />
            {t("register")}
          </div>
          <label className="field">
            <span>{t("email")}</span>
            <input name="email" type="email" required />
          </label>
          <label className="field">
            <span>{t("password")}</span>
            <input name="password" type="password" required />
          </label>
          <button type="submit" className="primary">
            {t("registerBtn")}
          </button>
        </form>
        <form
          className="card"
          onSubmit={e => {
            e.preventDefault()
            onLogin(e.currentTarget)
          }}
        >
          <div className="card-title">
            <LogIn size={16} />
            {t("login")}
          </div>
          <label className="field">
            <span>{t("email")}</span>
            <input name="email" type="email" required />
          </label>
          <label className="field">
            <span>{t("password")}</span>
            <input name="password" type="password" required />
          </label>
          <button type="submit" className="primary">
            {t("loginBtn")}
          </button>
        </form>
      </div>
    </motion.section>
  )
}
