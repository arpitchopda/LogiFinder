const axios = require('axios');
const cheerio = require('cheerio');

axios.get('https://html.duckduckgo.com/html/?q=DHL', {headers:{'User-Agent':'Mozilla/5.0'}})
.then(res => {
    const $ = cheerio.load(res.data);
    const firstResult = $('.result').first();
    console.log(firstResult.html());
    console.log("URL is:", firstResult.find('.result__url').attr('href'));
})
.catch(err => console.log(err.message));
