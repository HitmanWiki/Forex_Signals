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
const interval = "1min"; // 1-minute timeframe
const atrLength = 14; // ATR length
const shortEmaLength = 9; // Short EMA
const longEmaLength = 21; // Long EMA
const rsiLength = 14; // RSI length

let activeSignal = null; // Track active trade

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

/// Calculate indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    console.log("Calculating indicators...");
    console.log("Closes:", closes);
    console.log("Highs:", highs);
    console.log("Lows:", lows);

    // ATR Calculation
    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });
    console.log("ATR:", atr);

    // EMA Calculations
    const shortEma = technicalindicators.EMA.calculate({
        values: closes,
        period: shortEmaLength,
    });
    const longEma = technicalindicators.EMA.calculate({
        values: closes,
        period: longEmaLength,
    });
    console.log("Short EMA:", shortEma);
    console.log("Long EMA:", longEma);

    // RSI Calculation
    const rsi = technicalindicators.RSI.calculate({ values: closes, period: rsiLength });
    console.log("RSI:", rsi);



    return {
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
        rsi: rsi[rsi.length - 1],

        atr: atr[atr.length - 1],
    };
}

async function generateSignal() {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchData(pair, interval);

    if (!prices || prices.length < Math.max(shortEmaLength, longEmaLength, atrLength)) {
        console.log(`Not enough data for ${pair}`);
        return;
    }

    const { shortEma, longEma, rsi, atr } = calculateIndicators(prices);

    const currentPrice = prices[prices.length - 1].close;
    const recentHigh = Math.max(...prices.slice(-10).map((p) => p.high));
    const recentLow = Math.min(...prices.slice(-10).map((p) => p.low));

    // Log the indicator and price information for debugging
    console.log("=== Indicator Values ===");
    console.log("Short EMA:", shortEma);
    console.log("Long EMA:", longEma);
    console.log("RSI:", rsi);
    console.log("ATR:", atr);
    console.log("=== Price Info ===");
    console.log("Current Price:", currentPrice);
    console.log("Recent High:", recentHigh);
    console.log("Recent Low:", recentLow);

    let signal = "HOLD";
    let stopLoss, takeProfit;

    // Adjusted Buy Condition
    if (
        currentPrice <= (recentLow + 0.1 * atr) &&
        shortEma > (longEma + 0.5 * atr) &&
        rsi < 30
    ) {
        signal = "BUY";
        stopLoss = currentPrice - atr * 1.5;
        takeProfit = currentPrice + atr * 2;

        // Log the conditions that triggered the BUY signal
        console.log("BUY Signal Triggered");
        console.log("Condition 1: Current Price <= Recent Low + 0.1 * ATR");
        console.log("Condition 2: Short EMA > Long EMA + 0.5 * ATR");
        console.log("Condition 3: RSI < 30");
    }

    // Adjusted Sell Condition
    if (
        currentPrice >= (recentHigh - 0.1 * atr) &&
        shortEma < (longEma - 0.5 * atr) &&
        rsi > 70
    ) {
        signal = "SELL";
        stopLoss = currentPrice + atr * 1.5;
        takeProfit = currentPrice - atr * 2;

        // Log the conditions that triggered the SELL signal
        console.log("SELL Signal Triggered");
        console.log("Condition 1: Current Price >= Recent High - 0.1 * ATR");
        console.log("Condition 2: Short EMA < Long EMA - 0.5 * ATR");
        console.log("Condition 3: RSI > 70");
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
    Signal: ${signal}\n
    Current Price: $${currentPrice.toFixed(2)}\n
    RSI: ${rsi?.toFixed(2) || "N/A"}\n
    ATR: $${atr?.toFixed(2) || "N/A"}\n
    Stop Loss: $${stopLoss.toFixed(2)}\n
    Take Profit: $${takeProfit.toFixed(2)}\n`;

        bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
        activeSignal = { signal, stopLoss, takeProfit };

        console.log("Signal Sent to Telegram:", signal);
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
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        console.log("SELL trade stopped out.");
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        console.log("BUY trade hit TP.");
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit TP.");
        activeSignal = null;
    }
}

// Schedule signal generation and monitoring
setInterval(generateSignal, 1 * 60 * 1000); // Every 1 minute
setInterval(monitorSignal, 30 * 1000); // Every 30 seconds
