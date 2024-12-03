const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID; // Replace with your Telegram chat ID
const bot = new TelegramBot(botToken, { polling: true });

// Configuration
const COIN_GECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const WATCHED_CRYPTOS = ["bitcoin", "ethereum"]; // Replace with your cryptocurrency list
const vsCurrency = "usd"; // Currency for price comparison
const interval = 180; // Check every 3 minutes (in seconds)

// Active Signal Tracking
let activeSignals = {}; // Object to store active signals for each crypto
let signalStats = { success: 0, failure: 0 }; // Track success and failure rates

// Fetch Prices from CoinGecko
async function fetchPrices() {
    try {
        console.log(`Fetching prices for: ${WATCHED_CRYPTOS.join(", ")}...`);
        const url = `${COIN_GECKO_API}?ids=${WATCHED_CRYPTOS.join(",")}&vs_currencies=${vsCurrency}`;
        const response = await axios.get(url);

        console.log("Fetched Prices:", response.data);
        return response.data;
    } catch (error) {
        console.error("Error fetching data from CoinGecko:", error.message);
        return {};
    }
}

// Generate Signal
function generateSignal(prices, crypto) {
    const price = prices[crypto]?.[vsCurrency];
    if (!price) {
        console.error(`Price for ${crypto} not found!`);
        return null;
    }

    console.log(`Price for ${crypto}: $${price}`);

    // Example Signal Logic: Replace with your own strategy
    const shortEma = price * 0.99; // Dummy short EMA
    const longEma = price * 1.01; // Dummy long EMA

    if (shortEma > longEma) {
        return {
            crypto,
            signal: "BUY",
            price,
            shortEma,
            longEma,
            stopLoss: price * 0.98,
            takeProfit: price * 1.02,
        };
    } else if (shortEma < longEma) {
        return {
            crypto,
            signal: "SELL",
            price,
            shortEma,
            longEma,
            stopLoss: price * 1.02,
            takeProfit: price * 0.98,
        };
    }

    return null;
}

// Send Signal to Telegram
function sendSignalToTelegram(signal) {
    const message = `📊 **New Trading Signal** 📊\n
Crypto: ${signal.crypto.toUpperCase()}\n
Signal: ${signal.signal}\n
Price: $${signal.price.toFixed(2)}\n
Short EMA: $${signal.shortEma.toFixed(2)}\n
Long EMA: $${signal.longEma.toFixed(2)}\n
Stop Loss: $${signal.stopLoss.toFixed(2)}\n
Take Profit: $${signal.takeProfit.toFixed(2)}`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

// Monitor Active Signals
function monitorSignals(prices) {
    for (const crypto in activeSignals) {
        const signal = activeSignals[crypto];
        const price = prices[crypto]?.[vsCurrency];

        if (!price) {
            console.error(`Price for ${crypto} not found during monitoring!`);
            continue;
        }

        console.log(`Monitoring Active Signal for ${crypto}: $${price}`);

        if (signal.signal === "BUY") {
            if (price <= signal.stopLoss) {
                console.log(`BUY Signal for ${crypto} hit Stop Loss.`);
                sendSignalOutcome("STOP LOSS HIT", signal);
                signalStats.failure++;
                delete activeSignals[crypto];
            } else if (price >= signal.takeProfit) {
                console.log(`BUY Signal for ${crypto} hit Take Profit.`);
                sendSignalOutcome("TAKE PROFIT HIT", signal);
                signalStats.success++;
                delete activeSignals[crypto];
            }
        } else if (signal.signal === "SELL") {
            if (price >= signal.stopLoss) {
                console.log(`SELL Signal for ${crypto} hit Stop Loss.`);
                sendSignalOutcome("STOP LOSS HIT", signal);
                signalStats.failure++;
                delete activeSignals[crypto];
            } else if (price <= signal.takeProfit) {
                console.log(`SELL Signal for ${crypto} hit Take Profit.`);
                sendSignalOutcome("TAKE PROFIT HIT", signal);
                signalStats.success++;
                delete activeSignals[crypto];
            }
        }
    }
}

// Send Signal Outcome to Telegram
function sendSignalOutcome(outcome, signal) {
    const message = `📊 **Signal Outcome** 📊\n
Crypto: ${signal.crypto.toUpperCase()}\n
Signal: ${signal.signal}\n
Outcome: ${outcome}\n
Entry Price: $${signal.price.toFixed(2)}\n
Stop Loss: $${signal.stopLoss.toFixed(2)}\n
Take Profit: $${signal.takeProfit.toFixed(2)}\n
Success Rate: ${(signalStats.success / (signalStats.success + signalStats.failure) * 100).toFixed(2)}%`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

// Send Active Signal Update to Telegram
function sendActiveSignalStatus() {
    if (Object.keys(activeSignals).length === 0) {
        bot.sendMessage(chatId, "No active signals at the moment.");
        return;
    }

    let message = `📊 **Active Signal Update** 📊\n`;
    for (const crypto in activeSignals) {
        const signal = activeSignals[crypto];
        message += `
Crypto: ${signal.crypto.toUpperCase()}\n
Signal: ${signal.signal}\n
Entry Price: $${signal.price.toFixed(2)}\n
Stop Loss: $${signal.stopLoss.toFixed(2)}\n
Take Profit: $${signal.takeProfit.toFixed(2)}\n`;
    }

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

// Reset Signals
function resetSignals() {
    activeSignals = {};
    signalStats = { success: 0, failure: 0 };
    bot.sendMessage(chatId, "All signals have been reset.");
}

// Main Function
async function main() {
    const prices = await fetchPrices();

    for (const crypto of WATCHED_CRYPTOS) {
        if (!activeSignals[crypto]) {
            const newSignal = generateSignal(prices, crypto);
            if (newSignal) {
                console.log(`New Signal for ${crypto}:`, newSignal);
                activeSignals[crypto] = newSignal;
                sendSignalToTelegram(newSignal);
            }
        }
    }

    monitorSignals(prices);
}

// Schedule Tasks
setInterval(main, interval * 1000); // Run every interval seconds
setInterval(sendActiveSignalStatus, 60 * 60 * 1000); // Send active signal update every hour

// Handle Telegram Commands
bot.onText(/\/reset/, () => {
    resetSignals();
});
