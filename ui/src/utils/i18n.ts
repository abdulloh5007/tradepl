import type { Lang } from "../types"

const translations: Record<string, Record<Lang, string>> = {
    buy: { en: "Buy", uz: "Sotib olish", ru: "Купить" },
    sell: { en: "Sell", uz: "Sotish", ru: "Продать" },
    balance: { en: "Balance", uz: "Balans", ru: "Баланс" },
    equity: { en: "Equity", uz: "Kapital", ru: "Средства" },
    margin: { en: "Margin", uz: "Marja", ru: "Маржа" },
    freeMargin: { en: "Free Margin", uz: "Erkin Marja", ru: "Свободная маржа" },
    marginLevel: { en: "Margin Level", uz: "Marja Darajasi", ru: "Уровень маржи" },
    profit: { en: "Profit", uz: "Foyda", ru: "Прибыль" },
    positions: { en: "Positions", uz: "Pozitsiyalar", ru: "Позиции" },
    ticket: { en: "Ticket", uz: "Chipta", ru: "Тикет" },
    time: { en: "Time", uz: "Vaqt", ru: "Время" },
    type: { en: "Type", uz: "Turi", ru: "Тип" },
    volume: { en: "Volume", uz: "Hajm", ru: "Объём" },
    price: { en: "Price", uz: "Narx", ru: "Цена" },
    sl: { en: "S/L", uz: "S/L", ru: "S/L" },
    tp: { en: "T/P", uz: "T/P", ru: "T/P" },
    close: { en: "Close", uz: "Yopish", ru: "Закрыть" },
    spread: { en: "Spread", uz: "Spred", ru: "Спред" },
    bid: { en: "Bid", uz: "Bid", ru: "Bid" },
    ask: { en: "Ask", uz: "Ask", ru: "Ask" },
    last: { en: "Last", uz: "Oxirgi", ru: "Последняя" },
    qty: { en: "Enter quantity", uz: "Miqdorni kiriting", ru: "Введите объём" },
    statusOrderPlaced: { en: "Order placed", uz: "Buyurtma qo'yildi", ru: "Ордер размещён" },
    logout: { en: "Logout", uz: "Chiqish", ru: "Выход" },
    register: { en: "Register", uz: "Ro'yxatdan o'tish", ru: "Регистрация" },
    login: { en: "Login", uz: "Kirish", ru: "Вход" },
    chart: { en: "Chart", uz: "Grafik", ru: "График" },
    accounts: { en: "Accounts", uz: "Hisoblar", ru: "Счета" },
    api: { en: "API", uz: "API", ru: "API" },
    faucet: { en: "Faucet", uz: "Faucet", ru: "Кран" }
}

export function t(key: string, lang: Lang): string {
    return translations[key]?.[lang] || key
}

export { translations }
