const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const technicalindicators = require('technicalindicators');
require('dotenv').config();

const apiKey = process.env.TWELVE_DATA_API_KEY;
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const channelId = process.env.TELEGRAM_CHANNEL_ID;

let activeSignals = {}; // Track active signals for all pairs
let signalHistory = { successes: 0, failures: 0, total: 0 };
let signalCounter = 1; // Simple counter for tagging signals

const pairs = ['XAU/USD', 'EUR/USD', 'BTC/USD']; // Trading pairs
const bot = new TelegramBot(botToken, { polling: true });

// Fetch 5-minute data from Twelve Data
async function fetchForexCryptoData(pair, interval = '5min') {
    try {
        const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=${interval}&apikey=${apiKey}`;
        const response = await axios.get(url);

        if (response.data && response.data.values) {
            const prices = response.data.values.map((candle) => ({
                time: new Date(candle.datetime), // Timestamp
                high: parseFloat(candle.high),
                low: parseFloat(candle.low),
                close: parseFloat(candle.close),
            }));
            console.log(`Fetched ${prices.length} candles for ${pair}`);
            return prices.reverse(); // Return data in chronological order
        } else {
            console.error(`No data returned for ${pair}: ${response.data.message || 'Unknown error'}`);
            return [];
        }
    } catch (error) {
        console.error(`Error fetching data for ${pair}:`, error.message);
        return [];
    }
}

// Function to calculate RSI
function interpretRSI(prices, period = 14) {
    const closes = prices.map((p) => p.close);
    const rsi = technicalindicators.RSI.calculate({ values: closes, period });
    const latestRSI = rsi[rsi.length - 1];

    if (!latestRSI) return 'Neutral'; // Handle cases where RSI cannot be calculated
    if (latestRSI < 30) return 'Bullish';
    if (latestRSI > 70) return 'Bearish';
    return 'Neutral';
}

// Function to calculate Bollinger Bands
function interpretBollingerBands(prices, period = 20, nbdevup = 2, nbdevdn = 2) {
    const closes = prices.map((p) => p.close);
    const { upper, lower } = technicalindicators.BollingerBands.calculate({
        period,
        values: closes,
        stdDev: nbdevup,
    });
    const latestClose = closes[closes.length - 1];

    if (!upper || !lower) return 'Neutral'; // Handle cases where bands cannot be calculated
    if (latestClose < lower[lower.length - 1]) return 'Bullish';
    if (latestClose > upper[upper.length - 1]) return 'Bearish';
    return 'Neutral';
}

// Function to calculate moving averages
function interpretMovingAverages(prices, shortPeriod = 20, longPeriod = 50) {
    const closes = prices.map((p) => p.close);
    const shortMA = technicalindicators.SMA.calculate({ values: closes, period: shortPeriod });
    const longMA = technicalindicators.SMA.calculate({ values: closes, period: longPeriod });

    if (!shortMA.length || !longMA.length) return 'Neutral'; // Handle insufficient data
    if (shortMA[shortMA.length - 1] > longMA[longMA.length - 1]) return 'Bullish'; // Golden Cross
    if (shortMA[shortMA.length - 1] < longMA[longMA.length - 1]) return 'Bearish'; // Death Cross
    return 'Neutral';
}

// Generate trading signals
async function generateComprehensiveSignal(pair) {
    console.log(`Generating signal for ${pair}`);
    try {
        const prices = await fetchForexCryptoData(pair);

        if (!prices || prices.length < 15) {
            console.log(`Not enough data for ${pair}.`);
            return;
        }

        // Calculate indicators
        const rsiSignal = interpretRSI(prices);
        const bbSignal = interpretBollingerBands(prices);
        const maSignal = interpretMovingAverages(prices);

        console.log(`RSI: ${rsiSignal}, BB: ${bbSignal}, MA: ${maSignal}`);

        // Combine signals
        let finalSignal = 'HOLD';
        if (rsiSignal === 'Bullish' && bbSignal === 'Bullish' && maSignal === 'Bullish') {
            finalSignal = 'BUY';
        } else if (rsiSignal === 'Bearish' && bbSignal === 'Bearish' && maSignal === 'Bearish') {
            finalSignal = 'SELL';
        }

        if (!activeSignals[pair]) {
            const currentPrice = prices[0].close;
            const stopLoss = currentPrice - 10; // Example: 10 points stop loss
            const takeProfit = currentPrice + 20; // Example: 20 points take profit
            const signalTag = `Signal-${signalCounter++}`;

            const message = `📊 **Trading Signal for ${pair}** (Tag: ${signalTag}) 📊\n
            Signal: ${finalSignal}\n
            RSI: ${rsiSignal}\n
            Bollinger Bands: ${bbSignal}\n
            Moving Averages: ${maSignal}\n
            Stop Loss: $${stopLoss.toFixed(2)}\n
            Take Profit: $${takeProfit.toFixed(2)}\n`;

            bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
            activeSignals[pair] = { type: finalSignal, stopLoss, takeProfit, tag: signalTag };
        }
    } catch (error) {
        console.error(`Error generating signal for ${pair}:`, error.message);
    }
}

// Monitor signals periodically
async function monitorActiveSignals() {
    for (const pair in activeSignals) {
        const signal = activeSignals[pair];
        const prices = await fetchForexCryptoData(pair);
        const currentPrice = prices[0]?.close;

        if (currentPrice <= signal.stopLoss) {
            signalHistory.failures++;
            signalHistory.total++;
            delete activeSignals[pair];
            sendOutcomeMessage('FAILURE', signal);
        } else if (currentPrice >= signal.takeProfit) {
            signalHistory.successes++;
            signalHistory.total++;
            delete activeSignals[pair];
            sendOutcomeMessage('SUCCESS', signal);
        }
    }
}

// Send signal outcomes
function sendOutcomeMessage(outcome, signal) {
    const successRate = ((signalHistory.successes / signalHistory.total) * 100).toFixed(2);
    const message = `📊 **Signal Outcome** (Tag: ${signal.tag}) 📊\n
    Signal: ${signal.type}\n
    Outcome: ${outcome}\n
    Success Rate: ${successRate}%\n
    Stop Loss: $${signal.stopLoss.toFixed(2)}\n
    Take Profit: $${signal.takeProfit.toFixed(2)}\n`;

    bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
}

// Run signals for all pairs
async function generateSignalsForAllPairs() {
    for (const pair of pairs) {
        await generateComprehensiveSignal(pair);
        await sleep(15000); // Delay to prevent rate limit issues
    }
}

setInterval(() => generateSignalsForAllPairs(), 5 * 60 * 1000); // Every 5 minutes
setInterval(() => monitorActiveSignals(), 1 * 60 * 1000); // Every minute

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'This bot generates trading signals using RSI, Bollinger Bands, and Moving Averages.');
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
