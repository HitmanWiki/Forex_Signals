const axios = require("axios");
const technicalindicators = require("technicalindicators");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHANNEL_ID;
const bot = new TelegramBot(botToken, { polling: true });

const COINEX_API_URL = "https://api.coinex.com/v1/market/kline";
const symbol = "BTCUSDT";
const interval = "3min";
const limit = 150;

// Active signal and statistics
let activeSignal = null;
let totalSignals = 0;
let successCount = 0;
let failureCount = 0;
const atrMultiplier = 1.5;

// Fetch candles
async function fetchCandles() {
    try {
        console.log(`Fetching data for ${symbol} with interval: ${interval}`);
        const response = await axios.get(COINEX_API_URL, {
            params: { market: symbol, type: interval, limit: limit },
        });
        if (response.data && response.data.data) {
            const candles = response.data.data.map((candle) => ({
                time: new Date(candle[0] * 1000),
                open: parseFloat(candle[1]),
                close: parseFloat(candle[2]),
                high: parseFloat(candle[3]),
                low: parseFloat(candle[4]),
                volume: parseFloat(candle[5]),
            }));

            console.log(`Fetched ${candles.length} candles for ${symbol}`);
            return candles.slice(-limit); // Return the last `limit` candles
        } else {
            console.error("Unexpected response format:", response.data);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching candles: ${error.message}`);
        return [];
    }
}


// Calculate indicators
function calculateIndicators(candles) {
    if (candles.length < 50) {
        console.log("Not enough candles to calculate indicators.");
        return null;
    }
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const emaFast = technicalindicators.EMA.calculate({
        values: closes,
        period: 20,
    });
    const emaSlow = technicalindicators.EMA.calculate({
        values: closes,
        period: 50,
    });
    const rsi = technicalindicators.RSI.calculate({
        values: closes,
        period: 14,
    });
    const macd = technicalindicators.MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
    });
    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 14,
    });
    if (emaFast.length === 0 || emaSlow.length === 0 || macd.length === 0) {
        console.log("EMA or MACD calculation failed.");
        return null;
    }


    // CPR Levels
    const highPrev = Math.max(...highs.slice(-1));
    const lowPrev = Math.min(...lows.slice(-1));
    const closePrev = closes[closes.length - 2];
    const pp = (highPrev + lowPrev + closePrev) / 3;
    const bc = (highPrev + lowPrev) / 2;
    const tc = (pp + bc) / 2;

    return {
        emaFast: emaFast[emaFast.length - 1],
        emaSlow: emaSlow[emaSlow.length - 1],
        rsi: rsi[rsi.length - 1],
        macdLine: macd[macd.length - 1]?.MACD,
        signalLine: macd[macd.length - 1]?.signal,
        atr: atr[atr.length - 1],
        cprUpper: tc,
        cprLower: bc,
    };
}

// Generate signal
function generateSignal(candles, indicators) {
    const { emaFast, emaSlow, rsi, macdLine, signalLine, atr, cprUpper, cprLower } = indicators;
    const close = candles[candles.length - 1].close;

    console.log("=== Indicator Values ===");
    console.log(`Fast EMA: ${emaFast}`);
    console.log(`Slow EMA: ${emaSlow}`);
    console.log(`ATR: ${atr}`);
    console.log(`CPR Upper: ${cprUpper}`);
    console.log(`CPR Lower: ${cprLower}`);
    console.log("=== Price Info ===");
    console.log(`Current Price: ${close}`);



    const buyCondition =
        close > cprUpper &&
        emaFast > emaSlow &&
        rsi > 50 &&
        macdLine > signalLine &&
        macdLine > 0;

    const sellCondition =
        close < cprLower &&
        emaFast < emaSlow &&
        rsi < 50 &&
        macdLine < signalLine &&
        macdLine < 0;

    if (buyCondition) {
        totalSignals++;
        return {
            id: totalSignals,
            crypto: symbol,
            signal: "BUY",
            stopLoss: close - atr * atrMultiplier,
            takeProfit: close + atr * 2.0,
            trailingStop: close - atr * atrMultiplier, // Initial trailing stop
            price: close,
        };
    } else if (sellCondition) {
        totalSignals++;
        return {
            id: totalSignals,
            crypto: symbol,
            signal: "SELL",
            stopLoss: close + atr * atrMultiplier,
            takeProfit: close - atr * 2.0,
            trailingStop: close + atr * atrMultiplier, // Initial trailing stop
            price: close,
        };
    }
    console.log("No signal generated.");
    return null;
}

async function monitorSignal() {
    if (!activeSignal) return;

    const candles = await fetchCandles();
    if (!candles || candles.length < limit) {
        console.error("Not enough data to calculate indicators.");
        return;
    }

    const currentPrice = candles[candles.length - 1].close;

    if (activeSignal.signal === "BUY") {
        // Update trailing stop for BUY
        activeSignal.trailingStop = Math.max(activeSignal.trailingStop, currentPrice - activeSignal.atr * 1.5);

        if (currentPrice <= activeSignal.trailingStop) {
            console.log("BUY trade stopped out with trailing stop.");
            sendSignalOutcome("TRAILING STOP HIT", activeSignal);
            failureCount++;
            activeSignal = null;
        } else if (currentPrice >= activeSignal.takeProfit) {
            console.log("BUY trade hit TP.");
            sendSignalOutcome("TAKE PROFIT HIT", activeSignal);
            successCount++;
            activeSignal = null;
        }
    } else if (activeSignal.signal === "SELL") {
        // Update trailing stop for SELL
        activeSignal.trailingStop = Math.min(activeSignal.trailingStop, currentPrice + activeSignal.atr * 1.5);

        if (currentPrice >= activeSignal.trailingStop) {
            console.log("SELL trade stopped out with trailing stop.");
            sendSignalOutcome("TRAILING STOP HIT", activeSignal);
            failureCount++;
            activeSignal = null;
        } else if (currentPrice <= activeSignal.takeProfit) {
            console.log("SELL trade hit TP.");
            sendSignalOutcome("TAKE PROFIT HIT", activeSignal);
            successCount++;
            activeSignal = null;
        }
    }
}

// Send Signal Outcome to Telegram
function sendSignalOutcome(outcome, signal) {
    if (!signal || typeof signal !== "object") {
        console.error("Invalid signal object:", signal);
        bot.sendMessage(
            chatId,
            "Error: Unable to send signal outcome due to missing or invalid signal data."
        );
        return;
    }



    const message = `📊 **Signal Outcome** 📊\n
     Signal ID: ${signal.id || "N/A"}\n
     Crypto: ${signal.crypto?.toUpperCase() || "N/A"}\n
     Signal: ${signal.signal || "N/A"}\n
     Outcome: ${outcome || "N/A"}\n
     Entry Price: $${signal.price?.toFixed(2) || "N/A"}\n
     Stop Loss: $${signal.stopLoss?.toFixed(2) || "N/A"}\n
      Trailing Stop: $${signal.trailingStop?.toFixed(2) || "N/A"}\n
     Take Profit: $${signal.takeProfit?.toFixed(2) || "N/A"}\n
     Success Ratio: ${((successCount / (successCount + failureCount || 1)) * 100).toFixed(2)}%`;

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}
// Function to send signal stats
function sendSignalStats() {
    try {
        const totalSignals = successCount + failureCount; // Total signals generated
        const successRatio = totalSignals > 0
            ? ((successCount / totalSignals) * 100).toFixed(2)
            : "0.00";

        const message = `📊 **Signal Stats Update** 📊\n
        Total Signals: ${totalSignals}\n
        Successful Signals: ${successCount}\n
        Failed Signals: ${failureCount}\n
        Success Ratio: ${successRatio}%`;

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("Error sending signal stats:", error.message);
        bot.sendMessage(
            chatId,
            "⚠️ Error occurred while sending signal stats. Please check the logs.",
            { parse_mode: "Markdown" }
        );
    }
}

function sendActiveSignalStatus() {
    try {
        // Check if there is an active signal
        if (!activeSignal) {
            bot.sendMessage(chatId, "No active signal at the moment.");
            return;
        }

        // Calculate success ratio safely


        // Build the message with safe checks for all properties
        const message = `📊 **Active Signal Update** 📊\n
        Signal ID: ${activeSignal.id || "N/A"}\n
        Crypto: ${activeSignal.crypto?.toUpperCase() || "N/A"}\n
        Signal: ${activeSignal.signal || "N/A"}\n
        Entry Price: $${activeSignal.price?.toFixed(2) || "N/A"}\n
        Stop Loss: $${activeSignal.stopLoss?.toFixed(2) || "N/A"}\n
        Take Profit: $${activeSignal.takeProfit?.toFixed(2) || "N/A"}\n
       Success Ratio: ${((successCount / (successCount + failureCount || 1)) * 100).toFixed(2)}%`;

        // Send the message to Telegram
        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("Error sending active signal status:", error.message);

        // Notify via Telegram about the error
        bot.sendMessage(
            chatId,
            "⚠️ Error occurred while sending the active signal status. Please check the logs.",
            { parse_mode: "Markdown" }
        );
    }
}

// Reset function
function resetSignals() {
    activeSignal = null;
    successCount = 0; // Reset success count
    failureCount = 0; // Reset failure count
    // bot.sendMessage(chatId, "All signals and stats have been reset.");
}
// Main Function
async function main() {
    try {
        const candles = await fetchCandles();

        if (!candles || candles.length < limit) {
            console.log("Not enough data to calculate indicators.");
            return;
        }

        const indicators = calculateIndicators(candles);

        if (!indicators) {
            console.log("Error calculating indicators.");
            return;
        }

        const signal = generateSignal(candles, indicators, "BTCUSDT");

        if (signal && !activeSignal) {
            console.log("New Signal Generated:", signal);
            activeSignal = signal;

            const message = `📊 **New Trading Signal** 📊\n
             Signal ID: ${signal.id || "N/A"}\n
             Crypto: ${signal.crypto}\n
             Signal: ${signal.signal || "N/A"}\n
             Entry Price: $${signal.price?.toFixed(2) || "N/A"}\n
             Stop Loss: $${signal.stopLoss?.toFixed(2) || "N/A"}\n
             Take Profit: $${signal.takeProfit?.toFixed(2) || "N/A"}`;
            bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        } else if (signal) {
            console.log("Signal already active. Waiting for resolution...");
        } else {
            console.log("No new signal generated.");
        }
    } catch (error) {
        console.error("Error in main function:", error.message);
        bot.sendMessage(
            chatId,
            "⚠️ Error occurred while processing trading signals. Please check the logs.",
            { parse_mode: "Markdown" }
        );
    }
}


// Example of a reset trigger (Telegram Bot command)
bot.onText(/\/reset/, (msg) => {
    // const chatId = msg.chat.id;
    resetSignals();
    bot.sendMessage(chatId, "All signals and stats have been reset.");
});

// Schedule tasks
// Schedule tasks
setInterval(main, 180 * 1000); // Run every 3 minutes
setInterval(monitorSignal, 60 * 1000); // Monitor active signal every 1 minute
setInterval(sendActiveSignalStatus, 60 * 60 * 1000); // Send active signal update every hour
setInterval(sendSignalStats, 60 * 60 * 1000); // Send signal stats every hour
