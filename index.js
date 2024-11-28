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

async function fetchForexCryptoData(pair, interval) {
    try {
        if (!pair || typeof pair !== 'string') {
            throw new Error(`Invalid pair: ${pair}`);
        }

        const url = `https://api.twelvedata.com/time_series?symbol=${pair}&interval=5min&apikey=${apiKey}`;

        const response = await axios.get(url);

        if (response.data && response.data[`Time Series FX (${interval})`]) {
            const timeSeries = response.data[`Time Series FX (${interval})`];
            const prices = Object.keys(timeSeries).map((time) => ({
                time,
                high: parseFloat(timeSeries[time]['2. high']),
                low: parseFloat(timeSeries[time]['3. low']),
                close: parseFloat(timeSeries[time]['4. close']),
            }));

            return prices.reverse(); // Return data in chronological order
        }
    } catch (error) {
        console.error(`Error fetching data for ${pair} (${interval}):`, error.message);
        return [];
    }
}


// Function to calculate ATR (Average True Range) for dynamic SL and TP
function calculateATR(prices, period = 14) {
    let atr = 0;
    for (let i = 1; i < period + 1; i++) {
        const highLow = prices[i].high - prices[i].low;
        const highClose = Math.abs(prices[i].high - prices[i - 1].close);
        const lowClose = Math.abs(prices[i].low - prices[i - 1].close);
        atr += Math.max(highLow, highClose, lowClose);
    }
    return atr / period;
}

// Function to identify chart patterns
function identifyChartPattern(prices) {
    const recentHighs = prices.slice(0, 10).map(p => p.high);
    const recentLows = prices.slice(0, 10).map(p => p.low);

    // Double Top pattern: two peaks at approximately the same level
    if (recentHighs[0] < recentHighs[2] && recentHighs[2] > recentHighs[4] && recentHighs[4] < recentHighs[6]) {
        return 'Double Top (Bearish)';
    }

    // Double Bottom pattern: two lows at approximately the same level
    if (recentLows[0] > recentLows[2] && recentLows[2] < recentLows[4] && recentLows[4] > recentLows[6]) {
        return 'Double Bottom (Bullish)';
    }

    // Head and Shoulders pattern (Bearish)
    if (recentHighs[2] > recentHighs[0] && recentHighs[2] > recentHighs[4] && recentHighs[0] === recentHighs[4]) {
        return 'Head and Shoulders (Bearish)';
    }

    // Inverse Head and Shoulders pattern (Bullish)
    if (recentLows[2] < recentLows[0] && recentLows[2] < recentLows[4] && recentLows[0] === recentLows[4]) {
        return 'Inverse Head and Shoulders (Bullish)';
    }

    return 'No Pattern Identified';
}

// Function to calculate RSI and interpret as Bullish, Bearish or Neutral
function interpretRSI(prices, period = 14) {
    const closes = prices.map(p => p.close);
    const rsi = technicalindicators.RSI(closes, { period });
    const latestRSI = rsi[rsi.length - 1];

    if (latestRSI < 30) return 'Bullish';
    if (latestRSI > 70) return 'Bearish';
    return 'Neutral';
}

// Function to calculate Bollinger Bands and interpret the position of price
function interpretBollingerBands(prices, period = 20, nbdevup = 2, nbdevdn = 2) {
    const closes = prices.map(p => p.close);
    const { upper, middle, lower } = technicalindicators.BBANDS(closes, { period, nbdevup, nbdevdn });
    const latestClose = closes[closes.length - 1];

    if (latestClose < lower[lower.length - 1]) return 'Bullish';
    if (latestClose > upper[upper.length - 1]) return 'Bearish';
    return 'Neutral';
}

// Function to calculate moving averages and interpret crossovers
function interpretMovingAverages(prices, shortPeriod = 20, longPeriod = 50) {
    const closes = prices.map(p => p.close);
    const smaShort = technicalindicators.SMA(closes, { period: shortPeriod });
    const smaLong = technicalindicators.SMA(closes, { period: longPeriod });

    if (smaShort[smaShort.length - 1] > smaLong[smaLong.length - 1]) return 'Bullish'; // Golden Cross
    if (smaShort[smaShort.length - 1] < smaLong[smaLong.length - 1]) return 'Bearish'; // Death Cross
    return 'Neutral';
}




