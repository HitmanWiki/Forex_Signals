const Binance = require("node-binance-api");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Binance API and Telegram Bot Setup
const binance = new Binance().options({
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_API_SECRET,
});
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const channelId = process.env.TELEGRAM_CHANNEL_ID;

// Bot Configuration
const pair = "BTCUSDT"; // Pair to trade
const interval = "3m"; // Binance-supported interval
const atrLength = 20; // ATR length for stop-loss/take-profit
const emaShortLength = 30; // Short EMA length
const emaLongLength = 100; // Long EMA length
const cprLength = 15; // CPR calculation period
const riskRewardRatio = 2.0; // Risk-Reward ratio

let activeSignal = null; // Track the active signal

// Fetch 3-minute candles from Binance
async function fetchCandleData() {
    try {
        const candles = await binance.futuresCandlesticks(pair, interval, { limit: 30 });
        const formattedData = candles.map((candle) => ({
            time: new Date(candle[0]),
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
        }));
        console.log(`Successfully fetched ${formattedData.length} candles for ${pair}`);
        return formattedData.reverse(); // Return in chronological order
    } catch (error) {
        console.error(`Error fetching data from Binance: ${error.message}`);
        return [];
    }
}

// Calculate indicators
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

    const cprUpper = (pivotHigh + pivotLow) / 2;
    const cprLower = pivotClose;

    return {
        atr: atr[atr.length - 1],
        emaShort: emaShort[emaShort.length - 1],
        emaLong: emaLong[emaLong.length - 1],
        cprUpper,
        cprLower,
    };
}

// Generate trading signals
async function generateSignal() {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchCandleData();

    if (prices.length < Math.max(emaShortLength, emaLongLength, atrLength)) {
        console.log(`Not enough data to calculate indicators.`);
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

    if (signal !== "HOLD" && !activeSignal) {
        activeSignal = { signal, stopLoss, takeProfit, currentPrice, time: new Date() };
        const message = `📊 **New Trading Signal for ${pair}** 📊\n
Signal: ${signal}\n
Current Price: $${currentPrice.toFixed(2)}\n
Stop Loss: $${stopLoss.toFixed(2)}\n
Take Profit: $${takeProfit.toFixed(2)}\n
ATR: $${atr.toFixed(2)}\n
EMA Short: $${emaShort.toFixed(2)}\n
EMA Long: $${emaLong.toFixed(2)}\n
CPR Upper: $${cprUpper.toFixed(2)}\n
CPR Lower: $${cprLower.toFixed(2)}\n
Time: ${new Date().toLocaleString()}`;

        bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
    } else {
        console.log("No new signal generated.");
    }
}

// Monitor active signal
async function monitorActiveSignal() {
    if (!activeSignal) return;

    const prices = await fetchCandleData();
    const currentPrice = prices[prices.length - 1]?.close;

    if (!currentPrice) return;

    const { signal, stopLoss, takeProfit } = activeSignal;

    if (signal === "BUY" && currentPrice <= stopLoss) {
        console.log("BUY signal stopped out.");
        bot.sendMessage(channelId, `🚨 **BUY Signal Stopped Out** 🚨\nCurrent Price: $${currentPrice.toFixed(2)}`);
        activeSignal = null;
    } else if (signal === "BUY" && currentPrice >= takeProfit) {
        console.log("BUY signal hit take profit.");
        bot.sendMessage(channelId, `🎉 **BUY Signal Hit Take Profit** 🎉\nCurrent Price: $${currentPrice.toFixed(2)}`);
        activeSignal = null;
    } else if (signal === "SELL" && currentPrice >= stopLoss) {
        console.log("SELL signal stopped out.");
        bot.sendMessage(channelId, `🚨 **SELL Signal Stopped Out** 🚨\nCurrent Price: $${currentPrice.toFixed(2)}`);
        activeSignal = null;
    } else if (signal === "SELL" && currentPrice <= takeProfit) {
        console.log("SELL signal hit take profit.");
        bot.sendMessage(channelId, `🎉 **SELL Signal Hit Take Profit** 🎉\nCurrent Price: $${currentPrice.toFixed(2)}`);
        activeSignal = null;
    }
}

// Send hourly updates
function sendHourlyUpdate() {
    if (!activeSignal) {
        bot.sendMessage(channelId, `ℹ️ **No Active Signal** ℹ️`);
    } else {
        const { signal, stopLoss, takeProfit, currentPrice, time } = activeSignal;
        const message = `📊 **Active Signal Update for ${pair}** 📊\n
Signal: ${signal}\n
Entry Price: $${currentPrice.toFixed(2)}\n
Stop Loss: $${stopLoss.toFixed(2)}\n
Take Profit: $${takeProfit.toFixed(2)}\n
Time: ${new Date(time).toLocaleString()}`;
        bot.sendMessage(channelId, message, { parse_mode: "Markdown" });
    }
}

// Schedule tasks
setInterval(generateSignal, 3 * 60 * 1000); // Every 3 minutes
setInterval(monitorActiveSignal, 1 * 60 * 1000); // Every 1 minute
setInterval(sendHourlyUpdate, 60 * 60 * 1000); // Every hour
