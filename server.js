const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const cheerio = require('cheerio');
const { Groq } = require('groq-sdk');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const prisma = new PrismaClient();

let isProcessingAborted = false;
const processingQueue = [];
let isQueueProcessing = false;
let autoRetriesThisHour = 0;

setInterval(() => {
    autoRetriesThisHour = 0;
}, 60 * 60 * 1000);

async function startQueueProcessor() {
    if (isQueueProcessing) return;
    isQueueProcessing = true;
    
    const CONCURRENCY_LIMIT = 1;

    while (processingQueue.length > 0) {
        if (isProcessingAborted) {
            console.log('Queue processing aborted by user.');
            processingQueue.length = 0;
            break;
        }
        
        const batch = [];
        for (let i = 0; i < CONCURRENCY_LIMIT && processingQueue.length > 0; i++) {
            batch.push(processingQueue.shift());
        }

        await Promise.allSettled(batch.map(async (item) => {
            let displayName = typeof item === 'string' ? item : (item.name || item['Company Name'] || item['Company'] || item['Name'] || Object.values(item)[0] || 'Unknown');
            if (typeof displayName !== 'string') displayName = String(displayName);
            if (!displayName.trim()) return;
            
            try {
                console.log(`[Queue] Processing: ${displayName}`);
                const dataToProcess = typeof item === 'string' ? item.trim() : item;
                await processCompany(dataToProcess);
            } catch (err) {
                console.error(`[Queue] Error processing ${displayName}:`, err.message);
            }
        }));
        
        // Add a 2 second delay between batches to avoid IP bans and rate limits
        await new Promise(r => setTimeout(r, 2000));
    }
    
    isQueueProcessing = false;
    isProcessingAborted = false;
}

// Initialize Groq
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || 'dummy_key'
});

