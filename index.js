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
async function fetchForexCryptoData(pair, interval = '1min') {
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
    if (latestRSI > 60) return 'Bearish';
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
    if (currentPrice > latestBollinger.middle && currentPrice < latestBollinger.upper) signal = 'BUY';
    if (currentPrice < latestBollinger.middle && currentPrice > latestBollinger.lower) signal = 'SELL';

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
        const prices = await fetchForexCryptoData(pair, '5min'); // Use 5-minute chart for more frequent signals

        if (!prices || prices.length < 50) {
            console.log(`Not enough data for ${pair}.`);
            return;
        }

        // Extract data for indicators
        const closes = prices.map((p) => p.close);
        const highs = prices.map((p) => p.high);
        const lows = prices.map((p) => p.low);

        // Calculate indicators
        const shortMA = technicalindicators.SMA.calculate({ values: closes, period: 20 });
        const longMA = technicalindicators.SMA.calculate({ values: closes, period: 50 });
        const rsi = technicalindicators.RSI.calculate({ values: closes, period: 14 });
        const bollinger = technicalindicators.BollingerBands.calculate({
            values: closes,
            period: 20,
            stdDev: 2,
        });
        const atr = technicalindicators.ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
        });

        // Validate indicators
        if (!shortMA.length || !longMA.length || !rsi.length || !bollinger.length || !atr.length) {
            console.log(`Not enough data to calculate indicators for ${pair}.`);
            return;
        }

        // Extract latest values
        const currentPrice = closes[closes.length - 1];
        const latestRSI = rsi[rsi.length - 1];
        const latestShortMA = shortMA[shortMA.length - 1];
        const latestLongMA = longMA[longMA.length - 1];
        const latestBollinger = bollinger[bollinger.length - 1];
        const latestATR = atr[atr.length - 1];

        // Simplified signal logic
        let signal = 'HOLD';
        let stopLoss, takeProfit;

        if (
            latestShortMA > latestLongMA && // Uptrend
            (latestRSI < 50 || currentPrice > latestBollinger.middle) // RSI or Bollinger Band breakout
        ) {
            signal = 'BUY';
            stopLoss = currentPrice - latestATR * 1.5;
            takeProfit = currentPrice + latestATR * 2;
        } else if (
            latestShortMA < latestLongMA && // Downtrend
            (latestRSI > 50 || currentPrice < latestBollinger.middle) // RSI or Bollinger Band breakout
        ) {
            signal = 'SELL';
            stopLoss = currentPrice + latestATR * 1.5;
            takeProfit = currentPrice - latestATR * 2;
        }

        // Generate signal message
        if (signal !== 'HOLD') {
            const signalTag = `Signal-${signalCounter++}`;
            const message = `📊 **Trading Signal for ${pair}** (Tag: ${signalTag}) 📊\n
            Signal: ${signal}\n
            RSI: ${latestRSI.toFixed(2)}\n
            Moving Averages: Short = ${latestShortMA.toFixed(2)}, Long = ${latestLongMA.toFixed(2)}\n
            Bollinger Bands: Upper = ${latestBollinger.upper.toFixed(2)}, Lower = ${latestBollinger.lower.toFixed(2)}\n
            ATR: ${latestATR.toFixed(2)}\n
            Stop Loss: $${stopLoss.toFixed(2)}\n
            Take Profit: $${takeProfit.toFixed(2)}\n`;

            bot.sendMessage(channelId, message, { parse_mode: 'Markdown' });
            activeSignals[pair] = { type: signal, stopLoss, takeProfit, pair, tag: signalTag };
        } else {
            console.log(`No signal generated for ${pair}.`);
        }
    } catch (error) {
        console.error(`Error generating signal for ${pair}:`, error.message);
    }
}



// Monitor Active Signals
async function monitorActiveSignals() {
    for (const pair in activeSignals) {
        const signal = activeSignals[pair];
        const prices = await fetchForexCryptoData(pair, '5min'); // Fetch 15-minute data for monitoring
        const currentPrice = prices[0]?.close;

        if (!currentPrice) continue;

        // Check Stop Loss
        if (currentPrice <= signal.stopLoss && signal.type === 'BUY') {
            signalHistory.failures++;
            signalHistory.total++;
            delete activeSignals[pair];
            sendOutcomeMessage('FAILURE', signal);
        } else if (currentPrice >= signal.stopLoss && signal.type === 'SELL') {
            signalHistory.failures++;
            signalHistory.total++;
            delete activeSignals[pair];
            sendOutcomeMessage('FAILURE', signal);
        }

        // Check Take Profit
        if (currentPrice >= signal.takeProfit && signal.type === 'BUY') {
            signalHistory.successes++;
            signalHistory.total++;
            delete activeSignals[pair];
            sendOutcomeMessage('SUCCESS', signal);
        } else if (currentPrice <= signal.takeProfit && signal.type === 'SELL') {
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

setInterval(() => generateSignalsForAllPairs(), 15 * 60 * 1000); // Every 15 minutes
setInterval(() => monitorActiveSignals(), 1 * 60 * 1000); // Every minute

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'This bot generates trading signals using RSI, Bollinger Bands, Moving Averages, ATR, and Support/Resistance.');
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
