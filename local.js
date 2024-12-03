const axios = require("axios");

async function fetchCoinGeckoPrice(symbol) {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`;

    try {
        const response = await axios.get(url);
        console.log(`Price of ${symbol.toUpperCase()}: $${response.data[symbol].usd}`);
    } catch (error) {
        console.error("Error fetching price from CoinGecko:", error.message);
    }
}

fetchCoinGeckoPrice("bitcoin");
