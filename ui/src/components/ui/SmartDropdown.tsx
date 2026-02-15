import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"

export type SmartDropdownOption = {
  value: string | number
  label: string
  disabled?: boolean
}

interface SmartDropdownProps {
  value: string | number
  options: SmartDropdownOption[]
  onChange: (value: string | number) => void
  disabled?: boolean
  ariaLabel?: string
  className?: string
  triggerClassName?: string
  menuClassName?: string
  maxMenuHeight?: number
}

export default function SmartDropdown({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  maxMenuHeight = 240
}: SmartDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [menuMounted, setMenuMounted] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)

  const selected = useMemo(() => {
    const current = String(value)
    return options.find(o => String(o.value) === current) || null
  }, [options, value])

  const updatePlacement = useCallback(() => {
    if (!rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const estimatedMenuHeight = Math.min(maxMenuHeight, options.length * 42 + 12)
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top
    const shouldOpenUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow
    setOpenUpward(shouldOpenUp)
  }, [maxMenuHeight, options.length])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const openMenu = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setMenuMounted(true)
    window.requestAnimationFrame(() => setOpen(true))
  }, [])

  const closeMenu = useCallback(() => {
    setOpen(false)
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      setMenuMounted(false)
      closeTimerRef.current = null
    }, 180)
  }, [])

  useEffect(() => {
    if (!open) return
    updatePlacement()

    const onDocMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu()
    }
    const onLayoutChange = () => updatePlacement()

    document.addEventListener("mousedown", onDocMouseDown)
    document.addEventListener("keydown", onEsc)
    window.addEventListener("resize", onLayoutChange)
    window.addEventListener("scroll", onLayoutChange, true)

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown)
      document.removeEventListener("keydown", onEsc)
      window.removeEventListener("resize", onLayoutChange)
      window.removeEventListener("scroll", onLayoutChange, true)
    }
  }, [closeMenu, open, updatePlacement])

  return (
    <div
      ref={rootRef}
      className={`ui-dropdown ${open ? "is-open" : ""} ${menuMounted && !open ? "is-closing" : ""} ${openUpward ? "open-upward" : "open-downward"} ${className}`}
    >
      <button
        type="button"
        className={`ui-dropdown-trigger ${triggerClassName}`}
        onClick={() => {
          if (disabled) return
          if (open) {
            closeMenu()
            return
          }
          updatePlacement()
          openMenu()
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="ui-dropdown-value">{selected?.label || "—"}</span>
        <ChevronDown size={16} className="ui-dropdown-chevron" />
      </button>

      {menuMounted && (
        <div
          className={`ui-dropdown-menu ${menuClassName}`}
          style={{ maxHeight: maxMenuHeight }}
          role="listbox"
        >
          {options.map(option => {
            const active = String(option.value) === String(value)
            return (
              <button
                key={String(option.value)}
                type="button"
                className={`ui-dropdown-option ${active ? "active" : ""}`}
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return
                  onChange(option.value)
                  closeMenu()
                }}
                role="option"
                aria-selected={active}
              >
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