// Fetch upload history
app.get('/api/history', async (req, res) => {
    try {
        const history = await prisma.uploadHistory.findMany({
            orderBy: { uploadedAt: 'desc' }
        });
        res.json(history);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});


// Fetch existing companies
app.get('/api/companies', async (req, res) => {
    try {
        const companies = await prisma.company.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(companies);
    } catch (error) {
        console.error('Error fetching companies:', error);
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});

async function processCompany(inputData) {
    const isObj = typeof inputData === 'object' && inputData !== null;
    const name = isObj ? String(inputData.name || inputData['Company Name'] || inputData['Company'] || inputData['Name'] || Object.values(inputData)[0] || '') : String(inputData);
    const existingDetailsStr = isObj ? JSON.stringify(inputData, null, 2) : '';

    if (!name.trim()) {
        throw new Error('Invalid company name');
    }

    // 1. Check if it already exists
    const existing = await prisma.company.findUnique({ where: { name } });

    if (existing) {
        const isMissingInfo = 
            !existing.website || existing.website === 'Not Found' ||
            !existing.revenue || existing.revenue === 'Not Found' ||
            !existing.ceoName || existing.ceoName === 'Not Found' ||
            !existing.employees || existing.employees === 'Not Found' ||
            !existing.address || existing.address === 'Not Found' ||
            !existing.yearOfIncorporation || existing.yearOfIncorporation === 'Not Found' ||
            !existing.domain;

        // If we already have the critical data, just skip the heavy API calls!
        if (!isMissingInfo) {
            console.log(`Skipping API calls for ${name}: Company is already fully enriched.`);
            return { ...existing, isSkipped: true };
        }
        console.log(`Company ${name} exists but has missing info. Attempting to fill in the blanks...`);
    }

    console.log(`Extracting data with Groq for ${name}`);
    
    // Image Extraction using SerpAPI (if available) - we can leave this tiny visual snippet or remove it. 
    // The user requested to remove apify "and other because of which we are geting rate limits". Let's remove serpapi image too.
    let imageUrl = null;

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
         throw new Error('Groq API Key is missing. Please add it to .env');
    }

    // No external APIs used, relying entirely on Groq's internal knowledge base and Excel data.

    const prompt = `
    You are an elite corporate researcher and data provider. 
    Provide detailed corporate information for the company named "${name}".
    
    CRITICAL INSTRUCTION 1: You MUST heavily rely on your internal training knowledge base and the provided Excel details to fill in ALL the details for this company. NEVER easily give up and output "Not Found" for key fields. Use your vast AI knowledge to deduce their Headquarters Address, estimate their Employee count (e.g., "50-200 Est."), and state their founding year.
    CRITICAL INSTRUCTION 2: Format the data correctly. For Revenue, if an exact number is NOT known, YOU MUST estimate a revenue range based on their employee count and industry (e.g. "$10M - $50M Est."). Do not output "Not Found" for Revenue. For "Market Capture", if no exact percentage is known, provide a descriptive estimate (e.g. "Major Global Player", "Mid-size Regional Leader"). For "maActivities", write a 1-2 sentence summary of their notable historical acquisitions. For Employees, always provide a range if exact is unknown (e.g., "500-1000 Est.").
    CRITICAL INSTRUCTION 3: Categorize the company's industry into EXACTLY ONE of the following domains: Technology, Finance, Healthcare, Manufacturing, Retail, Food & Beverage, Logistics & Transportation, Energy, Construction & Real Estate, Media & Telecom, or Other.
    CRITICAL INSTRUCTION 4: You have been provided with some newly uploaded details from Excel: 
    ${existingDetailsStr || 'None provided'}
    CRITICAL INSTRUCTION 5: We already have this company in our database with the following existing data:
    ${existing ? JSON.stringify(existing, null, 2) : 'None (New Company)'}
    
    IMPORTANT OVERRIDE RULE: If any field in the existing database data is "Not Found", null, or missing, YOU MUST IGNORE IT. You must rigorously extract that missing field from the uploaded Excel details. If the data exists in the Excel details (like website, email, phone, etc.), YOU MUST USE IT. 
    
    CRITICAL INSTRUCTION 6: THE USER REQUIRES EVERY SINGLE FIELD TO BE POPULATED. YOU ARE STRICTLY FORBIDDEN FROM USING "Not Found" OR LEAVING ANY FIELD EMPTY. 
    If a field is missing from both your knowledge and the Excel file, YOU MUST GENERATE A HIGHLY EDUCATED GUESS. 
    - For websites: First, use your vast knowledge base to provide their EXACT, real official website (e.g. www.dhl.com). If and ONLY if you absolutely do not know it, generate a highly probable guess like "www.[companyname].com" (removing spaces).
    - For emails: generate "info@[companyname].com".
    - For phones: generate a standard corporate format for their country.
    - For addresses: generate a plausible business district address in their known city.
    - For names: generate a plausible placeholder like "Corporate Contact".
    
    Return ONLY a JSON object with these exact keys. NEVER output "Not Found":
    {
      "extractedName": "Exact full legal name of the company",
      "website": "Educated guess or extracted URL (NO Not Found)",
      "headquarters": "City, Country (NO Not Found)",
      "presence": "Regions or Countries (NO Not Found)",
      "yearOfIncorporation": "Year (NO Not Found)",
      "marketCapture": "Descriptive text (NO Not Found)",
      "businessServices": "List of services (NO Not Found)",
      "contactPersons": "General contact persons summary (NO Not Found)",
      "contactName": "Specific Contact Person Name (NO Not Found)",
      "contactEmail": "Contact Email (NO Not Found)",
      "contactPhone": "Contact Phone Number (NO Not Found)",
      "ceoName": "Name of the CEO (NO Not Found)",
      "address": "Full Address (NO Not Found)",
      "country": "Country (NO Not Found)",
      "region": "Region (NO Not Found)",
      "revenue": "Estimated revenue range (NO Not Found)",
      "employees": "Estimated number of employees (NO Not Found)",
      "linkedInProfile": "LinkedIn URL or guessed linkedin.com/company/... (NO Not Found)",
      "maActivities": "Recent M&A activities or 'None recently' (NO Not Found)",
      "domain": "One of the strict domain categories from Instruction 3"
    }
    Do not wrap the JSON in markdown code blocks, just return the raw JSON string.
    `;

    let aiResult;
    try {
        aiResult = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });
    } catch (err) {
        if (err.status === 429 || err.message?.includes('rate limit') || err.message?.includes('Rate limit')) {
            console.log(`[Groq] Rate limit hit on 70b. Falling back to llama-3.1-8b-instant for ${name}...`);
            aiResult = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama-3.1-8b-instant',
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });
        } else {
            throw err;
        }
    }
    
    let responseText = aiResult.choices[0]?.message?.content || '{}';
    
    // Clean up markdown formatting if Gemini adds it
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const extractedData = JSON.parse(responseText);

    // Sanitize arrays and numbers to strings for Prisma
    const sanitizeString = (val) => {
        if (val === null || val === undefined) return null;
        if (Array.isArray(val)) return val.join(', ');
        return String(val);
    };

    // 4. Save to database
    const companyData = {
        name: existing ? existing.name : (sanitizeString(extractedData.extractedName) || name),
        website: sanitizeString(extractedData.website),
        headquarters: sanitizeString(extractedData.headquarters),
        presence: sanitizeString(extractedData.presence),
        yearOfIncorporation: sanitizeString(extractedData.yearOfIncorporation),
        marketCapture: sanitizeString(extractedData.marketCapture),
        businessServices: sanitizeString(extractedData.businessServices),
        contactPersons: sanitizeString(extractedData.contactPersons),
        contactName: sanitizeString(extractedData.contactName),
        contactEmail: sanitizeString(extractedData.contactEmail),
        contactPhone: sanitizeString(extractedData.contactPhone),
        ceoName: sanitizeString(extractedData.ceoName),
        address: sanitizeString(extractedData.address),
        country: sanitizeString(extractedData.country),
        region: sanitizeString(extractedData.region),
        revenue: sanitizeString(extractedData.revenue),
        employees: sanitizeString(extractedData.employees),
        linkedInProfile: sanitizeString(extractedData.linkedInProfile),
        maActivities: sanitizeString(extractedData.maActivities),
        source: isObj && inputData.source ? inputData.source : existing?.source
    };
    
    if (imageUrl) companyData.imageUrl = imageUrl;

    const savedCompany = await prisma.company.upsert({
        where: { name: companyData.name },
        update: companyData,
        create: companyData
    });

    return savedCompany;
}

