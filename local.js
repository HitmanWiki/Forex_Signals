const axios = require('axios');
require('dotenv').config();

const pairs = ['BTC/USD']; // Define the trading pairs

(async function fetchForexCryptoData(pair = 'BTC/USD', interval = '5min') {
    const apiKey = process.env.TWELVE_DATA_API_KEY; // Load the API key from .env

    if (!apiKey) {
        console.error('Error: API key is missing. Please check your .env file.');
        return;
    }

    try {
        // Encode the pair to ensure it is URL-safe
        const encodedPair = encodeURIComponent(pair);

        // Construct the URL
        const url = `https://api.twelvedata.com/time_series?symbol=${encodedPair}&interval=${interval}&apikey=${apiKey}`;

        // Debugging log to verify the constructed URL
        console.log(`Fetching data from URL: ${url}`);

        // Fetch data using Axios
        const response = await axios.get(url);

        if (response.data && response.data.values) {
            console.log(`Fetched ${response.data.values.length} candles for ${pair}`);
        } else {
            console.error(`API Error: ${response.data.message || 'No data received'}`);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
})(pairs[0]); // Pass the first pair explicitly
