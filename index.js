const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const technicalindicators = require('technicalindicators');
require('dotenv').config();

// Bot and API Setup
const apiKey = process.env.TWELVE_DATA_API_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;

const bot = new TelegramBot(botToken, { polling: true });

const pairs = ['BTC/USD']; // Trading pair
const interval = '5min'; // Ensure it's a 3-minute timeframe
const riskRewardRatio = 2.0; // Risk-Reward Ratio
const atrLength = 20; // ATR Length
const cprLength = 15; // CPR Lookback Period
const emaShortLength = 30; // Short EMA Length
const emaLongLength = 100; // Long EMA Length

let activeSignals = {}; // Track active trades

// Fetch data from Twelve Data API
async function fetchForexCryptoData(pair) {
    try {
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(pair)}&interval=${interval}&apikey=${apiKey}`;
        const response = await axios.get(url);

        if (response.data && response.data.values) {
            const prices = response.data.values.map((candle) => ({
                time: new Date(candle.datetime),
                open: parseFloat(candle.open),
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close),
            }));
            console.log(`Fetched ${prices.length} candles for ${pair}`);
            return prices.reverse(); // Return in chronological order
        } else {
            console.error(`No data for ${pair}: ${response.data.message || 'Unknown error'}`);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching data for ${pair}: ${error.message}`);
        return [];
    }
}

// Calculate indicators
function calculateIndicators(prices) {
    const closes = prices.map((p) => p.close);
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);

    // ATR Calculation
    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period: atrLength,
    });

    // EMA Calculations
    const emaShort = technicalindicators.EMA.calculate({ values: closes, period: emaShortLength });
    const emaLong = technicalindicators.EMA.calculate({ values: closes, period: emaLongLength });

    // CPR Calculation
    const pivotHigh = Math.max(...highs.slice(-cprLength));
    const pivotLow = Math.min(...lows.slice(-cprLength));
    const pivotClose = closes.slice(-cprLength).reduce((sum, val) => sum + val, 0) / cprLength;

    const cprUpper = (pivotHigh + pivotLow) / 2;
    const cprLower = pivotClose;

    return {
        emaShort: emaShort[emaShort.length - 1],
        emaLong: emaLong[emaLong.length - 1],
        atr: atr[atr.length - 1],
        cprUpper,
        cprLower,
    };
}

// Generate signals
async function generateSignal(pair) {
    console.log(`Generating signal for ${pair}`);
    const prices = await fetchForexCryptoData(pair);

    if (!prices || prices.length < Math.max(emaLongLength, atrLength, cprLength)) {
        console.log(`Not enough data for ${pair}`);
        return;
    }

    const { emaShort, emaLong, atr, cprUpper, cprLower } = calculateIndicators(prices);
    const currentPrice = prices[prices.length - 1].close;

    let signal = 'HOLD';
    let stopLoss, takeProfit;

    // Long Condition
    if (currentPrice > cprUpper && emaShort > emaLong) {
        signal = 'BUY';
        stopLoss = currentPrice - atr;
        takeProfit = currentPrice + atr * riskRewardRatio;
    }

    // Short Condition
    if (currentPrice < cprLower && emaShort < emaLong) {
        signal = 'SELL';
        stopLoss = currentPrice + atr;
        takeProfit = currentPrice - atr * riskRewardRatio;
    }

    if (signal !== 'HOLD') {
        const signalTag = `Signal-${pair}-${Date.now()}`;
        const message = `📊 **Trading Signal for ${pair}** 📊\n
        Signal: ${signal}\n
        Current Price: $${currentPrice.toFixed(2)}\n
        CPR Upper: $${cprUpper.toFixed(2)}, CPR Lower: $${cprLower.toFixed(2)}\n
        EMA Short: $${emaShort.toFixed(2)}, EMA Long: $${emaLong.toFixed(2)}\n
        ATR: $${atr.toFixed(2)}\n
        Stop Loss: $${stopLoss.toFixed(2)}\n
        Take Profit: $${takeProfit.toFixed(2)}\n`;

        bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
        activeSignals[pair] = { signal, stopLoss, takeProfit };
    } else {
        console.log(`No signal generated for ${pair}.`);
    }
}

// Monitor active signals
async function monitorSignals() {
    for (const pair in activeSignals) {
        const signal = activeSignals[pair];
        const prices = await fetchForexCryptoData(pair);
        const currentPrice = prices[prices.length - 1]?.close;

        if (!currentPrice) continue;

        if (signal.signal === 'BUY' && currentPrice <= signal.stopLoss) {
            console.log(`BUY trade stopped out for ${pair}`);
            delete activeSignals[pair];
        } else if (signal.signal === 'SELL' && currentPrice >= signal.stopLoss) {
            console.log(`SELL trade stopped out for ${pair}`);
            delete activeSignals[pair];
        } else if (signal.signal === 'BUY' && currentPrice >= signal.takeProfit) {
            console.log(`BUY trade hit TP for ${pair}`);
            delete activeSignals[pair];
        } else if (signal.signal === 'SELL' && currentPrice <= signal.takeProfit) {
            console.log(`SELL trade hit TP for ${pair}`);
            delete activeSignals[pair];
        }
    }
}

// Run the bot
setInterval(() => {
    pairs.forEach((pair) => generateSignal(pair));
}, 5 * 60 * 1000); // Run every 3 minutes

setInterval(() => {
    monitorSignals();
}, 1 * 60 * 1000); // Monitor every minute
