@echo off
echo Starting LogiFinder Backend...
start cmd /k "npm run dev"

echo Starting LogiFinder Frontend...
start cmd /k "npm run client"

echo Starting Database Viewer (Prisma Studio)...
start cmd /k "npx prisma studio"

echo Opening Dashboard, Prisma Studio, and Supabase Database in browser...
timeout /t 3 /nobreak > nul
start http://localhost:5173
start http://localhost:5555
start https://supabase.com/dashboard/project/pcaolmdiuvdfoqpuyuls

echo All servers and browser windows are started! You can safely close this black window.
