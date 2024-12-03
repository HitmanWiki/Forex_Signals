const Binance = require('binance-api-node').default;

// Initialize the Binance client
const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
});

async function fetchCandles() {
    try {
        const candles = await client.futuresCandles({
            symbol: 'BTCUSDT',
            interval: '3m',
            limit: 10,
        });

        const formattedData = candles.map((candle) => ({
            time: new Date(candle.openTime),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume),
        }));

        console.log('Formatted Data:', formattedData);
    } catch (error) {
        console.error('Error fetching candles:', error.message);
    }
}

fetchCandles();
