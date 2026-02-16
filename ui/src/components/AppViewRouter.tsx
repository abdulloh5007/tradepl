import { Suspense, lazy } from "react"
import type { ReactNode } from "react"
import type { DepositBonusStatus, KYCStatus, ProfitRewardStatus, ReferralStatus, SignupBonusStatus, UserProfile } from "../api"
import type { AppNotification, Lang, MarketConfig, MarketNewsEvent, Metrics, NotificationSettings, Order, Quote, Theme, TradingAccount, View } from "../types"
import { t } from "../utils/i18n"
import TradingPage from "../pages/Trading/TradingPage"
import PositionsPage from "../pages/Positions/PositionsPage"
import type { AccountSnapshot } from "./accounts/types"

type CandlePoint = { time: number; open: number; high: number; low: number; close: number }
type FaucetApi = {
  faucet: (payload: { asset: string; amount: string; reference?: string }) => Promise<{ status: string }>
  metrics: () => Promise<{ balance: string; equity: string; margin: string; free_margin: string; margin_level: string; pl: string }>
}

const HistoryPage = lazy(() => import("../pages/History/HistoryPage"))
const AccountsPage = lazy(() => import("../pages/Accounts/AccountsPage"))
const NotificationsPage = lazy(() => import("../pages/Notifications/NotificationsPage"))
const ProfilePage = lazy(() => import("../pages/Settings/ProfilePage"))
const ApiPage = lazy(() => import("../pages/Api/ApiPage"))
const FaucetPage = lazy(() => import("../pages/Faucet/FaucetPage"))

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
    methodID: string
    proofFile: File
  }) => Promise<void>
  newsUpcoming: MarketNewsEvent[]
  activeAccount: TradingAccount | null
  kycStatus: KYCStatus | null
  onRequestKYC: (payload: {
    documentType: "passport" | "id_card" | "driver_license" | "other"
    fullName: string
    documentNumber: string
    residenceAddress: string
    frontProofFile: File
    backProofFile: File
  }) => Promise<void>
  referralStatus: ReferralStatus | null
  onReferralWithdraw: (amountUSD?: string) => Promise<void>
  onRefreshReferral: () => Promise<void> | void
  profitRewardStatus: ProfitRewardStatus | null
  onRefreshProfitReward: () => Promise<void> | void
  onClaimProfitReward: (stageNo: number, tradingAccountID: string) => Promise<void>
  onGoTrade: () => void
  hasUnreadNotifications: boolean
  onOpenNotifications: () => void
  notifications: AppNotification[]
  onBackFromHistory: () => void
  onBackFromNotifications: () => void
  onMarkAllNotificationsRead: () => void
  onNotificationClick: (notificationID: string) => void
  onNotificationAction: (notificationID: string, action: NonNullable<AppNotification["action"]>) => void
  profile: UserProfile | null
  setLang: (lang: Lang) => void
  setTheme: (theme: Theme) => void
  notificationSettings: NotificationSettings
  setNotificationSettings: (settings: NotificationSettings) => void
  telegramBotSwitchVisible: boolean
  telegramBotNotificationsEnabled: boolean
  telegramBotNotificationsBusy: boolean
  telegramWriteAccess: boolean
  onToggleTelegramBotNotifications: (enabled: boolean) => Promise<void> | void
  openProfitStagesSignal: number
  onLogout: () => void
  api: FaucetApi
  onMetricsUpdate: (metrics: Metrics) => void
  token: string
  onLoginRequired: () => void
  isUnlimitedLeverage: boolean
}

const ViewFallback = ({ lang }: { lang: Lang }) => (
  <div style={{ padding: "20px 8px", color: "var(--muted)", textAlign: "center", fontSize: 13 }}>
    {t("common.loading", lang)}
  </div>
)

const LazyView = ({ children, lang }: { children: ReactNode; lang: Lang }) => (
  <Suspense fallback={<ViewFallback lang={lang} />}>
    {children}
  </Suspense>
)

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
  newsUpcoming,
  activeAccount,
  kycStatus,
  onRequestKYC,
  referralStatus,
  onReferralWithdraw,
  onRefreshReferral,
  profitRewardStatus,
  onRefreshProfitReward,
  onClaimProfitReward,
  onGoTrade,
  hasUnreadNotifications,
  onOpenNotifications,
  notifications,
  onBackFromHistory,
  onBackFromNotifications,
  onMarkAllNotificationsRead,
  onNotificationClick,
  onNotificationAction,
  profile,
  setLang,
  setTheme,
  notificationSettings,
  setNotificationSettings,
  telegramBotSwitchVisible,
  telegramBotNotificationsEnabled,
  telegramBotNotificationsBusy,
  telegramWriteAccess,
  onToggleTelegramBotNotifications,
  openProfitStagesSignal,
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
      <LazyView lang={lang}>
        <HistoryPage
          orders={orderHistory}
          lang={lang}
          loading={historyLoading}
          hasMore={historyHasMore}
          onRefresh={onRefreshHistory}
          onLoadMore={onLoadMoreHistory}
          onBack={onBackFromHistory}
        />
      </LazyView>
    )
  }

  if (view === "accounts") {
    return (
      <LazyView lang={lang}>
        <AccountsPage
          lang={lang}
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
          newsUpcoming={newsUpcoming}
          onCloseAll={async () => {
            await onCloseAll()
          }}
          onGoTrade={onGoTrade}
          hasUnreadNotifications={hasUnreadNotifications}
          onOpenNotifications={onOpenNotifications}
        />
      </LazyView>
    )
  }

  if (view === "notifications") {
    return (
      <LazyView lang={lang}>
        <NotificationsPage
          lang={lang}
          items={notifications}
          onBack={onBackFromNotifications}
          onMarkAllRead={onMarkAllNotificationsRead}
          onItemClick={onNotificationClick}
          onActionClick={onNotificationAction}
        />
      </LazyView>
    )
  }

  if (view === "profile") {
    return (
      <LazyView lang={lang}>
        <ProfilePage
          lang={lang}
          setLang={setLang}
          theme={theme}
          setTheme={setTheme}
          onLogout={onLogout}
          profile={profile}
          notificationSettings={notificationSettings}
          setNotificationSettings={setNotificationSettings}
          telegramBotSwitchVisible={telegramBotSwitchVisible}
          telegramBotNotificationsEnabled={telegramBotNotificationsEnabled}
          telegramBotNotificationsBusy={telegramBotNotificationsBusy}
          telegramWriteAccess={telegramWriteAccess}
          onToggleTelegramBotNotifications={onToggleTelegramBotNotifications}
          activeAccount={activeAccount}
          kycStatus={kycStatus}
          onRequestKYC={onRequestKYC}
          referralStatus={referralStatus}
          onReferralWithdraw={onReferralWithdraw}
          onRefreshReferral={onRefreshReferral}
          profitRewardStatus={profitRewardStatus}
          onRefreshProfitReward={onRefreshProfitReward}
          onClaimProfitReward={onClaimProfitReward}
          accounts={accounts}
          openProfitStagesSignal={openProfitStagesSignal}
        />
      </LazyView>
    )
  }

  if (view === "api") {
    return (
      <LazyView lang={lang}>
        <ApiPage lang={lang} />
      </LazyView>
    )
  }

  if (view === "faucet") {
    return (
      <LazyView lang={lang}>
        <FaucetPage
          api={api}
          onMetricsUpdate={onMetricsUpdate}
          lang={lang}
          token={token}
          onLoginRequired={onLoginRequired}
        />
      </LazyView>
    )
  }

  return null
}
