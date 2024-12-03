const axios = require("axios");
const technicalindicators = require("technicalindicators");

// Configuration
const COINEX_API_URL = "https://api.coinex.com/v1/market/kline";
const symbol = "BTCUSDT";
const interval = "3min"; // CoinEx API uses intervals like "1min", "3min", "5min"
const limit = 100; // Number of candles to fetch
const atrLength = 20; // ATR calculation period
const shortEmaLength = 9; // Short EMA length
const longEmaLength = 21; // Long EMA length

// Fetch candle data
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

// Fetch real-time price
async function fetchRealTimePrice() {
    try {
        const response = await axios.get(REALTIME_PRICE_URL, {
            params: {
                ids: symbol,
                vs_currencies: "usd",
            },
        });

        if (response.data && response.data[symbol]) {
            return response.data[symbol].usd;
        } else {
            console.error("Unexpected response format for real-time price:", response.data);
            return null;
        }
    } catch (error) {
        console.error(`Error fetching real-time price: ${error.message}`);
        return null;
    }
}

// Calculate indicators
function calculateIndicators(candles) {
    const closes = candles.map((c) => c.close);

    const shortEma = technicalindicators.EMA.calculate({
        values: closes,
        period: shortEmaLength,
    });

    const longEma = technicalindicators.EMA.calculate({
        values: closes,
        period: longEmaLength,
    });

    const atr = technicalindicators.ATR.calculate({
        high: closes,
        low: closes,
        close: closes,
        period: atrLength,
    });

    return {
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
        atr: atr[atr.length - 1],
    };
}

// Generate signal
async function generateSignal() {
    const candles = await fetchCandles();
    if (candles.length < limit) {
        console.log("Not enough data to calculate indicators.");
        return;
    }

    const realTimePrice = await fetchRealTimePrice();
    const currentPrice = realTimePrice || candles[candles.length - 1].close;

    console.log("=== Indicator Values ===");
    const indicators = calculateIndicators(candles);
    console.log(`Short EMA: ${indicators.shortEma}`);
    console.log(`Long EMA: ${indicators.longEma}`);
    console.log(`ATR: ${indicators.atr}`);
    console.log("=== Price Info ===");
    console.log(`Current Price: ${currentPrice}`);

    const atrMultiplier = 1.5;

    const longCondition = currentPrice > indicators.shortEma && indicators.shortEma > indicators.longEma;
    const shortCondition = currentPrice < indicators.shortEma && indicators.shortEma < indicators.longEma;

    if (longCondition) {
        console.log("BUY Signal Detected!");
        return {
            signal: "BUY",
            stopLoss: currentPrice - indicators.atr * atrMultiplier,
            takeProfit: currentPrice + indicators.atr * atrMultiplier,
            price: currentPrice,
        };
    } else if (shortCondition) {
        console.log("SELL Signal Detected!");
        return {
            signal: "SELL",
            stopLoss: currentPrice + indicators.atr * atrMultiplier,
            takeProfit: currentPrice - indicators.atr * atrMultiplier,
            price: currentPrice,
        };
    } else {
        console.log("No signal generated.");
        return null;
    }
}

// Run the script
(async () => {
    const signal = await generateSignal();
    if (signal) {
        console.log("Generated Signal:", signal);
    }
})();
