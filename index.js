const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Bot and API Configuration
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(botToken, { polling: true });
const channelId = process.env.TELEGRAM_CHANNEL_ID;

const pair = "BTCUSDT"; // Target market
const interval = "1min"; // Interval for candlesticks
const atrLength = 14; // ATR period
const shortEmaLength = 9; // Short EMA
const longEmaLength = 21; // Long EMA
let activeSignal = null;

// Fetch Candles from Coinex
async function fetchCandles(symbol, interval = "1min", limit = 150) {
    try {
        const url = `https://api.coinex.com/v1/market/kline`;
        const formattedSymbol = symbol.replace("BTCUSDT", "BTC_USDT");
        const response = await axios.get(url, {
            params: {
                market: formattedSymbol,
                type: interval,
                limit: limit,
            },
        });

        if (response.data && response.data.data) {
            const candles = response.data.data.map((candle) => ({
                time: new Date(candle[0] * 1000),
                open: parseFloat(candle[1]),
                high: parseFloat(candle[3]),
                low: parseFloat(candle[4]),
                close: parseFloat(candle[2]),
                volume: parseFloat(candle[5]),
            }));
            console.log(`Fetched ${candles.length} candles for ${symbol} (${interval})`);
            return candles.reverse();
        } else {
            console.error(`Unexpected response format`, response.data);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching candles: ${error.message}`);
        return [];
    }
}

// Calculate Indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });

    const shortEma = technicalindicators.EMA.calculate({
        values: closes,
        period: shortEmaLength,
    });

    const longEma = technicalindicators.EMA.calculate({
        values: closes,
        period: longEmaLength,
    });

    return {
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
        atr: atr[atr.length - 1],
    };
}

// Generate Trading Signal
async function generateSignal() {
    console.log(`Generating signal for ${pair}...`);
    const candles = await fetchCandles(pair, interval, 150);

    if (candles.length < Math.max(shortEmaLength, longEmaLength, atrLength)) {
        console.log("Not enough data to calculate indicators.");
        return;
    }

    const { shortEma, longEma, atr } = calculateIndicators(candles);
    const currentPrice = candles[candles.length - 1].close;
    const recentHigh = Math.max(...candles.slice(-10).map((c) => c.high));
    const recentLow = Math.min(...candles.slice(-10).map((c) => c.low));

    let signal = "HOLD";
    let stopLoss, takeProfit;

    if (currentPrice > recentHigh && shortEma > longEma) {
        signal = "BUY";
        stopLoss = currentPrice - atr * 1.5;
        takeProfit = currentPrice + atr * 2;
    } else if (currentPrice < recentLow && shortEma < longEma) {
        signal = "SELL";
        stopLoss = currentPrice + atr * 1.5;
        takeProfit = currentPrice - atr * 2;
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice.toFixed(2)}\n
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
    const candles = await fetchCandles(pair, interval, 10);
    const currentPrice = candles[candles.length - 1]?.close;

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

// Run Bot
setInterval(generateSignal, 5 * 60 * 1000); // Every 5 minutes
setInterval(monitorSignal, 1 * 60 * 1000); // Every 1 minute
