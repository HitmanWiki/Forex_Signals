const axios = require("axios");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Configuration
const API_URL = "https://api.coinex.com/v1/market/kline";
const symbol = "BTCUSDT";
const interval = "3min";
const limit = 150;

// Fetch candles from Coinex
async function fetchCandles() {
    try {
        console.log(`Fetching data for ${symbol} with interval: ${interval}`);
        const response = await axios.get(API_URL, {
            params: { market: symbol, type: interval, limit: limit },
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
            console.log("Sample Candle:", candles[candles.length - 1]); // Display the most recent candle
            return candles.reverse(); // Reverse to chronological order
        } else {
            console.error("Unexpected response format:", response.data);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching candles: ${error.message}`);
        if (error.response) console.error("Response Data:", error.response.data);
        return [];
    }
}

// Calculate indicators
function calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    console.log("Closes for Indicator Calculation:", closes); // Debug closes

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
    console.log("=== Price Info ===");
    console.log(`Current Price: ${currentPrice}`);

    const atrMultiplier = 1.5;

    const longCondition =
        currentPrice >= shortEma * 0.999 &&
        shortEma > longEma;

    const shortCondition =
        currentPrice <= shortEma * 1.001 &&
        shortEma < longEma;

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

// Main function
async function main() {
    const candles = await fetchCandles();

    if (candles.length < 100) {
        console.log("Not enough data to calculate indicators.");
        return;
    }

    const indicators = calculateIndicators(candles);

    const signal = generateSignal(candles, indicators);

    if (signal) {
        console.log("Generated Signal:", signal);
    } else {
        console.log("No valid signal at this time.");
    }
}

// Run the bot
main();
