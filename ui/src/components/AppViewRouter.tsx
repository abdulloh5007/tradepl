import type { ComponentProps } from "react"
import type { DepositBonusStatus, KYCStatus, ReferralStatus, SignupBonusStatus, UserProfile } from "../api"
import type { AppNotification, Lang, MarketConfig, Metrics, Order, Quote, Theme, TradingAccount, View } from "../types"
import { AccountsPage, ApiPage, FaucetPage, HistoryPage, NotificationsPage, PositionsPage, ProfilePage, TradingPage } from "../pages"
import type { AccountSnapshot } from "./accounts/types"

type CandlePoint = { time: number; open: number; high: number; low: number; close: number }
type FaucetApi = ComponentProps<typeof FaucetPage>["api"]

interface AppViewRouterProps {
  view: View
  candles: CandlePoint[]
  quote: Quote | null
  openOrders: Order[]
  marketPair: string
  marketConfig: Record<string, MarketConfig>
  theme: Theme
  timeframes: string[]
  timeframe: string
  setTimeframe: (timeframe: string) => void
  fetchCandles: (timeframe?: string) => Promise<void> | void
  quickQty: string
  setQuickQty: (value: string) => void
  onBuy: () => void
  onSell: () => void
  lang: Lang
  onLoadMore: (beforeTime: number) => Promise<void> | void
  isLoadingMore: boolean
  hasMoreData: boolean
  metrics: Metrics
  marketPrice: number
  onClose: (orderId: string) => void
  onCloseAll: () => Promise<void> | void
  onCloseProfit: () => Promise<void> | void
  onCloseLoss: () => Promise<void> | void
  bulkClosing: boolean
  orderHistory: Order[]
  historyLoading: boolean
  historyHasMore: boolean
  onRefreshHistory: () => Promise<void> | void
  onLoadMoreHistory: () => Promise<void> | void
  accounts: TradingAccount[]
  activeAccountId: string
  activeOpenOrdersCount: number
  liveDataReady: boolean
  snapshots: Record<string, AccountSnapshot>
  onSwitchAccount: (accountId: string) => Promise<void>
  onCreateAccount: (payload: { plan_id: string; mode: "demo" | "real"; name?: string; is_active?: boolean }) => Promise<void>
  onUpdateAccountLeverage: (accountId: string, leverage: number) => Promise<void>
  onRenameAccount: (accountId: string, name: string) => Promise<void>
  onTopUpDemo: (amount: string) => Promise<void>
  onWithdrawDemo: (amount: string) => Promise<void>
  signupBonus: SignupBonusStatus | null
  depositBonus: DepositBonusStatus | null
  onClaimSignupBonus: () => Promise<void>
  onRequestRealDeposit: (payload: {
    amountUSD: string
    voucherKind: "none" | "gold" | "diamond"
    proofFile: File
  }) => Promise<void>
  kycStatus: KYCStatus | null
  onRequestKYC: (payload: {
    documentType: "passport" | "id_card" | "driver_license" | "other"
    fullName: string
    documentNumber: string
    residenceAddress: string
    notes?: string
    proofFile: File
  }) => Promise<void>
  referralStatus: ReferralStatus | null
  onReferralWithdraw: (amountUSD?: string) => Promise<void>
  onRefreshReferral: () => Promise<void> | void
  onGoTrade: () => void
  hasUnreadNotifications: boolean
  onOpenNotifications: () => void
  notifications: AppNotification[]
  onBackFromNotifications: () => void
  onMarkAllNotificationsRead: () => void
  profile: UserProfile | null
  setLang: (lang: Lang) => void
  setTheme: (theme: Theme) => void
  onLogout: () => void
  api: FaucetApi
  onMetricsUpdate: (metrics: Metrics) => void
  token: string
  onLoginRequired: () => void
  isUnlimitedLeverage: boolean
}

