const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const technicalindicators = require('technicalindicators');
require('dotenv').config();

// API and Bot Configuration
const apiKey = process.env.TWELVE_DATA_API_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;

const bot = new TelegramBot(botToken, { polling: true });
const pair = "BTC/USD";
const interval = "5min";

// Strategy Parameters
const atrLength = 20;
const cprLength = 15;
const emaShortLength = 30;
const emaLongLength = 100;
const riskRewardRatio = 2.0;

let activeSignal = null;

// Fetch Data
async function fetchData(symbol, interval) {
    try {
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&apikey=${apiKey}&outputsize=200`;
        const response = await axios.get(url);

        if (response.data && response.data.values) {
            const prices = response.data.values.map((candle) => ({
                time: new Date(candle.datetime),
                open: parseFloat(candle.open),
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close),
            }));
            console.log(`Fetched ${prices.length} candles for ${symbol} (${interval})`);
            return prices.reverse(); // Return in chronological order
        } else {
            console.error(`No data for ${symbol}: ${response.data.message || "Unknown error"}`);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching data for ${symbol}: ${error.message}`);
        return [];
    }
}


// Calculate Indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    const atr = technicalindicators.ATR.calculate({ high: highs, low: lows, close: closes, period: atrLength });
    const emaShort = technicalindicators.EMA.calculate({ values: closes, period: emaShortLength });
    const emaLong = technicalindicators.EMA.calculate({ values: closes, period: emaLongLength });

    const pivotHigh = Math.max(...highs.slice(-cprLength));
    const pivotLow = Math.min(...lows.slice(-cprLength));
    const pivotClose = closes.slice(-cprLength).reduce((a, b) => a + b, 0) / cprLength;

    return {
        atr: atr[atr.length - 1],
        emaShort: emaShort[emaShort.length - 1],
        emaLong: emaLong[emaLong.length - 1],
        cprUpper: (pivotHigh + pivotLow) / 2,
        cprLower: pivotClose,
    };
}

// Generate Signal
async function generateSignal() {
    const prices = await fetchData(pair, interval);

    if (prices.length < Math.max(atrLength, emaLongLength, cprLength)) {
        console.log("Not enough data to calculate indicators.");
        return;
    }

    const { atr, emaShort, emaLong, cprUpper, cprLower } = calculateIndicators(prices);
    const currentPrice = prices[prices.length - 1].close;

    let signal = "HOLD";
    let stopLoss, takeProfit;

    // Long Condition
    if (currentPrice > cprUpper && emaShort > emaLong) {
        signal = "BUY";
        stopLoss = currentPrice - atr;
        takeProfit = currentPrice + atr * riskRewardRatio;
    }

    // Short Condition
    if (currentPrice < cprLower && emaShort < emaLong) {
        signal = "SELL";
        stopLoss = currentPrice + atr;
        takeProfit = currentPrice - atr * riskRewardRatio;
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice}\n
        ATR: $${atr}\n
        EMA Short: $${emaShort}\n
        EMA Long: $${emaLong}\n
        CPR Upper: $${cprUpper}\n
        CPR Lower: $${cprLower}\n
        Stop Loss: $${stopLoss}\n
        Take Profit: $${takeProfit}\n`;

        bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
        activeSignal = { signal, stopLoss, takeProfit };
    } else {
        console.log("No signal generated.");
    }
}

// Monitor Active Signal
async function monitorSignal() {
    if (!activeSignal) return;

    const prices = await fetchData(pair, interval);
    const currentPrice = prices[prices.length - 1]?.close;

    if (!currentPrice) return;

    if (activeSignal.signal === "BUY" && currentPrice <= activeSignal.stopLoss) {
        console.log("BUY trade stopped out.");
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        console.log("SELL trade stopped out.");
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        console.log("BUY trade hit Take Profit.");
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit Take Profit.");
        activeSignal = null;
    }
}

// Schedule Signal Generation and Monitoring
setInterval(generateSignal, 5 * 60 * 1000); // Every 5 minutes
setInterval(monitorSignal, 30 * 1000); // Every 30 seconds