// Search and extract data for a company
app.post('/api/companies/search', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Company name is required' });

    try {
        isProcessingAborted = false;
        const company = await processCompany(name);
        res.json({ message: 'Success', data: company });
    } catch (error) {
        console.error('Error during search/extract:', error);
        res.status(500).json({ error: error.message, details: error.message });
    }
});

// Bulk search from uploaded file
app.post('/api/companies/bulk-search', async (req, res) => {
    const { names, companies, filename } = req.body;
    const items = companies || names;
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'A list of company names or objects is required' });
    }

    try {
        isProcessingAborted = false;
        
        const itemsWithSource = items.map(item => {
            if (typeof item === 'object') {
                return { ...item, source: filename };
            }
            return { name: item, source: filename };
        });

        processingQueue.push(...itemsWithSource);

        if (filename) {
            await prisma.uploadHistory.create({ data: { filename } });
        }

        startQueueProcessor();

        res.json({ message: 'Upload received. Processing in background.', queueLength: processingQueue.length });
    } catch (error) {
        console.error('Error during bulk upload:', error);
        res.status(500).json({ error: 'Failed to process bulk upload' });
    }
});

app.get('/api/queue/status', (req, res) => {
    res.json({ length: processingQueue.length, isProcessing: isQueueProcessing });
});

app.get('/api/companies/incomplete-count', async (req, res) => {
    try {
        const count = await prisma.company.count({
            where: {
                OR: [
                    { revenue: 'Not Found' },
                    { ceoName: 'Not Found' },
                    { website: 'Not Found' }
                ]
            }
        });
        res.json({ count });
    } catch (error) {
        console.error('Error counting incomplete companies:', error);
        res.status(500).json({ error: 'Failed to count incomplete companies' });
    }
});

async function startAutoRetriever() {
    if (isQueueProcessing || processingQueue.length > 0) return;
    
    try {
        const incompleteCompanies = await prisma.company.findMany({
            where: {
                OR: [
                    { revenue: 'Not Found' },
                    { ceoName: 'Not Found' },
                    { website: 'Not Found' }
                ]
            },
            take: 10,
            orderBy: { updatedAt: 'asc' }
        });
        
        if (incompleteCompanies.length > 0) {
            console.log(`[AutoRetriever] Found ${incompleteCompanies.length} incomplete companies. Queuing for re-extraction...`);
            for (const company of incompleteCompanies) {
                processingQueue.push(company);
            }
            startQueueProcessor();
        }
    } catch (err) {
        console.error('[AutoRetriever] Error:', err);
    }
}
setInterval(startAutoRetriever, 5 * 60 * 1000);