export default function AppViewRouter({
  view,
  candles,
  quote,
  openOrders,
  marketPair,
  marketConfig,
  theme,
  timeframes,
  timeframe,
  setTimeframe,
  fetchCandles,
  quickQty,
  setQuickQty,
  onBuy,
  onSell,
  lang,
  onLoadMore,
  isLoadingMore,
  hasMoreData,
  metrics,
  marketPrice,
  onClose,
  onCloseAll,
  onCloseProfit,
  onCloseLoss,
  bulkClosing,
  orderHistory,
  historyLoading,
  historyHasMore,
  onRefreshHistory,
  onLoadMoreHistory,
  accounts,
  activeAccountId,
  activeOpenOrdersCount,
  liveDataReady,
  snapshots,
  onSwitchAccount,
  onCreateAccount,
  onUpdateAccountLeverage,
  onRenameAccount,
  onTopUpDemo,
  onWithdrawDemo,
  signupBonus,
  depositBonus,
  onClaimSignupBonus,
  onRequestRealDeposit,
  kycStatus,
  onRequestKYC,
  referralStatus,
  onReferralWithdraw,
  onRefreshReferral,
  onGoTrade,
  hasUnreadNotifications,
  onOpenNotifications,
  notifications,
  onBackFromNotifications,
  onMarkAllNotificationsRead,
  profile,
  setLang,
  setTheme,
  onLogout,
  api,
  onMetricsUpdate,
  token,
  onLoginRequired,
  isUnlimitedLeverage,
}: AppViewRouterProps) {
  if (view === "chart") {
    return (
      <TradingPage
        candles={candles}
        quote={quote}
        openOrders={openOrders}
        marketPair={marketPair}
        marketConfig={marketConfig}
        theme={theme}
        timeframes={timeframes}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        fetchCandles={fetchCandles}
        quickQty={quickQty}
        setQuickQty={setQuickQty}
        onBuy={onBuy}
        onSell={onSell}
        lang={lang}
        onLoadMore={onLoadMore}
        isLoadingMore={isLoadingMore}
        hasMoreData={hasMoreData}
      />
    )
  }

  if (view === "positions") {
    return (
      <PositionsPage
        metrics={metrics}
        orders={openOrders}
        quote={quote}
        marketPair={marketPair}
        marketConfig={marketConfig}
        marketPrice={marketPrice}
        onClose={onClose}
        onCloseAll={onCloseAll}
        onCloseProfit={onCloseProfit}
        onCloseLoss={onCloseLoss}
        bulkClosing={bulkClosing}
        lang={lang}
        isUnlimitedLeverage={isUnlimitedLeverage}
      />
    )
  }

  if (view === "history") {
    return (
      <HistoryPage
        orders={orderHistory}
        lang={lang}
        loading={historyLoading}
        hasMore={historyHasMore}
        onRefresh={onRefreshHistory}
        onLoadMore={onLoadMoreHistory}
      />
    )
  }

  if (view === "accounts") {
    return (
      <AccountsPage
        accounts={accounts}
        activeAccountId={activeAccountId}
        metrics={metrics}
        activeOpenOrdersCount={activeOpenOrdersCount}
        liveDataReady={liveDataReady}
        snapshots={snapshots}
        onSwitch={onSwitchAccount}
        onCreate={onCreateAccount}
        onUpdateLeverage={onUpdateAccountLeverage}
        onRenameAccount={onRenameAccount}
        onTopUpDemo={onTopUpDemo}
        onWithdrawDemo={onWithdrawDemo}
        signupBonus={signupBonus}
        depositBonus={depositBonus}
        onClaimSignupBonus={onClaimSignupBonus}
        onRequestRealDeposit={onRequestRealDeposit}
        kycStatus={kycStatus}
        onRequestKYC={onRequestKYC}
        referralStatus={referralStatus}
        onReferralWithdraw={onReferralWithdraw}
        onRefreshReferral={onRefreshReferral}
        onCloseAll={async () => {
          await onCloseAll()
        }}
        onGoTrade={onGoTrade}
        hasUnreadNotifications={hasUnreadNotifications}
        onOpenNotifications={onOpenNotifications}
      />
    )
  }

  if (view === "notifications") {
    return (
      <NotificationsPage
        items={notifications}
        onBack={onBackFromNotifications}
        onMarkAllRead={onMarkAllNotificationsRead}
      />
    )
  }

  if (view === "profile") {
    return (
      <ProfilePage
        lang={lang}
        setLang={setLang}
        theme={theme}
        setTheme={setTheme}
        onLogout={onLogout}
        profile={profile}
      />
    )
  }

  if (view === "api") return <ApiPage />

  if (view === "faucet") {
    return (
      <FaucetPage
        api={api}
        onMetricsUpdate={onMetricsUpdate}
        lang={lang}
        token={token}
        onLoginRequired={onLoginRequired}
      />
    )
  }

  return null
}
