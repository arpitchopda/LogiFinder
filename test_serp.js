const axios = require('axios');
require('dotenv').config();

async function testSerpApi() {
    const query = 'DHL logistics official website address CEO';
    try {
        const res = await axios.get('https://serpapi.com/search.json', {
            params: {
                q: query,
                api_key: process.env.SERPAPI_KEY
            }
        });
        const snippets = res.data.organic_results.map(r => r.snippet).join('\n');
        console.log('Snippets:', snippets);
    } catch (err) {
        console.error(err);
    }
}
testSerpApi();
