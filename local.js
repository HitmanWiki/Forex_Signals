const axios = require("axios");
const technicalindicators = require("technicalindicators");

// Configuration
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3/coins";
const coinId = "bitcoin"; // CoinGecko ID for Bitcoin
const vs_currency = "usd"; // Target currency
const interval = "3m"; // Supported intervals might be limited by the API
const days = "90"; // Time range: 1 = last 24 hours

// Fetch candles from CoinGecko
async function fetchCandles() {
    try {
        console.log(`Fetching data for ${coinId} with interval: ${interval}`);
        const response = await axios.get(`${COINGECKO_API_URL}/${coinId}/ohlc`, {
            params: { vs_currency, days }, // Fetch 7 days of data
        });

        if (response.data && response.data.length > 0) {
            const candles = response.data.map((candle) => ({
                time: new Date(candle[0]),
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: 0, // Volume not provided in CoinGecko API's OHLC data
            }));
            console.log(`Fetched ${candles.length} candles for ${coinId}`);
            return candles.reverse(); // Reverse for chronological order
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

    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: 20,
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

// Generate signal
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
    const longCondition = currentPrice > shortEma && shortEma > longEma;
    const shortCondition = currentPrice < shortEma && shortEma < longEma;

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
        console.log(`Not enough data to calculate indicators. Fetched ${candles.length} candles.`);
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
// Execute
main();
