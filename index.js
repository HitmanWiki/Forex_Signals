const axios = require("axios");
const technicalindicators = require("technicalindicators");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();



// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID; // Replace with your Telegram chat ID
const bot = new TelegramBot(botToken, { polling: true });

let activeSignal = null; // Stores the current active signal

// Fetch candles from Coinex
async function fetchBinanceCandles(symbol = "BTCUSDT", interval = "3m", limit = 150) {
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        console.log(`Fetching data from Binance URL: ${url}`);

        // Make the GET request
        const response = await axios.get(url);

        // Format the response into readable candles
        const candles = response.data.map((candle) => ({
            time: new Date(candle[0]), // Open time
            open: parseFloat(candle[1]), // Open price
            high: parseFloat(candle[2]), // High price
            low: parseFloat(candle[3]), // Low price
            close: parseFloat(candle[4]), // Close price
            volume: parseFloat(candle[5]), // Volume
        }));

        console.log(`Fetched ${candles.length} candles for ${symbol} (${interval})`);
        console.log("Sample Candle:", candles[candles.length - 1]); // Log the latest candle
        return candles;
    } catch (error) {
        console.error("Error fetching candles:", error.message);
        if (error.response) {
            console.error("Response Data:", error.response.data);
        }
        return [];
    }
}
// Calculate indicators
function calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
    });

    const shortEma = technicalindicators.EMA.calculate({
        values: closes,
        period: 30,
    });

    const longEma = technicalindicators.EMA.calculate({
        values: closes,
        period: 100,
    });

    return {
        atr: atr[atr.length - 1],
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
    };
}

// Generate a signal
function generateSignal(candles, indicators) {
    const { shortEma, longEma, atr } = indicators;
    const currentPrice = candles[candles.length - 1].close;

    console.log("=== Indicator Values ===");
    console.log(`Short EMA: ${shortEma}`);
    console.log(`Long EMA: ${longEma}`);
    console.log(`ATR: ${atr}`);
    // console.log(`RSI: ${rsi}`);
    console.log("=== Price Info ===");
    console.log(`Current Price: ${currentPrice}`);

    const atrMultiplier = 1.5;

    const longCondition =
        currentPrice >= shortEma * 0.999 &&
        shortEma > longEma;
    // rsi > 50;

    const shortCondition =
        currentPrice <= shortEma * 1.001 &&
        shortEma < longEma;
    // rsi < 50;

    if (longCondition) {
        console.log("BUY Signal Detected!");
        return {
            signal: "BUY",
            stopLoss: currentPrice - atr * atrMultiplier,
            takeProfit: currentPrice + atr * atrMultiplier,
            price: currentPrice,
        };
    } else if (shortCondition) {
        console.log("SELL Signal Detected!");
        return {
            signal: "SELL",
            stopLoss: currentPrice + atr * atrMultiplier,
            takeProfit: currentPrice - atr * atrMultiplier,
            price: currentPrice,
        };
    }

    console.log("No signal generated.");
    return null;
}

// Monitor active signal
async function monitorSignal() {
    if (!activeSignal) return;

    const candles = await fetchCandles();
    if (candles.length < limit) return;

    const currentPrice = candles[candles.length - 1].close;

    if (activeSignal.signal === "BUY" && currentPrice <= activeSignal.stopLoss) {
        console.log("BUY trade stopped out.");
        sendSignalOutcome("STOP LOSS HIT", activeSignal);
        activeSignal = null;
    } else if (activeSignal.signal === "BUY" && currentPrice >= activeSignal.takeProfit) {
        console.log("BUY trade hit TP.");
        sendSignalOutcome("TAKE PROFIT HIT", activeSignal);
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice >= activeSignal.stopLoss) {
        console.log("SELL trade stopped out.");
        sendSignalOutcome("STOP LOSS HIT", activeSignal);
        activeSignal = null;
    } else if (activeSignal.signal === "SELL" && currentPrice <= activeSignal.takeProfit) {
        console.log("SELL trade hit TP.");
        sendSignalOutcome("TAKE PROFIT HIT", activeSignal);
        activeSignal = null;
    }
}

// Send signal outcome to Telegram
function sendSignalOutcome(outcome, signal) {
    const message = `📊 **Signal Outcome** 📊\n
    Signal: ${signal.signal}\n
    Outcome: ${outcome}\n
    Entry Price: $${signal.price.toFixed(2)}\n
    Stop Loss: $${signal.stopLoss.toFixed(2)}\n
    Take Profit: $${signal.takeProfit.toFixed(2)}`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

// Send active signal status every hour
function sendActiveSignalStatus() {
    if (!activeSignal) {
        bot.sendMessage(chatId, "No active signal at the moment.");
        return;
    }
    const message = `📊 **Active Signal Update** 📊\n
    Signal: ${activeSignal.signal}\n
    Entry Price: $${activeSignal.price.toFixed(2)}\n
    Stop Loss: $${activeSignal.stopLoss.toFixed(2)}\n
    Take Profit: $${activeSignal.takeProfit.toFixed(2)}`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}
// Function to reset active signal
function resetActiveSignal() {
    console.log("Resetting active signal...");
    activeSignal = null; // Clear the existing signal
    bot.sendMessage(chatId, "Active signal has been reset. New signals will now be generated.");
}

bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    resetActiveSignal();
});



// Main signal generation loop
async function main() {
    const candles = await fetchCandles();

    if (candles.length < 100) {
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
setInterval(main, 180 * 1000); // Run every minute
setInterval(monitorSignal, 60 * 1000); // Monitor active signal every 30 seconds
setInterval(sendActiveSignalStatus, 60 * 60 * 1000); // Send active signal update every hour
