const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_API_KEY');
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-1.5-pro',
            tools: [{ googleSearch: {} }] // Enable Google Search grounding
        });
        
        const prompt = "Find the official website and CEO of DHL logistics. Return JSON with 'website' and 'ceo'.";
        const result = await model.generateContent(prompt);
        console.log(result.response.text());
    } catch (err) {
        console.error('Error:', err.message);
    }
}
testGemini();
