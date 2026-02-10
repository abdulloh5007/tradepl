import type { Metrics } from "../../types"

export type AccountSnapshot = {
  pl: number
  openCount: number
  metrics: Metrics | null
}
