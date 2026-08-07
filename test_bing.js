const puppeteer = require('puppeteer');

async function searchBing(query) {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    try {
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`);
        await page.waitForSelector('.b_algo', { timeout: 5000 });
        
        const results = await page.evaluate(() => {
            const items = [];
            document.querySelectorAll('.b_algo').forEach(el => {
                if (items.length >= 3) return;
                const title = el.querySelector('h2')?.innerText || '';
                const snippet = el.querySelector('.b_caption p')?.innerText || el.querySelector('.b_lineclamp2')?.innerText || '';
                items.push({ title, snippet });
            });
            return items;
        });
        
        console.log('Bing Results:', results);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await browser.close();
    }
}

searchBing('DHL logistics official website address CEO');
