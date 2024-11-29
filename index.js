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

const pairs = ['EUR/USD', 'BTC/USD']; // Trading pairs
const bot = new TelegramBot(botToken, { polling: true });

// Fetch data from Twelve Data
async function fetchForexCryptoData(pair, interval = '5min') {
    try {
        const encodedPair = encodeURIComponent(pair);
        const url = `https://api.twelvedata.com/time_series?symbol=${encodedPair}&interval=${interval}&apikey=${apiKey}`;
        console.log(`Fetching data from URL: ${url}`);

        const response = await axios.get(url);

        if (response.data && response.data.values) {
            const prices = response.data.values.map((candle) => ({
                time: new Date(candle.datetime),
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
        console.error(`Error fetching data for ${pair}: ${error.message}`);
        return [];
    }
}

// RSI Calculation
function interpretRSI(prices, period = 14) {
    const closes = prices.map((p) => p.close);
    const rsi = technicalindicators.RSI.calculate({ values: closes, period });
    const latestRSI = rsi[rsi.length - 1];

    if (!latestRSI) return 'Neutral';
    if (latestRSI < 30) return 'Bullish';
    if (latestRSI > 70) return 'Bearish';
    return 'Neutral';
}

// Bollinger Bands Calculation
function interpretBollingerBands(prices, period = 20, stdDev = 2) {
    const closes = prices.map((p) => p.close);
    const { upper, lower } = technicalindicators.BollingerBands.calculate({
        period,
        values: closes,
        stdDev,
    });
    const latestClose = closes[closes.length - 1];

    if (!upper || !lower) return 'Neutral';
    if (latestClose < lower[lower.length - 1]) return 'Bullish';
    if (latestClose > upper[upper.length - 1]) return 'Bearish';
    return 'Neutral';
}

// Moving Averages Calculation
function interpretMovingAverages(prices, shortPeriod = 20, longPeriod = 50) {
    const closes = prices.map((p) => p.close);
    const shortMA = technicalindicators.SMA.calculate({ values: closes, period: shortPeriod });
    const longMA = technicalindicators.SMA.calculate({ values: closes, period: longPeriod });

    if (!shortMA.length || !longMA.length) return 'Neutral';
    if (shortMA[shortMA.length - 1] > longMA[longMA.length - 1]) return 'Bullish';
    if (shortMA[shortMA.length - 1] < longMA[longMA.length - 1]) return 'Bearish';
    return 'Neutral';
}

// ATR Calculation
function calculateATR(prices, period = 14) {
    const highs = prices.map((p) => p.high);
    const lows = prices.map((p) => p.low);
    const closes = prices.map((p) => p.close);

    const atr = technicalindicators.ATR.calculate({
        high: highs,
        low: lows,
        close: closes,
        period,
    });

    return atr[atr.length - 1];
}

// Support and Resistance Calculation
function calculateSupportResistance(prices) {
    if (prices.length < 2) {
        console.error('Not enough data to calculate support and resistance');
        return { support: null, resistance: null };
    }

    const lastCandle = prices[0];
    const prevCandle = prices[1];
    const pivot = (prevCandle.high + prevCandle.low + prevCandle.close) / 3;

    const resistance = pivot + (prevCandle.high - prevCandle.low);
    const support = pivot - (prevCandle.high - prevCandle.low);

    return { support, resistance };
}

// Generate Trading Signal
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
        const atr = calculateATR(prices);
        const { support, resistance } = calculateSupportResistance(prices);

        // Log indicator results
        console.log(`RSI for ${pair}: ${rsiSignal}`);
        console.log(`Bollinger Bands for ${pair}: ${bbSignal}`);
        console.log(`Moving Averages for ${pair}: ${maSignal}`);
        console.log(`ATR for ${pair}: ${atr}`);
        console.log(`Support: ${support}, Resistance: ${resistance}`);

        let finalSignal = 'HOLD';

        const currentPrice = prices[0].close;
        console.log(`Current Price for ${pair}: ${currentPrice}`);

        // Signal Decision
        if (
            currentPrice > resistance &&
            rsiSignal === 'Bullish' &&
            bbSignal === 'Bullish' &&
            maSignal === 'Bullish'
        ) {
            finalSignal = 'BUY';
        } else if (
            currentPrice < support &&
            rsiSignal === 'Bearish' &&
            bbSignal === 'Bearish' &&
            maSignal === 'Bearish'
        ) {
            finalSignal = 'SELL';
        }

        console.log(`Signal for ${pair}: ${finalSignal}`);

        if (!activeSignals[pair] && finalSignal !== 'HOLD') {
            const multiplier = 1.5;
            const stopLoss = finalSignal === 'BUY'
                ? currentPrice - atr * multiplier
                : currentPrice + atr * multiplier;

            const takeProfit = finalSignal === 'BUY'
                ? currentPrice + atr * multiplier
                : currentPrice - atr * multiplier;

            const signalTag = `Signal-${signalCounter++}`;

            const message = `📊 **Trading Signal for ${pair}** (Tag: ${signalTag}) 📊\n
            Signal: ${finalSignal}\n
            RSI: ${rsiSignal}\n
            Bollinger Bands: ${bbSignal}\n
            Moving Averages: ${maSignal}\n
            ATR: ${atr.toFixed(2)}\n
            Support: $${support.toFixed(2)}\n
            Resistance: $${resistance.toFixed(2)}\n
            Stop Loss: $${stopLoss.toFixed(2)}\n
            Take Profit: $${takeProfit.toFixed(2)}\n`;

            bot.sendMessage(channelId, message, { parse_mode: 'Markdown' })
                .then(() => console.log('Signal sent to Telegram channel'))
                .catch((err) => console.error('Error sending message to Telegram:', err));

            activeSignals[pair] = {
                type: finalSignal,
                stopLoss,
                takeProfit,
                atr,
                support,
                resistance,
                tag: signalTag,
                pair,
            };
        }
    } catch (error) {
        console.error(`Error generating signal for ${pair}:`, error.message);
    }
}


// Monitor Active Signals
async function monitorActiveSignals() {
    for (const pair in activeSignals) {
        const signal = activeSignals[pair];
        const prices = await fetchForexCryptoData(pair);
        const currentPrice = prices[0]?.close;

        if (!currentPrice) continue;

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

// Send Signal Outcomes
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

// Run Signals for All Pairs
async function generateSignalsForAllPairs() {
    for (const pair of pairs) {
        await generateComprehensiveSignal(pair);
        await sleep(15000); // Avoid rate limit issues
    }
}

setInterval(() => generateSignalsForAllPairs(), 5 * 60 * 1000); // Every 5 minutes
setInterval(() => monitorActiveSignals(), 1 * 60 * 1000); // Every minute

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'This bot generates trading signals using RSI, Bollinger Bands, Moving Averages, ATR, and Support/Resistance.');
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
