const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetAllCompanies() {
    console.log('Resetting all company data to trigger re-extraction...');
    try {
        const result = await prisma.company.updateMany({
            data: {
                website: 'Not Found',
                headquarters: 'Not Found',
                country: 'Not Found',
                region: 'Not Found',
                contactName: 'Not Found',
                contactEmail: 'Not Found',
                contactPhone: 'Not Found',
                ceoName: 'Not Found',
                employees: 'Not Found',
                revenue: 'Not Found'
            }
        });
        console.log(`Successfully reset ${result.count} companies.`);
    } catch (err) {
        console.error('Failed to reset companies:', err);
    } finally {
        await prisma.$disconnect();
    }
}

resetAllCompanies();
