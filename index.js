const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID; // Replace with your Telegram chat ID
const bot = new TelegramBot(botToken, { polling: true });

// Configuration
const symbol = "BTCUSDT"; // Your trading pair
const interval = "3min"; // Fetch interval
const limit = 150; // Number of candles to fetch

// Active Signal Tracking
let activeSignal = {}; // Object to store active signals for each crypto
let signalStats = { success: 0, failure: 0 }; // Track success and failure rates

// Parameters
const atrLength = 20; // ATR Lookback Period
const emaShortLength = 30; // Short EMA Period
const emaLongLength = 100; // Long EMA Period
const cprLength = 15; // CPR Lookback Period
const riskRewardRatio = 2; // Risk-Reward Ratio

// Fetch candles from CoinGecko
async function fetchCandles() {
    try {
        console.log(`Fetching data for ${symbol} with interval: ${interval}`);
        const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${symbol}/ohlc`, {
            params: { vs_currency: "usd", days: "1", interval: interval },
        });

        if (response.data && response.data.length > 0) {
            const candles = response.data.map((candle) => ({
                time: new Date(candle[0]),
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5] || 0), // Assuming volume is the 6th element; adjust if incorrect
            }));
            console.log(`Fetched ${candles.length} candles for ${symbol}`);
            return candles;
        } else {
            console.error("Unexpected response format:", response.data);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching candles: ${error.message}`);
        return [];
    }
}


// Calculate Indicators
function calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });

    const shortEma = technicalindicators.EMA.calculate({
        values: closes,
        period: emaShortLength,
    });

    const longEma = technicalindicators.EMA.calculate({
        values: closes,
        period: emaLongLength,
    });

    const pivotHigh = Math.max(...highs.slice(-cprLength));
    const pivotLow = Math.min(...lows.slice(-cprLength));
    const pivotClose = closes.slice(-cprLength).reduce((sum, val) => sum + val, 0) / cprLength;

    const cprUpper = (pivotHigh + pivotLow) / 2;
    const cprLower = pivotClose;

    return {
        atr: atr[atr.length - 1],
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
        cprUpper,
        cprLower,
    };
}

// Generate Signal
function generateSignal(candles, indicators) {
    const { atr, shortEma, longEma, cprUpper, cprLower } = indicators;
    const currentPrice = candles[candles.length - 1].close;

    console.log("=== Indicator Values ===");
    console.log(`Short EMA: ${shortEma}`);
    console.log(`Long EMA: ${longEma}`);
    console.log(`ATR: ${atr}`);
    console.log(`CPR Upper: ${cprUpper}`);
    console.log(`CPR Lower: ${cprLower}`);
    console.log("=== Price Info ===");
    console.log(`Current Price: ${currentPrice}`);

    const longCondition = currentPrice > cprUpper && shortEma > longEma;
    const shortCondition = currentPrice < cprLower && shortEma < longEma;

    if (longCondition) {
        console.log("BUY Signal Detected!");
        return {
            signal: "BUY",
            stopLoss: currentPrice - atr,
            takeProfit: currentPrice + atr * riskRewardRatio,
            price: currentPrice,
        };
    } else if (shortCondition) {
        console.log("SELL Signal Detected!");
        return {
            signal: "SELL",
            stopLoss: currentPrice + atr,
            takeProfit: currentPrice - atr * riskRewardRatio,
            price: currentPrice,
        };
    }

    console.log("No signal generated.");
    return null;
}

// Monitor Active Signal
// Monitor active signal
async function monitorSignal() {
    if (!activeSignal) return;

    const candles = await fetchCandles();
    if (!candles || candles.length < limit) {
        console.error("Not enough data to calculate indicators.");
        return;
    }

    const currentPrice = candles[candles.length - 1].close;

    if (activeSignal.signal === "BUY" && currentPrice <= activeSignal.stopLoss) {
        console.log("BUY trade stopped out.");
        sendSignalOutcome("STOP LOSS HIT", activeSignal);
        signalStats.totalSignals++;
        signalStats.failureCount++;
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        console.log("BUY trade hit TP.");
        sendSignalOutcome("TAKE PROFIT HIT", activeSignal);
        signalStats.totalSignals++;
        signalStats.successCount++;
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        console.log("SELL trade stopped out.");
        sendSignalOutcome("STOP LOSS HIT", activeSignal);
        signalStats.totalSignals++;
        signalStats.failureCount++;
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit TP.");
        sendSignalOutcome("TAKE PROFIT HIT", activeSignal);
        signalStats.totalSignals++;
        signalStats.successCount++;
        activeSignal = null;
    }
}

// Send Signal Outcome to Telegram
function sendSignalOutcome(outcome, signal) {
    const message = `📊 **Signal Outcome** 📊\n
Crypto: ${signal.crypto.toUpperCase()}\n
Signal: ${signal.signal}\n
Outcome: ${outcome}\n
Entry Price: $${signal.price.toFixed(2)}\n
Stop Loss: $${signal.stopLoss.toFixed(2)}\n
Take Profit: $${signal.takeProfit.toFixed(2)}`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

function sendActiveSignalStatus() {
    if (!activeSignal) {
        bot.sendMessage(chatId, "No active signal at the moment.");
        return;
    }
    const message = `📊 **Active Signal Update** 📊\n
    Signal: ${activeSignal.signal}\n
    Entry Price: $${activeSignal.price.toFixed(2)}\n
    Stop Loss: $${activeSignal.stopLoss.toFixed(2)}\n
    Take Profit: $${activeSignal.takeProfit.toFixed(2)}\n
    Success Ratio: ${(successCount / (successCount + failureCount) * 100).toFixed(2)}%`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}
function sendSignalStats() {
    const message = `📊 **Signal Performance Stats** 📊\n
    Total Signals: ${signalStats.totalSignals}\n
    Success Count: ${signalStats.successCount}\n
    Failure Count: ${signalStats.failureCount}\n
    Success Rate: ${signalStats.successRate()}%`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

// Main Function
async function main() {
    const candles = await fetchCandles();

    if (candles.length < limit) {
        console.log("Not enough data to calculate indicators.");
        return;
    }

    const indicators = calculateIndicators(candles);

    const signal = generateSignal(candles, indicators);

    if (signal && !activeSignal) {
        console.log("New Signal Generated:", signal);
        activeSignal = signal;

        const message = `📊 **New Trading Signal** 📊\n
        Signal: ${signal.signal}\n
        Entry Price: $${signal.price.toFixed(2)}\n
        Stop Loss: $${signal.stopLoss.toFixed(2)}\n
        Take Profit: $${signal.takeProfit.toFixed(2)}`;
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } else if (signal) {
        console.log("Signal already active. Waiting for resolution...");
    }
}

// Schedule tasks
// Schedule tasks
setInterval(main, 180 * 1000); // Run every 3 minutes
setInterval(monitorSignal, 60 * 1000); // Monitor active signal every 1 minute
setInterval(sendActiveSignalStatus, 60 * 60 * 1000); // Send active signal update every hour
setInterval(sendSignalStats, 60 * 60 * 1000); // Send signal stats every hour
