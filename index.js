const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Bot and API Setup
const apiKey = process.env.TWELVE_DATA_API_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;

const bot = new TelegramBot(botToken, { polling: true });

const pair = "BTC/USD"; // Focused on BTC/USD
const interval = "5min"; // 1-minute timeframe
const atrLength = 14; // ATR length
const shortEmaLength = 30; // Short EMA
const longEmaLength = 100; // Long EMA
const cprLength = 15; // CPR Lookback Period
const riskRewardRatio = 2.0; // Risk-Reward Ratio

let activeSignal = null; // Track active trade
let signalHistory = { total: 0, successes: 0, failures: 0 }; // Track signal success/failure
let signalTagCounter = 1; // Unique signal counter

// Fetch data from Twelve Data API
async function fetchData(pair, interval) {
    try {
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
            pair
        )}&interval=${interval}&apikey=${apiKey}`;
        const response = await axios.get(url);

        if (response.data && response.data.values) {
            const prices = response.data.values.map((candle) => ({
                time: new Date(candle.datetime),
                open: parseFloat(candle.open),
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close),
                volume: parseFloat(candle.volume || 0),
            }));
            console.log(`Fetched ${prices.length} candles for ${pair} (${interval})`);
            return prices.reverse(); // Return in chronological order
        } else {
            console.error(
                `No data for ${pair}: ${response.data.message || "Unknown error"}`
            );
            return [];
        }
    } catch (error) {
        console.error(`Error fetching data for ${pair}: ${error.message}`);
        return [];
    }
}

// Calculate indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    // ATR Calculation
    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });

    // EMA Calculations
    const shortEma = technicalindicators.EMA.calculate({
        values: closes,
        period: shortEmaLength,
    });
    const longEma = technicalindicators.EMA.calculate({
        values: closes,
        period: longEmaLength,
    });

    // CPR Calculation
    const pivotHigh = Math.max(...highs.slice(-cprLength));
    const pivotLow = Math.min(...lows.slice(-cprLength));
    const pivotClose = closes.slice(-cprLength).reduce((a, b) => a + b, 0) / cprLength;

    const cprUpper = (pivotHigh + pivotLow) / 2;
    const cprLower = pivotClose;

    return {
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
        atr: atr[atr.length - 1],
        cprUpper,
        cprLower,
    };
}

// Send Telegram message for a signal
function sendSignalMessage(signalType, pair, currentPrice, stopLoss, takeProfit, indicators, tag) {
    // Calculate the success ratio
    const successRate = signalHistory.total
        ? ((signalHistory.successes / signalHistory.total) * 100).toFixed(2)
        : "N/A";

    const message = `📊 **Trading Signal for ${pair}** 📊\n
🔖 **Signal Tag**: #${tag}\n
📈 **Signal**: ${signalType}\n
💰 **Current Price**: $${currentPrice.toFixed(2)}\n
📉 **Stop Loss**: $${stopLoss.toFixed(2)}\n
📈 **Take Profit**: $${takeProfit.toFixed(2)}\n
📊 **ATR**: $${indicators.atr.toFixed(2)}\n
📊 **CPR Upper**: $${indicators.cprUpper.toFixed(2)}\n
📊 **CPR Lower**: $${indicators.cprLower.toFixed(2)}\n
📈 **Recent Signals Summary**:\n
   ✅ Successes: ${signalHistory.successes}\n
   ❌ Failures: ${signalHistory.failures}\n
   📊 Success Rate: ${successRate}%\n
🔔 **Outcome Updates will follow this tag**: #${tag}`;

    bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
}

// Send Telegram message for signal outcome
function sendOutcomeMessage(signalType, tag, outcome) {
    signalHistory.total += 1;
    if (outcome === "SUCCESS") signalHistory.successes += 1;
    if (outcome === "FAILURE") signalHistory.failures += 1;

    const successRate = ((signalHistory.successes / signalHistory.total) * 100).toFixed(2);

    const message = `📊 **Signal Outcome Update** 📊\n
🔖 **Signal Tag**: #${tag}\n
📈 **Signal Type**: ${signalType}\n
🎯 **Outcome**: ${outcome}\n
📊 **Updated Success Summary**:\n
   ✅ Successes: ${signalHistory.successes}\n
   ❌ Failures: ${signalHistory.failures}\n
   📊 Success Rate: ${successRate}%`;

    bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
}

// Generate signals
async function generateSignal() {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchData(pair, interval);

    if (!prices || prices.length < Math.max(shortEmaLength, longEmaLength, atrLength)) {
        console.log(`Not enough data for ${pair}`);
        return;
    }

    const indicators = calculateIndicators(prices);
    const currentPrice = prices[prices.length - 1].close;

    let signal = "HOLD";
    let stopLoss, takeProfit;

    // Long Condition
    if (
        currentPrice > indicators.cprUpper &&
        indicators.shortEma > indicators.longEma
    ) {
        signal = "BUY";
        stopLoss = currentPrice - indicators.atr * 1.5;
        takeProfit = currentPrice + indicators.atr * riskRewardRatio;
    }

    // Short Condition
    if (
        currentPrice < indicators.cprLower &&
        indicators.shortEma < indicators.longEma
    ) {
        signal = "SELL";
        stopLoss = currentPrice + indicators.atr * 1.5;
        takeProfit = currentPrice - indicators.atr * riskRewardRatio;
    }

    if (signal !== "HOLD") {
        const signalTag = `Signal-${signalTagCounter++}`;
        sendSignalMessage(signal, pair, currentPrice, stopLoss, takeProfit, indicators, signalTag);

        activeSignal = { signal, stopLoss, takeProfit, tag: signalTag };
    } else {
        console.log("No signal generated.");
    }
}

// Monitor active signals
async function monitorSignal() {
    if (!activeSignal) return;
    const prices = await fetchData(pair, interval);
    const currentPrice = prices[prices.length - 1]?.close;

    if (!currentPrice) return;

    if (activeSignal.signal === "BUY" && currentPrice <= activeSignal.stopLoss) {
        console.log("BUY trade stopped out.");
        sendOutcomeMessage(activeSignal.signal, activeSignal.tag, "FAILURE");
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        console.log("SELL trade stopped out.");
        sendOutcomeMessage(activeSignal.signal, activeSignal.tag, "FAILURE");
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        console.log("BUY trade hit TP.");
        sendOutcomeMessage(activeSignal.signal, activeSignal.tag, "SUCCESS");
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit TP.");
        sendOutcomeMessage(activeSignal.signal, activeSignal.tag, "SUCCESS");
        activeSignal = null;
    }
}

// Schedule signal generation and monitoring
setInterval(generateSignal, 5 * 60 * 1000); // Every 1 minute
setInterval(monitorSignal, 30 * 1000); // Every 30 seconds
