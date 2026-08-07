const { ApifyClient } = require('apify-client');
require('dotenv').config();

const client = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

async function testApify() {
    const input = {
        queries: "DHL logistics official website address CEO",
        resultsPerPage: 3,
        maxPagesPerQuery: 1,
    };
    try {
        console.log('Running Apify Actor...');
        const run = await client.actor('apify/google-search-scraper').call(input);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        console.log('Items:', items);
    } catch (err) {
        console.error('Error:', err);
    }
}
testApify();
