const Binance = require('node-binance-api');

const binance = new Binance().options({
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_API_SECRET,
    test: true, // Use Binance Testnet

    family: 4 // Use IPv4 explicitly
});

async function fetchCandlestickData(symbol, interval) {
    try {
        const data = await new Promise((resolve, reject) => {
            binance.candlesticks(symbol, interval, (error, ticks, symbol) => {
                if (error) return reject(`Error fetching data: ${error.message}`);
                resolve(ticks); // Return candlestick data
            });
        });

        const prices = data.map((tick) => ({
            time: new Date(tick[0]), // Open time
            open: parseFloat(tick[1]),
            high: parseFloat(tick[2]),
            low: parseFloat(tick[3]),
            close: parseFloat(tick[4]),
            volume: parseFloat(tick[5])
        }));

        console.log(`Fetched ${prices.length} candles for ${symbol}`);
        return prices;
    } catch (error) {
        console.error(`Error fetching data from Binance: ${error}`);
        return [];
    }
}

// Example Usage
(async () => {
    const symbol = "BTCUSDT"; // Binance symbol format
    const interval = "3m"; // 3-minute interval
    const prices = await fetchCandlestickData(symbol, interval);
    console.log(prices);
})();
