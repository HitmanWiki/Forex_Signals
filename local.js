const axios = require("axios");



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

// Test the function
fetchBinanceCandles();