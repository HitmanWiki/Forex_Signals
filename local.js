const axios = require("axios");
const technicalindicators = require("technicalindicators");

// Fetch candles from Coinex API
async function fetchCandles(symbol, interval = "1min", limit = 150) {
    try {
        const url = `https://api.coinex.com/v1/market/kline`;

        // Coinex API requires specific formats for market and interval
        const formattedSymbol = symbol.replace("BTCUSDT", "BTCUSDT"); // Ensure correct symbol format
        const formattedInterval = interval; // Ensure correct interval

        console.log(`Fetching data for ${formattedSymbol} with interval: ${formattedInterval}`);

        const response = await axios.get(url, {
            params: {
                market: formattedSymbol, // Example: BTCUSDT
                type: formattedInterval, // Example: 1min, 3min, etc.
                limit: limit, // Number of candles to fetch
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
            return candles.reverse(); // Reverse to chronological order
        } else {
            console.error(`Unexpected response format`, response.data);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching candles: ${error.message}`);
        if (error.response) {
            console.error(`Response Data:`, error.response.data);
        }
        return [];
    }
}

// Calculate indicators
function calculateIndicators(candles, atrLength = 14, shortEmaLength = 30, longEmaLength = 100) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

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

    // Define signal conditions
    const longCondition = currentPrice > shortEma && shortEma > longEma;
    const shortCondition = currentPrice < shortEma && shortEma < longEma;

    if (longCondition) {
        console.log(`BUY Signal Detected!`);
        console.log(`Current Price: ${currentPrice}, Stop Loss: ${currentPrice - atr}, Take Profit: ${currentPrice + 2 * atr}`);
        return { signal: "BUY", stopLoss: currentPrice - atr, takeProfit: currentPrice + 2 * atr };
    } else if (shortCondition) {
        console.log(`SELL Signal Detected!`);
        console.log(`Current Price: ${currentPrice}, Stop Loss: ${currentPrice + atr}, Take Profit: ${currentPrice - 2 * atr}`);
        return { signal: "SELL", stopLoss: currentPrice + atr, takeProfit: currentPrice - 2 * atr };
    } else {
        console.log(`No signal generated.`);
        return { signal: "HOLD" };
    }
}

// Main function for testing
async function main() {
    const symbol = "BTCUSDT";
    const interval = "1min";

    const candles = await fetchCandles(symbol, interval);

    if (candles.length < 100) {
        console.error(`Not enough data to calculate indicators.`);
        return;
    }

    console.log(`Sample Candle:`, candles[candles.length - 1]);

    const indicators = calculateIndicators(candles);

    console.log("=== Indicator Values ===");
    console.log(`ATR: ${indicators.atr}`);
    console.log(`Short EMA: ${indicators.shortEma}`);
    console.log(`Long EMA: ${indicators.longEma}`);

    const signal = generateSignal(candles, indicators);
    console.log(`Generated Signal:`, signal);
}

// Run the main function
main();
