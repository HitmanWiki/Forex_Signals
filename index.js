const axios = require("axios");
const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

// Environment Variables
const COINEX_API_KEY = process.env.COINEX_API_KEY;
const COINEX_API_SECRET = process.env.COINEX_API_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// CoinEx API Base URL
const BASE_URL = "https://api.coinex.com/v1";

// Telegram Bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Trading Configuration
const pair = "BTCUSDT";
const interval = "3min";
const limit = 50;
const atrLength = 14;
const emaShortLength = 30;
const emaLongLength = 100;
const riskRewardRatio = 2.0;

let activeSignal = null; // Track active trade

// Helper Function: Fetch Candlesticks from CoinEx
async function fetchCandles(symbol, interval, limit = 150) {
    try {
        const response = await axios.get(`${BASE_URL}/market/kline`, {
            params: {
                symbol,
                type: interval,
                limit,
            },
            headers: {
                Authorization: COINEX_API_KEY,
            },
        });

        const candles = response.data.data.map((candle) => ({
            time: new Date(candle[0] * 1000),
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
        }));

        return candles.reverse(); // Chronological order
    } catch (error) {
        console.error("Error fetching candles:", error.message);
        return [];
    }
}

// Helper Function: Calculate Indicators
function calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);

    // EMA Calculation
    const emaShort = calculateEMA(closes, emaShortLength);
    const emaLong = calculateEMA(closes, emaLongLength);

    // ATR Calculation
    const atr = calculateATR(candles, atrLength);

    // CPR Calculation
    const pivotHigh = Math.max(...candles.slice(-atrLength).map((c) => c.high));
    const pivotLow = Math.min(...candles.slice(-atrLength).map((c) => c.low));
    const pivotClose = closes.slice(-atrLength).reduce((sum, c) => sum + c, 0) / atrLength;

    const cprUpper = (pivotHigh + pivotLow) / 2;
    const cprLower = pivotClose;

    return { emaShort, emaLong, atr, cprUpper, cprLower };
}

// Helper Function: Calculate EMA
function calculateEMA(data, length) {
    const k = 2 / (length + 1);
    return data.reduce((prev, curr, index) => {
        if (index === 0) return curr;
        return curr * k + prev * (1 - k);
    }, 0);
}

// Helper Function: Calculate ATR
function calculateATR(candles, length) {
    const tr = candles.map((c, i) => {
        if (i === 0) return 0;
        return Math.max(
            c.high - c.low,
            Math.abs(c.high - candles[i - 1].close),
            Math.abs(c.low - candles[i - 1].close)
        );
    });

    return tr.slice(-length).reduce((sum, val) => sum + val, 0) / length;
}

// Generate Signal
async function generateSignal() {

    console.log(`Generating signal for ${pair}...`);
    const candles = await fetchWithRetry(pair, interval, 150); // Fetch 150 candles for safety

    if (candles.length < Math.max(atrLength, shortEmaLength, longEmaLength)) {
        console.log(`Not enough data to calculate indicators. Fetched ${candles.length} candles.`);
        return;
    }

    console.log("Fetched sufficient data for indicators.");
    const { shortEma, longEma, atr } = calculateIndicators(candles);

    if (!shortEma || !longEma || !atr) {
        console.log("Failed to calculate indicators.");
        return;
    }

    const currentPrice = candles[candles.length - 1].close;
    const recentHigh = Math.max(...candles.slice(-10).map((c) => c.high));
    const recentLow = Math.min(...candles.slice(-10).map((c) => c.low));

    console.log('=== Indicator Values ===');
    console.log(`Short EMA: ${shortEma}`);
    console.log(`Long EMA: ${longEma}`);
    console.log(`ATR: ${atr}`);
    console.log('=== Price Info ===');
    console.log(`Current Price: ${currentPrice}`);
    console.log(`Recent High: ${recentHigh}`);
    console.log(`Recent Low: ${recentLow}`);

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

    if (signal !== "HOLD" && !activeSignal) {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice.toFixed(2)}\n
        ATR: $${atr.toFixed(2)}\n
        CPR Upper: $${cprUpper.toFixed(2)}\n
        CPR Lower: $${cprLower.toFixed(2)}\n
        Stop Loss: $${stopLoss.toFixed(2)}\n
        Take Profit: $${takeProfit.toFixed(2)}\n`;

        bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: "Markdown" });
        activeSignal = { signal, stopLoss, takeProfit };
    } else {
        console.log("No signal generated.");
    }
}

// Monitor Active Signal
async function monitorSignal() {
    if (activeSignal) {
        console.log('Active Signal:', activeSignal);
    }

    const candles = await fetchCandles();
    const currentPrice = candles[candles.length - 1]?.close;

    if (!currentPrice) return;

    if (activeSignal.signal === "BUY" && currentPrice <= activeSignal.stopLoss) {
        bot.sendMessage(
            TELEGRAM_CHANNEL_ID,
            `🚨 **BUY Signal Stopped Out**\nCurrent Price: $${currentPrice.toFixed(
                2
            )}\nStop Loss Hit: $${activeSignal.stopLoss.toFixed(2)}`
        );
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        bot.sendMessage(
            TELEGRAM_CHANNEL_ID,
            `🚨 **SELL Signal Stopped Out**\nCurrent Price: $${currentPrice.toFixed(
                2
            )}\nStop Loss Hit: $${activeSignal.stopLoss.toFixed(2)}`
        );
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        bot.sendMessage(
            TELEGRAM_CHANNEL_ID,
            `✅ **BUY Signal Take Profit Hit**\nCurrent Price: $${currentPrice.toFixed(
                2
            )}\nTake Profit: $${activeSignal.takeProfit.toFixed(2)}`
        );
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        bot.sendMessage(
            TELEGRAM_CHANNEL_ID,
            `✅ **SELL Signal Take Profit Hit**\nCurrent Price: $${currentPrice.toFixed(
                2
            )}\nTake Profit: $${activeSignal.takeProfit.toFixed(2)}`
        );
        activeSignal = null;
    }
}

// Schedule Signal Generation and Monitoring
setInterval(generateSignal, 3 * 60 * 1000); // Every 3 minutes
setInterval(monitorSignal, 1 * 60 * 1000); // Every minute
