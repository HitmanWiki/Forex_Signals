const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Bot and API Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const binanceApiKey = process.env.BINANCE_API_KEY;
const binanceApiSecret = process.env.BINANCE_API_SECRET;

const bot = new TelegramBot(botToken, { polling: true });

const binanceApiUrl = "https://testnet.binance.vision/api/v3";
const pair = "BTCUSDT"; // Binance symbol format
const interval = "3m"; // 3-minute timeframe
const atrLength = 14; // ATR length
const shortEmaLength = 30; // Short EMA
const longEmaLength = 100; // Long EMA
const cprLength = 15; // CPR lookback period
const riskRewardRatio = 2.0; // Risk-reward ratio

let activeSignal = null;
let signalHistory = { successes: 0, failures: 0, total: 0 };

// Fetch data from Binance Testnet API
async function fetchData(symbol, interval) {
    try {
        const response = await axios.get(`${binanceApiUrl}/klines`, {
            params: {
                symbol: symbol,
                interval: interval,
                limit: 30, // Fetch 30 candles
            },
            headers: {
                "X-MBX-APIKEY": binanceApiKey,
            },
        });

        const prices = response.data.map((candle) => ({
            time: new Date(candle[0]),
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
        }));

        console.log(`Fetched ${prices.length} candles for ${symbol} (${interval})`);
        return prices;
    } catch (error) {
        console.error("Error fetching data from Binance:", error.message);
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

// Generate signals
async function generateSignal() {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchData(pair, interval);

    if (!prices || prices.length < Math.max(shortEmaLength, longEmaLength, atrLength)) {
        console.log(`Not enough data for ${pair}`);
        return;
    }

    const { shortEma, longEma, atr, cprUpper, cprLower } = calculateIndicators(prices);

    const currentPrice = prices[prices.length - 1].close;

    let signal = "HOLD";
    let stopLoss, takeProfit;

    // Long Condition
    if (currentPrice > cprUpper && shortEma > longEma) {
        signal = "BUY";
        stopLoss = currentPrice - atr;
        takeProfit = currentPrice + atr * riskRewardRatio;
    }

    // Short Condition
    if (currentPrice < cprLower && shortEma < longEma) {
        signal = "SELL";
        stopLoss = currentPrice + atr;
        takeProfit = currentPrice - atr * riskRewardRatio;
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
    Signal: ${signal}\n
    Current Price: $${currentPrice.toFixed(2)}\n
    ATR: $${atr.toFixed(2)}\n
    CPR Upper: $${cprUpper.toFixed(2)}\n
    CPR Lower: $${cprLower.toFixed(2)}\n
    Stop Loss: $${stopLoss.toFixed(2)}\n
    Take Profit: $${takeProfit.toFixed(2)}\n
    Success Rate: ${((signalHistory.successes / signalHistory.total) * 100 || 0).toFixed(2)}%`;

        bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
        activeSignal = { signal, stopLoss, takeProfit };
        signalHistory.total++;
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
        signalHistory.failures++;
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        console.log("SELL trade stopped out.");
        signalHistory.failures++;
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        console.log("BUY trade hit TP.");
        signalHistory.successes++;
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit TP.");
        signalHistory.successes++;
        activeSignal = null;
    }
}

// Schedule signal generation and monitoring
setInterval(generateSignal, 3 * 60 * 1000); // Every 3 minutes
setInterval(monitorSignal, 1 * 60 * 1000); // Every 1 minute
