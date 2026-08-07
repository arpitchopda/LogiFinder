const fs = require('fs'); 
const file = './client/src/App.jsx'; 
let content = fs.readFileSync(file, 'utf8'); 

// Insert API_URL declaration
if (!content.includes('const API_URL = import.meta.env.VITE_API_URL')) {
    content = content.replace(/function App\(\) {/, `const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';\n\nfunction App() {`); 
}

// Replace all hardcoded URLs
content = content.replace(/'http:\/\/localhost:5000\//g, '`${API_URL}/');
content = content.replace(/'http:\/\/localhost:5000'/g, 'API_URL');

fs.writeFileSync(file, content);
console.log('App.jsx updated successfully.');
