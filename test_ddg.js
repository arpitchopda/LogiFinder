const axios = require('axios');
const cheerio = require('cheerio');

async function searchDDG(query) {
    try {
        const response = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            }
        });
        
        const $ = cheerio.load(response.data);
        const results = [];
        
        $('.result__body').each((i, elem) => {
            if (i >= 5) return;
            const title = $(elem).find('.result__title').text().trim();
            const snippet = $(elem).find('.result__snippet').text().trim();
            const url = $(elem).find('.result__url').text().trim();
            results.push({ title, snippet, url });
        });
        
        console.log('Results:', results);
    } catch (err) {
        console.error('Error fetching DDG:', err.message);
    }
}
searchDDG('DHL logistics official website address CEO');
