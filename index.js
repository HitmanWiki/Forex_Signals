const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID; // Replace with your Telegram chat ID
const bot = new TelegramBot(botToken, { polling: true });

// Configuration
const COIN_GECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const WATCHED_CRYPTOS = ["bitcoin"]; // Replace with your cryptocurrency list
const vsCurrency = "usd"; // Currency for price comparison
const interval = 180; // Check every 3 minutes (in seconds)

// Active Signal Tracking
let activeSignals = {}; // Object to store active signals for each crypto
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
        const response = await axios.get(COINGECKO_API_URL, {
            params: { vs_currency: "usd", days: "1", interval: "minute" }, // Fetch 1-day minute-level data
        });

        if (response.data && response.data.prices) {
            const prices = response.data.prices.slice(-limit); // Use the latest `limit` candles
            const candles = prices.map((price, index) => ({
                time: new Date(price[0]),
                open: index === 0 ? price[1] : prices[index - 1][1],
                high: Math.max(price[1], index === 0 ? price[1] : prices[index - 1][1]),
                low: Math.min(price[1], index === 0 ? price[1] : prices[index - 1][1]),
                close: price[1],
                volume: Math.random() * 10, // CoinGecko doesn't provide volume; generate mock data
            }));
            console.log(`Fetched ${candles.length} candles for ${symbol} (${interval})`);
            return candles.reverse(); // Reverse to chronological order
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
function monitorSignals(prices) {
    for (const crypto in activeSignals) {
        const signal = activeSignals[crypto];
        const price = prices[crypto]?.[vsCurrency];

        if (!price) {
            console.error(`Price for ${crypto} not found during monitoring!`);
            continue;
        }

        console.log(`Monitoring Active Signal for ${crypto}: $${price}`);

        if (signal.signal === "BUY" && price <= signal.stopLoss) {
            console.log(`BUY Signal for ${crypto} hit Stop Loss.`);
            sendSignalOutcome("STOP LOSS HIT", signal);
            signalStats.failure++;
            delete activeSignals[crypto];
        } else if (signal.signal === "BUY" && price >= signal.takeProfit) {
            console.log(`BUY Signal for ${crypto} hit Take Profit.`);
            sendSignalOutcome("TAKE PROFIT HIT", signal);
            signalStats.success++;
            delete activeSignals[crypto];
        } else if (signal.signal === "SELL" && price >= signal.stopLoss) {
            console.log(`SELL Signal for ${crypto} hit Stop Loss.`);
            sendSignalOutcome("STOP LOSS HIT", signal);
            signalStats.failure++;
            delete activeSignals[crypto];
        } else if (signal.signal === "SELL" && price <= signal.takeProfit) {
            console.log(`SELL Signal for ${crypto} hit Take Profit.`);
            sendSignalOutcome("TAKE PROFIT HIT", signal);
            signalStats.success++;
            delete activeSignals[crypto];
        }
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
setInterval(main, 180 * 1000); // Run every 3 minutes
setInterval(monitorSignal, 60 * 1000); // Monitor active signal every 1 minute
setInterval(sendActiveSignalStatus, 60 * 60 * 1000); // Send active signal update every hour