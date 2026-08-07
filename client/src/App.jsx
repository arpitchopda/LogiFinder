import { useState, useEffect, useRef } from 'react';
import { Search, Moon, Sun, Building2, ExternalLink, Upload, Download, History, XCircle, Activity } from 'lucide-react';
import axios from 'axios';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import './index.css';

const API_URL = import.meta.env.VITE_API_URL || API_URL;

function App() {
  const [theme, setTheme] = useState('dark');
  const [searchQuery, setSearchQuery] = useState('');
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notification, setNotification] = useState(null);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [queueStatus, setQueueStatus] = useState({ length: 0, isProcessing: false });
  const [incompleteCount, setIncompleteCount] = useState(0);
  const fileInputRef = useRef(null);

  const [sortName, setSortName] = useState('None');
  const [sortRevenue, setSortRevenue] = useState('None');
  const [filterIndia, setFilterIndia] = useState(false);
  const [filterCountry, setFilterCountry] = useState('All');
  const [filterDomain, setFilterDomain] = useState('All');
  const [filterSource, setFilterSource] = useState('All');
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    fetchCompanies();
    fetchHistory();
    const checkStatus = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/queue/status');
        setQueueStatus(res.data);
      } catch(err) {}
    }
    checkStatus();
  }, []);

  useEffect(() => {
    let intervalId;
    if (queueStatus.isProcessing || queueStatus.length > 0) {
      intervalId = setInterval(async () => {
        try {
          const res = await axios.get(`${API_URL}/api/queue/status');
          setQueueStatus(res.data);
          if (!res.data.isProcessing && res.data.length === 0) {
            fetchCompanies();
            fetchHistory();
          }
        } catch(err) {
          console.error(err);
        }
      }, 5000);
    }
    return () => clearInterval(intervalId);
  }, [queueStatus.isProcessing, queueStatus.length]);

  useEffect(() => {
    const fetchIncompleteCount = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/companies/incomplete-count');
        setIncompleteCount(res.data.count);
      } catch (err) {
        console.error('Error fetching incomplete count:', err);
      }
    };
    fetchIncompleteCount();
    const countInterval = setInterval(fetchIncompleteCount, 10000); // Check every 10 seconds
    return () => clearInterval(countInterval);
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/history');
      setUploadHistory(res.data);
    } catch (err) {
      console.error('Failed to fetch history', err);
    }
  };

  const fetchCompanies = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/companies');
      setCompanies(res.data);
    } catch (err) {
      console.error('Failed to fetch companies', err);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    setNotification(null);
    
    const isUrl = /^(https?:\/\/|www\.)/i.test(searchQuery);

    try {
      if (isUrl) {
        const res = await axios.post(`${API_URL}/api/companies/scrape-website', { url: searchQuery });
        if (res.data.error) setError(res.data.error);
        else {
          setNotification(`Deep scan complete! Found ${res.data.extractedNames?.length || 0} companies and added them to the queue.`);
          setQueueStatus({ length: res.data.queueLength, isProcessing: true });
          await fetchHistory();
          setSearchQuery('');
        }
      } else if (searchQuery.includes(',')) {
        const names = searchQuery.split(',').map(n => n.trim()).filter(Boolean);
        const res = await axios.post(`${API_URL}/api/companies/bulk-search', {
          companies: names,
          filename: `Search Bar: ${names.length} companies`
        });
        if (res.data.error) {
          setError(res.data.error);
        } else {
          setNotification(`Added ${names.length} companies to the background queue!`);
          setQueueStatus({ length: res.data.queueLength, isProcessing: true });
          setSearchQuery('');
        }
      } else {
        const res = await axios.post(`${API_URL}/api/companies/search', {
          name: searchQuery
        });
        if (res.data.error) {
          setError(res.data.error);
        } else {
          if (res.data.data?.isSkipped) {
            setNotification(`"${searchQuery}" was skipped because it already exists in the database.`);
          }
          await fetchCompanies();
          setSearchQuery('');
        }
      }
    } catch (err) {
      const serverErr = err.response?.data?.error;
      const serverDetails = err.response?.data?.details;
      setError(serverDetails ? `${serverErr}: ${serverDetails}` : (serverErr || 'An error occurred.'));
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setNotification(null);
    
    try {
      let extractedData = [];
      
      if (file.name.endsWith('.csv')) {
        extractedData = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
              resolve(results.data);
            },
            error: reject
          });
        });
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        extractedData = XLSX.utils.sheet_to_json(worksheet);
      } else {
        throw new Error('Unsupported file type. Please upload CSV or Excel.');
      }

      if (!extractedData || extractedData.length === 0) {
        throw new Error('No company data found in the file.');
      }

      const res = await axios.post(`${API_URL}/api/companies/bulk-search', {
        companies: extractedData,
        filename: file.name
      });

      if (res.data.error) {
        setError(res.data.error);
      } else {
        setNotification(`Upload successful! ${extractedData.length} companies added to the queue.`);
        setQueueStatus({ length: res.data.queueLength, isProcessing: true });
        await fetchHistory();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to process file.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const parseRevenue = (revString) => {
    if (!revString || revString === 'Not Found') return 0;
    let val = revString.replace(/[^0-9.]/g, '');
    let num = parseFloat(val) || 0;
    const lower = revString.toLowerCase();
    if (lower.includes('b') || lower.includes('billion')) num *= 1e9;
    else if (lower.includes('m') || lower.includes('million')) num *= 1e6;
    else if (lower.includes('k') || lower.includes('thousand')) num *= 1e3;
    return num;
  };

  const downloadMasterExcel = () => {
    if (companies.length === 0) return;
    const dataToExport = companies.map(c => {
      const { id, createdAt, updatedAt, imageUrl, ...rest } = c;
      return rest;
    });
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "LogiFinder Data");
    XLSX.writeFile(workbook, "LogiFinder_Master.xlsx");
  };

  const uniqueCountries = [...new Set(companies
    .map(c => c.country)
    .filter(country => country && country !== 'Not Found' && country.trim() !== '')
  )].sort();

  const uniqueDomains = [...new Set(companies
    .map(c => c.domain)
    .filter(domain => domain && domain !== 'Not Found' && domain.trim() !== '')
  )].sort();

  const uniqueSources = [...new Set(companies
    .map(c => c.source)
    .filter(source => source && source.trim() !== '')
  )].sort();

  const filteredCompanies = companies.filter(c => {
    if (filterCountry !== 'All' && c.country !== filterCountry) return false;
    if (filterDomain !== 'All' && c.domain !== filterDomain) return false;
    if (filterSource !== 'All' && c.source !== filterSource) return false;
    if (localSearchQuery && !c.name.toLowerCase().includes(localSearchQuery.toLowerCase())) return false;
    if (filterIndia) {
      const matchStr = `${c.headquarters || ''} ${c.country || ''} ${c.region || ''} ${c.address || ''}`.toLowerCase();
      if (!matchStr.includes('india')) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortName === 'Asc') {
      const cmp = a.name.localeCompare(b.name);
      if (cmp !== 0) return cmp;
    }
    if (sortName === 'Desc') {
      const cmp = b.name.localeCompare(a.name);
      if (cmp !== 0) return cmp;
    }
    if (sortRevenue === 'Asc') return parseRevenue(a.revenue) - parseRevenue(b.revenue);
    if (sortRevenue === 'Desc') return parseRevenue(b.revenue) - parseRevenue(a.revenue);
    return 0;
  });

  const handleAbort = async () => {
    try {
      await axios.post(`${API_URL}/api/companies/abort');
      setNotification('Cancellation sent! The process will stop after finishing the current item.');
    } catch (err) {
      console.error('Failed to abort', err);
    }
  };

  return (
    <div className="app-container">


      {showHistory && (
        <div className="history-modal-overlay" onClick={() => setShowHistory(false)}>
          <div className="history-modal glass-panel" onClick={e => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={() => setShowHistory(false)}>
              <XCircle size={24} />
            </button>
            <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <History size={20} /> Upload & Scrape History
            </h2>
            {uploadHistory.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>No history available yet.</p>
            ) : (
              <ul className="history-list">
                {uploadHistory.map(h => (
                  <li key={h.id} className="history-item">
                    <span style={{ fontWeight: '500' }}>{h.filename}</span>
                    <span className="date">{new Date(h.uploadedAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="theme-toggle" style={{ backgroundColor: 'var(--accent-primary)', color: 'white', border: 'none' }}>
            <Building2 size={24} />
          </div>
          <h1>LogiFinder</h1>
          <span style={{ 
            background: 'var(--accent-primary)', 
            color: 'white', 
            padding: '4px 10px', 
            borderRadius: '20px', 
            fontSize: '0.9rem', 
            fontWeight: 'bold' 
          }}>
            {companies.length} Companies
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, justifyContent: 'flex-end' }}>
          <div className="glass-panel" style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '8px 16px', gap: '8px', flex: 1, maxWidth: '350px', borderRadius: '20px' }}>
            <Search size={18} style={{ color: 'var(--text-secondary)' }} />
            <input 
              type="text" 
              placeholder="Search existing companies..."
              value={localSearchQuery}
              onChange={(e) => {
                setLocalSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-primary)',
                width: '100%',
                outline: 'none',
                fontSize: '0.95rem'
              }}
            />
            {showSuggestions && localSearchQuery && (
              <div className="glass-panel" style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '0.5rem',
                maxHeight: '300px',
                overflowY: 'auto',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                padding: '0.5rem 0'
              }}>
                {companies
                  .filter(c => c.name.toLowerCase().includes(localSearchQuery.toLowerCase()))
                  .map(c => (
                    <div 
                      key={c.id} 
                      onClick={() => {
                        setLocalSearchQuery(c.name);
                        setShowSuggestions(false);
                      }}
                      style={{
                        padding: '0.5rem 1rem',
                        cursor: 'pointer',
                        color: 'var(--text-primary)',
                        transition: 'background 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 210, 255, 0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Search size={14} style={{ color: 'var(--accent-primary)', opacity: 0.7 }} />
                      {c.name}
                    </div>
                  ))
                }
                {companies.filter(c => c.name.toLowerCase().includes(localSearchQuery.toLowerCase())).length === 0 && (
                  <div style={{ padding: '0.5rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    No matching companies found.
                  </div>
                )}
              </div>
            )}
          </div>
          <button onClick={toggleTheme} className="theme-toggle" aria-label="Toggle Theme">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      <form onSubmit={handleSearch} className="search-container">
        <input 
          type="text" 
          className="search-input" 
          placeholder="Enter logistics company name or paste a website URL..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <Search className="spinner" size={20} /> : <Search size={20} />}
          {loading ? (/^(https?:\/\/|www\.)/i.test(searchQuery) ? 'Scraping...' : 'Analyzing...') : 'Analyze 😎'}
        </button>
        {loading && (
          <button 
            type="button" 
            className="btn-primary" 
            onClick={handleAbort}
            style={{ background: '#ff7b72', color: 'white', border: 'none' }}
            title="Cancel Processing"
          >
            <XCircle size={20} />
            Cancel
          </button>
        )}
        <button 
          type="button" 
          className="btn-primary" 
          disabled={loading} 
          onClick={() => fileInputRef.current?.click()}
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          title="Upload CSV or Excel"
        >
          <Upload size={20} />
          Upload
        </button>
        <button 
          type="button" 
          className="btn-primary" 
          onClick={downloadMasterExcel}
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          title="Download Master Excel"
        >
          <Download size={20} />
          Export
        </button>
        <button 
          type="button" 
          className="btn-primary" 
          onClick={() => setShowHistory(true)}
          style={{ background: 'var(--surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          title="View Upload History"
        >
          <History size={20} />
          History
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".csv, .xlsx, .xls" 
          onChange={handleFileUpload} 
        />
      </form>

      <div className="motto-box glass-panel">
        <p className="motto-text">
          Empowering the future of global supply chains with intelligent data discovery.
        </p>
      </div>

      <div className="filter-bar">
        <select className="filter-select" value={sortName} onChange={e => setSortName(e.target.value)}>
          <option value="None">Sort by Name: None</option>
          <option value="Asc">Name: A - Z</option>
          <option value="Desc">Name: Z - A</option>
        </select>
        <select className="filter-select" value={sortRevenue} onChange={e => setSortRevenue(e.target.value)}>
          <option value="None">Sort by Revenue: None</option>
          <option value="Desc">Revenue: High to Low</option>
          <option value="Asc">Revenue: Low to High</option>
        </select>
        <select className="filter-select" value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
          <option value="All">All Countries</option>
          {uniqueCountries.map(country => (
            <option key={country} value={country}>{country}</option>
          ))}
        </select>
        <select className="filter-select" value={filterDomain} onChange={e => setFilterDomain(e.target.value)}>
          <option value="All">All Domains</option>
          {uniqueDomains.map(domain => (
            <option key={domain} value={domain}>{domain}</option>
          ))}
        </select>
        <select className="filter-select" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
          <option value="All">All Sources</option>
          {uniqueSources.map(source => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
        <label className="filter-select" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', userSelect: 'none' }}>
          <input type="checkbox" checked={filterIndia} onChange={e => setFilterIndia(e.target.checked)} />
          India Presence
        </label>
      </div>

      {error && (
        <div style={{ color: '#ff7b72', textAlign: 'center', marginBottom: '2rem', padding: '1rem', background: 'rgba(255, 123, 114, 0.1)', borderRadius: '12px' }}>
          {error}
        </div>
      )}

      {notification && (
        <div style={{ color: '#58a6ff', textAlign: 'center', marginBottom: '2rem', padding: '1rem', background: 'rgba(88, 166, 255, 0.1)', borderRadius: '12px', border: '1px solid rgba(88, 166, 255, 0.2)' }}>
          {notification}
        </div>
      )}

      {queueStatus.isProcessing && (
        <div style={{ color: '#d2a8ff', textAlign: 'center', marginBottom: '2rem', padding: '1rem', background: 'rgba(210, 168, 255, 0.1)', borderRadius: '12px', border: '1px solid rgba(210, 168, 255, 0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Search className="spinner" size={16} /> 
            Processing {queueStatus.length} companies in the background... You can safely continue using the app.
          </div>
        </div>
      )}

      <div className="glass-panel table-wrapper">
        {companies.length === 0 ? (
          <div className="empty-state">
            <Building2 size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
            <h2>No companies found</h2>
            <p>Search for a logistics company above to enrich its data and add it to your dashboard.</p>
          </div>
        ) : (
          <div className="data-list">
            {filteredCompanies.map((c) => {
              const isExpanded = expandedId === c.id;
              return (
                <div key={c.id} className={`list-row ${isExpanded ? 'expanded' : ''}`}>
                  <div 
                    className="list-header" 
                    onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  >
                    <div className="list-col-main">
                      <div className="list-title">{c.name}</div>
                      <div className="list-subtitle">HQ: {c.headquarters || c.country || 'N/A'}</div>
                    </div>
                    <div className="list-col">
                      <span className="badge" style={{ marginRight: '0.5rem', background: 'var(--accent-secondary)' }}>
                        {c.domain && c.domain !== 'Not Found' ? c.domain : 'Uncategorized'}
                      </span>
                      <span className="badge">{c.revenue && c.revenue !== 'Not Found' ? c.revenue : 'Rev N/A'}</span>
                    </div>
                    <div className="list-col">
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {c.ceoName && c.ceoName !== 'Not Found' ? `CEO: ${c.ceoName}` : 'No CEO info'}
                      </span>
                    </div>
                    <div className="list-toggle">
                      {isExpanded ? '▲' : '▼'}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="list-details">
                      {c.imageUrl && (
                        <div className="details-banner" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.8)), url(${c.imageUrl})` }}>
                          <h2 className="banner-title">{c.name}</h2>
                        </div>
                      )}
                      
                      <div className="details-grid">
                        <div className="details-section">
                          <h3>Firmographics</h3>
                          <p><strong>Incorporated:</strong> {c.yearOfIncorporation !== 'Not Found' ? c.yearOfIncorporation : '-'}</p>
                          <p><strong>Employees:</strong> {c.employees && c.employees !== 'Not Found' ? c.employees : '-'}</p>
                          <p><strong>Address:</strong> {c.address !== 'Not Found' ? c.address : '-'}</p>
                          <p><strong>Region/Presence:</strong> {c.presence !== 'Not Found' ? c.presence : (c.region || '-')}</p>
                          <p><strong>Market Capture:</strong> {c.marketCapture !== 'Not Found' ? c.marketCapture : '-'}</p>
                        </div>

                        <div className="details-section">
                          <h3>Leadership & Contacts</h3>
                          <p><strong>CEO:</strong> {c.ceoName !== 'Not Found' ? c.ceoName : '-'}</p>
                          {(c.contactName || c.contactEmail || c.contactPhone) ? (
                            <div className="contact-box">
                              {c.contactName && c.contactName !== 'Not Found' && <div><strong>Name:</strong> {c.contactName}</div>}
                              {c.contactEmail && c.contactEmail !== 'Not Found' && <div><strong>Email:</strong> {c.contactEmail}</div>}
                              {c.contactPhone && c.contactPhone !== 'Not Found' && <div><strong>Phone:</strong> {c.contactPhone}</div>}
                            </div>
                          ) : (
                            <p className="secondary-text">{c.contactPersons !== 'Not Found' ? c.contactPersons : 'No direct contacts found'}</p>
                          )}
                        </div>

                        <div className="details-section full-width">
                          <h3>Business Services</h3>
                          <p className="secondary-text">{c.businessServices !== 'Not Found' ? c.businessServices : '-'}</p>
                        </div>

                        {c.maActivities && c.maActivities !== 'Not Found' && (
                          <div className="details-section full-width">
                            <h3>M&A Activities</h3>
                            <p className="secondary-text">{c.maActivities}</p>
                          </div>
                        )}
                      </div>

                      <div className="details-actions">
                        {c.website && c.website !== 'Not Found' && (
                          <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="btn-secondary">
                            <ExternalLink size={16} /> Official Website
                          </a>
                        )}
                        {c.linkedInProfile && c.linkedInProfile !== 'Not Found' && (
                          <a href={c.linkedInProfile} target="_blank" rel="noreferrer" className="btn-secondary">
                             <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                             LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      <footer style={{ textAlign: 'center', padding: '2rem', marginTop: '2rem', color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: '500' }}>
        Made with ❤️ by Arpit Chopda
      </footer>
    </div>
  );
}

export default App;
