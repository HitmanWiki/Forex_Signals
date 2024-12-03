const Binance = require('binance-api-node').default;
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Initialize Binance client
const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
});

// Telegram Bot setup
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const channelId = process.env.TELEGRAM_CHANNEL_ID;

// Trading settings
const pair = 'BTCUSDT';
const interval = '3m'; // 3-minute timeframe
const atrLength = 14;
const shortEmaLength = 30;
const longEmaLength = 100;
const riskRewardRatio = 2.0;

let activeSignal = null; // Track the active signal

// Fetch candles from Binance
async function fetchCandles(symbol, interval, limit = 100) {
    try {
        const candles = await client.futuresCandles({
            symbol,
            interval,
            limit,
        });

        return candles.map((candle) => ({
            time: new Date(candle.openTime),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume),
        }));
    } catch (error) {
        console.error(`Error fetching candles for ${symbol}: ${error.message}`);
        return [];
    }
}

// Retry mechanism for fetching data
async function fetchWithRetry(symbol, interval, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const candles = await fetchCandles(symbol, interval);
        if (candles.length > 0) return candles;
        console.log(`Retry ${attempt}/${retries} for ${symbol}...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.error(`Failed to fetch candles after ${retries} retries.`);
    return [];
}

// Calculate indicators
function calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    // ATR calculation
    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });

    // EMA calculations
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

// Generate signal
async function generateSignal() {
    console.log(`Generating signal for ${pair}...`);
    const candles = await fetchWithRetry(pair, interval);

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

    let signal = "HOLD";
    let stopLoss, takeProfit;

    // Long condition
    if (currentPrice > recentHigh && shortEma > longEma) {
        signal = "BUY";
        stopLoss = currentPrice - atr;
        takeProfit = currentPrice + atr * riskRewardRatio;
    }

    // Short condition
    if (currentPrice < recentLow && shortEma < longEma) {
        signal = "SELL";
        stopLoss = currentPrice + atr;
        takeProfit = currentPrice - atr * riskRewardRatio;
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
Signal: ${signal}\n
Current Price: $${currentPrice.toFixed(2)}\n
Stop Loss: $${stopLoss.toFixed(2)}\n
Take Profit: $${takeProfit.toFixed(2)}\n
Short EMA: $${shortEma.toFixed(2)}\n
Long EMA: $${longEma.toFixed(2)}\n
ATR: $${atr.toFixed(2)}\n`;

        bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
        activeSignal = { signal, stopLoss, takeProfit, entryPrice: currentPrice };
    } else {
        console.log("No signal generated.");
    }
}

// Monitor active signals
async function monitorActiveSignal() {
    if (!activeSignal) return;

    const candles = await fetchWithRetry(pair, interval);
    const currentPrice = candles[candles.length - 1]?.close;

    if (!currentPrice) return;

    if (activeSignal.signal === "BUY") {
        if (currentPrice <= activeSignal.stopLoss) {
            console.log("BUY trade stopped out.");
            bot.sendMessage(channelId, `❌ **BUY Trade Stopped Out** @ $${currentPrice.toFixed(2)}`);
            activeSignal = null;
        } else if (currentPrice >= activeSignal.takeProfit) {
            console.log("BUY trade take profit hit.");
            bot.sendMessage(channelId, `✅ **BUY Trade Take Profit Hit** @ $${currentPrice.toFixed(2)}`);
            activeSignal = null;
        }
    } else if (activeSignal.signal === "SELL") {
        if (currentPrice >= activeSignal.stopLoss) {
            console.log("SELL trade stopped out.");
            bot.sendMessage(channelId, `❌ **SELL Trade Stopped Out** @ $${currentPrice.toFixed(2)}`);
            activeSignal = null;
        } else if (currentPrice <= activeSignal.takeProfit) {
            console.log("SELL trade take profit hit.");
            bot.sendMessage(channelId, `✅ **SELL Trade Take Profit Hit** @ $${currentPrice.toFixed(2)}`);
            activeSignal = null;
        }
    }
}

// Schedule signal generation and monitoring
setInterval(generateSignal, 3 * 60 * 1000); // Every 3 minutes
setInterval(monitorActiveSignal, 1 * 60 * 1000); // Every 1 minute
