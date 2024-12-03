const Binance = require('binance-api-node').default;
const TelegramBot = require('node-telegram-bot-api');
const technicalindicators = require('technicalindicators');
require('dotenv').config();

// Binance Client Initialization
const client = Binance({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
});

// Telegram Bot Initialization
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const channelId = process.env.TELEGRAM_CHANNEL_ID;

// Strategy Configuration
const pair = 'BTCUSDT';
const interval = '3m'; // 3-minute chart
const atrLength = 20;
const emaShortLength = 30;
const emaLongLength = 100;
const riskRewardRatio = 2;
let activeSignal = null; // Track active signal
let signalHistory = { successes: 0, failures: 0, total: 0 };

// Fetch Candles from Binance
async function fetchCandles(symbol, interval, limit = 30) {
    try {
        const candles = await client.futuresCandles({
            symbol,
            interval,
            limit,
        });

        return candles.map((candle) => ({
            time: new Date(candle.openTime),
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume),
        }));
    } catch (error) {
        console.error('Error fetching candles:', error.message);
        return [];
    }
}

// Calculate Indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });

    const emaShort = technicalindicators.EMA.calculate({
        values: closes,
        period: emaShortLength,
    });

    const emaLong = technicalindicators.EMA.calculate({
        values: closes,
        period: emaLongLength,
    });

    return {
        atr: atr[atr.length - 1],
        emaShort: emaShort[emaShort.length - 1],
        emaLong: emaLong[emaLong.length - 1],
    };
}

// Generate Signal
async function generateSignal() {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchCandles(pair, interval);

    if (!prices || prices.length < Math.max(atrLength, emaShortLength, emaLongLength)) {
        console.log(`Not enough data for ${pair}.`);
        return;
    }

    const { atr, emaShort, emaLong } = calculateIndicators(prices);
    const currentPrice = prices[prices.length - 1].close;
    const recentHigh = Math.max(...prices.slice(-15).map((p) => p.high));
    const recentLow = Math.min(...prices.slice(-15).map((p) => p.low));

    let signal = 'HOLD';
    let stopLoss, takeProfit;

    if (currentPrice > recentHigh && emaShort > emaLong) {
        signal = 'BUY';
        stopLoss = currentPrice - atr;
        takeProfit = currentPrice + atr * riskRewardRatio;
    } else if (currentPrice < recentLow && emaShort < emaLong) {
        signal = 'SELL';
        stopLoss = currentPrice + atr;
        takeProfit = currentPrice - atr * riskRewardRatio;
    }

    if (signal !== 'HOLD') {
        activeSignal = { signal, stopLoss, takeProfit, currentPrice };
        signalHistory.total++;

        const message = `📊 **Trading Signal for ${pair}** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice.toFixed(2)}\n
        Stop Loss: $${stopLoss.toFixed(2)}\n
        Take Profit: $${takeProfit.toFixed(2)}\n
        ATR: $${atr.toFixed(2)}\n
        EMA Short: $${emaShort.toFixed(2)}\n
        EMA Long: $${emaLong.toFixed(2)}\n`;

        bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
    } else {
        console.log('No signal generated.');
    }
}

// Monitor Active Signals
async function monitorActiveSignal() {
    if (!activeSignal) return;

    const prices = await fetchCandles(pair, interval);
    const currentPrice = prices[prices.length - 1]?.close;

    if (!currentPrice) return;

    if (activeSignal.signal === 'BUY' && currentPrice >= activeSignal.takeProfit) {
        signalHistory.successes++;
        bot.sendMessage(
            channelId,
            `✅ **BUY Signal Success for ${pair}**\n
            Entry Price: $${activeSignal.currentPrice.toFixed(2)}\n
            Exit Price: $${currentPrice.toFixed(2)}\n
            Profit Target Hit!`,
            { parse_mode: 'Markdown' }
        );
        activeSignal = null;
    } else if (activeSignal.signal === 'SELL' && currentPrice <= activeSignal.takeProfit) {
        signalHistory.successes++;
        bot.sendMessage(
            channelId,
            `✅ **SELL Signal Success for ${pair}**\n
            Entry Price: $${activeSignal.currentPrice.toFixed(2)}\n
            Exit Price: $${currentPrice.toFixed(2)}\n
            Profit Target Hit!`,
            { parse_mode: 'Markdown' }
        );
        activeSignal = null;
    } else if (currentPrice <= activeSignal.stopLoss || currentPrice >= activeSignal.stopLoss) {
        signalHistory.failures++;
        bot.sendMessage(
            channelId,
            `❌ **Signal Failed for ${pair}**\n
            Entry Price: $${activeSignal.currentPrice.toFixed(2)}\n
            Stop Loss Hit at $${activeSignal.stopLoss.toFixed(2)}.`,
            { parse_mode: 'Markdown' }
        );
        activeSignal = null;
    }
}

// Schedule Signal Generation and Monitoring
setInterval(generateSignal, 3 * 60 * 1000); // Every 3 minutes
setInterval(monitorActiveSignal, 1 * 60 * 1000); // Every 1 minute

// Periodic Summary Report
setInterval(() => {
    const successRate = ((signalHistory.successes / signalHistory.total) * 100 || 0).toFixed(2);
    const message = `📊 **Signal Summary** 📊\n
    Total Signals: ${signalHistory.total}\n
    Successes: ${signalHistory.successes}\n
    Failures: ${signalHistory.failures}\n
    Success Rate: ${successRate}%`;
    bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
}, 60 * 60 * 1000); // Every 1 hour
