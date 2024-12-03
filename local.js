const axios = require("axios");

// Binance API Details
const binanceApiUrl = "https://api.binance.com"; // Binance live API endpoint
const binanceApiKey = process.env.BINANCE_API_KEY; // Set your Binance API key in environment variables

// Function to fetch market data
async function fetchMarketData(symbol = "BTCUSDT", interval = "3m", limit = 30) {
    try {
        const response = await axios.get(`${binanceApiUrl}/api/v3/klines`, {
            params: {
                symbol: symbol,
                interval: interval,
                limit: limit,
            },
            headers: {
                "X-MBX-APIKEY": binanceApiKey, // Include API key in the header
            },
        });

        const candles = response.data.map((candle) => ({
            time: new Date(candle[0]), // Timestamp
            open: parseFloat(candle[1]), // Opening price
            high: parseFloat(candle[2]), // Highest price
            low: parseFloat(candle[3]), // Lowest price
            close: parseFloat(candle[4]), // Closing price
            volume: parseFloat(candle[5]), // Trade volume
        }));

        console.log(`Fetched ${candles.length} candles for ${symbol} (${interval})`);
        console.log("Sample candle:", candles[0]); // Display a sample candle
        return candles;
    } catch (error) {
        // Handle HTTP errors
        if (error.response) {
            if (error.response.status === 451) {
                console.error(
                    "Error fetching data: Regional or legal restrictions on accessing Binance API."
                );
            } else if (error.response.status === 429) {
                console.error(
                    "Error fetching data: Rate limit exceeded. Please wait before retrying."
                );
            } else {
                console.error(
                    `Error fetching data: ${error.response.status} - ${error.response.data.msg}`
                );
            }
        } else {
            console.error("Error fetching data:", error.message);
        }
        return [];
    }
}

// Main function to test the Binance API key
async function testBinanceApiKey() {
    console.log("Testing Binance API key...");

    const symbol = "BTCUSDT"; // Trading pair
    const interval = "3m"; // Timeframe (3 minutes)
    const limit = 30; // Number of candles to fetch

    // Fetch market data
    const candles = await fetchMarketData(symbol, interval, limit);

    if (candles.length > 0) {
        console.log(`Successfully fetched data for ${symbol}.`);
    } else {
        console.error("Failed to fetch market data. Check your API key or network settings.");
    }
}

// Run the test
testBinanceApiKey();