// Function to monitor the active signal and check if SL or TP is hit
async function generateSignal(pair) {
    const prices = await fetchForexCryptoData(pair, '5min');

    if (!prices || prices.length < 5) return; // Fetch latest 5min prices to monitor signal

    if (prices.length < 1) return;

    const currentPrice = prices[0].close;

    // Check if the Stop Loss or Take Profit has been hit
    if (currentPrice <= signal.stopLoss) {
        signalHistory.failures += 1;
        signalHistory.total += 1;
        sendOutcomeMessage('FAILURE', signal);
        activeSignal = null; // Reset active signal
    } else if (currentPrice >= signal.takeProfit) {
        signalHistory.successes += 1;
        signalHistory.total += 1;
        sendOutcomeMessage('SUCCESS', signal);
        activeSignal = null; // Reset active signal
    }
}

// Function to send the outcome message after signal completion
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

// Function to generate signal and track success
async function generateComprehensiveSignal(pair) {
    console.log(`Generating signal for ${pair}`);
    const timeframes = ['5min', '15min', '30min', '60min'];

    try {
        const [prices5m, prices15m, prices30m, prices1h] = await Promise.all(
            timeframes.map((interval) => fetchForexCryptoData(pair, interval))
        );

        if (!prices5m || !prices15m || !prices30m || !prices1h ||
            prices5m.length < 15 || prices15m.length < 15 || prices30m.length < 15 || prices1h.length < 15) {
            console.log(`Not enough data for ${pair} on one or more timeframes.`);
            return;
        }

        const rsiSignal = interpretRSI(prices5m);
        const bbSignal = interpretBollingerBands(prices5m);
        const maSignal = interpretMovingAverages(prices5m);
        const chartPattern = identifyChartPattern(prices5m);

        let finalSignal = 'HOLD';
        if (rsiSignal === 'Bullish' && bbSignal === 'Bullish' && maSignal === 'Bullish') {
            finalSignal = 'BUY';
        } else if (rsiSignal === 'Bearish' && bbSignal === 'Bearish' && maSignal === 'Bearish') {
            finalSignal = 'SELL';
        }

        if (!activeSignals[pair]) {
            const currentPrice = prices5m[0].close;
            const stopLoss = currentPrice - 10;
            const takeProfit = currentPrice + 20;

            const signalTag = `Signal-${signalCounter++}`;

            const message = `📊 **Trading Signal for ${pair}** (Tag: ${signalTag}) 📊\n
            Signal: ${finalSignal}\n
            RSI: ${rsiSignal}\n
            Bollinger Bands: ${bbSignal}\n
            Moving Averages: ${maSignal}\n
            Chart Pattern: ${chartPattern}\n
            Stop Loss: $${stopLoss.toFixed(2)}\n
            Take Profit: $${takeProfit.toFixed(2)}\n`;

            bot.sendMessage(channelId, message, { parse_mode: 'Markdown' })
                .then(() => console.log('Signal sent to Telegram channel'))
                .catch((err) => console.error('Error sending message to Telegram:', err));

            activeSignals[pair] = { type: finalSignal, stopLoss, takeProfit, chartPattern, tag: signalTag, pair };
        }
    } catch (error) {
        console.error(`Error generating signals for ${pair}:`, error.message);
    }
}

async function monitorSignal(signal) {
    const prices = await fetchForexCryptoData(signal.pair, '5min');
    if (!prices || prices.length < 1) return;

    const currentPrice = prices[0].close;

    if (currentPrice <= signal.stopLoss) {
        signalHistory.failures++;
        signalHistory.total++;
        sendOutcomeMessage('FAILURE', signal);
        delete activeSignals[signal.pair];
    } else if (currentPrice >= signal.takeProfit) {
        signalHistory.successes++;
        signalHistory.total++;
        sendOutcomeMessage('SUCCESS', signal);
        delete activeSignals[signal.pair];
    }
}

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

function monitorActiveSignals() {
    for (const pair in activeSignals) {
        monitorSignal(activeSignals[pair]);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateSignalsForAllPairs() {
    for (const pair of pairs) {
        await generateComprehensiveSignal(pair);
        await sleep(15000); // Add delay to prevent API rate limit issues
    }
}

setInterval(() => {
    generateSignalsForAllPairs();
}, 5 * 60 * 1000);

setInterval(() => {
    monitorActiveSignals();
}, 5 * 60 * 1000);

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `This bot sends trading signals for XAU/USD, EUR/USD, BTC/USD using RSI, Bollinger Bands, Moving Averages, and Chart Pattern Detection.`
    );
});