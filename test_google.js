const google = require('googlethis');

async function testGoogle() {
    const options = {
        page: 0, 
        safe: false, 
        additional_params: {
            hl: 'en' 
        }
    };
    
    try {
        const response = await google.search('DHL logistics official website address CEO', options);
        console.log('Results:', response.results.slice(0, 3));
        const snippets = response.results.map(r => r.description).join('\n');
        console.log('Snippets:', snippets);
    } catch (err) {
        console.error('Error:', err);
    }
}
testGoogle();
