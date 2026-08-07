const { search } = require('duck-duck-scrape');

async function testDuck() {
    try {
        const searchResults = await search('DHL logistics official website address CEO');
        const snippets = searchResults.results.slice(0, 3).map(r => r.title + ': ' + r.description).join('\n');
        console.log('Snippets:', snippets);
    } catch (err) {
        console.error('Error:', err);
    }
}
testDuck();