// Scrape website for company names and extract data
app.post('/api/companies/scrape-website', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        console.log(`Scraping website: ${url}`);
        let targetUrl = url;
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
        let textContent = '';
        console.log(`Launching Puppeteer to scrape ${targetUrl}`);
        
        try {
            const puppeteer = require('puppeteer');
            const browser = await puppeteer.launch({ headless: 'new' });
            const page = await browser.newPage();
            
            // Speed up page load by blocking resources
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Auto-clicker for "Load More"
            let loadMoreClicks = 0;
            const maxClicks = 8;
            
            while (loadMoreClicks < maxClicks) {
                const clicked = await page.evaluate(() => {
                    // Find any element (button or link) that looks like a "Load More" trigger
                    const elements = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                    const loadMoreRegex = /load more|show more|view more|load more members/i;
                    
                    for (const el of elements) {
                        const text = el.innerText || el.textContent;
                        if (loadMoreRegex.test(text) && el.offsetHeight > 0 && el.offsetWidth > 0) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });
                
                if (clicked) {
                    loadMoreClicks++;
                    console.log(`Clicked Load More (${loadMoreClicks}/${maxClicks}) on ${targetUrl}...`);
                    // Wait for the AJAX content to render
                    await new Promise(r => setTimeout(r, 2500)); 
                } else {
                    console.log(`No (more) "Load More" buttons found on ${targetUrl}.`);
                    break;
                }
            }

            // Extract text after all clicks
            textContent = await page.evaluate(() => {
                const scripts = document.querySelectorAll('script, style, nav, footer');
                scripts.forEach(s => s.remove());
                return document.body.innerText.replace(/\s+/g, ' ').trim();
            });
            
            await browser.close();
        } catch (err) {
            console.error(`Failed to scrape ${targetUrl} with Puppeteer:`, err.message);
        }
        
        // Chunk text to avoid exceeding Groq's 8k token limit (approx 25,000 chars per chunk)
        const CHUNK_SIZE = 20000;
        let allExtractedCompanies = [];
        
        console.log(`Extracted ${textContent.length} characters of text. Chunking and sending to Groq...`);
        
        for (let i = 0; i < textContent.length; i += CHUNK_SIZE) {
            const chunk = textContent.slice(i, i + CHUNK_SIZE);
            console.log(`Processing chunk ${i / CHUNK_SIZE + 1} (${chunk.length} chars)...`);
            
            const prompt = `
            You are an AI data extractor. Extract a list of all companies mentioned in the following text.
            For each company, extract its name AND any other details visible in the text (such as website, address, email, phone number, etc.).
            
            CRITICAL INSTRUCTION 1: Only extract company names that are written in English (using the Latin/English alphabet). DO NOT extract companies whose names are written in other languages or scripts (like Arabic, Chinese, Cyrillic, etc.). Ignore companies whose primary business description is not in English.
            CRITICAL INSTRUCTION 2: Categorize the company's industry into EXACTLY ONE of the following domains: Technology, Finance, Healthcare, Manufacturing, Retail, Food & Beverage, Logistics & Transportation, Energy, Construction & Real Estate, Media & Telecom, or Other. Include this as the "domain" field.
            
            Return ONLY a JSON object containing an array of objects under the key "companies". 
            Example: { "companies": [{ "name": "DHL", "domain": "Logistics & Transportation", "website": "dhl.com", "address": "123 Main St", "contactEmail": "info@dhl.com", "contactPhone": "123-456-7890" }] }
            
            Text:
            ${chunk}
            `;

            try {
                const aiResult = await groq.chat.completions.create({
                    messages: [{ role: 'user', content: prompt }],
                    model: 'llama-3.3-70b-versatile',
                    temperature: 0.1,
                    response_format: { type: 'json_object' }
                });
                
                let responseText = aiResult.choices[0]?.message?.content || '{"companies": []}';
                responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(responseText);
                
                if (parsed.companies && Array.isArray(parsed.companies)) {
                    allExtractedCompanies.push(...parsed.companies);
                }
            } catch (chunkErr) {
                console.error(`Error processing chunk ${i / CHUNK_SIZE + 1}:`, chunkErr.message);
            }
        }
        
        const extractedCompanies = allExtractedCompanies.map(c => ({
            ...c,
            source: url
        }));

        if (extractedCompanies.length === 0) {
            return res.status(400).json({ error: 'No companies found on this website.' });
        }

        console.log(`Found ${extractedCompanies.length} companies with details. Pushing to queue...`);
        
        isProcessingAborted = false;
        processingQueue.push(...extractedCompanies);
        
        await prisma.uploadHistory.create({ data: { filename: `Scraped URL: ${url}` } });
        
        startQueueProcessor();

        res.json({ message: 'Scraping completed. Processing in background.', queueLength: processingQueue.length, extractedNames: extractedCompanies });
    } catch (error) {
        console.error('Error during scraping:', error);
        res.status(500).json({ error: 'Failed to scrape and process website', details: error.message });
    }
});

// Abort currently running loop
app.post('/api/companies/abort', (req, res) => {
    isProcessingAborted = true;
    res.json({ message: 'Abort signal received' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
