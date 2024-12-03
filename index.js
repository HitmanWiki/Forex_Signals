const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// API and Bot Configurations
const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;

const bot = new TelegramBot(botToken, { polling: true });

const pair = "BTC/USD"; // Pair
const interval = "1min"; // Timeframe
const atrLength = 20; // ATR length
const cprLength = 15; // CPR lookback period
const emaShortLength = 30; // Short EMA
const emaLongLength = 100; // Long EMA
const riskRewardRatio = 2.0; // Risk-Reward Ratio
const useATR = true; // ATR-based stop-loss/take-profit

let activeSignal = null; // Track active trades

// Map trading pairs to Alpha Vantage symbols
const symbolMap = {
    "BTC/USD": "BTCUSD",
};

// Fetch Data from Alpha Vantage
async function fetchData(symbol, interval) {
    const mappedSymbol = symbolMap[symbol]; // Map pair to Alpha Vantage format
    if (!mappedSymbol) {
        console.error(`Symbol mapping not found for: ${symbol}`);
        return [];
    }

    try {
        const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${mappedSymbol}&interval=${interval}&apikey=${apiKey}&datatype=json`;
        const response = await axios.get(url);

        const timeSeriesKey = `Time Series (${interval})`;
        if (response.data[timeSeriesKey]) {
            const data = response.data[timeSeriesKey];
            const prices = Object.keys(data).map((timestamp) => ({
                time: new Date(timestamp),
                open: parseFloat(data[timestamp]["1. open"]),
                high: parseFloat(data[timestamp]["2. high"]),
                low: parseFloat(data[timestamp]["3. low"]),
                close: parseFloat(data[timestamp]["4. close"]),
            }));
            console.log(`Fetched ${prices.length} candles for ${symbol} (${interval})`);
            return prices.reverse(); // Return data in chronological order
        } else {
            console.error(`Error fetching data: ${response.data["Note"] || "Unknown error"}`);
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

    // ATR
    const atr = technicalindicators.ATR.calculate({ high: highs, low: lows, close: closes, period: atrLength });

    // EMAs
    const shortEma = technicalindicators.EMA.calculate({ values: closes, period: emaShortLength });
    const longEma = technicalindicators.EMA.calculate({ values: closes, period: emaLongLength });

    // CPR
    const pivotHigh = Math.max(...highs.slice(-cprLength));
    const pivotLow = Math.min(...lows.slice(-cprLength));
    const pivotClose = closes.slice(-cprLength).reduce((sum, val) => sum + val, 0) / cprLength;

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

// Generate Signal
async function generateSignal() {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchData(pair, interval); // Fetch data with mapped symbol

    if (!prices || prices.length < Math.max(emaLongLength, atrLength)) {
        console.log("Not enough data to calculate indicators.");
        return;
    }

    const { shortEma, longEma, atr, cprUpper, cprLower } = calculateIndicators(prices);
    const currentPrice = prices[prices.length - 1].close;

    console.log("=== Indicator Values ===");
    console.log(`Short EMA: ${shortEma}`);
    console.log(`Long EMA: ${longEma}`);
    console.log(`ATR: ${atr}`);
    console.log(`CPR Upper: ${cprUpper}`);
    console.log(`CPR Lower: ${cprLower}`);
    console.log(`Current Price: ${currentPrice}`);

    let signal = "HOLD";
    let stopLoss, takeProfit;

    // Long Condition
    if (currentPrice > cprUpper && shortEma > longEma) {
        signal = "BUY";
        stopLoss = currentPrice - (useATR ? atr : 50); // Example fixed fallback
        takeProfit = currentPrice + (useATR ? atr * riskRewardRatio : 100);
    }

    // Short Condition
    if (currentPrice < cprLower && shortEma < longEma) {
        signal = "SELL";
        stopLoss = currentPrice + (useATR ? atr : 50);
        takeProfit = currentPrice - (useATR ? atr * riskRewardRatio : 100);
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice.toFixed(2)}\n
        ATR: $${atr?.toFixed(2) || "N/A"}\n
        CPR Upper: $${cprUpper.toFixed(2)}\n
        CPR Lower: $${cprLower.toFixed(2)}\n
        Stop Loss: $${stopLoss.toFixed(2)}\n
        Take Profit: $${takeProfit.toFixed(2)}\n`;

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
        console.log("BUY trade hit TP.");
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit TP.");
        activeSignal = null;
    }
}

// Schedule Tasks
setInterval(generateSignal, 1 * 60 * 1000); // Generate signals every minute
setInterval(monitorSignal, 30 * 1000); // Monitor active signals every 30 seconds
