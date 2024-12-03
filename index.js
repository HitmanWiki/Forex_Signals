const Binance = require("node-binance-api");
const TelegramBot = require("node-telegram-bot-api");
const technicalindicators = require("technicalindicators");
require("dotenv").config();

// Initialize Binance for Testnet
const binance = new Binance().options({
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_API_SECRET,
    useServerTime: true,
    test: true,
    base: 'https://testnet.binance.vision', // Testnet URL
});

// Bot and Trading Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;
const bot = new TelegramBot(botToken, { polling: true });

const pair = "BTCUSDT";
const interval = "3m"; // 3-minute timeframe
const atrLength = 14;
const shortEmaLength = 30;
const longEmaLength = 100;
const riskRewardRatio = 2.0;

// Fetch Testnet Data
async function fetchBinanceData(pair, interval) {
    try {
        const candles = await binance.candlesticks(pair, interval, { limit: 150 });
        return candles.map((candle) => ({
            time: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
        }));
    } catch (error) {
        console.error(`Error fetching data from Binance Testnet: ${error.message}`);
        return [];
    }
}

// Calculate Indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    const shortEma = technicalindicators.EMA.calculate({ values: closes, period: shortEmaLength });
    const longEma = technicalindicators.EMA.calculate({ values: closes, period: longEmaLength });
    const rsi = technicalindicators.RSI.calculate({ values: closes, period: 14 });
    const atr = technicalindicators.ATR.calculate({ high: highs, low: lows, close: closes, period: atrLength });

    return {
        shortEma: shortEma[shortEma.length - 1],
        longEma: longEma[longEma.length - 1],
        rsi: rsi[rsi.length - 1],
        atr: atr[atr.length - 1],
    };
}

// Generate Signal and Place Test Orders
async function generateSignal() {
    const prices = await fetchBinanceData(pair, interval);
    if (prices.length < Math.max(shortEmaLength, longEmaLength, atrLength)) return;

    const { shortEma, longEma, rsi, atr } = calculateIndicators(prices);
    const currentPrice = prices[prices.length - 1].close;
    const recentHigh = Math.max(...prices.slice(-10).map((p) => p.high));
    const recentLow = Math.min(...prices.slice(-10).map((p) => p.low));

    let signal = "HOLD";
    let stopLoss, takeProfit;

    if (currentPrice > recentHigh && shortEma > longEma && rsi > 50) {
        signal = "BUY";
        stopLoss = currentPrice - atr;
        takeProfit = currentPrice + atr * riskRewardRatio;
        await placeTestOrder(pair, "BUY", 0.001); // Testnet order
    } else if (currentPrice < recentLow && shortEma < longEma && rsi < 50) {
        signal = "SELL";
        stopLoss = currentPrice + atr;
        takeProfit = currentPrice - atr * riskRewardRatio;
        await placeTestOrder(pair, "SELL", 0.001); // Testnet order
    }

    if (signal !== "HOLD") {
        const message = `📊 **Trading Signal for ${pair}** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice.toFixed(2)}\n
        RSI: ${rsi.toFixed(2)}\n
        ATR: $${atr.toFixed(2)}\n
        Stop Loss: $${stopLoss.toFixed(2)}\n
        Take Profit: $${takeProfit.toFixed(2)}\n`;

        bot.sendMessage(channelId, message);
    } else {
        console.log("No signal generated.");
    }
}

// Run Bot on Testnet
setInterval(generateSignal, 3 * 60 * 1000); // Every 3 minutes
