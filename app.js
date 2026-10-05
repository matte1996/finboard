/* ==========================================================================
   FINBOARD BUSINESS LOGIC & DATA ORCHESTRATION (API SERVER INTEGRATED)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // --------------------------------------------------------------------------
    // 1. STATE & STORAGE INITIALIZATION
    // --------------------------------------------------------------------------
    let state = {
        portfolios: {},
        activePortfolioId: null
    };

    let serverMode = false; // Set to true if the local PowerShell server API is active

    function apiFetch(path, options) {
        const url = (path.startsWith('/api/') && window.location.protocol === 'file:') 
            ? `http://localhost:8081${path}` 
            : path;
        return fetch(url, options);
    }

    // Load state from LocalStorage on startup (fallback mode)
    const savedState = localStorage.getItem('finboard_state');
    if (savedState) {
        try {
            state = JSON.parse(savedState);
            if (state.portfolios) {
                Object.values(state.portfolios).forEach(p => {
                    p.customTypologies = p.customTypologies || {};
                });
            }
        } catch (e) {
            console.error("Error parsing saved state:", e);
        }
    }

    function saveState() {
        localStorage.setItem('finboard_state', JSON.stringify(state));
    }

    const DEFAULT_GLOBAL_TYPOLOGIES = {
        'Mixed (60/40)': {
            type: 'mixed',
            allocation: { 'Stocks': 60, 'Bond': 40 }
        },
        'Mixed (80/20)': {
            type: 'mixed',
            allocation: { 'Stocks': 80, 'Bond': 20 }
        }
    };
    let globalCustomTypologies = { ...DEFAULT_GLOBAL_TYPOLOGIES };

    function getMergedTypologies(port) {
        const portCustom = (port && port.customTypologies) || {};
        return {
            ...globalCustomTypologies,
            ...portCustom
        };
    }

    // --------------------------------------------------------------------------
    // 2. CONSTANTS & TICKER MAPPINGS
    // --------------------------------------------------------------------------
    // Mapping of US Tickers to European exchange (EUR denominated) symbols on Frankfurt/Milan
    const US_TO_EU_TICKER_MAP = {
        'AAPL': 'APC.F',    // Apple on Frankfurt
        'MSFT': 'MSF.F',    // Microsoft on Frankfurt
        'TSLA': 'TL0.F',    // Tesla on Frankfurt
        'AMZN': 'AMZ.F',    // Amazon on Frankfurt
        'NVDA': 'NVD.F',    // NVIDIA on Frankfurt
        'GOOGL': 'ABEC.F',  // Alphabet on Frankfurt
        'META': 'FB2.F',    // Meta on Frankfurt
        'NFLX': 'NFC.F',    // Netflix on Frankfurt
        'AMD': 'AMD.F',     // AMD on Frankfurt
        'DIS': 'ECD.F',     // Disney on Frankfurt
        'RACE': 'RACE.MI',   // Ferrari on Milan
        'BIIB': '1BIIB.MI'   // Biogen on Milan
    };

    // Dictionary of simulated stock prices for fallback/offline mode
    const MOCK_STOCK_DATABASE = {
        'AAPL': { price: 182.40, name: "Apple Inc.", exchange: "Nasdaq", currency: "USD", prevClose: 181.10, open: 181.25, high: 183.10, low: 180.80 },
        'APC.F': { price: 168.10, name: "Apple Inc. (EUR)", exchange: "Frankfurt", currency: "EUR", prevClose: 167.30, open: 167.50, high: 168.80, low: 167.00 },
        'AAPL.MI': { price: 168.15, name: "Apple Inc. (Milano)", exchange: "Milano", currency: "EUR", prevClose: 167.40, open: 167.60, high: 168.90, low: 167.10 },
        'MSFT': { price: 415.60, name: "Microsoft Corporation", exchange: "Nasdaq", currency: "USD", prevClose: 413.50, open: 414.00, high: 417.20, low: 413.80 },
        'MSF.F': { price: 382.80, name: "Microsoft Corp (EUR)", exchange: "Frankfurt", currency: "EUR", prevClose: 381.10, open: 381.50, high: 383.90, low: 381.00 },
        'TSLA': { price: 174.50, name: "Tesla Inc.", exchange: "Nasdaq", currency: "USD", prevClose: 172.10, open: 172.50, high: 176.40, low: 171.80 },
        'TL0.F': { price: 160.80, name: "Tesla Inc (EUR)", exchange: "Frankfurt", currency: "EUR", prevClose: 158.90, open: 159.20, high: 162.10, low: 158.50 },
        'ISP.MI': { price: 3.3250, name: "Intesa Sanpaolo S.p.A.", exchange: "Milano", currency: "EUR", prevClose: 3.2840, open: 3.2900, high: 3.3420, low: 3.2800 },
        'URTH.MI': { price: 92.40, name: "iShares MSCI World ETF", exchange: "Milano", currency: "EUR", prevClose: 92.15, open: 92.20, high: 92.65, low: 92.05 },
        'CSPX.MI': { price: 512.60, name: "iShares Core S&P 500 EUR", exchange: "Milano", currency: "EUR", prevClose: 510.10, open: 510.50, high: 513.80, low: 510.00 },
        'ENI.MI': { price: 14.12, name: "Eni S.p.A.", exchange: "Milano", currency: "EUR", prevClose: 14.28, open: 14.24, high: 14.30, low: 14.05 },
        'MC.PA': { price: 792.00, name: "LVMH Moët Hennessy", exchange: "Paris", currency: "EUR", prevClose: 788.00, open: 790.00, high: 796.00, low: 786.00 },
        
        // Ferrari Tickers with exact prices (RACE USD: 352.72 / Milan EUR: 303.00)
        'RACE': { price: 352.72, name: "Ferrari N.V. (USD)", exchange: "NYSE", currency: "USD", prevClose: 350.10, open: 351.00, high: 354.50, low: 349.80 },
        'RACE.MI': { price: 303.00, name: "Ferrari N.V. (Milano)", exchange: "Milano", currency: "EUR", prevClose: 301.10, open: 301.20, high: 304.50, low: 300.50 },
        
        // Biogen Tickers (BIIB USD: 189.18 / Milan EUR: 160.82 / Frankfurt EUR: 158.56)
        'BIIB': { price: 189.18, name: "Biogen Inc. (USD)", exchange: "Nasdaq", currency: "USD", prevClose: 192.23, open: 190.58, high: 190.58, low: 184.96 },
        '1BIIB.MI': { price: 160.82, name: "Biogen Inc. (Milano)", exchange: "Milano", currency: "EUR", prevClose: 165.74, open: 163.10, high: 163.10, low: 160.12 },
        'IDP.F': { price: 158.56, name: "Biogen Inc. (Frankfurt)", exchange: "Frankfurt", currency: "EUR", prevClose: 165.12, open: 164.08, high: 164.08, low: 158.06 },
        
        'EURUSD=X': { price: 1.1641, name: "EUR/USD Currency Rate", exchange: "CCY", currency: "USD", prevClose: 1.1630, open: 1.1630, high: 1.1660, low: 1.1620 }
    };

    let isMockMode = false;
    let isPrivacyMode = localStorage.getItem('finboard_privacy') === 'true';
    let cachedEURUSD = 1.1641; // Fallback conversion (352.72 USD / 303.00 EUR = 1.1641)
    let netWorthChartInstance = null;
    let sparklineChartInstance = null;
    let allocationPieChartInstance = null;
    let equityPieChartInstance = null;
    let aggregatePieChartInstance = null;
    let selectedAggregatePortfolioIds = new Set();
    let cachedAggregateData = null;

    // Sorting states for holdings table
    let holdingsSortCol = 'currentValue';
    let holdingsSortOrder = 'desc';
    let isGridExpanded = false;
    let cachedResolvedHoldings = [];
    let depositsCurrentPage = 1;

    // --------------------------------------------------------------------------
    // 3. TIME & MARKET HOURS ANALYSIS
    // --------------------------------------------------------------------------
    function isEuropeanMarketOpen() {
        const now = new Date();
        let cetString;
        try {
            cetString = now.toLocaleString("en-US", { timeZone: "Europe/Rome" });
        } catch (e) {
            cetString = now.toString();
        }
        const cetDate = new Date(cetString);
        const day = cetDate.getDay(); // 0: Sunday, 6: Saturday
        const hours = cetDate.getHours();
        const minutes = cetDate.getMinutes();
        const timeInMinutes = hours * 60 + minutes;

        const isWeekDay = (day >= 1 && day <= 5);
        const isTradingHours = (timeInMinutes >= 9 * 60 && timeInMinutes <= 17 * 60 + 30);

        return isWeekDay && isTradingHours;
    }

    function updateMarketStatusIndicator() {
        const indicator = document.getElementById('market-status-indicator');
        if (!indicator) return;
        const dot = indicator.querySelector('.status-dot');
        const text = indicator.querySelector('.status-text');

        if (isMockMode) {
            dot.className = 'status-dot simulated';
            text.innerText = 'Demo Mode (Simulazione)';
            return;
        }

        const euOpen = isEuropeanMarketOpen();
        dot.className = 'status-dot active';
        if (euOpen) {
            text.innerText = 'Borse EU Aperte (EUR)';
        } else {
            text.innerText = 'Borse EU Chiuse (US + CCY)';
        }
    }

    // --------------------------------------------------------------------------
    // 4. SERVER CONNECTIVITY & FILE-SYSTEM API HANDLERS
    // --------------------------------------------------------------------------
    async function checkServerStatus() {
        try {
            const res = await apiFetch('/api/status');
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'ok') {
                    serverMode = true;
                    console.log("Connected to Finboard PowerShell API server.");
                }
            }
        } catch (e) {
            serverMode = false;
            console.log("Local API server offline. Falling back to browser LocalStorage mode.");
        }
        updateFolderSyncUI();
    }

    function updateFolderSyncUI() {
        const badge = document.getElementById('folder-status-badge');
        const headerIcon = document.getElementById('folder-header-icon');
        const btnSelector = document.getElementById('btn-connect-folder-selector');
        const descParagraph = document.querySelector('.folder-sync-status-box p');

        if (serverMode) {
            if (badge) {
                badge.className = 'badge badge-success';
                badge.innerText = 'Server Connesso';
            }
            if (headerIcon) {
                headerIcon.className = 'text-success';
                headerIcon.setAttribute('data-lucide', 'folder-check');
            }
            if (btnSelector) {
                btnSelector.innerHTML = '<i data-lucide="check"></i> Server Attivo';
                btnSelector.disabled = true;
            }
            if (descParagraph) {
                descParagraph.innerHTML = 'L\'applicazione è connessa al server locale. Le cartelle dei portafogli e i file <strong>patrimonio.csv</strong> vengono gestiti direttamente all\'interno della cartella <strong>input</strong> del progetto.';
            }
        } else {
            if (badge) {
                badge.className = 'badge badge-danger';
                badge.innerText = 'Server Scollegato';
            }
            if (headerIcon) {
                headerIcon.className = 'text-danger';
                headerIcon.setAttribute('data-lucide', 'folder-off');
            }
            if (btnSelector) {
                btnSelector.innerHTML = '<i data-lucide="refresh-cw"></i> Verifica Server';
                btnSelector.disabled = false;
            }
            if (descParagraph) {
                descParagraph.innerHTML = 'L\'applicazione è avviata in modalità statica. Avvia il server locale con il file <strong>start.bat</strong> per abilitare la sincronizzazione delle cartelle fisiche e dei file patrimonio.csv.';
            }
        }
        lucide.createIcons();
    }

    // Connect trigger button click
    const btnConnectSelector = document.getElementById('btn-connect-folder-selector');
    if (btnConnectSelector) {
        btnConnectSelector.addEventListener('click', async () => {
            btnConnectSelector.innerHTML = '<i data-lucide="loader-2" class="spinning"></i> Connessione...';
            lucide.createIcons();
            await checkServerStatus();
            if (serverMode) {
                await loadAllPortfolios();
                renderPortfolioSelectorList();
            } else {
                alert("Server locale non rilevato. Assicurati di aver fatto doppio clic sul file 'start.bat' per avviare il server locale.");
                updateFolderSyncUI();
            }
        });
    }

    // Check header folder icon click
    const btnConnectHeader = document.getElementById('btn-connect-folder-header');
    if (btnConnectHeader) {
        btnConnectHeader.addEventListener('click', () => {
            if (serverMode) {
                alert("Il server locale è attivo e sincronizza le cartelle dei portafogli ed i file patrimonio.csv sul tuo hard disk.");
            } else {
                alert("Il server locale è disattivo. Per sincronizzare le cartelle sul disco, avvia 'start.bat' e ricarica la pagina.");
            }
        });
    }

    async function loadGlobalTypologies() {
        const saved = localStorage.getItem('finboard_global_typologies');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    globalCustomTypologies = { ...DEFAULT_GLOBAL_TYPOLOGIES, ...parsed };
                }
            } catch (e) {
                console.error("Error parsing saved global typologies:", e);
            }
        }

        if (serverMode) {
            try {
                const res = await apiFetch('/api/typologies');
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') {
                        globalCustomTypologies = { ...DEFAULT_GLOBAL_TYPOLOGIES, ...data };
                        localStorage.setItem('finboard_global_typologies', JSON.stringify(globalCustomTypologies));
                    }
                }
            } catch (err) {
                console.warn("Could not load typologies from backend server:", err);
            }
        }
    }

    async function saveGlobalTypologies() {
        localStorage.setItem('finboard_global_typologies', JSON.stringify(globalCustomTypologies));
        if (serverMode) {
            try {
                await apiFetch('/api/save-typologies', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(globalCustomTypologies, null, 2)
                });
            } catch (err) {
                console.error("Failed to save typologies to backend server:", err);
            }
        }
    }

    // Load list of portfolios
    async function loadAllPortfolios() {
        if (serverMode) {
            try {
                const res = await apiFetch('/api/portfolios');
                if (res.ok) {
                    const data = await res.json();
                    state.portfolios = {};
                    data.forEach(p => {
                        // Ensure holdings is always an array (handles PowerShell single-item object collapsing)
                        if (p.holdings) {
                            if (!Array.isArray(p.holdings)) {
                                p.holdings = [p.holdings];
                            }
                        } else {
                            p.holdings = [];
                        }
                        p.customTypologies = p.customTypologies || {};
                        p.manualDeposits = p.manualDeposits || [];
                        state.portfolios[p.id] = p;
                    });
                    
                    // Reset active ID if deleted from backend
                    if (state.activePortfolioId && !state.portfolios[state.activePortfolioId]) {
                        state.activePortfolioId = null;
                    }
                }
            } catch (err) {
                console.error("Failed to load portfolios from backend API server:", err);
            }
        } else {
            // Load fallback demo state if localStorage is empty
            if (Object.keys(state.portfolios).length === 0) {
                initializeDefaultState();
            }
        }
    }

    // Sync metadata.json to disk (holdings and cash balance)
    async function savePortfolioMetadata() {
        const port = getActivePortfolio();
        if (!port) return;

        if (serverMode) {
            try {
                await apiFetch('/api/save-portfolio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: port.id,
                        name: port.name,
                        desc: port.desc,
                        cash: port.cash,
                        lastRealTimeValue: port.lastRealTimeValue,
                        holdings: port.holdings,
                        customTypologies: port.customTypologies || {},
                        manualDeposits: port.manualDeposits || []
                    })
                });
            } catch (e) {
                console.error("Failed to save portfolio metadata to backend:", e);
            }
        } else {
            saveState();
        }
    }

    // Save CSV to disk
    async function savePatrimonioCsvContent(csvContent) {
        const port = getActivePortfolio();
        if (!port || !serverMode) return;

        try {
            await apiFetch(`/api/save-patrimonio?portfolio=${encodeURIComponent(port.name)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body: csvContent
            });
        } catch (e) {
            console.error("Failed to write patrimonio.csv to backend:", e);
        }
    }

    // --------------------------------------------------------------------------
    // 5. API QUOTE ORCHESTRATION (BYPASSES THIRD PARTY CORS PROXIES)
    // --------------------------------------------------------------------------
    async function fetchWithProxy(targetUrl) {
        // Fallback proxies if server is not active
        try {
            // Try api.allorigins.win
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
            const response = await apiFetch(proxyUrl);
            if (response.ok) {
                const envelope = await response.json();
                return JSON.parse(envelope.contents);
            }
        } catch (e) {
            console.warn("Public proxy failed.", e);
        }
        throw new Error("Proxy fetch failed");
    }

    async function updateExchangeRate() {
        if (serverMode) {
            try {
                const res = await apiFetch('/api/quote?ticker=EURUSD=X');
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        cachedEURUSD = data.chart.result[0].meta.regularMarketPrice || 1.1641;
                        console.log(`Live exchange rate from Server Proxy: 1 EUR = ${cachedEURUSD} USD`);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch rate via server:", e);
                cachedEURUSD = MOCK_STOCK_DATABASE['EURUSD=X'].price;
            }
        } else {
            try {
                const data = await fetchWithProxy('https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X');
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    cachedEURUSD = data.chart.result[0].meta.regularMarketPrice || 1.1641;
                }
            } catch (e) {
                cachedEURUSD = MOCK_STOCK_DATABASE['EURUSD=X'].price;
            }
        }
    }

    async function updateMarketIndicators() {
        const valBtc = document.getElementById('val-btc');
        const valSp500 = document.getElementById('val-sp500');
        const valEurusd = document.getElementById('val-eurusd');
        const valRussell = document.getElementById('val-russell');
        const valBtp10y = document.getElementById('val-btp10y');
        const valUs10y = document.getElementById('val-us10y');
        
        if (!valBtc || !valSp500 || !valEurusd || !valRussell || !valBtp10y || !valUs10y) return;

        if (isMockMode) {
            valBtc.innerText = `$ 67,540.00`;
            valSp500.innerText = `5,280.00 pt`;
            valEurusd.innerText = `1.0850`;
            valRussell.innerText = `2,050.00 pt`;
            valBtp10y.innerText = `3.85%`;
            valUs10y.innerText = `4.45%`;
            return;
        }

        // 1. EUR/USD
        if (cachedEURUSD) {
            valEurusd.innerText = cachedEURUSD.toFixed(4);
        }

        // 2. BTC/USD (BTC-USD)
        try {
            let btcPrice = null;
            if (serverMode) {
                const res = await apiFetch('/api/quote?ticker=BTC-USD');
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        btcPrice = data.chart.result[0].meta.regularMarketPrice;
                    }
                }
            } else {
                const data = await fetchWithProxy('https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD');
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    btcPrice = data.chart.result[0].meta.regularMarketPrice;
                }
            }
            if (btcPrice) {
                valBtc.innerText = `$ ${btcPrice.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
        } catch (e) {
            console.error("Failed to fetch BTC price:", e);
        }

        // 3. S&P 500 (^GSPC)
        try {
            let spPrice = null;
            if (serverMode) {
                const res = await apiFetch('/api/quote?ticker=%5EGSPC');
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        spPrice = data.chart.result[0].meta.regularMarketPrice;
                    }
                }
            } else {
                const data = await fetchWithProxy('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC');
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    spPrice = data.chart.result[0].meta.regularMarketPrice;
                }
            }
            if (spPrice) {
                valSp500.innerText = `${spPrice.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt`;
            }
        } catch (e) {
            console.error("Failed to fetch S&P 500 price:", e);
        }

        // 4. Russell 2000 (^RUT)
        try {
            let russellPrice = null;
            if (serverMode) {
                const res = await apiFetch('/api/quote?ticker=%5ERUT');
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        russellPrice = data.chart.result[0].meta.regularMarketPrice;
                    }
                }
            } else {
                const data = await fetchWithProxy('https://query1.finance.yahoo.com/v8/finance/chart/%5ERUT');
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    russellPrice = data.chart.result[0].meta.regularMarketPrice;
                }
            }
            if (russellPrice) {
                valRussell.innerText = `${russellPrice.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt`;
            }
        } catch (e) {
            console.error("Failed to fetch Russell 2000 price:", e);
        }

        // 5. BTP 10Y Yield (MIT10.AS)
        try {
            let btpPrice = null;
            if (serverMode) {
                const res = await apiFetch('/api/quote?ticker=MIT10.AS');
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        btpPrice = data.chart.result[0].meta.regularMarketPrice;
                    }
                }
            } else {
                const data = await fetchWithProxy('https://query1.finance.yahoo.com/v8/finance/chart/MIT10.AS');
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    btpPrice = data.chart.result[0].meta.regularMarketPrice;
                }
            }
            if (btpPrice) {
                valBtp10y.innerText = `${btpPrice.toFixed(2)}%`;
            }
        } catch (e) {
            console.error("Failed to fetch BTP 10Y price:", e);
        }

        // 6. US 10Y Treasury Yield (^TNX)
        try {
            let us10yPrice = null;
            if (serverMode) {
                const res = await apiFetch('/api/quote?ticker=%5ETNX');
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        us10yPrice = data.chart.result[0].meta.regularMarketPrice;
                    }
                }
            } else {
                const data = await fetchWithProxy('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX');
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    us10yPrice = data.chart.result[0].meta.regularMarketPrice;
                }
            }
            if (us10yPrice) {
                valUs10y.innerText = `${us10yPrice.toFixed(2)}%`;
            }
        } catch (e) {
            console.error("Failed to fetch US 10Y yield:", e);
        }

    }

    async function getStockQuote(ticker) {
        const cleanTicker = ticker.toUpperCase().trim();
        
        if (isMockMode) {
            return getMockQuote(cleanTicker);
        }

        if (serverMode) {
            try {
                const res = await apiFetch(`/api/quote?ticker=${cleanTicker}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.chart && data.chart.result && data.chart.result[0]) {
                        const meta = data.chart.result[0].meta;
                        return {
                            symbol: meta.symbol,
                            name: meta.longName || meta.shortName || meta.symbol,
                            price: meta.regularMarketPrice,
                            currency: meta.currency,
                            exchange: meta.exchangeName,
                            prevClose: meta.previousClose,
                            open: meta.regularMarketPrice,
                            high: meta.dayHigh || meta.regularMarketPrice,
                            low: meta.dayLow || meta.regularMarketPrice
                        };
                    }
                }
                throw new Error("Invalid quote payload");
            } catch (e) {
                console.warn(`Local server fetch failed for ${cleanTicker}. Using simulated quote.`, e);
                return getMockQuote(cleanTicker);
            }
        } else {
            // Static mode: fetch via public proxies
            try {
                const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanTicker}?range=1d&interval=1m`;
                const data = await fetchWithProxy(yahooUrl);
                if (data && data.chart && data.chart.result && data.chart.result[0]) {
                    const meta = data.chart.result[0].meta;
                    return {
                        symbol: meta.symbol,
                        name: meta.longName || meta.shortName || meta.symbol,
                        price: meta.regularMarketPrice,
                        currency: meta.currency,
                        exchange: meta.exchangeName,
                        prevClose: meta.previousClose,
                        open: meta.regularMarketPrice,
                        high: meta.dayHigh || meta.regularMarketPrice,
                        low: meta.dayLow || meta.regularMarketPrice
                    };
                }
                throw new Error();
            } catch (e) {
                console.warn(`CORS proxy failed for ${cleanTicker}. Using simulated quote.`, e);
                return getMockQuote(cleanTicker);
            }
        }
    }

    function getMockQuote(ticker) {
        const cleanTicker = ticker.toUpperCase().trim();
        let base = MOCK_STOCK_DATABASE[cleanTicker];
        
        if (!base) {
            const hash = cleanTicker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            const mockPrice = (hash % 250) + 10 + Math.random();
            const isEu = cleanTicker.includes('.') && !cleanTicker.endsWith('=X');
            base = {
                price: mockPrice,
                name: `${cleanTicker} Corp`,
                exchange: isEu ? "Milano" : "NYSE",
                currency: isEu ? "EUR" : "USD",
                prevClose: mockPrice * 0.99,
                open: mockPrice * 0.995,
                high: mockPrice * 1.01,
                low: mockPrice * 0.98
            };
            MOCK_STOCK_DATABASE[cleanTicker] = base;
        }

        const drift = (Math.random() - 0.5) * 0.003;
        base.price = +(base.price * (1 + drift)).toFixed(4);
        base.high = Math.max(base.high, base.price);
        base.low = Math.min(base.low, base.price);

        return { ...base, symbol: cleanTicker };
    }

    // --------------------------------------------------------------------------
    // 6. CSV PARSER (GATTI MATTEO BROKER SEMICOLON DELIMITED FORMAT)
    // --------------------------------------------------------------------------
    function parseBrokerCsv(csvText) {
        if (!csvText) return [];
        const lines = csvText.split(/\r?\n/);
        
        // Focus on row 8 (index 7) as header and row 9 (index 8) onwards as data
        // Columns A (index 0) to F (index 5) contain Date and Patrimonio
        // Columns I (index 8) and K (index 10) contain Deposit Date and Deposit Value
        const headerIndex = 7;
        if (lines.length <= headerIndex) return [];
        
        const parsedData = [];
        const deposits = [];
        let totalBollo = 0;
        
        const dateColIdx = 0;
        const patrimonioColIdx = 5;
        const depositDateColIdx = 8;
        const depositValColIdx = 10;
        
        for (let i = headerIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const cols = line.split(';');
            
            // Parse net worth history (only from index 8 onwards)
            if (i > headerIndex && cols.length > patrimonioColIdx) {
                const dateStr = cols[dateColIdx].trim();
                const valueRaw = cols[patrimonioColIdx].trim();
                
                if (dateStr && !dateStr.toLowerCase().includes("data") && valueRaw) {
                    const sanitizedVal = valueRaw.replace(/[^\d.,-]/g, '').replace(',', '.');
                    const value = parseFloat(sanitizedVal);
                    const parsedDate = parseBrokerDate(dateStr);
                    
                    if (parsedDate && !isNaN(value)) {
                        parsedData.push({
                            date: parsedDate,
                            value: value
                        });
                    }
                }
            }
            
            // Parse deposits & bolli (from index 7 onwards)
            if (cols.length > depositValColIdx) {
                const depDateStr = cols[depositDateColIdx].trim();
                const depDescStr = cols[9] ? cols[9].trim() : "";
                const depValRaw = cols[depositValColIdx].trim();
                
                if (depDateStr && !depDateStr.toLowerCase().includes("data") && depValRaw) {
                    const sanitizedDepVal = depValRaw.replace(/[^\d.,-]/g, '').replace(',', '.');
                    const depVal = parseFloat(sanitizedDepVal);
                    const parsedDepDate = parseBrokerDate(depDateStr);
                    
                    if (parsedDepDate && !isNaN(depVal)) {
                        const descLower = depDescStr.toLowerCase();
                        const isDeposit = descLower.includes("conferimento titoli") || descLower.includes("conferimento con bonifico");
                        const isWithdrawal = descLower.includes("prelievo bonifico");
                        const isBollo = descLower.includes("bollo");
                        
                        if (isDeposit || isWithdrawal) {
                            let finalVal = depVal;
                            if (isDeposit) {
                                finalVal = Math.abs(depVal);
                            } else if (isWithdrawal) {
                                finalVal = -Math.abs(depVal);
                            }
                            deposits.push({
                                date: parsedDepDate,
                                value: finalVal,
                                desc: depDescStr || "Conferimento con bonifico"
                            });
                        } else if (isBollo) {
                            totalBollo += Math.abs(depVal);
                        }
                    }
                }
            }
        }

        parsedData.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        const groupedDeposits = {};
        let totalDeposited = 0;
        deposits.forEach(d => {
            totalDeposited += d.value;
            if (groupedDeposits[d.date]) {
                groupedDeposits[d.date] += d.value;
            } else {
                groupedDeposits[d.date] = d.value;
            }
        });
        
        parsedData.deposits = groupedDeposits;
        parsedData.totalDeposited = totalDeposited;
        parsedData.totalBollo = totalBollo;
        parsedData.rawDeposits = deposits;
        
        return parsedData;
    }

    function parseBrokerDate(str) {
        const cleaned = str.trim();
        if (!cleaned) return null;
        
        let parts = cleaned.split('/');
        if (parts.length === 3) {
            let month = parts[0];
            let day = parts[1];
            let year = parts[2];
            
            if (year.length === 2) {
                year = "20" + year;
            }
            
            month = month.padStart(2, '0');
            day = day.padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        }
        
        parts = cleaned.split(/[\-\.]/);
        if (parts.length === 3) {
            if (parts[0].length === 4) {
                return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            } else if (parts[2].length === 4) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        
        return null;
    }

    // --------------------------------------------------------------------------
    // 7. VIEW TRANSITIONS & DOM INITIALIZATION
    // --------------------------------------------------------------------------
    const screens = {
        selector: document.getElementById('portfolio-selector-screen'),
        dashboard: document.getElementById('main-dashboard-screen'),
        aggregate: document.getElementById('aggregate-view-screen')
    };

    const tabs = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');

    function showScreen(screenId) {
        Object.keys(screens).forEach(key => {
            if (key === screenId) {
                if (screens[key]) {
                    screens[key].classList.remove('hidden');
                    screens[key].classList.add('active');
                }
            } else {
                if (screens[key]) {
                    screens[key].classList.add('hidden');
                    screens[key].classList.remove('active');
                }
            }
        });
        
        if (screenId === 'selector') {
            state.activePortfolioId = null;
            saveState();
            loadAllPortfolios().then(() => {
                renderPortfolioSelectorList();
                updateFolderSyncUI();
            });
        } else if (screenId === 'dashboard') {
            renderDashboard();
        } else if (screenId === 'aggregate') {
            state.activePortfolioId = null;
            updatePrivacyUI();
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-target');
            
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(target).classList.add('active');

            if (target === 'tab-patrimonio') {
                renderNetWorthChart();
            } else if (target === 'tab-deposits') {
                depositsCurrentPage = 1;
                renderDepositsTable();
            }
        });
    });

    // --------------------------------------------------------------------------
    // 8. PORTFOLIO SELECTOR STATE FUNCTIONS
    // --------------------------------------------------------------------------
    const btnShowAddPortfolio = document.getElementById('btn-show-add-portfolio');
    const btnCloseAddPortfolio = document.getElementById('btn-close-add-portfolio');
    const btnCancelAddPortfolio = document.getElementById('btn-cancel-add-portfolio');
    const addPortfolioCard = document.getElementById('add-portfolio-card');
    const formNewPortfolio = document.getElementById('form-new-portfolio');
    const portfolioList = document.getElementById('portfolio-list');

    btnShowAddPortfolio.addEventListener('click', () => {
        addPortfolioCard.classList.remove('hidden');
        btnShowAddPortfolio.classList.add('hidden');
        document.getElementById('portfolio-name').focus();
    });

    function closeAddPortfolioForm() {
        addPortfolioCard.classList.add('hidden');
        btnShowAddPortfolio.classList.remove('hidden');
        formNewPortfolio.reset();
    }

    btnCloseAddPortfolio.addEventListener('click', closeAddPortfolioForm);
    btnCancelAddPortfolio.addEventListener('click', closeAddPortfolioForm);

    formNewPortfolio.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('portfolio-name').value.trim();
        const cash = parseFloat(document.getElementById('portfolio-cash').value) || 0;
        const desc = document.getElementById('portfolio-desc').value.trim();

        if (!name) return;

        // Check duplicate name
        const collision = Object.values(state.portfolios).find(p => p.name.toLowerCase() === name.toLowerCase());
        if (collision) {
            alert(`Esiste già un portafoglio denominato "${name}".`);
            return;
        }

        if (serverMode) {
            try {
                const res = await apiFetch(`/api/create-portfolio?name=${encodeURIComponent(name)}&cash=${cash}&desc=${encodeURIComponent(desc)}`);
                if (res.ok) {
                    await loadAllPortfolios();
                    closeAddPortfolioForm();
                    renderPortfolioSelectorList();
                } else {
                    const err = await res.json();
                    alert("Impossibile creare la cartella del portafoglio: " + err.error);
                }
            } catch (err) {
                alert("Errore nella chiamata del server API.");
            }
        } else {
            // Standalone LocalStorage mode
            const id = 'port-' + Date.now();
            state.portfolios[id] = {
                id,
                name,
                cash,
                desc: desc || "Nessuna descrizione.",
                holdings: [],
                patrimonioCsvData: []
            };
            saveState();
            closeAddPortfolioForm();
            renderPortfolioSelectorList();
        }
    });

    function calculateStaticHoldingsCost(portfolio) {
        if (!portfolio || !portfolio.holdings) return 0;
        if (!Array.isArray(portfolio.holdings)) {
            return (portfolio.holdings.shares * portfolio.holdings.buyPrice) || 0;
        }
        return portfolio.holdings.reduce((sum, h) => sum + (h.shares * h.buyPrice), 0);
    }

    function renderQuickStats(cash, netWorth, totalProfit) {
        const globalNetWorth = document.getElementById('global-net-worth');
        const globalHoldingsValue = document.getElementById('global-holdings-value');
        const globalCash = document.getElementById('global-cash');
        const globalTotalProfit = document.getElementById('global-total-profit');

        if (globalNetWorth) globalNetWorth.innerText = `€ ${formatMoney(netWorth)}`;
        if (globalCash) globalCash.innerText = `€ ${formatMoney(cash)}`;

        const holdingsVal = netWorth - cash;
        if (globalHoldingsValue) globalHoldingsValue.innerText = `€ ${formatMoney(holdingsVal)}`;

        if (globalTotalProfit) {
            const investedCost = holdingsVal - totalProfit;
            const pct = investedCost > 0 ? (totalProfit / investedCost) * 100 : 0;
            const sign = totalProfit >= 0 ? '+' : '';
            const displayProfitPct = isPrivacyMode ? '***' : pct.toFixed(2);
            const displaySign = isPrivacyMode ? '' : sign;
            globalTotalProfit.innerText = `${displaySign}€ ${formatMoney(totalProfit)} (${displaySign}${displayProfitPct}%)`;
            
            if (totalProfit >= 0) {
                globalTotalProfit.className = 'stat-value badge badge-success';
            } else {
                globalTotalProfit.className = 'stat-value badge badge-danger';
            }
        }
    }

    function renderPortfolioSelectorList() {
        portfolioList.innerHTML = '';
        const list = Object.values(state.portfolios);

        // Purge any deleted portfolios from selection
        Array.from(selectedAggregatePortfolioIds).forEach(id => {
            if (!state.portfolios[id]) selectedAggregatePortfolioIds.delete(id);
        });

        if (list.length === 0) {
            portfolioList.innerHTML = `<div class="col-span-3 text-center text-muted py-6">Nessun portafoglio configurato. Creane uno per iniziare.</div>`;
            updateAggregateButtonState();
            return;
        }

        list.forEach(p => {
            let displayVal = p.cash + calculateStaticHoldingsCost(p);
            if (p.lastRealTimeValue !== undefined && p.lastRealTimeValue !== null) {
                displayVal = p.lastRealTimeValue;
            }
            const isSelected = selectedAggregatePortfolioIds.has(p.id);
            const card = document.createElement('div');
            card.className = `portfolio-card has-checkbox ${isSelected ? 'is-selected' : ''}`;
            card.innerHTML = `
                <input type="checkbox" class="portfolio-card-checkbox" data-id="${p.id}" ${isSelected ? 'checked' : ''} title="Seleziona per vista aggregata">
                <div>
                    <h4>${escapeHTML(p.name)}</h4>
                    <p>${escapeHTML(p.desc)}</p>
                </div>
                <div class="card-value">€ ${formatMoney(displayVal)}</div>
                <button class="btn-tiny btn-rename-portfolio text-warning" title="Rinomina Portafoglio" data-id="${p.id}">
                    <i data-lucide="pencil" style="width: 15px; height: 15px;"></i>
                </button>
                <button class="btn-tiny btn-delete-portfolio text-danger" title="Elimina Portafoglio" data-id="${p.id}">
                    <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
                </button>
            `;

            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-portfolio') || e.target.closest('.btn-rename-portfolio') || e.target.closest('.portfolio-card-checkbox')) return;
                state.activePortfolioId = p.id;
                saveState();
                showScreen('dashboard');
            });

            portfolioList.appendChild(card);
        });

        document.querySelectorAll('.btn-delete-portfolio').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                const p = state.portfolios[id];
                if (confirm(`Sei sicuro di voler eliminare il portafoglio "${p.name}"? Verrà rimosso da LocalStorage. La cartella sul disco non verrà cancellata.`)) {
                    delete state.portfolios[id];
                    saveState();
                    renderPortfolioSelectorList();
                }
            });
        });

        document.querySelectorAll('.btn-rename-portfolio').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                const p = state.portfolios[id];
                if (!p) return;

                const newName = prompt("Inserisci il nuovo nome per il portafoglio:", p.name);
                if (newName === null) return;

                const trimmedName = newName.trim();
                if (!trimmedName) {
                    alert("Il nome del portafoglio non può essere vuoto.");
                    return;
                }

                if (trimmedName === p.name) {
                    return;
                }

                // Check for invalid folder characters: \ / : * ? " < > |
                const invalidChars = /[\\/:*?"<>|]/;
                if (invalidChars.test(trimmedName)) {
                    alert("Il nome del portafoglio contiene caratteri non validi (\\ / : * ? \" < > |).");
                    return;
                }

                // Check if portfolio with that name already exists
                const nameExists = Object.values(state.portfolios).some(x => x.name.toLowerCase() === trimmedName.toLowerCase() && x.id !== p.id);
                if (nameExists) {
                    alert("Esiste già un portafoglio con questo nome.");
                    return;
                }

                if (serverMode) {
                    try {
                        const res = await apiFetch(`/api/rename-portfolio?oldName=${encodeURIComponent(p.name)}&newName=${encodeURIComponent(trimmedName)}`);
                        if (res.ok) {
                            const oldId = p.id;
                            const newId = "port-" + trimmedName.toLowerCase().replace(/ /g, "-");

                            // Reload all portfolios from disk
                            await loadAllPortfolios();

                            // If active, update ID
                            if (state.activePortfolioId === oldId) {
                                state.activePortfolioId = newId;
                                saveState();
                            }

                            renderPortfolioSelectorList();
                        } else {
                            const err = await res.json();
                            alert("Impossibile rinominare il portafoglio: " + (err.error || "Errore sconosciuto."));
                        }
                    } catch (err) {
                        console.error(err);
                        alert("Errore di connessione con il server API.");
                    }
                } else {
                    // Standalone LocalStorage mode
                    const oldId = p.id;
                    const newId = "port-" + trimmedName.toLowerCase().replace(/ /g, "-");

                    // Rename in state object
                    const portData = state.portfolios[oldId];
                    delete state.portfolios[oldId];

                    portData.id = newId;
                    portData.name = trimmedName;
                    state.portfolios[newId] = portData;

                    // If active portfolio was renamed, update it
                    if (state.activePortfolioId === oldId) {
                        state.activePortfolioId = newId;
                    }

                    saveState();
                    renderPortfolioSelectorList();
                }
            });
        });

        document.querySelectorAll('.portfolio-card-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = cb.getAttribute('data-id');
                const card = cb.closest('.portfolio-card');
                if (cb.checked) {
                    selectedAggregatePortfolioIds.add(id);
                    if (card) card.classList.add('is-selected');
                } else {
                    selectedAggregatePortfolioIds.delete(id);
                    if (card) card.classList.remove('is-selected');
                }
                updateAggregateButtonState();
            });
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

        updateAggregateButtonState();
        lucide.createIcons();
    }

    // --------------------------------------------------------------------------
    // 9. DASHBOARD STATE FUNCTIONS
    // --------------------------------------------------------------------------
    const activePortfolioNameBtn = document.getElementById('active-portfolio-name-btn');
    const activePortfolioNameText = document.getElementById('active-portfolio-name-text');
    const portfolioDropdownList = document.getElementById('portfolio-dropdown-list');
    const btnExitPortfolio = document.getElementById('btn-exit-portfolio');
    const btnGoHome = document.getElementById('btn-go-home');
    const btnRefreshPrices = document.getElementById('btn-refresh-prices');
    const refreshIcon = document.getElementById('refresh-icon');

    btnExitPortfolio.addEventListener('click', () => showScreen('selector'));
    btnGoHome.addEventListener('click', () => showScreen('selector'));

    activePortfolioNameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        activePortfolioNameBtn.classList.toggle('active');
        portfolioDropdownList.classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        activePortfolioNameBtn.classList.remove('active');
        portfolioDropdownList.classList.add('hidden');
    });

    function populateDropdownList() {
        portfolioDropdownList.innerHTML = '';
        Object.values(state.portfolios).forEach(p => {
            let displayVal = p.cash + calculateStaticHoldingsCost(p);
            if (p.lastRealTimeValue !== undefined && p.lastRealTimeValue !== null) {
                displayVal = p.lastRealTimeValue;
            }
            const item = document.createElement('div');
            item.className = `dropdown-item ${p.id === state.activePortfolioId ? 'active' : ''}`;
            item.innerHTML = `
                <span>${escapeHTML(p.name)}</span>
                <span class="text-xs text-muted">€ ${formatMoney(displayVal)}</span>
            `;
            item.addEventListener('click', () => {
                state.activePortfolioId = p.id;
                saveState();
                renderDashboard();
            });
            portfolioDropdownList.appendChild(item);
        });
    }

    function updatePrivacyUI() {
        const iconHome = document.getElementById('privacy-icon-home');
        const iconDash = document.getElementById('privacy-icon');
        const iconAgg = document.getElementById('privacy-icon-aggregate');
        
        if (isPrivacyMode) {
            if (iconHome) iconHome.setAttribute('data-lucide', 'eye-off');
            if (iconDash) iconDash.setAttribute('data-lucide', 'eye-off');
            if (iconAgg) iconAgg.setAttribute('data-lucide', 'eye-off');
        } else {
            if (iconHome) iconHome.setAttribute('data-lucide', 'eye');
            if (iconDash) iconDash.setAttribute('data-lucide', 'eye');
            if (iconAgg) iconAgg.setAttribute('data-lucide', 'eye');
        }
        lucide.createIcons();
    }

    function refreshCurrentScreen() {
        updatePrivacyUI();
        const selectorScreen = document.getElementById('portfolio-selector-screen');
        const aggregateScreen = document.getElementById('aggregate-view-screen');
        if (selectorScreen && selectorScreen.classList.contains('active')) {
            renderPortfolioSelectorList();
        } else if (aggregateScreen && aggregateScreen.classList.contains('active')) {
            if (cachedAggregateData) {
                renderAggregateView(cachedAggregateData);
            }
        } else {
            const activePort = getActivePortfolio();
            if (activePort) {
                activePortfolioNameText.innerText = activePort.name;
                populateDropdownList();
                renderHoldingsTable(false, cachedResolvedHoldings);
                updateQuickStatsAndPie();
                renderNetWorthChart();
                updateMarketIndicators();
                renderDepositsTable();
            }
        }
    }

    const btnTogglePrivacyHome = document.getElementById('btn-toggle-privacy-home');
    const btnTogglePrivacy = document.getElementById('btn-toggle-privacy');
    const btnTogglePrivacyAggregate = document.getElementById('btn-toggle-privacy-aggregate');

    function togglePrivacyMode() {
        isPrivacyMode = !isPrivacyMode;
        localStorage.setItem('finboard_privacy', isPrivacyMode.toString());
        refreshCurrentScreen();
    }

    if (btnTogglePrivacyHome) {
        btnTogglePrivacyHome.addEventListener('click', togglePrivacyMode);
    }
    if (btnTogglePrivacy) {
        btnTogglePrivacy.addEventListener('click', togglePrivacyMode);
    }
    if (btnTogglePrivacyAggregate) {
        btnTogglePrivacyAggregate.addEventListener('click', togglePrivacyMode);
    }

    btnRefreshPrices.addEventListener('click', async () => {
        refreshIcon.classList.add('spinning');
        await loadAllPortfolios(); // Reload metadata from folders
        await renderDashboard(); // Redraws everything
        refreshIcon.classList.remove('spinning');
    });

    function populateAssetTypeDropdown() {
        const select = document.getElementById('asset-type');
        if (!select) return;
        
        const activePort = getActivePortfolio();
        const merged = getMergedTypologies(activePort);
        const customTypes = Object.keys(merged);
        
        const baseTypes = ['Stocks', 'Bond', 'Hard assets', 'CASH', 'Crypto'];
        const allTypes = Array.from(new Set([...baseTypes, ...customTypes]));
        
        const currentVal = select.value;
        
        select.innerHTML = '';
        allTypes.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.innerText = t;
            select.appendChild(opt);
        });
        
        // Restore value if it still exists
        if (allTypes.includes(currentVal)) {
            select.value = currentVal;
        } else {
            select.value = 'Stocks';
        }
    }

    async function renderDashboard() {
        const activePort = state.portfolios[state.activePortfolioId];
        if (!activePort) {
            showScreen('selector');
            return;
        }

        // Reset active tab to performance
        if (tabs && panels) {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            const tabPerf = document.querySelector('[data-target="tab-performance"]');
            if (tabPerf) tabPerf.classList.add('active');
            const panelPerf = document.getElementById('tab-performance');
            if (panelPerf) panelPerf.classList.add('active');
        }

        // Reset period filter when entering a portfolio dashboard
        currentPatrimonioFilter = { type: 'MAX', start: null, end: null };
        updatePeriodButtonsUI('MAX');

        activePortfolioNameText.innerText = activePort.name;
        populateDropdownList();
        updateMarketStatusIndicator();
        updateFolderSyncUI();
        populateAssetTypeDropdown();
        
        // 1. Try reading the patrimonio.csv from portfolio directory
        if (serverMode) {
            try {
                const res = await apiFetch(`/api/patrimonio?portfolio=${encodeURIComponent(activePort.name)}`);
                if (res.ok) {
                    const csvText = await res.text();
                    const parsedData = parseBrokerCsv(csvText);
                    activePort.patrimonioCsvData = parsedData;
                    activePort.patrimonioCsvText = csvText;
                }
            } catch (err) {
                console.log(`Failed to load folder CSV for ${activePort.name}`);
            }
        }

        // 2. Draw static layouts
        renderQuickStats(activePort.cash, activePort.cash, 0);
        renderHoldingsTable(true);
        
        // 3. Resolve live pricing
        await refreshDashboardPrices();
        
        // 4. Draw Chart
        renderNetWorthChart();
    }

    function getActivePortfolio() {
        return state.portfolios[state.activePortfolioId];
    }

    // --------------------------------------------------------------------------
    // 10. SECTION 1: HOLDINGS & REAL-TIME PERFORMANCE
    // --------------------------------------------------------------------------
    const formAddAsset = document.getElementById('form-add-asset');
    const holdingsTableBody = document.getElementById('holdings-table-body');
    const holdingsEmptyState = document.getElementById('holdings-empty-state');
    const holdingsTable = document.getElementById('holdings-table');
    const holdingsCount = document.getElementById('holdings-count');

    const btnEditCash = document.getElementById('global-cash');
    const editCashModal = document.getElementById('edit-cash-modal');
    const btnCloseCashModal = document.getElementById('btn-close-cash-modal');
    const btnCancelCashModal = document.getElementById('btn-cancel-cash-modal');
    const btnSaveCashModal = document.getElementById('btn-save-cash-modal');
    const inputEditCash = document.getElementById('input-edit-cash');

    // Edit Position Modal variables
    const editHoldingModal = document.getElementById('edit-holding-modal');
    const btnCloseHoldingModal = document.getElementById('btn-close-holding-modal');
    const btnCancelHoldingModal = document.getElementById('btn-cancel-holding-modal');
    const btnSaveHoldingModal = document.getElementById('btn-save-holding-modal');
    const inputEditHoldingShares = document.getElementById('input-edit-holding-shares');
    const inputEditHoldingPrice = document.getElementById('input-edit-holding-price');
    const editHoldingTickerDisplay = document.getElementById('edit-holding-ticker-display');
    const lblEditHoldingShares = document.getElementById('lbl-edit-holding-shares');
    const lblEditHoldingPrice = document.getElementById('lbl-edit-holding-price');
    let editingHoldingTicker = null;

    const closeHoldingModal = () => {
        if (editHoldingModal) editHoldingModal.classList.add('hidden');
        editingHoldingTicker = null;
    };
    if (btnCloseHoldingModal) btnCloseHoldingModal.addEventListener('click', closeHoldingModal);
    if (btnCancelHoldingModal) btnCancelHoldingModal.addEventListener('click', closeHoldingModal);

    function openEditHoldingModal(ticker) {
        const port = getActivePortfolio();
        if (!port) return;
        const holding = port.holdings.find(x => x.ticker === ticker);
        if (!holding) return;

        editingHoldingTicker = ticker;
        if (editHoldingTickerDisplay) editHoldingTickerDisplay.innerText = ticker;
        
        if (inputEditHoldingShares) inputEditHoldingShares.value = holding.shares;
        if (inputEditHoldingPrice) inputEditHoldingPrice.value = holding.buyPrice;

        const assetType = holding.type || getDefaultAssetType(holding.ticker, holding.isin);
        const isBondGeneric = (holding.ticker === 'BOND' || holding.ticker === 'BOT');
        if (assetType === 'CASH' || isBondGeneric) {
            if (lblEditHoldingShares) lblEditHoldingShares.innerText = isBondGeneric ? "Importo / Controvalore (€)" : "Importo (€)";
            if (lblEditHoldingPrice) lblEditHoldingPrice.innerText = "PMC (Fissato a 1)";
            if (inputEditHoldingPrice) {
                inputEditHoldingPrice.value = "1.00";
                inputEditHoldingPrice.disabled = true;
            }
        } else {
            if (lblEditHoldingShares) lblEditHoldingShares.innerText = "Numero Quote";
            if (lblEditHoldingPrice) lblEditHoldingPrice.innerText = "P.M.C. (€)";
            if (inputEditHoldingPrice) inputEditHoldingPrice.disabled = false;
        }

        if (editHoldingModal) editHoldingModal.classList.remove('hidden');
    }

    if (btnSaveHoldingModal) {
        btnSaveHoldingModal.addEventListener('click', async () => {
            const port = getActivePortfolio();
            if (!port || !editingHoldingTicker) return;

            const holding = port.holdings.find(x => x.ticker === editingHoldingTicker);
            if (!holding) return;

            const shares = parseFloat(inputEditHoldingShares.value);
            const buyPrice = parseFloat(inputEditHoldingPrice.value);

            const assetType = holding.type || getDefaultAssetType(holding.ticker, holding.isin);
            const isBondGeneric = (holding.ticker === 'BOND' || holding.ticker === 'BOT');
            if (isNaN(shares) || shares <= 0) {
                alert("Inserisci una quantità o importo valido.");
                return;
            }
            if (assetType !== 'CASH' && !isBondGeneric && (isNaN(buyPrice) || buyPrice <= 0)) {
                alert("Inserisci un prezzo medio di carico valido.");
                return;
            }

            holding.shares = shares;
            holding.buyPrice = (assetType === 'CASH' || isBondGeneric) ? 1.0 : buyPrice;

            await savePortfolioMetadata();
            closeHoldingModal();
            refreshDashboardPrices();
        });
    }

    // --------------------------------------------------------------------------
    // ADD SHARES MODAL (Aggiungi Quote con ricalcolo PMC ponderato)
    // --------------------------------------------------------------------------
    const addSharesModal = document.getElementById('add-shares-modal');
    const btnCloseAddSharesModal = document.getElementById('btn-close-add-shares-modal');
    const btnCancelAddSharesModal = document.getElementById('btn-cancel-add-shares-modal');
    const btnConfirmAddSharesModal = document.getElementById('btn-confirm-add-shares-modal');
    const addSharesTickerDisplay = document.getElementById('add-shares-ticker-display');
    const addSharesCurrentQty = document.getElementById('add-shares-current-qty');
    const addSharesCurrentPmc = document.getElementById('add-shares-current-pmc');
    const inputAddSharesQty = document.getElementById('input-add-shares-qty');
    const inputAddSharesPmc = document.getElementById('input-add-shares-pmc');
    const addSharesPreview = document.getElementById('add-shares-preview');
    const addSharesPreviewQty = document.getElementById('add-shares-preview-qty');
    const addSharesPreviewPmc = document.getElementById('add-shares-preview-pmc');
    let addSharesTicker = null;

    function closeAddSharesModal() {
        if (addSharesModal) addSharesModal.classList.add('hidden');
        if (addSharesPreview) addSharesPreview.classList.add('hidden');
        if (inputAddSharesQty) inputAddSharesQty.value = '';
        if (inputAddSharesPmc) {
            inputAddSharesPmc.value = '';
            inputAddSharesPmc.disabled = false;
        }
        const lblQty = document.querySelector('label[for="input-add-shares-qty"]');
        const lblPmc = document.querySelector('label[for="input-add-shares-pmc"]');
        if (lblQty) lblQty.innerText = "Quote da aggiungere";
        if (lblPmc) lblPmc.innerText = "P.M.C. acquisto (€)";
        addSharesTicker = null;
    }
    if (btnCloseAddSharesModal) btnCloseAddSharesModal.addEventListener('click', closeAddSharesModal);
    if (btnCancelAddSharesModal) btnCancelAddSharesModal.addEventListener('click', closeAddSharesModal);

    function openAddSharesModal(ticker) {
        const port = getActivePortfolio();
        if (!port) return;
        const holding = port.holdings.find(x => x.ticker === ticker);
        if (!holding) return;

        addSharesTicker = ticker;

        // Populate header info
        const displayName = holding.name ? `${ticker} — ${holding.name}` : ticker;
        if (addSharesTickerDisplay) addSharesTickerDisplay.innerText = displayName;

        // Show current position stats
        if (addSharesCurrentQty) addSharesCurrentQty.innerText = holding.shares.toLocaleString('it-IT', { maximumFractionDigits: 4 });
        if (addSharesCurrentPmc) addSharesCurrentPmc.innerText = `€ ${holding.buyPrice.toLocaleString('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

        const isBondGeneric = (holding.ticker === 'BOND' || holding.ticker === 'BOT');
        const isCash = (holding.type === 'CASH' || holding.ticker === 'CASH');
        const lblQty = document.querySelector('label[for="input-add-shares-qty"]');
        const lblPmc = document.querySelector('label[for="input-add-shares-pmc"]');

        // Clear inputs and preview
        if (inputAddSharesQty) inputAddSharesQty.value = '';
        if (inputAddSharesPmc) {
            if (isBondGeneric || isCash) {
                inputAddSharesPmc.value = '1.00';
                inputAddSharesPmc.disabled = true;
            } else {
                inputAddSharesPmc.value = '';
                inputAddSharesPmc.disabled = false;
            }
        }
        if (lblQty) lblQty.innerText = (isBondGeneric || isCash) ? "Importo da aggiungere (€)" : "Quote da aggiungere";
        if (lblPmc) lblPmc.innerText = (isBondGeneric || isCash) ? "P.M.C. (Fissato a 1.00 €)" : "P.M.C. acquisto (€)";
        if (addSharesPreview) addSharesPreview.classList.add('hidden');

        if (addSharesModal) addSharesModal.classList.remove('hidden');
        if (inputAddSharesQty) inputAddSharesQty.focus();
    }

    function updateAddSharesPreview() {
        const port = getActivePortfolio();
        if (!port || !addSharesTicker) return;
        const holding = port.holdings.find(x => x.ticker === addSharesTicker);
        if (!holding) return;

        const isBondGeneric = (holding.ticker === 'BOND' || holding.ticker === 'BOT');
        const isCash = (holding.type === 'CASH' || holding.ticker === 'CASH');

        const addQty = parseFloat(inputAddSharesQty ? inputAddSharesQty.value : '');
        const addPmc = (isBondGeneric || isCash) ? 1.0 : parseFloat(inputAddSharesPmc ? inputAddSharesPmc.value : '');

        if (!isNaN(addQty) && addQty > 0 && !isNaN(addPmc) && addPmc > 0) {
            // Weighted average PMC = (existing cost + new cost) / total shares
            const existingCost = holding.shares * holding.buyPrice;
            const newCost = addQty * addPmc;
            const totalShares = holding.shares + addQty;
            const newWeightedPmc = (isBondGeneric || isCash) ? 1.0 : ((existingCost + newCost) / totalShares);

            if (addSharesPreview) addSharesPreview.classList.remove('hidden');
            if (addSharesPreviewQty) addSharesPreviewQty.innerText = totalShares.toLocaleString('it-IT', { maximumFractionDigits: 4 });
            if (addSharesPreviewPmc) addSharesPreviewPmc.innerText = `€ ${newWeightedPmc.toLocaleString('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
        } else {
            if (addSharesPreview) addSharesPreview.classList.add('hidden');
        }
    }

    if (inputAddSharesQty) inputAddSharesQty.addEventListener('input', updateAddSharesPreview);
    if (inputAddSharesPmc) inputAddSharesPmc.addEventListener('input', updateAddSharesPreview);

    if (btnConfirmAddSharesModal) {
        btnConfirmAddSharesModal.addEventListener('click', async () => {
            const port = getActivePortfolio();
            if (!port || !addSharesTicker) return;

            const holding = port.holdings.find(x => x.ticker === addSharesTicker);
            if (!holding) return;

            const isBondGeneric = (holding.ticker === 'BOND' || holding.ticker === 'BOT');
            const isCash = (holding.type === 'CASH' || holding.ticker === 'CASH');

            const addQty = parseFloat(inputAddSharesQty ? inputAddSharesQty.value : '');
            let addPmc = (isBondGeneric || isCash) ? 1.0 : parseFloat(inputAddSharesPmc ? inputAddSharesPmc.value : '');

            if (isNaN(addQty) || addQty <= 0) {
                alert('Inserisci un importo o numero di quote valido (> 0).');
                return;
            }
            if (!isBondGeneric && !isCash && (isNaN(addPmc) || addPmc <= 0)) {
                alert('Inserisci un prezzo medio di carico valido (> 0).');
                return;
            }

            // Recalculate weighted PMC
            const existingCost = holding.shares * holding.buyPrice;
            const newCost = addQty * addPmc;
            const totalShares = holding.shares + addQty;
            const newWeightedPmc = (isBondGeneric || isCash) ? 1.0 : ((existingCost + newCost) / totalShares);

            // Apply to holding
            holding.shares = totalShares;
            holding.buyPrice = newWeightedPmc;

            btnConfirmAddSharesModal.disabled = true;
            btnConfirmAddSharesModal.innerHTML = '<i data-lucide="loader-2" class="spinning" style="width:16px;height:16px;"></i> Salvataggio...';

            try {
                await savePortfolioMetadata();
                closeAddSharesModal();
                refreshDashboardPrices();
            } catch (err) {
                console.error('Error saving after add-shares:', err);
                alert('Errore durante il salvataggio.');
            } finally {
                btnConfirmAddSharesModal.disabled = false;
                btnConfirmAddSharesModal.innerHTML = '<i data-lucide="plus-circle" style="width:16px;height:16px;"></i> Conferma Acquisto';
                lucide.createIcons();
            }
        });
    }

    // --------------------------------------------------------------------------
    // SELL SHARES MODAL (Vendita Quote con mantenimento PMC)
    // --------------------------------------------------------------------------
    const sellSharesModal = document.getElementById('sell-shares-modal');
    const btnCloseSellSharesModal = document.getElementById('btn-close-sell-shares-modal');
    const btnCancelSellSharesModal = document.getElementById('btn-cancel-sell-shares-modal');
    const btnConfirmSellSharesModal = document.getElementById('btn-confirm-sell-shares-modal');
    const sellSharesTickerDisplay = document.getElementById('sell-shares-ticker-display');
    const sellSharesCurrentQty = document.getElementById('sell-shares-current-qty');
    const sellSharesCurrentPmc = document.getElementById('sell-shares-current-pmc');
    const inputSellSharesQty = document.getElementById('input-sell-shares-qty');
    const sellSharesPreview = document.getElementById('sell-shares-preview');
    const sellSharesPreviewQty = document.getElementById('sell-shares-preview-qty');
    const sellSharesPreviewPmc = document.getElementById('sell-shares-preview-pmc');
    const sellSharesPreviewMsg = document.getElementById('sell-shares-preview-msg');
    let sellSharesTicker = null;

    function closeSellSharesModal() {
        if (sellSharesModal) sellSharesModal.classList.add('hidden');
        if (sellSharesPreview) sellSharesPreview.classList.add('hidden');
        if (inputSellSharesQty) inputSellSharesQty.value = '';
        const lblSellQty = document.querySelector('label[for="input-sell-shares-qty"]');
        if (lblSellQty) lblSellQty.innerText = "Quote da vendere";
        sellSharesTicker = null;
    }
    if (btnCloseSellSharesModal) btnCloseSellSharesModal.addEventListener('click', closeSellSharesModal);
    if (btnCancelSellSharesModal) btnCancelSellSharesModal.addEventListener('click', closeSellSharesModal);

    function openSellSharesModal(ticker) {
        const port = getActivePortfolio();
        if (!port) return;
        const holding = port.holdings.find(x => x.ticker === ticker);
        if (!holding) return;

        sellSharesTicker = ticker;

        // Populate header info
        const displayName = holding.name ? `${ticker} — ${holding.name}` : ticker;
        if (sellSharesTickerDisplay) sellSharesTickerDisplay.innerText = displayName;

        // Show current position stats
        if (sellSharesCurrentQty) sellSharesCurrentQty.innerText = holding.shares.toLocaleString('it-IT', { maximumFractionDigits: 4 });
        if (sellSharesCurrentPmc) sellSharesCurrentPmc.innerText = `€ ${holding.buyPrice.toLocaleString('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

        const isBondGeneric = (holding.ticker === 'BOND' || holding.ticker === 'BOT');
        const isCash = (holding.type === 'CASH' || holding.ticker === 'CASH');
        const lblSellQty = document.querySelector('label[for="input-sell-shares-qty"]');
        if (lblSellQty) {
            lblSellQty.innerText = (isBondGeneric || isCash) ? "Importo da disinvestire (€)" : "Quote da vendere";
        }

        // Clear inputs and preview
        if (inputSellSharesQty) {
            inputSellSharesQty.value = '';
            inputSellSharesQty.max = holding.shares;
        }
        if (sellSharesPreview) sellSharesPreview.classList.add('hidden');

        if (sellSharesModal) sellSharesModal.classList.remove('hidden');
        if (inputSellSharesQty) inputSellSharesQty.focus();
    }

    function updateSellSharesPreview() {
        const port = getActivePortfolio();
        if (!port || !sellSharesTicker) return;
        const holding = port.holdings.find(x => x.ticker === sellSharesTicker);
        if (!holding) return;

        const sellQty = parseFloat(inputSellSharesQty ? inputSellSharesQty.value : '');

        if (!isNaN(sellQty) && sellQty > 0) {
            if (sellQty > holding.shares) {
                // Show warning message
                if (sellSharesPreview) sellSharesPreview.classList.remove('hidden');
                if (sellSharesPreviewQty) sellSharesPreviewQty.innerText = '—';
                if (sellSharesPreviewPmc) sellSharesPreviewPmc.innerText = '—';
                if (sellSharesPreviewMsg) {
                    sellSharesPreviewMsg.innerText = 'Errore: Non puoi vendere più quote di quelle possedute.';
                    sellSharesPreviewMsg.classList.remove('hidden');
                }
                if (btnConfirmSellSharesModal) btnConfirmSellSharesModal.disabled = true;
                return;
            }

            if (btnConfirmSellSharesModal) btnConfirmSellSharesModal.disabled = false;
            const remainingShares = holding.shares - sellQty;

            if (sellSharesPreview) sellSharesPreview.classList.remove('hidden');
            if (sellSharesPreviewQty) sellSharesPreviewQty.innerText = remainingShares.toLocaleString('it-IT', { maximumFractionDigits: 4 });
            if (sellSharesPreviewPmc) sellSharesPreviewPmc.innerText = `€ ${holding.buyPrice.toLocaleString('it-IT', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;

            if (sellSharesPreviewMsg) {
                if (remainingShares === 0 || remainingShares < 0.0001) {
                    sellSharesPreviewMsg.innerText = 'Attenzione: Verrà venduto il 100% delle quote. La posizione sarà rimossa dal portafoglio.';
                    sellSharesPreviewMsg.classList.remove('hidden');
                    sellSharesPreviewMsg.style.color = '#ef4444';
                } else {
                    sellSharesPreviewMsg.classList.add('hidden');
                }
            }
        } else {
            if (sellSharesPreview) sellSharesPreview.classList.add('hidden');
            if (btnConfirmSellSharesModal) btnConfirmSellSharesModal.disabled = false;
        }
    }

    if (inputSellSharesQty) inputSellSharesQty.addEventListener('input', updateSellSharesPreview);

    if (btnConfirmSellSharesModal) {
        btnConfirmSellSharesModal.addEventListener('click', async () => {
            const port = getActivePortfolio();
            if (!port || !sellSharesTicker) return;

            const holding = port.holdings.find(x => x.ticker === sellSharesTicker);
            if (!holding) return;

            const sellQty = parseFloat(inputSellSharesQty ? inputSellSharesQty.value : '');

            if (isNaN(sellQty) || sellQty <= 0) {
                alert('Inserisci un numero di quote valido (> 0).');
                return;
            }

            if (sellQty > holding.shares) {
                alert('Non puoi vendere più quote di quelle possedute.');
                return;
            }

            const remainingShares = holding.shares - sellQty;

            if (remainingShares === 0 || remainingShares < 0.0001) {
                // Sell 100% - remove position
                port.holdings = port.holdings.filter(x => x.ticker !== sellSharesTicker);
            } else {
                // Partial sale - update shares count, keep buyPrice (PMC) unchanged
                holding.shares = remainingShares;
            }

            btnConfirmSellSharesModal.disabled = true;
            btnConfirmSellSharesModal.innerHTML = '<i data-lucide="loader-2" class="spinning" style="width:16px;height:16px;"></i> Salvataggio...';

            try {
                await savePortfolioMetadata();
                closeSellSharesModal();
                refreshDashboardPrices();
            } catch (err) {
                console.error('Error saving after sell-shares:', err);
                alert('Errore durante il salvataggio.');
            } finally {
                btnConfirmSellSharesModal.disabled = false;
                btnConfirmSellSharesModal.innerHTML = '<i data-lucide="minus-circle" style="width:16px;height:16px;"></i> Conferma Vendita';
                lucide.createIcons();
            }
        });
    }

    btnEditCash.addEventListener('click', () => {
        const port = getActivePortfolio();
        if (!port) return;
        inputEditCash.value = port.cash.toFixed(2);
        editCashModal.classList.remove('hidden');
    });

    const closeCashModal = () => editCashModal.classList.add('hidden');
    btnCloseCashModal.addEventListener('click', closeCashModal);
    btnCancelCashModal.addEventListener('click', closeCashModal);
    
    btnSaveCashModal.addEventListener('click', async () => {
        const port = getActivePortfolio();
        if (!port) return;
        const newCash = parseFloat(inputEditCash.value);
        if (isNaN(newCash) || newCash < 0) {
            alert("Inserisci un importo di liquidità valido.");
            return;
        }
        port.cash = newCash;
        await savePortfolioMetadata();
        closeCashModal();
        refreshDashboardPrices();
    });

    async function resolveIsinToTicker(isin) {
        if (serverMode) {
            try {
                const res = await apiFetch(`/api/resolve-isin?isin=${encodeURIComponent(isin)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    return data.ticker || isin;
                } else {
                    const data = await res.json();
                    if (data.error) {
                        throw new Error(data.error);
                    }
                }
            } catch (e) {
                console.error("Server ISIN resolution failed:", e);
                if (e.message === "Isin non valido") {
                    throw e;
                }
            }
        }
        
        // Frontend fallback (tries Yahoo search via proxy, then OpenFIGI)
        try {
            const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=5&newsCount=0`;
            const data = await fetchWithProxy(yahooUrl);
            if (data && data.quotes && data.quotes.length > 0) {
                const preferred = data.quotes.find(q => q.symbol && (q.symbol.endsWith('.MI') || q.symbol.endsWith('.DE') || q.symbol.endsWith('.F')));
                return preferred ? preferred.symbol : data.quotes[0].symbol;
            }
        } catch (e) {
            console.warn("Frontend fallback Yahoo search failed for ISIN", e);
        }
        
        // OpenFIGI frontend fallback (tries direct POST, if blocked by CORS it will catch and fail)
        try {
            const body = JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]);
            const res = await fetch("https://api.openfigi.com/v3/mapping", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data[0] && data[0].data && data[0].data.length > 0) {
                    const results = data[0].data;
                    const FIGI_EXCH_MAP = {
                        'IM': '.MI', 'GY': '.DE', 'GR': '.F', 'LN': '.L',
                        'FP': '.PA', 'NA': '.AS', 'BB': '.BR', 'PL': '.LS',
                        'SM': '.MC', 'US': ''
                    };
                    for (const r of results) {
                        const suffix = FIGI_EXCH_MAP[r.exchCode];
                        if (suffix !== undefined) {
                            return r.ticker + suffix;
                        }
                    }
                    return results[0].ticker;
                }
            }
        } catch (e) {
            console.warn("Frontend OpenFIGI direct fallback failed:", e);
        }
        
        return isin;
    }

    // Setup type change logic for CASH and BOND
    const assetTypeSelect = document.getElementById('asset-type');
    const assetTickerInput = document.getElementById('asset-ticker');
    if (assetTypeSelect) {
        assetTypeSelect.addEventListener('change', () => {
            const type = assetTypeSelect.value;
            const assetSharesLabel = document.querySelector('label[for="asset-shares"]');
            const assetBuyPriceInput = document.getElementById('asset-buy-price');
            const tickerUpper = assetTickerInput ? assetTickerInput.value.trim().toUpperCase() : '';

            if (type === 'CASH') {
                if (assetSharesLabel) assetSharesLabel.innerText = "Importo (€)";
                if (assetBuyPriceInput) {
                    assetBuyPriceInput.value = "1";
                    assetBuyPriceInput.disabled = true;
                    // Trigger input event to satisfy validation
                    assetBuyPriceInput.dispatchEvent(new Event('input'));
                }
                if (assetTickerInput && !assetTickerInput.value) {
                    assetTickerInput.value = "CASH";
                }
            } else if (type === 'Bond' && (tickerUpper === 'BOND' || tickerUpper === 'BOT')) {
                if (assetSharesLabel) assetSharesLabel.innerText = "Importo / Controvalore (€)";
                if (assetBuyPriceInput) {
                    assetBuyPriceInput.value = "1";
                    assetBuyPriceInput.disabled = true;
                    assetBuyPriceInput.dispatchEvent(new Event('input'));
                }
            } else {
                if (assetSharesLabel) assetSharesLabel.innerText = "Numero Quote";
                if (assetBuyPriceInput) {
                    assetBuyPriceInput.disabled = false;
                    if (assetBuyPriceInput.value === "1") {
                        assetBuyPriceInput.value = "";
                    }
                }
                if (assetTickerInput && assetTickerInput.value === "CASH") {
                    assetTickerInput.value = "";
                }
            }
        });
    }

    if (assetTickerInput) {
        assetTickerInput.addEventListener('input', () => {
            const val = assetTickerInput.value.trim().toUpperCase();
            const assetSharesLabel = document.querySelector('label[for="asset-shares"]');
            const assetBuyPriceInput = document.getElementById('asset-buy-price');

            if (val === 'BOND' || val === 'BOT') {
                if (assetTypeSelect && assetTypeSelect.value !== 'Bond') {
                    assetTypeSelect.value = 'Bond';
                }
                if (assetSharesLabel) assetSharesLabel.innerText = "Importo / Controvalore (€)";
                if (assetBuyPriceInput) {
                    assetBuyPriceInput.value = "1";
                    assetBuyPriceInput.disabled = true;
                    assetBuyPriceInput.dispatchEvent(new Event('input'));
                }
            } else if (val === 'CASH') {
                if (assetTypeSelect && assetTypeSelect.value !== 'CASH') {
                    assetTypeSelect.value = 'CASH';
                }
                if (assetSharesLabel) assetSharesLabel.innerText = "Importo (€)";
                if (assetBuyPriceInput) {
                    assetBuyPriceInput.value = "1";
                    assetBuyPriceInput.disabled = true;
                    assetBuyPriceInput.dispatchEvent(new Event('input'));
                }
            } else {
                if (assetBuyPriceInput && assetBuyPriceInput.disabled) {
                    assetBuyPriceInput.disabled = false;
                    if (assetBuyPriceInput.value === "1") {
                        assetBuyPriceInput.value = "";
                    }
                    if (assetSharesLabel) assetSharesLabel.innerText = "Numero Quote";
                }
            }
        });
    }

    formAddAsset.addEventListener('submit', async (e) => {
        e.preventDefault();
        const tickerOrIsin = document.getElementById('asset-ticker').value.trim().toUpperCase();
        const shares = parseFloat(document.getElementById('asset-shares').value);
        const buyPrice = parseFloat(document.getElementById('asset-buy-price').value);
        const typeSelect = document.getElementById('asset-type');
        const assetType = typeSelect ? typeSelect.value : 'Stocks';

        if (!tickerOrIsin || isNaN(shares) || isNaN(buyPrice)) return;

        const port = getActivePortfolio();
        if (!port) return;

        formAddAsset.querySelector('button[type="submit"]').disabled = true;
        
        try {
            let ticker = tickerOrIsin;
            let name = tickerOrIsin;
            const isBondGeneric = (tickerOrIsin === 'BOND' || tickerOrIsin === 'BOT');
            
            if (assetType === 'CASH') {
                name = (ticker === 'CASH') ? "Liquidità" : ticker;
                const existing = port.holdings.find(h => h.ticker === ticker);
                if (existing) {
                    const totalCost = (existing.shares * existing.buyPrice) + (shares * buyPrice);
                    existing.shares += shares;
                    existing.buyPrice = +(totalCost / existing.shares).toFixed(4);
                    existing.type = 'CASH';
                } else {
                    port.holdings.push({
                        ticker,
                        isin: "",
                        name,
                        shares,
                        buyPrice,
                        type: 'CASH'
                    });
                }
            } else if (isBondGeneric) {
                ticker = 'BOND';
                name = (tickerOrIsin === 'BOT') ? "BOT / Titoli di Stato a breve" : "Obbligazioni Generiche (BOND)";
                const existing = port.holdings.find(h => h.ticker === 'BOND');
                if (existing) {
                    existing.shares += shares;
                    existing.buyPrice = 1.0;
                    existing.type = 'Bond';
                } else {
                    port.holdings.push({
                        ticker: 'BOND',
                        isin: "",
                        name,
                        shares,
                        buyPrice: 1.0,
                        type: 'Bond'
                    });
                }
            } else {
                let isin = "";
                const isIsinRegex = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i;
                if (isIsinRegex.test(tickerOrIsin)) {
                    isin = tickerOrIsin;
                    // Show visual loading indicator in the search field
                    document.getElementById('asset-ticker').value = "Risoluzione ISIN...";
                    ticker = await resolveIsinToTicker(isin);
                    document.getElementById('asset-ticker').value = ticker;
                    console.log(`Resolved ISIN ${isin} to ticker ${ticker}`);
                }

                const quote = await getStockQuote(ticker);
                name = quote.name || ticker;

                const existing = port.holdings.find(h => h.ticker === ticker);
                if (existing) {
                    const totalCost = (existing.shares * existing.buyPrice) + (shares * buyPrice);
                    existing.shares += shares;
                    existing.buyPrice = +(totalCost / existing.shares).toFixed(4);
                    existing.type = assetType;
                    if (isin && !existing.isin) {
                        existing.isin = isin;
                    }
                } else {
                    port.holdings.push({
                        ticker,
                        isin,
                        name,
                        shares,
                        buyPrice,
                        type: assetType
                    });
                }
            }

            await savePortfolioMetadata();
            formAddAsset.reset();
            if (assetTypeSelect) {
                assetTypeSelect.value = 'Stocks';
                assetTypeSelect.dispatchEvent(new Event('change'));
            }
            await refreshDashboardPrices();
        } catch (err) {
            console.error("Error adding asset:", err);
            const msg = err.message === "Isin non valido" ? "Errore: Isin non valido." : "Impossibile reperire i dettagli per questo ticker o ISIN. Assicurati che sia corretto.";
            alert(msg);
            // Restore input value in case of error
            document.getElementById('asset-ticker').value = tickerOrIsin;
        } finally {
            formAddAsset.querySelector('button[type="submit"]').disabled = false;
        }
    });

    async function resolveHoldingsPrices(holdingsList) {
        const isEuOpen = isEuropeanMarketOpen();
        const promises = holdingsList.map(async (h) => {
            const assetType = h.type || getDefaultAssetType(h.ticker, h.isin);
            const isBondGeneric = (h.ticker === 'BOND' || h.ticker === 'BOT' || (assetType === 'Bond' && h.ticker === 'BOND'));

            if (assetType === 'CASH') {
                const buyCost = h.shares * (h.buyPrice || 1);
                const currentValue = h.shares * (h.buyPrice || 1);
                return {
                    ...h,
                    ticker: h.ticker,
                    isin: h.isin || "",
                    queriedTicker: h.ticker,
                    name: h.name || "Liquidità",
                    shares: h.shares,
                    buyPrice: h.buyPrice || 1,
                    buyCost: buyCost,
                    currentPrice: h.buyPrice || 1,
                    originalPrice: h.buyPrice || 1,
                    originalCurrency: "EUR",
                    currentValue: currentValue,
                    pnl: 0,
                    pnlPercent: 0,
                    exchange: "CASH",
                    sourceMsg: "Liquidità Portafoglio",
                    type: "CASH"
                };
            }

            if (isBondGeneric) {
                const buyCost = h.shares;
                const currentValue = h.shares;
                const displayName = h.name || ((h.ticker === 'BOT') ? "BOT / Titoli di Stato a breve" : "Obbligazioni Generiche (BOND)");
                return {
                    ...h,
                    ticker: 'BOND',
                    isin: h.isin || "",
                    queriedTicker: 'BOND',
                    name: displayName,
                    shares: h.shares,
                    buyPrice: 1.0,
                    buyCost: buyCost,
                    currentPrice: 1.0,
                    originalPrice: 1.0,
                    originalCurrency: "EUR",
                    currentValue: currentValue,
                    pnl: 0,
                    pnlPercent: 0,
                    exchange: "BOND",
                    sourceMsg: "Quota Fissa (Senza tracking)",
                    type: "Bond"
                };
            }

            const isSingleStock = (
                assetType === 'Stocks' && 
                !h.ticker.includes('.') && 
                h.ticker !== 'CASH' &&
                h.ticker !== 'BOND' &&
                h.ticker !== 'BOT' &&
                !h.ticker.toUpperCase().includes('BTC') &&
                !h.ticker.toUpperCase().includes('ETH') &&
                !h.ticker.toUpperCase().includes('XBT') &&
                !h.ticker.toUpperCase().includes('CRYPTO')
            );

            let targetTicker = h.ticker;
            let sourceMsg = "Diretto";
            let wasConverted = false;

            if (isSingleStock) {
                if (isEuOpen) {
                    if (US_TO_EU_TICKER_MAP[h.ticker]) {
                        targetTicker = US_TO_EU_TICKER_MAP[h.ticker];
                        sourceMsg = "Borsa Europea (EUR)";
                    } else {
                        sourceMsg = "Borsa Internazionale";
                    }
                } else {
                    sourceMsg = "Borsa USA (Convertito)";
                    wasConverted = true;
                }
            } else {
                const tUpper = (h.ticker || '').toUpperCase();
                if (assetType === 'Bond') {
                    sourceMsg = "Borsa Italiana";
                } else if (assetType.startsWith('Mixed') || (globalCustomTypologies[assetType] && globalCustomTypologies[assetType].type === 'mixed') || tUpper.includes('4PAPRST') || tUpper.includes('FONTE') || tUpper.includes('AMUNDI') || tUpper.includes('GENGRRB') || tUpper.includes('GENERALI')) {
                    sourceMsg = "Fondo Pensione";
                } else if (h.ticker.includes('.')) {
                    sourceMsg = "Borsa Europea (EUR)";
                } else {
                    sourceMsg = "Diretto";
                }
            }

            try {
                const quote = await getStockQuote(targetTicker);
                
                let currentPriceEUR = quote.price;
                if (quote.currency === "USD" || wasConverted) {
                    currentPriceEUR = quote.price / cachedEURUSD;
                }

                // Save last resolved price to holding object for future estimation
                h.lastPrice = quote.price;

                const buyCost = h.shares * h.buyPrice;
                const currentValue = h.shares * currentPriceEUR;
                const pnl = currentValue - buyCost;
                const pnlPercent = buyCost > 0 ? (pnl / buyCost) * 100 : 0;

                return {
                    ...h,
                    ticker: h.ticker,
                    isin: h.isin || "",
                    queriedTicker: targetTicker,
                    name: quote.name || h.name || h.ticker,
                    shares: h.shares,
                    buyPrice: h.buyPrice,
                    buyCost: buyCost,
                    currentPrice: currentPriceEUR,
                    originalPrice: quote.price,
                    originalCurrency: quote.currency,
                    currentValue: currentValue,
                    pnl: pnl,
                    pnlPercent: pnlPercent,
                    exchange: quote.exchange,
                    sourceMsg: sourceMsg,
                    type: assetType
                };
            } catch (err) {
                console.error(`Error resolving quote for ${targetTicker}:`, err);
                return {
                    ...h,
                    ticker: h.ticker,
                    isin: h.isin || "",
                    queriedTicker: targetTicker,
                    name: h.name || h.ticker,
                    shares: h.shares,
                    buyPrice: h.buyPrice,
                    buyCost: h.shares * h.buyPrice,
                    currentPrice: h.buyPrice,
                    originalPrice: h.buyPrice,
                    originalCurrency: "EUR",
                    currentValue: h.shares * h.buyPrice,
                    pnl: 0,
                    pnlPercent: 0,
                    exchange: "N/D",
                    sourceMsg: "Errore (PMC Fallback)",
                    type: assetType
                };
            }
        });

        return Promise.all(promises);
    }

    function updateQuickStatsAndPie() {
        const port = getActivePortfolio();
        if (!port) return;

        let totalInvestedCost = 0;
        let totalCurrentValue = 0;

        cachedResolvedHoldings.forEach(h => {
            totalInvestedCost += h.buyCost;
            totalCurrentValue += h.currentValue;
        });

        const totalRealTimeValue = port.cash + totalCurrentValue;
        renderQuickStats(port.cash, totalRealTimeValue, totalCurrentValue - totalInvestedCost);
        updatePieChartFromCached();

        if (port.lastRealTimeValue !== totalRealTimeValue) {
            port.lastRealTimeValue = totalRealTimeValue;
            savePortfolioMetadata();
        }
    }

    async function refreshDashboardPrices() {
        const port = getActivePortfolio();
        if (!port) return;

        updateMarketStatusIndicator();
        await updateExchangeRate();
        updateMarketIndicators();
        
        if (port.holdings.length === 0) {
            cachedResolvedHoldings = [];
            renderHoldingsTable(false, []);
            renderQuickStats(port.cash, port.cash, 0);
            updatePieChartFromCached();
            return;
        }

        // Reset grid expanded state when refreshing/loading a portfolio
        isGridExpanded = false;

        // 1. Sort holdings by estimated current value descending
        const sortedHoldings = [...port.holdings].sort((a, b) => {
            const valA = a.shares * (a.lastPrice || a.buyPrice);
            const valB = b.shares * (b.lastPrice || b.buyPrice);
            return valB - valA;
        });

        const top10 = sortedHoldings.slice(0, 10);
        const remaining = sortedHoldings.slice(10);

        // 2. Load top 10 immediately in parallel
        const top10Resolved = await resolveHoldingsPrices(top10);
        
        // Save the metadata (updating lastPrice on top 10)
        await savePortfolioMetadata();

        // Put resolved top 10 into cache and render immediately
        cachedResolvedHoldings = [...top10Resolved];
        
        // Also add the unresolved remaining holdings as placeholders in cachedResolvedHoldings so stats look complete
        // while we fetch the actual prices in the background.
        const remainingPlaceholders = remaining.map(h => {
            const assetType = h.type || getDefaultAssetType(h.ticker, h.isin);
            const buyCost = h.shares * h.buyPrice;
            const lastPriceEUR = h.lastPrice || h.buyPrice;
            const currentValue = h.shares * lastPriceEUR;
            return {
                ticker: h.ticker,
                isin: h.isin || "",
                queriedTicker: h.ticker,
                name: h.name || h.ticker,
                shares: h.shares,
                buyPrice: h.buyPrice,
                buyCost: buyCost,
                currentPrice: lastPriceEUR,
                originalPrice: lastPriceEUR,
                originalCurrency: "EUR",
                currentValue: currentValue,
                pnl: currentValue - buyCost,
                pnlPercent: buyCost > 0 ? ((currentValue - buyCost) / buyCost) * 100 : 0,
                exchange: "Caricamento...",
                sourceMsg: "Precaricato",
                type: assetType
            };
        });

        cachedResolvedHoldings = [...top10Resolved, ...remainingPlaceholders];
        
        // Update table & stats immediately
        sortAndRenderHoldingsTable();
        updateQuickStatsAndPie();

        // 3. Preload remaining items in background
        if (remaining.length > 0) {
            resolveHoldingsPrices(remaining).then(async (remainingResolved) => {
                // Ensure the user hasn't switched portfolios in the meantime
                const currentPort = getActivePortfolio();
                if (!currentPort || currentPort.id !== port.id) return;

                // Update metadata for remaining
                await savePortfolioMetadata();

                // Merge and update cachedResolvedHoldings
                cachedResolvedHoldings = [...top10Resolved, ...remainingResolved];
                
                // Update table & stats again
                sortAndRenderHoldingsTable();
                updateQuickStatsAndPie();
            }).catch(err => {
                console.error("Error preloading remaining holdings:", err);
            });
        }
    }

    function sortAndRenderHoldingsTable() {
        const sorted = [...cachedResolvedHoldings];
        sorted.sort((a, b) => {
            let valA = a[holdingsSortCol];
            let valB = b[holdingsSortCol];
            
            // Handling string fields (ticker, exchange)
            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
                return holdingsSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            
            // Numeric fields
            return holdingsSortOrder === 'asc' ? valA - valB : valB - valA;
        });
        
        renderHoldingsTable(false, sorted);
        updateSortHeaderClasses();
    }

    function updateSortHeaderClasses() {
        document.querySelectorAll('#holdings-table th[data-sort]').forEach(th => {
            th.classList.remove('sorted-asc', 'sorted-desc');
            const col = th.getAttribute('data-sort');
            if (col === holdingsSortCol) {
                th.classList.add(holdingsSortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });
    }

    // Attach click handlers to headers for dynamic sorting
    document.querySelectorAll('#holdings-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (holdingsSortCol === col) {
                holdingsSortOrder = holdingsSortOrder === 'desc' ? 'asc' : 'desc';
            } else {
                holdingsSortCol = col;
                holdingsSortOrder = 'desc'; // default to descending
            }
            sortAndRenderHoldingsTable();
        });
    });

    function updatePieChartFromCached() {
        const activePort = getActivePortfolio();
        const customTypologies = getMergedTypologies(activePort);

        // 1. Initialize default categories
        const categories = {
            'Stocks': { val: 0, pnl: 0 },
            'Bond': { val: 0, pnl: 0 },
            'Hard assets': { val: 0, pnl: 0 },
            'CASH': { val: 0, pnl: 0 },
            'Crypto': { val: 0, pnl: 0 }
        };

        // Add custom single typologies
        Object.keys(customTypologies).forEach(key => {
            const ty = customTypologies[key];
            if (ty && ty.type === 'single') {
                categories[key] = { val: 0, pnl: 0 };
            }
        });

        // 2. Loop through holdings and aggregate
        cachedResolvedHoldings.forEach(h => {
            const type = h.type || getDefaultAssetType(h.ticker, h.isin);
            const curVal = h.currentValue || 0;
            const pnlVal = h.pnl || 0;

            if (customTypologies[type]) {
                const ty = customTypologies[type];
                if (ty.type === 'mixed') {
                    const alloc = ty.allocation || {};
                    let totalAllocPct = 0;
                    Object.keys(alloc).forEach(target => {
                        totalAllocPct += alloc[target] || 0;
                    });
                    if (totalAllocPct > 0) {
                        Object.keys(alloc).forEach(target => {
                            const pct = (alloc[target] || 0) / totalAllocPct;
                            if (!categories[target]) {
                                categories[target] = { val: 0, pnl: 0 };
                            }
                            categories[target].val += curVal * pct;
                            categories[target].pnl += pnlVal * pct;
                        });
                    } else {
                        categories['CASH'].val += curVal;
                        categories['CASH'].pnl += pnlVal;
                    }
                } else {
                    // Custom single type
                    if (!categories[type]) {
                        categories[type] = { val: 0, pnl: 0 };
                    }
                    categories[type].val += curVal;
                    categories[type].pnl += pnlVal;
                }
            } else if (type === 'Mixed (60/40)') {
                categories['Stocks'].val += curVal * 0.60;
                categories['Stocks'].pnl += pnlVal * 0.60;
                categories['Bond'].val += curVal * 0.40;
                categories['Bond'].pnl += pnlVal * 0.40;
            } else if (type === 'Mixed (80/20)') {
                categories['Stocks'].val += curVal * 0.80;
                categories['Stocks'].pnl += pnlVal * 0.80;
                categories['Bond'].val += curVal * 0.20;
                categories['Bond'].pnl += pnlVal * 0.20;
            } else {
                // Default single category (or unknown, default to type or CASH)
                const targetKey = categories[type] ? type : 'CASH';
                categories[targetKey].val += curVal;
                categories[targetKey].pnl += pnlVal;
            }
        });

        // Add cash to CASH category
        if (activePort) {
            categories['CASH'].val += activePort.cash || 0;
        }

        // Render the chart
        renderAllocationPieChart(categories);
        renderEquityPieChart();
    }

    function renderHoldingsTable(isLoading, holdingsList = []) {
        holdingsTableBody.innerHTML = '';
        
        if (isLoading) {
            holdingsCount.innerText = 'Aggiornamento...';
            holdingsTableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center text-muted py-6">
                        <i data-lucide="loader-2" class="spinning" style="display:inline-block; vertical-align:middle; margin-right:8px;"></i>
                        Quotazione e calcolo andamento in corso...
                    </td>
                </tr>
            `;
            holdingsEmptyState.classList.add('hidden');
            holdingsTable.classList.remove('hidden');
            lucide.createIcons();
            return;
        }

        const activePort = getActivePortfolio();
        holdingsCount.innerText = `${activePort.holdings.length} Titoli`;

        if (holdingsList.length === 0) {
            holdingsTable.classList.add('hidden');
            holdingsEmptyState.classList.remove('hidden');
            return;
        }

        holdingsEmptyState.classList.add('hidden');
        holdingsTable.classList.remove('hidden');

        // Show only top 10 if not expanded
        const totalItemsCount = holdingsList.length;
        const needsTruncation = totalItemsCount > 10;
        let itemsToRender = holdingsList;
        if (needsTruncation && !isGridExpanded) {
            itemsToRender = holdingsList.slice(0, 10);
        }

        itemsToRender.forEach(h => {
            const tr = document.createElement('tr');
            const pnlClass = h.pnl >= 0 ? 'text-success' : 'text-danger';
            const pnlSign = h.pnl >= 0 ? '+' : '';
            
            const assetType = h.type || getDefaultAssetType(h.ticker, h.isin);
            const typeColorObj = getColorForType(assetType);
            const typeColor = typeColorObj.bg;
            const typeTextColor = typeColorObj.text;
            const typeHtml = `<span style="display:inline-block; font-size:0.65rem; font-weight:600; padding:2px 6px; border-radius:4px; margin-left:8px; background-color:${typeColor}; color:${typeTextColor}; text-transform:uppercase; vertical-align:middle;">${assetType}</span>`;

            const isinHtml = h.isin ? `<span class="text-xs text-muted" style="font-size:0.68rem; display:block; margin-top:1px;">ISIN: ${escapeHTML(h.isin)}</span>` : '';
            
            // Inline typology selector dropdown
            const merged = getMergedTypologies(activePort);
            const customTypes = Object.keys(merged);
            const baseTypes = ['Stocks', 'Bond', 'Hard assets', 'CASH', 'Crypto'];
            const selectOptions = Array.from(new Set([...baseTypes, ...customTypes]));
            let selectHtml = `<select class="asset-type-select typology-select-dropdown" data-ticker="${escapeHTML(h.ticker)}" style="background-color: ${typeColor}; color: ${typeTextColor}; border: 1px solid ${typeTextColor}33;">`;
            selectOptions.forEach(opt => {
                const selected = assetType === opt ? 'selected' : '';
                selectHtml += `<option value="${opt}" ${selected}>${opt}</option>`;
            });
            selectHtml += `</select>`;

            const displayShares = isPrivacyMode ? '*****' : h.shares.toLocaleString();
            const displayPnlPercent = isPrivacyMode ? '***' : h.pnlPercent.toFixed(2);
            const displayPnlSign = isPrivacyMode ? '' : pnlSign;

            tr.innerHTML = `
                <td>
                    <div class="asset-title">
                        <span class="asset-ticker-cell" style="vertical-align:middle;">${escapeHTML(h.ticker)}</span> ${typeHtml}
                        ${isinHtml}
                        <span class="asset-name-cell edit-holding-trigger" title="${escapeHTML(h.name)} (Clicca per modificare)" data-ticker="${escapeHTML(h.ticker)}">${escapeHTML(h.name)}</span>
                    </div>
                </td>
                <td>
                    <span class="badge badge-accent" style="font-size:0.7rem; font-weight:500;">${escapeHTML(h.exchange || 'N/D')}</span>
                    <div class="text-xs text-muted mt-1" style="font-size:0.68rem;">${escapeHTML(h.sourceMsg)}</div>
                </td>
                <td class="text-right font-medium">${displayShares}</td>
                <td class="text-right">€ ${formatMoney(h.buyPrice)}</td>
                <td class="text-right">€ ${formatMoney(h.buyCost)}</td>
                <td class="text-right font-semibold">€ ${formatMoney(h.currentPrice)}</td>
                <td class="text-right font-semibold">€ ${formatMoney(h.currentValue)}</td>
                <td class="text-right font-semibold ${pnlClass}">
                    ${displayPnlSign}€ ${formatMoney(h.pnl)}<br>
                    <span class="text-xs">${displayPnlSign}${displayPnlPercent}%</span>
                </td>
                <td class="text-center">
                    ${selectHtml}
                </td>
                <td class="text-center" style="white-space: nowrap;">
                    <button class="btn-tiny btn-add-shares text-success" title="Aggiungi Quote" data-ticker="${h.ticker}" style="margin-right: 4px;">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button class="btn-tiny btn-sell-shares text-warning" title="Vendi Quote" data-ticker="${h.ticker}" style="margin-right: 4px;">
                        <i data-lucide="minus" style="width: 14px; height: 14px;"></i>
                    </button>
                    <button class="btn-tiny btn-delete-holding text-danger" title="Rimuovi Posizione" data-ticker="${h.ticker}">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </td>
            `;

            holdingsTableBody.appendChild(tr);

            // Edit holding trigger event listener
            const trigger = tr.querySelector('.edit-holding-trigger');
            if (trigger) {
                trigger.addEventListener('click', (e) => {
                    const ticker = e.currentTarget.getAttribute('data-ticker');
                    openEditHoldingModal(ticker);
                });
            }
        });

        // Expand/Collapse Row
        if (needsTruncation) {
            const trExpand = document.createElement('tr');
            trExpand.className = 'expand-row';
            trExpand.innerHTML = `
                <td colspan="10" class="text-center py-4" style="background: rgba(255,255,255,0.01); cursor: pointer; transition: background 0.2s ease;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; color: var(--color-accent-primary); font-size: 0.85rem;">
                        <i data-lucide="${isGridExpanded ? 'chevron-up' : 'chevron-down'}" style="width: 16px; height: 16px;"></i>
                        <span>${isGridExpanded ? 'Mostra meno titoli' : `Mostra tutti (${totalItemsCount} titoli)`}</span>
                    </div>
                </td>
            `;
            trExpand.addEventListener('click', () => {
                isGridExpanded = !isGridExpanded;
                sortAndRenderHoldingsTable();
            });
            holdingsTableBody.appendChild(trExpand);
        }

        // Delete handlers
        document.querySelectorAll('.btn-delete-holding').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const ticker = btn.getAttribute('data-ticker');
                if (confirm(`Sei sicuro di voler eliminare la posizione in ${ticker}?`)) {
                    activePort.holdings = activePort.holdings.filter(x => x.ticker !== ticker);
                    await savePortfolioMetadata();
                    refreshDashboardPrices();
                }
            });
        });

        // Add-shares button event handlers
        document.querySelectorAll('.btn-add-shares').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ticker = btn.getAttribute('data-ticker');
                openAddSharesModal(ticker);
            });
        });

        // Sell-shares button event handlers
        document.querySelectorAll('.btn-sell-shares').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ticker = btn.getAttribute('data-ticker');
                openSellSharesModal(ticker);
            });
        });

        // Inline type select change event handlers
        document.querySelectorAll('.asset-type-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const ticker = select.getAttribute('data-ticker');
                const newType = select.value;
                
                // Find in active portfolio holdings
                const holding = activePort.holdings.find(x => x.ticker === ticker);
                if (holding) {
                    holding.type = newType;
                }
                
                // Find in cached resolved holdings
                const cachedHolding = cachedResolvedHoldings.find(x => x.ticker === ticker);
                if (cachedHolding) {
                    cachedHolding.type = newType;
                }
                
                // Save to storage
                await savePortfolioMetadata();
                
                // Re-calculate allocation and update pie chart immediately
                updatePieChartFromCached();
                
                // Re-render table and sort
                sortAndRenderHoldingsTable();
            });
        });

        lucide.createIcons();
    }

    function getColorForType(typeName) {
        const typeColors = {
            'Stocks': { bg: 'rgba(16, 185, 129, 0.12)', text: '#10b981' },
            'Bond': { bg: 'rgba(59, 130, 246, 0.12)', text: '#3b82f6' },
            'Hard assets': { bg: 'rgba(245, 158, 11, 0.12)', text: '#f59e0b' },
            'CASH': { bg: 'rgba(139, 92, 246, 0.12)', text: '#8b5cf6' },
            'Crypto': { bg: 'rgba(6, 182, 212, 0.12)', text: '#06b6d4' },
            'Mixed (60/40)': { bg: 'rgba(236, 72, 153, 0.12)', text: '#ec4899' },
            'Mixed (80/20)': { bg: 'rgba(244, 63, 94, 0.12)', text: '#f43f5e' }
        };
        if (typeColors[typeName]) {
            return typeColors[typeName];
        }
        // Generate deterministic HSL based on hash of string
        let hash = 0;
        for (let i = 0; i < typeName.length; i++) {
            hash = typeName.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h = Math.abs(hash) % 360;
        return {
            bg: `hsla(${h}, 70%, 55%, 0.12)`,
            text: `hsl(${h}, 70%, 55%)`
        };
    }

    function getDefaultAssetType(ticker, isin) {
        if (!ticker) return 'Stocks';
        const t = ticker.toUpperCase();
        const i = (isin || '').toUpperCase();
        const typKeys = Object.keys(globalCustomTypologies || {});
        if (t.includes('FONTE') || t.includes('DINAMICO')) {
            const match = typKeys.find(k => k.includes('60') || k.toLowerCase().includes('fonte'));
            return match || 'Mixed (60/40)';
        }
        if (t.includes('AMUNDI') || t.includes('SECONDA') || t.includes('ESPANSIONE') || t.includes('QS0000003561')) {
            const match = typKeys.find(k => k.includes('80') || k.toLowerCase().includes('amundi'));
            return match || 'Mixed (80/20)';
        }
        if (t.includes('4PAPRST') || t.includes('AXA') || t.includes('STABILITA')) {
            const match = typKeys.find(k => k.includes('30') || k.toLowerCase().includes('stabilita') || k.toLowerCase().includes('axa'));
            return match || 'Mixed (30/70)';
        }
        if (t.includes('GENGRRB') || t.includes('GENERALI') || t.includes('REAL RETURN')) {
            const match = typKeys.find(k => k.toLowerCase().includes('generali') || k.toLowerCase().includes('real return'));
            return match || 'Mixed';
        }
        if (t.includes('BTC') || t.includes('ETH') || t.includes('XBT') || t.includes('CRYPTO')) {
            return 'Crypto';
        }
        if (t.includes('GOLD') || t.includes('GLD') || i.includes('GB00BJYDH287')) {
            return 'Hard assets';
        }
        if (t === 'BOND' || t === 'BOT' || t.includes('BOND') || t.includes('BOT') || t.includes('BND') || t.includes('GOV') || t.includes('XG7S')) {
            return 'Bond';
        }
        if (t === 'CASH') {
            return 'CASH';
        }
        return 'Stocks';
    }

    // Reusable HTML tooltip generator for small charts to prevent clipping
    function getHtmlTooltipHandler() {
        return function(context) {
            // Tooltip Element
            let tooltipEl = document.getElementById('chartjs-html-tooltip');

            // Create element on first render
            if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.id = 'chartjs-html-tooltip';
                tooltipEl.style.cssText = `
                    background: rgba(30, 41, 59, 0.95);
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 8px;
                    color: #e2e8f0;
                    opacity: 0;
                    pointer-events: none;
                    position: absolute;
                    transform: translate(-50%, -100%);
                    transition: opacity 0.15s ease, transform 0.15s ease;
                    padding: 8px 12px;
                    z-index: 9999;
                    font-family: var(--font-sans), sans-serif;
                    font-size: 0.8rem;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
                    white-space: nowrap;
                `;
                document.body.appendChild(tooltipEl);
            }

            // Hide if no tooltip
            const tooltipModel = context.tooltip;
            if (tooltipModel.opacity === 0) {
                tooltipEl.style.opacity = '0';
                return;
            }

            // Set Text
            if (tooltipModel.body) {
                const titleLines = tooltipModel.title || [];
                const bodyLines = tooltipModel.body.map(bodyItem => bodyItem.lines);

                let innerHtml = '';
                titleLines.forEach(title => {
                    innerHtml += `<div style="font-weight: 700; color: #ffffff; margin-bottom: 4px;">${title}</div>`;
                });
                bodyLines.forEach((body, i) => {
                    const colors = tooltipModel.labelColors[i];
                    // Create a small colored indicator circle
                    const colorCircle = `<span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; background: ${colors.backgroundColor}; border: 1px solid ${colors.borderColor}"></span>`;
                    innerHtml += `<div style="display: flex; align-items: center; justify-content: flex-start;">${colorCircle}${body}</div>`;
                });

                tooltipEl.innerHTML = innerHtml;
            }

            const position = context.chart.canvas.getBoundingClientRect();

            // Display, position, and set styles
            tooltipEl.style.opacity = '1';
            tooltipEl.style.left = position.left + (window.pageXOffset || window.scrollX) + tooltipModel.caretX + 'px';
            tooltipEl.style.top = position.top + (window.pageYOffset || window.scrollY) + tooltipModel.caretY - 8 + 'px';
        };
    }

    function renderAllocationPieChart(categories) {
        const canvas = document.getElementById('allocation-pie-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const emptyState = document.getElementById('pie-empty-state');
        const legendContainer = document.getElementById('pie-legend-container');
        
        if (allocationPieChartInstance) {
            allocationPieChartInstance.destroy();
            allocationPieChartInstance = null;
        }

        // Calculate total value
        let total = 0;
        Object.keys(categories).forEach(k => {
            total += categories[k].val || 0;
        });

        if (total === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (legendContainer) legendContainer.innerHTML = '<div class="text-sm text-muted">Aggiungi titoli per vedere la ripartizione</div>';
            
            // Draw a flat gray circle as placeholder
            allocationPieChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Nessun dato'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                        borderColor: ['rgba(255, 255, 255, 0.1)'],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
            return;
        }
        
        if (emptyState) emptyState.classList.add('hidden');

        // Formulate sorted data list
        const categoriesList = [];
        Object.keys(categories).forEach(k => {
            const val = categories[k].val || 0;
            const pnl = categories[k].pnl || 0;
            if (val > 0.01) { // Ignore small rounding leftovers
                const pct = (val / total) * 100;
                const colors = getColorForType(k);
                categoriesList.push({
                    name: k,
                    val: val,
                    pnl: pnl,
                    pct: pct,
                    color: colors.text
                });
            }
        });

        // Sort descending by value
        categoriesList.sort((a, b) => b.val - a.val);

        // Prepare data for Chart.js
        const labels = categoriesList.map(c => c.name);
        const dataValues = categoriesList.map(c => c.val);
        const colors = categoriesList.map(c => c.color);

        allocationPieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataValues,
                    backgroundColor: colors,
                    borderColor: 'rgba(30, 41, 59, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        external: getHtmlTooltipHandler(),
                        callbacks: {
                            label: function(context) {
                                const val = context.parsed;
                                const pct = total > 0 ? (val / total) * 100 : 0;
                                return ` ${context.label}: € ${formatMoney(val)} (${pct.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });

        const formatInteger = (num) => {
            if (isPrivacyMode) return '*****';
            if (num === undefined || num === null) return "0";
            return Math.round(num).toLocaleString('it-IT', {
                maximumFractionDigits: 0
            });
        };

        const formatPnlText = (pnl) => {
            if (isPrivacyMode) {
                return `<span style="font-size: 0.72rem; color: var(--color-text-secondary); font-weight: 600;">(***** EUR)</span>`;
            }
            if (pnl === undefined || pnl === null || Math.round(pnl) === 0) return '';
            const rounded = Math.round(pnl);
            const sign = rounded >= 0 ? '+' : '';
            const color = rounded >= 0 ? '#10b981' : '#f43f5e';
            return `<span style="font-size: 0.72rem; color: ${color}; font-weight: 600;">(${sign}${formatInteger(rounded)} EUR)</span>`;
        };

        if (legendContainer) {
            legendContainer.innerHTML = '';
            categoriesList.forEach(c => {
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);';
                
                // Render "CASH" as "Cash" for nice naming in the legend
                const displayName = c.name === 'CASH' ? 'Cash' : c.name;
                
                itemDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">
                        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${c.color}; flex-shrink: 0;"></span>
                        <span style="font-size: 0.85rem; font-weight: 500;">${escapeHTML(displayName)}</span>
                    </div>
                    <div style="text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 6px; white-space: nowrap;">
                        <span style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-primary);">€ ${formatInteger(c.val)}</span>
                        ${formatPnlText(c.pnl)}
                        <span style="font-size: 0.76rem; color: ${c.color}; font-weight: 600;">${c.pct.toFixed(1)}%</span>
                    </div>
                `;
                legendContainer.appendChild(itemDiv);
            });
        }
    }

    function getEquityFraction(typeName, customTypologies, visited = new Set()) {
        if (!typeName) return 0;
        if (visited.has(typeName)) return 0; // Prevent infinite loops
        visited.add(typeName);

        const allTypologies = { ...globalCustomTypologies, ...(customTypologies || {}) };
        const lowerType = typeName.toLowerCase();
        if (lowerType === 'stocks') return 1.0;
        if (['bond', 'hard assets', 'cash', 'crypto'].includes(lowerType)) return 0.0;

        if (allTypologies && allTypologies[typeName]) {
            const ty = allTypologies[typeName];
            if (ty.type === 'mixed') {
                const alloc = ty.allocation || {};
                let totalAlloc = 0;
                Object.values(alloc).forEach(v => totalAlloc += v);
                if (totalAlloc <= 0) return 0;
                let eqFraction = 0;
                Object.keys(alloc).forEach(target => {
                    const pct = alloc[target] / totalAlloc;
                    eqFraction += pct * getEquityFraction(target, allTypologies, visited);
                });
                return eqFraction;
            } else {
                // Custom single category: check if the name suggests it's stocks/equity
                if (lowerType.includes('stock') || lowerType.includes('azion') || lowerType.includes('equit')) {
                    return 1.0;
                }
                return 0.0;
            }
        }

        if (typeName === 'Mixed (60/40)') return 0.60;
        if (typeName === 'Mixed (80/20)') return 0.80;

        // Default fallback checking name for stocks/equity
        if (lowerType.includes('stock') || lowerType.includes('azion') || lowerType.includes('equit')) {
            return 1.0;
        }
        return 0.0;
    }

    function getDeterministicColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const h = Math.abs(hash) % 360;
        const s = 70; // 70% saturation
        const l = 55; // 55% lightness for dark background readability
        return `hsl(${h}, ${s}%, ${l}%)`;
    }

    function renderEquityPieChart() {
        const canvas = document.getElementById('equity-pie-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const emptyState = document.getElementById('equity-pie-empty-state');
        const legendContainer = document.getElementById('equity-pie-legend-container');
        
        if (equityPieChartInstance) {
            equityPieChartInstance.destroy();
            equityPieChartInstance = null;
        }

        const activePort = getActivePortfolio();
        const customTypologies = getMergedTypologies(activePort);

        // 1. Aggregate equity components by ticker
        const aggregated = {};
        cachedResolvedHoldings.forEach(h => {
            const type = h.type || getDefaultAssetType(h.ticker, h.isin);
            const eqFraction = getEquityFraction(type, customTypologies);
            if (eqFraction > 0) {
                const curVal = h.currentValue || 0;
                const eqVal = curVal * eqFraction;
                const pnlVal = (h.pnl || 0) * eqFraction;
                if (eqVal > 0.01) {
                    const key = h.ticker.toUpperCase();
                    if (!aggregated[key]) {
                        aggregated[key] = {
                            ticker: h.ticker,
                            name: h.name || h.ticker,
                            val: 0,
                            pnl: 0
                        };
                    }
                    aggregated[key].val += eqVal;
                    aggregated[key].pnl += pnlVal;
                }
            }
        });

        const holdingsEquityList = Object.values(aggregated);
        
        // Calculate total equity value
        let totalEquity = 0;
        holdingsEquityList.forEach(c => {
            totalEquity += c.val;
        });

        if (totalEquity === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (legendContainer) legendContainer.innerHTML = '<div class="text-sm text-muted">Nessun prodotto azionario in portafoglio</div>';
            
            // Draw a flat gray circle as placeholder
            equityPieChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Nessun dato'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                        borderColor: ['rgba(255, 255, 255, 0.1)'],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '75%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        // Formulate percentages and colors
        holdingsEquityList.forEach(c => {
            c.pct = (c.val / totalEquity) * 100;
            c.color = getDeterministicColor(c.ticker);
        });

        // Sort descending by equity value
        holdingsEquityList.sort((a, b) => b.val - a.val);

        // Prepare data for Chart.js
        const labels = holdingsEquityList.map(c => `${c.ticker} - ${c.name}`);
        const dataValues = holdingsEquityList.map(c => c.val);
        const colors = holdingsEquityList.map(c => c.color);

        equityPieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataValues,
                    backgroundColor: colors,
                    borderColor: 'rgba(30, 41, 59, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        external: getHtmlTooltipHandler(),
                        callbacks: {
                            label: function(context) {
                                const val = context.parsed;
                                const pct = totalEquity > 0 ? (val / totalEquity) * 100 : 0;
                                return ` ${context.label}: € ${formatMoney(val)} (${pct.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });

        const formatInteger = (num) => {
            if (isPrivacyMode) return '*****';
            if (num === undefined || num === null) return "0";
            return Math.round(num).toLocaleString('it-IT', {
                maximumFractionDigits: 0
            });
        };

        const formatPnlText = (pnl) => {
            if (isPrivacyMode) {
                return `<span style="font-size: 0.72rem; color: var(--color-text-secondary); font-weight: 600;">(***** EUR)</span>`;
            }
            if (pnl === undefined || pnl === null || Math.round(pnl) === 0) return '';
            const rounded = Math.round(pnl);
            const sign = rounded >= 0 ? '+' : '';
            const color = rounded >= 0 ? '#10b981' : '#f43f5e';
            return `<span style="font-size: 0.72rem; color: ${color}; font-weight: 600;">(${sign}${formatInteger(rounded)} EUR)</span>`;
        };

        if (legendContainer) {
            legendContainer.innerHTML = '';
            holdingsEquityList.forEach(c => {
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);';
                
                itemDiv.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%;">
                        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${c.color}; flex-shrink: 0;"></span>
                        <span style="font-size: 0.85rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis;" title="${escapeHTML(c.name)}">${escapeHTML(c.ticker)}</span>
                    </div>
                    <div style="text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 6px; white-space: nowrap;">
                        <span style="font-size: 0.85rem; font-weight: 600; color: var(--color-text-primary);">€ ${formatInteger(c.val)}</span>
                        ${formatPnlText(c.pnl)}
                        <span style="font-size: 0.76rem; color: ${c.color}; font-weight: 600;">${c.pct.toFixed(1)}%</span>
                    </div>
                `;
                legendContainer.appendChild(itemDiv);
            });
        }
    }

    // --------------------------------------------------------------------------
    // 10.B AGGREGATE VIEW LOGIC & RENDERING
    // --------------------------------------------------------------------------
    const btnOpenAggregateView = document.getElementById('btn-open-aggregate-view');
    const btnAggregateText = document.getElementById('btn-aggregate-text');
    const btnExitAggregate = document.getElementById('btn-exit-aggregate');
    const btnAggregateHome = document.getElementById('btn-aggregate-home');
    const btnRefreshAggregate = document.getElementById('btn-refresh-aggregate');

    function updateAggregateButtonState() {
        if (!btnOpenAggregateView) return;
        const count = selectedAggregatePortfolioIds.size;
        if (count >= 2) {
            btnOpenAggregateView.disabled = false;
            btnOpenAggregateView.classList.remove('btn-secondary');
            btnOpenAggregateView.classList.add('btn-primary');
            if (btnAggregateText) btnAggregateText.innerText = `Vista Aggregata (${count})`;
            btnOpenAggregateView.title = `Visualizza l'aggregato dei ${count} portafogli selezionati`;
        } else {
            btnOpenAggregateView.disabled = true;
            btnOpenAggregateView.classList.remove('btn-primary');
            btnOpenAggregateView.classList.add('btn-secondary');
            if (btnAggregateText) btnAggregateText.innerText = 'Vista Aggregata';
            btnOpenAggregateView.title = 'Seleziona almeno 2 portafogli per abilitare la vista aggregata';
        }
    }

    if (btnOpenAggregateView) {
        btnOpenAggregateView.addEventListener('click', () => {
            if (selectedAggregatePortfolioIds.size >= 2) {
                showScreen('aggregate');
                loadAndRenderAggregateView(true);
            }
        });
    }

    if (btnExitAggregate) {
        btnExitAggregate.addEventListener('click', () => {
            showScreen('selector');
        });
    }

    if (btnAggregateHome) {
        btnAggregateHome.addEventListener('click', () => {
            showScreen('selector');
        });
    }

    if (btnRefreshAggregate) {
        btnRefreshAggregate.addEventListener('click', async () => {
            const refreshIcon = document.getElementById('refresh-icon-aggregate');
            if (refreshIcon) refreshIcon.classList.add('spinning');
            try {
                await loadAndRenderAggregateView(true);
            } finally {
                if (refreshIcon) refreshIcon.classList.remove('spinning');
            }
        });
    }

    function renderAggregatePieChart(data) {
        const canvas = document.getElementById('aggregate-allocation-pie-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const emptyState = document.getElementById('aggregate-pie-empty');

        if (aggregatePieChartInstance) {
            aggregatePieChartInstance.destroy();
            aggregatePieChartInstance = null;
        }

        if (!data || data.totalNetWorth === 0 || data.categoriesList.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            aggregatePieChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Nessun dato'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['rgba(255, 255, 255, 0.05)'],
                        borderColor: ['rgba(255, 255, 255, 0.1)'],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        const labels = data.categoriesList.map(c => c.name);
        const dataValues = data.categoriesList.map(c => c.val);
        const colors = data.categoriesList.map(c => c.color);

        aggregatePieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: dataValues,
                    backgroundColor: colors,
                    borderColor: 'rgba(30, 41, 59, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: false,
                        external: getHtmlTooltipHandler(),
                        callbacks: {
                            label: function(context) {
                                const val = context.parsed;
                                const pct = data.totalNetWorth > 0 ? (val / data.totalNetWorth) * 100 : 0;
                                if (isPrivacyMode) {
                                    return ` ${context.label}: € ***** (${pct.toFixed(1)}%)`;
                                }
                                return ` ${context.label}: € ${formatMoney(val)} (${pct.toFixed(1)}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderAggregateView(data) {
        if (!data) return;

        // 1. KPI Cards
        const netWorthEl = document.getElementById('aggregate-net-worth');
        const holdingsValEl = document.getElementById('aggregate-holdings-value');
        const cashEl = document.getElementById('aggregate-cash');
        const profitEl = document.getElementById('aggregate-total-profit');
        const countBadge = document.getElementById('aggregate-total-assets-count');

        if (netWorthEl) netWorthEl.innerText = isPrivacyMode ? '€ *****' : `€ ${formatMoney(data.totalNetWorth)}`;
        if (holdingsValEl) holdingsValEl.innerText = isPrivacyMode ? '€ *****' : `€ ${formatMoney(data.totalHoldingsValue)}`;
        if (cashEl) cashEl.innerText = isPrivacyMode ? '€ *****' : `€ ${formatMoney(data.totalCash)}`;
        
        if (profitEl) {
            if (isPrivacyMode) {
                profitEl.className = 'stat-value badge';
                profitEl.innerText = '€ *****';
            } else {
                const sign = data.totalPnl >= 0 ? '+' : '';
                const pnlClass = data.totalPnl >= 0 ? 'badge-success' : 'badge-danger';
                profitEl.className = `stat-value badge ${pnlClass}`;
                profitEl.innerText = `${sign}€ ${formatMoney(data.totalPnl)} (${sign}${data.totalPnlPercent.toFixed(2)}%)`;
            }
        }

        if (countBadge) {
            countBadge.innerText = `${data.resolvedHoldings.length} Titoli aggregati`;
        }

        // 2. Render Chart
        renderAggregatePieChart(data);

        // 3. Render Totals Table
        const legendBody = document.getElementById('aggregate-pie-legend-body');
        if (legendBody) {
            if (data.categoriesList.length === 0) {
                legendBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Nessuna posizione presente nei portafogli selezionati</td></tr>';
            } else {
                legendBody.innerHTML = data.categoriesList.map(c => {
                    const pnlSign = c.pnl >= 0 ? '+' : '';
                    const pnlClass = c.pnl >= 0 ? 'text-success' : 'text-danger';
                    const displayVal = isPrivacyMode ? '€ *****' : `€ ${formatMoney(c.val)}`;
                    const displayPct = isPrivacyMode ? '***' : `${c.pct.toFixed(1)}%`;
                    const displayPnl = isPrivacyMode ? '***' : (c.name === 'CASH' ? '<span class="text-muted">—</span>' : `<span class="${pnlClass}">${pnlSign}€ ${formatMoney(c.pnl)} (${pnlSign}${c.pnlPercent.toFixed(1)}%)</span>`);
                    
                    return `
                        <tr>
                            <td>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="width: 10px; height: 10px; border-radius: 50%; background-color: ${c.color}; display: inline-block; flex-shrink: 0;"></span>
                                    <span style="font-weight: 600; color: var(--color-text-primary);">${escapeHTML(c.name)}</span>
                                </div>
                            </td>
                            <td class="text-right font-medium">${displayVal}</td>
                            <td class="text-right font-semibold" style="color: var(--color-accent-primary);">${displayPct}</td>
                            <td class="text-right">${displayPnl}</td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 4. Render Portfolio Contribution Breakdown
        const distContainer = document.getElementById('aggregate-portfolios-distribution');
        if (distContainer) {
            distContainer.innerHTML = data.portfoliosContribution.map(item => {
                const displayVal = isPrivacyMode ? '€ *****' : `€ ${formatMoney(item.totalVal)}`;
                const displayPct = isPrivacyMode ? '***' : `${item.pct.toFixed(1)}%`;
                return `
                    <div class="aggregate-port-item">
                        <div style="display: flex; justify-content: space-between; align-items: baseline;">
                            <h5>${escapeHTML(item.name)}</h5>
                            <span class="port-pct">${displayPct}</span>
                        </div>
                        <div class="port-val">${displayVal}</div>
                        <div class="port-pct-bar-bg">
                            <div class="port-pct-bar-fill" style="width: ${Math.min(100, Math.max(0, item.pct))}%;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        lucide.createIcons();
    }

    async function loadAndRenderAggregateView(forceRefresh = false) {
        if (selectedAggregatePortfolioIds.size < 2) {
            showScreen('selector');
            return;
        }

        const selectedPorts = Array.from(selectedAggregatePortfolioIds)
            .map(id => state.portfolios[id])
            .filter(Boolean);

        if (selectedPorts.length < 2) {
            showScreen('selector');
            return;
        }

        // Populate header badges
        const badgesContainer = document.getElementById('aggregate-portfolios-badges');
        if (badgesContainer) {
            badgesContainer.innerHTML = selectedPorts.map(p => 
                `<span class="aggregate-badge"><i data-lucide="folder" style="width:12px;height:12px;"></i> ${escapeHTML(p.name)}</span>`
            ).join('');
            lucide.createIcons();
        }

        const loadingEl = document.getElementById('aggregate-loading');
        const contentEl = document.getElementById('aggregate-content');

        if (loadingEl) loadingEl.classList.remove('hidden');
        if (contentEl) contentEl.classList.add('hidden');

        try {
            await updateExchangeRate();

            let allHoldingsToResolve = [];
            selectedPorts.forEach(port => {
                const portCustomTypologies = getMergedTypologies(port);
                (port.holdings || []).forEach(h => {
                    allHoldingsToResolve.push({
                        ...h,
                        portfolioId: port.id,
                        portfolioName: port.name,
                        portCustomTypologies: portCustomTypologies
                    });
                });
            });

            const totalCash = selectedPorts.reduce((acc, p) => acc + (Number(p.cash) || 0), 0);
            
            let resolvedHoldings = [];
            if (allHoldingsToResolve.length > 0) {
                const rawResolved = await resolveHoldingsPrices(allHoldingsToResolve);
                resolvedHoldings = rawResolved.map((res, index) => {
                    const orig = allHoldingsToResolve[index] || {};
                    return {
                        ...res,
                        portfolioId: res.portfolioId || orig.portfolioId,
                        portfolioName: res.portfolioName || orig.portfolioName,
                        portCustomTypologies: res.portCustomTypologies || orig.portCustomTypologies
                    };
                });
            }

            let totalInvestedCost = 0;
            let totalHoldingsValue = 0;
            resolvedHoldings.forEach(h => {
                totalInvestedCost += h.buyCost || 0;
                totalHoldingsValue += h.currentValue || 0;
            });

            const totalNetWorth = totalCash + totalHoldingsValue;
            const totalPnl = totalHoldingsValue - totalInvestedCost;
            const totalPnlPercent = totalInvestedCost > 0 ? (totalPnl / totalInvestedCost) * 100 : 0;

            // Categories aggregation
            const categories = {
                'Stocks': { val: 0, pnl: 0, cost: 0 },
                'Bond': { val: 0, pnl: 0, cost: 0 },
                'Hard assets': { val: 0, pnl: 0, cost: 0 },
                'CASH': { val: 0, pnl: 0, cost: 0 },
                'Crypto': { val: 0, pnl: 0, cost: 0 }
            };

            resolvedHoldings.forEach(h => {
                const type = h.type || getDefaultAssetType(h.ticker, h.isin);
                const curVal = h.currentValue || 0;
                const pnlVal = h.pnl || 0;
                const costVal = h.buyCost || 0;
                const customTypologies = { ...globalCustomTypologies, ...(h.portCustomTypologies || {}) };

                if (customTypologies[type]) {
                    const ty = customTypologies[type];
                    if (ty.type === 'mixed') {
                        const alloc = ty.allocation || {};
                        let totalAllocPct = 0;
                        Object.keys(alloc).forEach(target => {
                            totalAllocPct += alloc[target] || 0;
                        });
                        if (totalAllocPct > 0) {
                            Object.keys(alloc).forEach(target => {
                                const pct = (alloc[target] || 0) / totalAllocPct;
                                if (!categories[target]) {
                                    categories[target] = { val: 0, pnl: 0, cost: 0 };
                                }
                                categories[target].val += curVal * pct;
                                categories[target].pnl += pnlVal * pct;
                                categories[target].cost += costVal * pct;
                            });
                        } else {
                            categories['CASH'].val += curVal;
                            categories['CASH'].pnl += pnlVal;
                            categories['CASH'].cost += costVal;
                        }
                    } else {
                        if (!categories[type]) {
                            categories[type] = { val: 0, pnl: 0, cost: 0 };
                        }
                        categories[type].val += curVal;
                        categories[type].pnl += pnlVal;
                        categories[type].cost += costVal;
                    }
                } else if (type === 'Mixed (60/40)') {
                    categories['Stocks'].val += curVal * 0.60;
                    categories['Stocks'].pnl += pnlVal * 0.60;
                    categories['Stocks'].cost += costVal * 0.60;
                    categories['Bond'].val += curVal * 0.40;
                    categories['Bond'].pnl += pnlVal * 0.40;
                    categories['Bond'].cost += costVal * 0.40;
                } else if (type === 'Mixed (80/20)') {
                    categories['Stocks'].val += curVal * 0.80;
                    categories['Stocks'].pnl += pnlVal * 0.80;
                    categories['Stocks'].cost += costVal * 0.80;
                    categories['Bond'].val += curVal * 0.20;
                    categories['Bond'].pnl += pnlVal * 0.20;
                    categories['Bond'].cost += costVal * 0.20;
                } else {
                    const targetKey = categories[type] ? type : 'CASH';
                    categories[targetKey].val += curVal;
                    categories[targetKey].pnl += pnlVal;
                    categories[targetKey].cost += costVal;
                }
            });

            // Add total cash to CASH category
            categories['CASH'].val += totalCash;
            categories['CASH'].cost += totalCash;

            // Formulate sorted categories list
            const categoriesList = [];
            Object.keys(categories).forEach(k => {
                const val = categories[k].val || 0;
                const cost = categories[k].cost || 0;
                const pnl = categories[k].pnl || 0;
                if (val > 0.01 || cost > 0.01) {
                    const pct = totalNetWorth > 0 ? (val / totalNetWorth) * 100 : 0;
                    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                    const colors = getColorForType(k);
                    categoriesList.push({
                        name: k,
                        val: val,
                        cost: cost,
                        pnl: pnl,
                        pnlPercent: pnlPct,
                        pct: pct,
                        color: colors.text
                    });
                }
            });
            categoriesList.sort((a, b) => b.val - a.val);

            // Individual portfolio contribution
            const portfoliosContribution = selectedPorts.map(p => {
                const pCash = Number(p.cash) || 0;
                let pVal = pCash;
                resolvedHoldings.forEach(h => {
                    if (String(h.portfolioId) === String(p.id)) {
                        pVal += h.currentValue || 0;
                    }
                });
                const pct = totalNetWorth > 0 ? (pVal / totalNetWorth) * 100 : 0;
                return {
                    id: p.id,
                    name: p.name,
                    totalVal: pVal,
                    pct: pct
                };
            });
            portfoliosContribution.sort((a, b) => b.totalVal - a.totalVal);

            cachedAggregateData = {
                selectedPorts,
                resolvedHoldings,
                totalCash,
                totalInvestedCost,
                totalHoldingsValue,
                totalNetWorth,
                totalPnl,
                totalPnlPercent,
                categoriesList,
                portfoliosContribution
            };

            renderAggregateView(cachedAggregateData);

        } catch (err) {
            console.error("Error generating aggregate view:", err);
            alert("Errore durante il consolidamento dei portafogli.");
        } finally {
            if (loadingEl) loadingEl.classList.add('hidden');
            if (contentEl) contentEl.classList.remove('hidden');
            lucide.createIcons();
        }
    }

    // --------------------------------------------------------------------------
    // 11. SECTION 2: NET WORTH HISTORICAL PATRIMONIO
    // --------------------------------------------------------------------------
    const csvFileInput = document.getElementById('csv-file-input');
    const csvDropZone = document.getElementById('csv-drop-zone');
    const btnDemoCsv = document.getElementById('btn-demo-csv');
    const btnDownloadTemplate = document.getElementById('btn-download-template');
    const csvLoadedInfo = document.getElementById('csv-loaded-info');
    const csvPointCount = document.getElementById('csv-point-count');
    const csvDateRange = document.getElementById('csv-date-range');
    const btnClearCsv = document.getElementById('btn-clear-csv');

    ['dragenter', 'dragover'].forEach(eventName => {
        csvDropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            csvDropZone.classList.add('drag-over');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        csvDropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            csvDropZone.classList.remove('drag-over');
        }, false);
    });

    csvDropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            handleManualCsvFile(files[0]);
        }
    });

    csvFileInput.addEventListener('change', (e) => {
        if (csvFileInput.files.length) {
            handleManualCsvFile(csvFileInput.files[0]);
        }
    });

    btnClearCsv.addEventListener('click', async () => {
        const port = getActivePortfolio();
        if (port && confirm("Sei sicuro di voler eliminare tutta la cronologia storica del patrimonio?")) {
            port.patrimonioCsvData = [];
            await savePatrimonioCsvContent("");
            saveState();
            renderNetWorthChart();
        }
    });

    function handleManualCsvFile(file) {
        const reader = new FileReader();
        reader.onload = async function(e) {
            const text = e.target.result;
            try {
                const parsedData = parseBrokerCsv(text);
                const port = getActivePortfolio();
                port.patrimonioCsvData = parsedData;
                
                await savePatrimonioCsvContent(text); // Save physically to subfolder
                saveState();
                renderNetWorthChart();
            } catch (err) {
                console.error("Manual CSV Parse Error:", err);
                alert("Errore nel parsing del file CSV: " + err.message);
            }
        };
        reader.readAsText(file);
    }

    btnDemoCsv.addEventListener('click', async () => {
        const port = getActivePortfolio();
        if (!port) return;

        const demoData = [];
        const baseWorth = port.cash + calculateStaticHoldingsCost(port);
        const days = 60;
        
        let currentWorth = baseWorth * 0.85;
        const now = new Date();
        
        let csvContent = "Date;Liquidità;Finanziamento long;Garanzia short;Portafoglio;Patrimonio;Note\n";
        for (let i = days; i >= 0; i--) {
            const d = new Date();
            d.setDate(now.getDate() - i);
            
            const change = (Math.random() - 0.44) * 0.015; 
            currentWorth = +(currentWorth * (1 + change)).toFixed(2);
            
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');

            const dateIso = `${yyyy}-${mm}-${dd}`;
            const dateStr = `${parseInt(mm)}/${parseInt(dd)}/${yyyy.toString().substr(2)}`;
            const valStr = currentWorth.toFixed(2).replace('.', ',');

            demoData.push({ date: dateIso, value: currentWorth });
            csvContent += `${dateStr};0;0;0;0;${valStr};\n`;
        }

        port.patrimonioCsvData = demoData;
        await savePatrimonioCsvContent(csvContent);
        saveState();
        renderNetWorthChart();
    });

    btnDownloadTemplate.addEventListener('click', (e) => {
        e.preventDefault();
        const csvContent = "Date;Liquidità;Finanziamento long;Garanzia short;Portafoglio;Patrimonio;Note\n8/17/23;10000;0;0;0;10000;\n9/4/23;500;0;0;9500;10000;\n10/12/23;400;0;0;10200;10600;\n11/24/23;1200;0;0;9800;11000;\n12/22/23;1500;0;0;10500;12000;\n1/10/24;800;0;0;11800;12600;\n2/19/24;50;0;0;13100;13150;";
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "patrimonio_template.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    let currentPatrimonioFilter = { type: 'MAX', start: null, end: null };

    function formatDateFull(dateStr) {
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function formatDateIso(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getFilteredPatrimonioData(allData, filter) {
        if (!allData || allData.length === 0) return [];
        
        let startDate = null;
        let endDate = null;
        
        const latestPoint = allData[allData.length - 1];
        const latestDate = new Date(latestPoint.date);
        
        if (filter.type === 'MAX') {
            return allData;
        } else if (filter.type === 'YTD') {
            const latestYear = latestDate.getFullYear();
            startDate = new Date(`${latestYear}-01-01`);
            endDate = latestDate;
        } else if (filter.type === '1Y') {
            startDate = new Date(latestDate);
            startDate.setFullYear(latestDate.getFullYear() - 1);
            endDate = latestDate;
        } else if (filter.type === 'CUSTOM') {
            if (filter.start) startDate = new Date(filter.start);
            if (filter.end) endDate = new Date(filter.end);
        }
        
        return allData.filter(d => {
            if (startDate) {
                const startStr = formatDateIso(startDate);
                if (d.date < startStr) return false;
            }
            if (endDate) {
                const endStr = formatDateIso(endDate);
                if (d.date > endStr) return false;
            }
            return true;
        });
    }

    function updatePeriodButtonsUI(activeType) {
        const btnYtd = document.getElementById('btn-period-ytd');
        const btn1y = document.getElementById('btn-period-1y');
        const btnMax = document.getElementById('btn-period-max');
        
        if (!btnYtd || !btn1y || !btnMax) return;
        
        btnYtd.className = 'btn btn-tiny ' + (activeType === 'YTD' ? 'btn-primary' : 'btn-secondary');
        btn1y.className = 'btn btn-tiny ' + (activeType === '1Y' ? 'btn-primary' : 'btn-secondary');
        btnMax.className = 'btn btn-tiny ' + (activeType === 'MAX' ? 'btn-primary' : 'btn-secondary');
    }

    // Wire up range buttons and calendar inputs
    document.addEventListener('DOMContentLoaded', () => {
        // Since we are already inside DOMContentLoaded, we can query and add listeners immediately
    });
    
    // Wire up listeners immediately in the outer block since app.js runs on DOMContentLoaded
    const initRangeListeners = () => {
        const btnYtd = document.getElementById('btn-period-ytd');
        const btn1y = document.getElementById('btn-period-1y');
        const btnMax = document.getElementById('btn-period-max');
        const dateStartInput = document.getElementById('input-date-start');
        const dateEndInput = document.getElementById('input-date-end');

        if (btnYtd) {
            btnYtd.addEventListener('click', () => {
                currentPatrimonioFilter = { type: 'YTD', start: null, end: null };
                updatePeriodButtonsUI('YTD');
                renderNetWorthChart();
            });
        }

        if (btn1y) {
            btn1y.addEventListener('click', () => {
                currentPatrimonioFilter = { type: '1Y', start: null, end: null };
                updatePeriodButtonsUI('1Y');
                renderNetWorthChart();
            });
        }

        if (btnMax) {
            btnMax.addEventListener('click', () => {
                currentPatrimonioFilter = { type: 'MAX', start: null, end: null };
                updatePeriodButtonsUI('MAX');
                renderNetWorthChart();
            });
        }

        function handleCustomDateChange() {
            if (dateStartInput && dateEndInput) {
                currentPatrimonioFilter = {
                    type: 'CUSTOM',
                    start: dateStartInput.value || null,
                    end: dateEndInput.value || null
                };
                updatePeriodButtonsUI('CUSTOM');
                renderNetWorthChart();
            }
        }

        if (dateStartInput) dateStartInput.addEventListener('change', handleCustomDateChange);
        if (dateEndInput) dateEndInput.addEventListener('change', handleCustomDateChange);

        // Toggle Net Worth Chart Fullscreen
        const btnFullscreen = document.getElementById('btn-chart-fullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', () => {
                const chartCard = btnFullscreen.closest('.card');
                chartCard.classList.toggle('chart-fullscreen');
                
                const isFullscreen = chartCard.classList.contains('chart-fullscreen');
                btnFullscreen.innerHTML = isFullscreen ? '<i data-lucide="minimize" style="width: 16px; height: 16px;"></i>' : '<i data-lucide="maximize" style="width: 16px; height: 16px;"></i>';
                btnFullscreen.title = isFullscreen ? "Esci da Schermo Intero" : "Schermo Intero";
                lucide.createIcons();
                
                setTimeout(() => {
                    if (netWorthChartInstance) {
                        netWorthChartInstance.resize();
                        netWorthChartInstance.update();
                    }
                }, 100);
            });
        }

        // Toggle Collapsible CSV Import Card
        const btnToggleCsv = document.getElementById('btn-toggle-csv-card');
        const csvContent = document.getElementById('csv-card-content');
        const csvCard = document.getElementById('csv-import-card');
        if (btnToggleCsv && csvContent && csvCard) {
            btnToggleCsv.addEventListener('click', () => {
                csvContent.classList.toggle('hidden');
                csvCard.classList.toggle('expanded');
                lucide.createIcons();
            });
        }
    };
    
    // Initialize immediately
    setTimeout(initRangeListeners, 50);

    function calculatePeriodTWRR(filteredData, depositsMap) {
        if (filteredData.length < 2) return 0;
        
        let twrrFactor = 1;
        let vPrev = filteredData[0].value;
        
        for (let i = 1; i < filteredData.length; i++) {
            const pt = filteredData[i];
            const cf = depositsMap[pt.date] || 0;
            
            if (cf !== 0) {
                const vBefore = pt.value - cf;
                if (vPrev > 0) {
                    const r = (vBefore - vPrev) / vPrev;
                    twrrFactor *= (1 + r);
                }
                vPrev = pt.value;
            }
        }
        
        const lastPt = filteredData[filteredData.length - 1];
        if (vPrev > 0) {
            const r = (lastPt.value - vPrev) / vPrev;
            twrrFactor *= (1 + r);
        }
        
        return twrrFactor - 1;
    }

    function calculatePeriodMWRR(startVal, endVal, Y_start, periodCFs, t_end) {
        if (startVal <= 0 && endVal <= 0) return 0;
        
        const cfs = periodCFs.map(cf => {
            const t_i = new Date(cf.dateStr);
            const Y_i = (t_end - t_i) / (1000 * 60 * 60 * 24 * 365);
            return { val: cf.value, Y_i: Y_i };
        });
        
        // NPV function: f(r)
        const f = (r) => {
            let val = startVal * Math.pow(1 + r, Y_start) - endVal;
            cfs.forEach(cf => {
                val += cf.val * Math.pow(1 + r, cf.Y_i);
            });
            return val;
        };
        
        // Derivative: f'(r)
        const df = (r) => {
            let val = Y_start * startVal * Math.pow(1 + r, Y_start - 1);
            cfs.forEach(cf => {
                val += cf.Y_i * cf.val * Math.pow(1 + r, cf.Y_i - 1);
            });
            return val;
        };
        
        // Newton-Raphson loop
        let r = 0.1; // initial guess: 10%
        for (let iter = 0; iter < 100; iter++) {
            const fr = f(r);
            const dfr = df(r);
            if (Math.abs(dfr) < 1e-12) break;
            const nextR = r - fr / dfr;
            if (isNaN(nextR) || !isFinite(nextR)) break;
            if (Math.abs(nextR - r) < 1e-6) {
                r = nextR;
                break;
            }
            r = nextR;
            if (r < -0.9999) r = -0.9999;
        }
        return r;
    }

    function renderNetWorthChart() {
        const port = getActivePortfolio();
        const chartStatsSummary = document.getElementById('chart-stats-summary');
        
        if (!port || !port.patrimonioCsvData || port.patrimonioCsvData.length === 0) {
            csvLoadedInfo.classList.add('hidden');
            chartStatsSummary.innerHTML = '';
            drawChart([], []);
            return;
        }

        csvLoadedInfo.classList.remove('hidden');
        csvPointCount.innerText = port.patrimonioCsvData.length;
        
        const firstPoint = port.patrimonioCsvData[0];
        const lastPoint = port.patrimonioCsvData[port.patrimonioCsvData.length - 1];
        
        // Setup Date inputs bounds
        const dateStartInput = document.getElementById('input-date-start');
        const dateEndInput = document.getElementById('input-date-end');
        if (dateStartInput && dateEndInput) {
            dateStartInput.min = firstPoint.date;
            dateStartInput.max = lastPoint.date;
            dateEndInput.min = firstPoint.date;
            dateEndInput.max = lastPoint.date;
        }

        // Get filtered data
        const filteredData = getFilteredPatrimonioData(port.patrimonioCsvData, currentPatrimonioFilter);
        
        if (filteredData.length === 0) {
            chartStatsSummary.innerHTML = `<div class="text-sm text-muted">Nessun dato nel periodo selezionato</div>`;
            drawChart([], []);
            return;
        }

        const firstFiltered = filteredData[0];
        const lastFiltered = filteredData[filteredData.length - 1];
        
        // Update input values to reflect bounds
        if (dateStartInput && dateEndInput) {
            dateStartInput.value = firstFiltered.date;
            dateEndInput.value = lastFiltered.date;
        }

        const d1 = formatDateShort(firstFiltered.date);
        const d2 = formatDateShort(lastFiltered.date);
        csvDateRange.innerText = `${formatDateShort(firstPoint.date)} - ${formatDateShort(lastPoint.date)}`;

        const totalGrowth = lastFiltered.value - firstFiltered.value;
        const growthPct = firstFiltered.value > 0 ? (totalGrowth / firstFiltered.value) * 100 : 0;
        const growthColor = totalGrowth >= 0 ? 'text-success' : 'text-danger';
        const growthSign = totalGrowth >= 0 ? '+' : '';

        let filterLabel = 'MAX';
        if (currentPatrimonioFilter.type === 'YTD') filterLabel = 'YTD';
        else if (currentPatrimonioFilter.type === '1Y') filterLabel = '1 Anno';
        else if (currentPatrimonioFilter.type === 'CUSTOM') filterLabel = 'Sottoperiodo';

        const totalDeposited = port.patrimonioCsvData.totalDeposited || 0;
        
        const firstIndex = port.patrimonioCsvData.findIndex(d => d.date === firstFiltered.date);
        const hasBasePoint = firstIndex > 0;
        const basePoint = hasBasePoint ? port.patrimonioCsvData[firstIndex - 1] : null;
        
        const startVal = hasBasePoint ? basePoint.value : firstFiltered.value;
        const startStr = hasBasePoint ? basePoint.date : firstFiltered.date;
        const endStr = lastFiltered.date;
        
        // Calculate deposits inside the selected subperiod
        let periodDeposited = 0;
        const depositsMap = port.patrimonioCsvData.deposits || {};
        for (const depDateStr in depositsMap) {
            if (depDateStr >= firstFiltered.date && depDateStr <= endStr) {
                periodDeposited += depositsMap[depDateStr];
            }
        }
        
        const totalBollo = port.patrimonioCsvData.totalBollo || 0;
        
        // Calculate TWRR and MWRR/IRR for the selected period
        const t_start = new Date(startStr);
        const t_end = new Date(endStr);
        const diffTime = Math.abs(t_end - t_start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const Y_start = diffDays / 365;
        
        // Collect sub-period cash flows (strictly after start date of the calculation)
        const periodCFs = [];
        for (const dateStr in depositsMap) {
            if (dateStr > startStr && dateStr <= endStr) {
                periodCFs.push({
                    dateStr: dateStr,
                    value: depositsMap[dateStr]
                });
            }
        }
        periodCFs.sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));
        
        // Calculate TWRR
        const calcDataForTWRR = hasBasePoint ? [basePoint, ...filteredData] : filteredData;
        const twrrTotal = calculatePeriodTWRR(calcDataForTWRR, depositsMap);
        let twrrAnnualized = 0;
        if (twrrTotal > -1) {
            twrrAnnualized = diffDays > 30 ? Math.pow(1 + twrrTotal, 365 / diffDays) - 1 : twrrTotal;
        } else {
            twrrAnnualized = -1;
        }
        
        // Calculate MWRR/IRR
        const mwrrAnnualized = calculatePeriodMWRR(startVal, lastFiltered.value, Y_start, periodCFs, t_end);
        let mwrrDisplayVal = mwrrAnnualized;
        if (diffDays <= 30) {
            const totalCF = periodCFs.reduce((acc, curr) => acc + curr.value, 0);
            const netInvested = startVal + totalCF;
            mwrrDisplayVal = netInvested > 0 ? (lastFiltered.value - netInvested) / netInvested : 0;
        }
        
        const twrrColor = twrrAnnualized >= 0 ? 'text-success' : 'text-danger';
        const twrrSign = twrrAnnualized >= 0 ? '+' : '';
        const mwrrColor = mwrrDisplayVal >= 0 ? 'text-success' : 'text-danger';
        const mwrrSign = mwrrDisplayVal >= 0 ? '+' : '';
        
        const yieldOnDeposited = lastPoint.value - totalDeposited;
        const yieldOnDepositedPct = totalDeposited > 0 ? (yieldOnDeposited / totalDeposited) * 100 : 0;
        const yieldColor = yieldOnDeposited >= 0 ? 'text-success' : 'text-danger';
        const yieldSign = yieldOnDeposited >= 0 ? '+' : '';

        const displayGrowthPct = isPrivacyMode ? '***' : growthPct.toFixed(1);
        const displayGrowthSign = isPrivacyMode ? '' : growthSign;
        const displayTwrrPct = isPrivacyMode ? '***' : (twrrAnnualized * 100).toFixed(1);
        const displayTwrrSign = isPrivacyMode ? '' : twrrSign;
        const displayMwrrPct = isPrivacyMode ? '***' : (mwrrDisplayVal * 100).toFixed(1);
        const displayMwrrSign = isPrivacyMode ? '' : mwrrSign;
        const displayYieldPct = isPrivacyMode ? '***' : yieldOnDepositedPct.toFixed(1);
        const displayYieldSign = isPrivacyMode ? '' : yieldSign;

        // Display Current Value, Yield, TWRR, MWRR, Total Deposited, Period Deposited, Total Bollo of active period
        chartStatsSummary.innerHTML = `
            <!-- Row 1 -->
            <div class="chart-stats-row">
                <div class="chart-stat-box">
                    <span class="stat-label">Patrimonio Attuale (${formatDateShort(lastPoint.date)})</span>
                    <span class="chart-stat-val">€ ${formatMoney(lastPoint.value)}</span>
                </div>
                <div class="chart-stat-box">
                    <span class="stat-label">Totale Versato</span>
                    <span class="chart-stat-val text-accent">€ ${formatMoney(totalDeposited)}</span>
                </div>
                <div class="chart-stat-box">
                    <span class="stat-label">Totale Bollo Pagato</span>
                    <span class="chart-stat-val" style="color: #ff9f40;">€ ${formatMoney(totalBollo)}</span>
                </div>
                <div class="chart-stat-box">
                    <span class="stat-label">Rendimento Periodo (${filterLabel})</span>
                    <span class="chart-stat-val ${growthColor}">${displayGrowthSign}€ ${formatMoney(totalGrowth)} (${displayGrowthSign}${displayGrowthPct}%)</span>
                </div>
                <div class="chart-stat-box">
                    <span class="stat-label">TWRR (${diffDays > 30 ? 'Ann.' : 'Semp.'})</span>
                    <span class="chart-stat-val ${twrrColor}">${displayTwrrSign}${displayTwrrPct}%</span>
                </div>
                <div class="chart-stat-box">
                    <span class="stat-label">MWRR/IRR (${diffDays > 30 ? 'Ann.' : 'Semp.'})</span>
                    <span class="chart-stat-val ${mwrrColor}">${displayMwrrSign}${displayMwrrPct}%</span>
                </div>
            </div>
            
            <!-- Row 2 -->
            <div class="chart-stats-row">
                <div class="chart-stat-box">
                    <span class="stat-label">Versato Periodo (${filterLabel})</span>
                    <span class="chart-stat-val text-accent">€ ${formatMoney(periodDeposited)}</span>
                </div>
                <div class="chart-stat-box">
                    <span class="stat-label">Rendimento su Versato</span>
                    <span class="chart-stat-val ${yieldColor}">${displayYieldSign}€ ${formatMoney(yieldOnDeposited)} (${displayYieldSign}${displayYieldPct}%)</span>
                </div>
            </div>
        `;

        const labels = filteredData.map(d => formatDateFull(d.date));
        const dataValues = filteredData.map(d => d.value);

        drawChart(labels, dataValues, filteredData);
    }

    function drawChart(labels, data, filteredData) {
        const ctx = document.getElementById('net-worth-chart').getContext('2d');
        
        if (netWorthChartInstance) {
            netWorthChartInstance.destroy();
        }

        if (labels.length === 0) {
            netWorthChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu'],
                    datasets: [{
                        label: 'Nessun dato caricato',
                        data: [1000, 1000, 1000, 1000, 1000, 1000],
                        borderColor: 'rgba(107, 114, 128, 0.4)',
                        borderDash: [5, 5],
                        borderWidth: 1.5,
                        fill: false
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    },
                    scales: {
                        y: { display: false },
                        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: 'rgba(255,255,255,0.2)' } }
                    }
                }
            });
            return;
        }

        // Calculate visible tick indices to prevent overlapping labels
        const labelsCount = labels.length;
        const transitionIndices = [];
        const visibleIndices = new Set();

        // 1. Find all year transition indices
        for (let i = 0; i < labelsCount; i++) {
            const parts = labels[i].split('/');
            if (parts.length === 3) {
                const year = parts[2];
                if (i === 0) {
                    transitionIndices.push(i);
                } else {
                    const prevParts = labels[i - 1].split('/');
                    if (prevParts.length === 3 && prevParts[2] !== year) {
                        transitionIndices.push(i);
                    }
                }
            }
        }

        // 2. Filter year transitions to ensure they are spaced out
        const minDistance = Math.max(15, Math.floor(labelsCount * 0.05));
        let lastAddedTransition = -999;
        transitionIndices.forEach(tIdx => {
            if (tIdx - lastAddedTransition >= minDistance) {
                visibleIndices.add(tIdx);
                lastAddedTransition = tIdx;
            }
        });

        // 3. Add regular ticks at a step, avoiding indices near transitions
        const step = Math.max(30, Math.floor(labelsCount / 6));
        for (let i = 0; i < labelsCount; i += step) {
            let tooClose = false;
            for (const vIdx of visibleIndices) {
                if (Math.abs(i - vIdx) < minDistance) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) {
                visibleIndices.add(i);
            }
        }

        const strokeColor = '#10b981';
        const fillGradient = ctx.createLinearGradient(0, 0, 0, 350);
        fillGradient.addColorStop(0, 'rgba(16, 185, 129, 0.24)');
        fillGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

        netWorthChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Patrimonio (€)',
                    data: data,
                    borderColor: strokeColor,
                    borderWidth: 2.5,
                    pointBackgroundColor: '#10b981',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    pointHoverBackgroundColor: '#10b981',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 1.5,
                    fill: true,
                    backgroundColor: fillGradient,
                    tension: 0.2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        titleColor: '#ffffff',
                        bodyColor: '#e2e8f0',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            title: function(context) {
                                return `Data: ${context[0].label}`;
                            },
                            label: function(context) {
                                return `Patrimonio: € ${formatMoney(context.parsed.y)}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: '#9ca3af',
                            font: { family: 'Inter', size: 9 },
                            callback: function(val) {
                                return '€ ' + formatMoney(val);
                            }
                        }
                    },
                    x: {
                        grid: {
                            color: function(context) {
                                if (!context.tick) return 'rgba(255,255,255,0.0)';
                                const tickVal = context.tick.value;
                                if (!visibleIndices.has(tickVal)) return 'rgba(255,255,255,0.0)';
                                
                                const label = labels[tickVal];
                                if (!label) return 'rgba(255,255,255,0.0)';
                                
                                const parts = label.split('/');
                                if (parts.length === 3) {
                                    if (tickVal === 0) return 'rgba(255, 255, 255, 0.35)';
                                    const prevLabel = labels[tickVal - 1];
                                    if (prevLabel) {
                                        const prevParts = prevLabel.split('/');
                                        if (prevParts.length === 3 && prevParts[2] !== parts[2]) {
                                            return 'rgba(255, 255, 255, 0.35)';
                                        }
                                    }
                                }
                                return 'rgba(255, 255, 255, 0.05)';
                            },
                            lineWidth: function(context) {
                                if (!context.tick) return 1;
                                const tickVal = context.tick.value;
                                if (!visibleIndices.has(tickVal)) return 0;
                                
                                const label = labels[tickVal];
                                if (!label) return 1;
                                
                                const parts = label.split('/');
                                if (parts.length === 3) {
                                    if (tickVal === 0) return 2;
                                    const prevLabel = labels[tickVal - 1];
                                    if (prevLabel) {
                                        const prevParts = prevLabel.split('/');
                                        if (prevParts.length === 3 && prevParts[2] !== parts[2]) {
                                            return 2;
                                        }
                                    }
                                }
                                return 1;
                            },
                            drawOnChartArea: true,
                            drawTicks: true
                        },
                        ticks: {
                            color: '#9ca3af',
                            font: { family: 'Inter', size: 9 },
                            maxRotation: 0,
                            autoSkip: false,
                            callback: function(val, index) {
                                if (!visibleIndices.has(val)) return '';
                                const label = labels[val];
                                if (!label) return '';
                                const parts = label.split('/');
                                if (parts.length !== 3) return label;
                                
                                const day = parts[0];
                                const month = parts[1];
                                const year = parts[2];
                                
                                let isTransition = false;
                                if (val === 0) {
                                    isTransition = true;
                                } else {
                                    const prevLabel = labels[val - 1];
                                    if (prevLabel) {
                                        const prevParts = prevLabel.split('/');
                                        if (prevParts.length === 3 && prevParts[2] !== year) {
                                            isTransition = true;
                                        }
                                    }
                                }

                                if (isTransition) {
                                    return [`${day}/${month}`, year];
                                } else {
                                    return [`${day}/${month}`, ''];
                                }
                            }
                        }
                    }
                }
            },
            plugins: [
                {
                    id: 'depositLines',
                    afterDraw: (chart) => {
                        const activePort = getActivePortfolio();
                        if (!activePort || !activePort.patrimonioCsvData || !activePort.patrimonioCsvData.deposits) return;
                        
                        const depositsMap = activePort.patrimonioCsvData.deposits;
                        const ctx = chart.ctx;
                        const meta = chart.getDatasetMeta(0);
                        
                        // Calculate monthly cumulative deposits and identify the day with the largest deposit
                        const monthlyDeposits = {}; // Key: "YYYY-MM", Value: { total: 0, maxVal: -1, maxDate: null }
                        for (const dateStr in depositsMap) {
                            const val = depositsMap[dateStr];
                            if (val > 0) { // Only deposits are accumulated
                                const month = dateStr.substring(0, 7); // "YYYY-MM"
                                if (!monthlyDeposits[month]) {
                                    monthlyDeposits[month] = {
                                        total: 0,
                                        maxVal: -1,
                                        maxDate: null
                                    };
                                }
                                monthlyDeposits[month].total += val;
                                if (val > monthlyDeposits[month].maxVal) {
                                    monthlyDeposits[month].maxVal = val;
                                    monthlyDeposits[month].maxDate = dateStr;
                                }
                            }
                        }
                        
                        // Map maxDates to their monthly cumulative sums
                        const targetDeposits = {};
                        for (const month in monthlyDeposits) {
                            const info = monthlyDeposits[month];
                            if (info.maxDate) {
                                targetDeposits[info.maxDate] = info.total;
                            }
                        }
                        
                        ctx.save();
                        ctx.font = 'bold 9px Inter';
                        ctx.textAlign = 'center';
                        
                        const drawnLabels = [];
                        
                        filteredData.forEach((d, idx) => {
                            const depVal = depositsMap[d.date] || 0;
                            const monthlyTotal = targetDeposits[d.date];
                            
                            const isDeposit = !!monthlyTotal;
                            const isWithdrawal = depVal < 0;
                            
                            if (isDeposit || isWithdrawal) {
                                if (meta.data && meta.data[idx]) {
                                    const x = meta.data[idx].x;
                                    
                                    // Draw red/orange vertical dashed line (orange for prelievo)
                                    ctx.strokeStyle = isDeposit ? 'rgba(239, 68, 68, 0.45)' : 'rgba(249, 115, 22, 0.45)';
                                    ctx.lineWidth = 1.5;
                                    ctx.setLineDash([4, 4]);
                                    ctx.beginPath();
                                    ctx.moveTo(x, chart.chartArea.top);
                                    ctx.lineTo(x, chart.chartArea.bottom);
                                    ctx.stroke();
                                    
                                    // Draw text label
                                    ctx.setLineDash([]);
                                    ctx.fillStyle = isDeposit ? '#ef4444' : '#f97316';
                                    const labelVal = isDeposit ? monthlyTotal : Math.abs(depVal);
                                    const text = isDeposit ? `+€${formatMoney(labelVal)}` : `-€${formatMoney(labelVal)}`;
                                    
                                    // Check which rows are blocked (within 55px distance)
                                    const row0Blocked = drawnLabels.some(p => Math.abs(x - p.x) < 55 && p.row === 0);
                                    const row1Blocked = drawnLabels.some(p => Math.abs(x - p.x) < 55 && p.row === 1);
                                    const row2Blocked = drawnLabels.some(p => Math.abs(x - p.x) < 55 && p.row === 2);
                                    
                                    let selectedRow = 0;
                                    if (!row0Blocked) {
                                        selectedRow = 0;
                                    } else if (!row1Blocked) {
                                        selectedRow = 1;
                                    } else if (!row2Blocked) {
                                        selectedRow = 2;
                                    } else {
                                        // Fallback if all 3 are blocked, cycle based on the last drawn label
                                        const lastRow = drawnLabels.length > 0 ? drawnLabels[drawnLabels.length - 1].row : 0;
                                        selectedRow = (lastRow + 1) % 3;
                                    }
                                    
                                    drawnLabels.push({ x: x, row: selectedRow });
                                    const yPos = chart.chartArea.top + 15 + (selectedRow * 13);
                                    
                                    ctx.fillText(text, x, yPos);
                                }
                            }
                        });
                        
                        ctx.restore();
                    }
                }
            ]
        });
    }

    // --------------------------------------------------------------------------
    // 12. SECTION 3: STOCK LOOKUP & SPARKLINE HISTORICAL CHART
    // --------------------------------------------------------------------------
    const inputStockSearch = document.getElementById('input-stock-search');
    const searchAutocompleteList = document.getElementById('search-autocomplete-list');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const searchResultDetail = document.getElementById('search-result-detail');
    const searchInitialState = document.getElementById('search-initial-state');

    const searchDetailName = document.getElementById('search-detail-name');
    const searchDetailSymbol = document.getElementById('search-detail-symbol');
    const searchDetailExchange = document.getElementById('search-detail-exchange');
    const searchDetailCurrency = document.getElementById('search-detail-currency');
    const searchDetailPrice = document.getElementById('search-detail-price');
    const searchDetailChange = document.getElementById('search-detail-change');
    const searchDetailHigh = document.getElementById('search-detail-high');
    const searchDetailLow = document.getElementById('search-detail-low');
    const searchDetailOpen = document.getElementById('search-detail-open');
    const searchDetailPrevClose = document.getElementById('search-detail-prev-close');
    const btnAddSearchToPortfolio = document.getElementById('btn-add-search-to-portfolio');

    let searchTimeout = null;

    btnClearSearch.addEventListener('click', () => {
        inputStockSearch.value = '';
        btnClearSearch.classList.add('hidden');
        searchAutocompleteList.classList.add('hidden');
        searchResultDetail.classList.add('hidden');
        searchInitialState.classList.remove('hidden');
    });

    inputStockSearch.addEventListener('input', () => {
        const query = inputStockSearch.value.trim();
        
        if (query.length === 0) {
            btnClearSearch.classList.add('hidden');
            searchAutocompleteList.classList.add('hidden');
            return;
        }

        btnClearSearch.classList.remove('hidden');

        if (searchTimeout) clearTimeout(searchTimeout);

        searchTimeout = setTimeout(() => {
            executeSearchAutocomplete(query);
        }, 300);
    });

    async function executeSearchAutocomplete(query) {
        if (isMockMode) {
            showMockAutocomplete(query);
            return;
        }

        if (serverMode) {
            try {
                const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.quotes && data.quotes.length > 0) {
                        renderAutocompleteList(data.quotes);
                    } else {
                        searchAutocompleteList.innerHTML = `<div class="p-3 text-muted text-sm text-center">Nessun risultato trovato</div>`;
                        searchAutocompleteList.classList.remove('hidden');
                    }
                }
            } catch (e) {
                showMockAutocomplete(query);
            }
        } else {
            // Standalone mode: fetch suggestion via public proxy
            try {
                const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`;
                const data = await fetchWithProxy(yahooUrl);
                if (data && data.quotes && data.quotes.length > 0) {
                    renderAutocompleteList(data.quotes);
                } else {
                    searchAutocompleteList.innerHTML = `<div class="p-3 text-muted text-sm text-center">Nessun risultato trovato</div>`;
                    searchAutocompleteList.classList.remove('hidden');
                }
            } catch (e) {
                showMockAutocomplete(query);
            }
        }
    }

    function showMockAutocomplete(query) {
        const lowerQuery = query.toLowerCase();
        const hits = Object.keys(MOCK_STOCK_DATABASE)
            .filter(key => key.toLowerCase().includes(lowerQuery) || MOCK_STOCK_DATABASE[key].name.toLowerCase().includes(lowerQuery))
            .slice(0, 6)
            .map(key => {
                const item = MOCK_STOCK_DATABASE[key];
                return {
                    symbol: key,
                    shortname: item.name,
                    exchange: item.exchange,
                    quoteType: "EQUITY"
                };
            });

        if (hits.length > 0) {
            renderAutocompleteList(hits);
        } else {
            renderAutocompleteList([{
                symbol: query.toUpperCase(),
                shortname: `${query.toUpperCase()} Corp (Simulato)`,
                exchange: "NYSE",
                quoteType: "EQUITY"
            }]);
        }
    }

    function renderAutocompleteList(quotes) {
        searchAutocompleteList.innerHTML = '';
        
        const filtered = quotes.filter(q => q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "MUTUALFUND" || q.quoteType === "INDEX" || q.symbol);

        if (filtered.length === 0) {
            searchAutocompleteList.innerHTML = `<div class="p-3 text-muted text-sm text-center">Nessun titolo corrispondente</div>`;
            searchAutocompleteList.classList.remove('hidden');
            return;
        }

        filtered.forEach(q => {
            const item = document.createElement('div');
            item.className = 'search-suggestion-item';
            item.innerHTML = `
                <div class="suggestion-info">
                    <span class="suggestion-symbol">${escapeHTML(q.symbol)}</span>
                    <span class="suggestion-name">${escapeHTML(q.shortname || q.longname || q.symbol)}</span>
                </div>
                <div class="suggestion-meta">
                    <span class="suggestion-exchange">${escapeHTML(q.exchange || 'USD')}</span>
                </div>
            `;
            item.addEventListener('click', () => {
                inputStockSearch.value = q.symbol;
                searchAutocompleteList.classList.add('hidden');
                loadDetailedStockResult(q.symbol);
            });
            searchAutocompleteList.appendChild(item);
        });

        searchAutocompleteList.classList.remove('hidden');
    }

    async function loadDetailedStockResult(symbol) {
        searchInitialState.classList.add('hidden');
        searchResultDetail.classList.add('hidden');
        
        const resolvedSymbol = symbol.toUpperCase().trim();
        
        try {
            let resultData;
            
            if (isMockMode) {
                resultData = getMockHistory(resolvedSymbol);
            } else if (serverMode) {
                try {
                    const res = await apiFetch(`/api/quote?ticker=${resolvedSymbol}&range=1mo&interval=1d`);
                    if (res.ok) {
                        resultData = await res.json();
                    } else {
                        throw new Error();
                    }
                } catch (e) {
                    resultData = getMockHistory(resolvedSymbol);
                }
            } else {
                try {
                    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${resolvedSymbol}?range=1mo&interval=1d`;
                    resultData = await fetchWithProxy(yahooUrl);
                } catch (e) {
                    resultData = getMockHistory(resolvedSymbol);
                }
            }

            if (resultData && resultData.chart && resultData.chart.result && resultData.chart.result[0]) {
                const res = resultData.chart.result[0];
                const meta = res.meta;
                
                searchResultDetail.classList.remove('hidden');

                const isUp = (meta.regularMarketPrice >= meta.previousClose);
                const pnlSign = isUp ? '+' : '';
                const pct = meta.previousClose > 0 ? ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100 : 0;
                
                searchDetailName.innerText = meta.longName || meta.shortName || meta.symbol;
                searchDetailSymbol.innerText = meta.symbol;
                searchDetailExchange.innerText = meta.exchangeName || "CCY";
                searchDetailCurrency.innerText = meta.currency;
                
                const cSymbol = meta.currency === 'USD' ? '$' : (meta.currency === 'EUR' ? '€' : meta.currency);
                searchDetailPrice.innerText = `${cSymbol} ${formatMoney(meta.regularMarketPrice)}`;
                searchDetailChange.innerText = `${pnlSign}${pct.toFixed(2)}%`;
                searchDetailChange.className = `price-change font-semibold ${isUp ? 'text-success' : 'text-danger'}`;

                searchDetailHigh.innerText = `${cSymbol} ${formatMoney(meta.dayHigh || meta.regularMarketPrice)}`;
                searchDetailLow.innerText = `${cSymbol} ${formatMoney(meta.dayLow || meta.regularMarketPrice)}`;
                searchDetailOpen.innerText = `${cSymbol} ${formatMoney(meta.regularMarketPrice)}`;
                searchDetailPrevClose.innerText = `${cSymbol} ${formatMoney(meta.previousClose)}`;

                btnAddSearchToPortfolio.onclick = () => {
                    const tabsBtn = document.querySelectorAll('.tab-btn');
                    const tabPanels = document.querySelectorAll('.tab-panel');

                    tabsBtn.forEach(t => t.classList.remove('active'));
                    tabPanels.forEach(p => p.classList.remove('active'));
                    
                    document.querySelector('[data-target="tab-performance"]').classList.add('active');
                    document.getElementById('tab-performance').classList.add('active');
                    
                    document.getElementById('asset-ticker').value = meta.symbol;
                    document.getElementById('asset-shares').value = '';
                    
                    let targetCostEUR = meta.regularMarketPrice;
                    if (meta.currency === 'USD') {
                        targetCostEUR = meta.regularMarketPrice / cachedEURUSD;
                    }
                    document.getElementById('asset-buy-price').value = targetCostEUR.toFixed(2);
                    
                    document.getElementById('asset-shares').focus();
                };

                const closePrices = res.indicators.quote[0].close || [];
                const timestamps = res.timestamp || [];
                
                const chartLabels = timestamps.map(ts => {
                    const d = new Date(ts * 1000);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                });
                
                const cleanClosePrices = closePrices.map((p, idx) => {
                    if (p === null || p === undefined) {
                        return idx > 0 ? closePrices[idx - 1] : meta.regularMarketPrice;
                    }
                    return p;
                });

                drawSparkline(chartLabels, cleanClosePrices, isUp);
            }
        } catch (e) {
            console.error("Error drawing stock details:", e);
            alert("Errore nel caricamento delle quotazioni.");
        }
    }

    function getMockHistory(symbol) {
        const quote = getMockQuote(symbol);
        const days = 22;
        const timestamp = [];
        const close = [];
        const baseTime = Date.now() / 1000 - (days * 24 * 3600);

        let curPrice = quote.prevClose * 0.95;
        for (let i = 0; i < days; i++) {
            timestamp.push(Math.round(baseTime + (i * 24 * 3600)));
            const change = (Math.random() - 0.48) * 0.015;
            curPrice = +(curPrice * (1 + change)).toFixed(4);
            close.push(curPrice);
        }

        close[close.length - 1] = quote.price;

        return {
            chart: {
                result: [{
                    meta: {
                        symbol: quote.symbol,
                        longName: quote.name,
                        shortName: quote.name,
                        exchangeName: quote.exchange,
                        currency: quote.currency,
                        regularMarketPrice: quote.price,
                        previousClose: quote.prevClose,
                        dayHigh: Math.max(quote.price, quote.open) * 1.005,
                        dayLow: Math.min(quote.price, quote.open) * 0.995,
                    },
                    timestamp: timestamp,
                    indicators: {
                        quote: [{
                            close: close
                        }]
                    }
                }]
            }
        };
    }

    function drawSparkline(labels, data, isUp) {
        const ctx = document.getElementById('search-sparkline-chart').getContext('2d');
        
        if (sparklineChartInstance) {
            sparklineChartInstance.destroy();
        }

        const strokeColor = isUp ? '#10b981' : '#ef4444';
        const fillGradient = ctx.createLinearGradient(0, 0, 0, 150);
        fillGradient.addColorStop(0, isUp ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)');
        fillGradient.addColorStop(1, isUp ? 'rgba(16,185,129,0)' : 'rgba(239,68,68,0)');

        sparklineChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Prezzo',
                    data: data,
                    borderColor: strokeColor,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    backgroundColor: fillGradient,
                    tension: 0.15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        padding: 10,
                        cornerRadius: 6,
                        displayColors: false
                    }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(255,255,255,0.02)' },
                        ticks: { color: '#6b7280', font: { family: 'Inter', size: 9 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#6b7280', font: { family: 'Inter', size: 9 } }
                    }
                }
            }
        });
    }

    // --------------------------------------------------------------------------
    // 12. SECTION 3: DEPOSITS / VERSAMENTI
    // --------------------------------------------------------------------------
    const depositsTableBody = document.getElementById('deposits-table-body');
    const depositsPageInfo = document.getElementById('deposits-page-info');
    const btnDepositsPrev = document.getElementById('btn-deposits-prev');
    const btnDepositsNext = document.getElementById('btn-deposits-next');
    const depositsTotalBadge = document.getElementById('deposits-total-badge');
    const formAddDeposit = document.getElementById('form-add-deposit');
    const inputDepositDate = document.getElementById('input-deposit-date');
    const inputDepositAmount = document.getElementById('input-deposit-amount');
    const inputDepositDesc = document.getElementById('input-deposit-desc');

    const editDepositModal = document.getElementById('edit-deposit-modal');
    const btnCloseDepositModal = document.getElementById('btn-close-deposit-modal');
    const btnCancelDepositModal = document.getElementById('btn-cancel-deposit-modal');
    const btnSaveDepositModal = document.getElementById('btn-save-deposit-modal');
    const inputEditDepositIndex = document.getElementById('input-edit-deposit-index');
    const inputEditDepositDate = document.getElementById('input-edit-deposit-date');
    const inputEditDepositAmount = document.getElementById('input-edit-deposit-amount');
    const inputEditDepositDesc = document.getElementById('input-edit-deposit-desc');

    function openEditDepositModal(idx) {
        const activePort = getActivePortfolio();
        if (!activePort || !activePort.manualDeposits) return;
        const dep = activePort.manualDeposits[idx];
        if (!dep) return;

        if (inputEditDepositIndex) inputEditDepositIndex.value = idx;
        if (inputEditDepositDate) inputEditDepositDate.value = dep.date;
        if (inputEditDepositAmount) inputEditDepositAmount.value = Math.abs(dep.value);
        if (inputEditDepositDesc) inputEditDepositDesc.value = dep.desc;

        if (editDepositModal) editDepositModal.classList.remove('hidden');
    }

    if (btnCloseDepositModal) {
        btnCloseDepositModal.addEventListener('click', () => {
            if (editDepositModal) editDepositModal.classList.add('hidden');
        });
    }
    if (btnCancelDepositModal) {
        btnCancelDepositModal.addEventListener('click', () => {
            if (editDepositModal) editDepositModal.classList.add('hidden');
        });
    }
    if (btnSaveDepositModal) {
        btnSaveDepositModal.addEventListener('click', async () => {
            const activePort = getActivePortfolio();
            if (!activePort || !activePort.manualDeposits) return;

            const idx = parseInt(inputEditDepositIndex.value);
            const date = inputEditDepositDate.value;
            const amount = parseFloat(inputEditDepositAmount.value);
            const desc = inputEditDepositDesc.value;

            if (!date || isNaN(amount) || amount === 0) {
                alert("Inserisci una data e un importo validi.");
                return;
            }

            let value = amount;
            if (desc === "Prelievo bonifico") {
                value = -Math.abs(amount);
            } else {
                value = Math.abs(amount);
            }

            activePort.manualDeposits[idx] = {
                date: date,
                desc: desc,
                value: value
            };

            const origText = btnSaveDepositModal.innerHTML;
            btnSaveDepositModal.disabled = true;
            btnSaveDepositModal.innerText = "Salvataggio...";

            try {
                await savePortfolioMetadata();
            } catch (err) {
                console.error("Error saving updated deposit:", err);
                alert("Errore durante il salvataggio.");
            } finally {
                btnSaveDepositModal.disabled = false;
                btnSaveDepositModal.innerHTML = origText;
            }

            if (editDepositModal) editDepositModal.classList.add('hidden');
            renderDepositsTable();
        });
    }

    function formatDateItalian(dateIsoStr) {
        const parts = dateIsoStr.split('-');
        if (parts.length !== 3) return dateIsoStr;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    function renderDepositsTable() {
        if (!depositsTableBody) return;
        depositsTableBody.innerHTML = '';

        const activePort = getActivePortfolio();
        if (!activePort) {
            depositsTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Nessun portafoglio attivo.</td></tr>';
            if (depositsPageInfo) depositsPageInfo.innerText = 'Pagina 1 di 1';
            return;
        }

        const manualDeposits = activePort.manualDeposits || [];
        
        // Map to keep track of the original index in the manualDeposits array
        const manualWithIndex = manualDeposits.map((d, index) => ({ ...d, originalIndex: index }));

        // Sort from most recent to least recent
        const sortedDeposits = [...manualWithIndex];
        sortedDeposits.sort((a, b) => b.date.localeCompare(a.date));

        // Calculate total
        let totalVal = 0;
        sortedDeposits.forEach(d => {
            totalVal += d.value;
        });

        // Calculate total per calendar year
        const yearTotals = {};
        sortedDeposits.forEach(d => {
            if (d.date) {
                const year = d.date.substring(0, 4);
                yearTotals[year] = (yearTotals[year] || 0) + d.value;
            }
        });

        // Update total badge
        if (depositsTotalBadge) {
            depositsTotalBadge.innerText = `Totale Versato: € ${formatMoney(totalVal)}`;
        }

        if (sortedDeposits.length === 0) {
            depositsTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Nessun versamento registrato.</td></tr>';
            if (depositsPageInfo) depositsPageInfo.innerText = 'Pagina 1 di 1';
            if (btnDepositsPrev) btnDepositsPrev.disabled = true;
            if (btnDepositsNext) btnDepositsNext.disabled = true;
            return;
        }

        const itemsPerPage = 15;
        const totalPages = Math.ceil(sortedDeposits.length / itemsPerPage);

        if (depositsCurrentPage > totalPages) {
            depositsCurrentPage = totalPages;
        }
        if (depositsCurrentPage < 1) {
            depositsCurrentPage = 1;
        }

        if (depositsPageInfo) {
            depositsPageInfo.innerText = `Pagina ${depositsCurrentPage} di ${totalPages}`;
        }

        if (btnDepositsPrev) btnDepositsPrev.disabled = (depositsCurrentPage === 1);
        if (btnDepositsNext) btnDepositsNext.disabled = (depositsCurrentPage === totalPages);

        const startIdx = (depositsCurrentPage - 1) * itemsPerPage;
        const pageItems = sortedDeposits.slice(startIdx, startIdx + itemsPerPage);

        let lastYearSeen = null;
        pageItems.forEach(d => {
            const year = d.date ? d.date.substring(0, 4) : "";
            
            // Year break row
            if (lastYearSeen !== null && year !== lastYearSeen) {
                const sumTr = document.createElement('tr');
                sumTr.className = 'year-summary-row';
                const yearAmt = yearTotals[lastYearSeen] || 0;
                const amtClass = yearAmt >= 0 ? 'text-success' : 'text-danger';
                const amtSign = yearAmt >= 0 ? '+' : '';
                sumTr.innerHTML = `
                    <td colspan="2" class="text-right" style="color: var(--color-text-secondary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Totale ${lastYearSeen}</td>
                    <td class="text-right font-semibold ${amtClass}" style="border-top: 1px solid var(--color-border); font-weight: 700;">${amtSign}€ ${formatMoney(yearAmt)}</td>
                    <td></td>
                `;
                depositsTableBody.appendChild(sumTr);
            }
            lastYearSeen = year;

            const tr = document.createElement('tr');
            const amtClass = d.value >= 0 ? 'text-success' : 'text-danger';
            const amtSign = d.value >= 0 ? '+' : '';

            tr.innerHTML = `
                <td>${formatDateItalian(d.date)}</td>
                <td class="font-medium">${escapeHTML(d.desc)}</td>
                <td class="text-right font-semibold ${amtClass}">
                    <span class="edit-deposit-trigger" data-idx="${d.originalIndex}" title="Clicca per modificare" style="cursor: pointer; border-bottom: 1px dashed currentColor; padding-bottom: 1px;">
                        ${amtSign}€ ${formatMoney(d.value)}
                    </span>
                </td>
                <td class="text-center">
                    <button class="btn-tiny btn-delete-deposit text-danger" title="Elimina Operazione" data-idx="${d.originalIndex}">
                        <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                    </button>
                </td>
            `;
            depositsTableBody.appendChild(tr);
        });

        // Last year break row at the end of the page
        if (pageItems.length > 0 && lastYearSeen !== null) {
            const sumTr = document.createElement('tr');
            sumTr.className = 'year-summary-row';
            const yearAmt = yearTotals[lastYearSeen] || 0;
            const amtClass = yearAmt >= 0 ? 'text-success' : 'text-danger';
            const amtSign = yearAmt >= 0 ? '+' : '';
            sumTr.innerHTML = `
                <td colspan="2" class="text-right" style="color: var(--color-text-secondary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700;">Totale ${lastYearSeen}</td>
                <td class="text-right font-semibold ${amtClass}" style="border-top: 1px solid var(--color-border); font-weight: 700;">${amtSign}€ ${formatMoney(yearAmt)}</td>
                <td></td>
            `;
            depositsTableBody.appendChild(sumTr);
        }

        // Attach click listeners to edit triggers
        depositsTableBody.querySelectorAll('.edit-deposit-trigger').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
                openEditDepositModal(idx);
            });
        });

        // Attach click listeners to delete buttons
        depositsTableBody.querySelectorAll('.btn-delete-deposit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(btn.getAttribute('data-idx'));
                if (confirm("Sei sicuro di voler eliminare questa operazione?")) {
                    const activePort = getActivePortfolio();
                    if (activePort && activePort.manualDeposits) {
                        activePort.manualDeposits.splice(idx, 1);
                        try {
                            await savePortfolioMetadata();
                            renderDepositsTable();
                        } catch (err) {
                            console.error(err);
                            alert("Errore durante l'eliminazione.");
                        }
                    }
                }
            });
        });

        // Re-generate Lucide icons for the new trash buttons
        lucide.createIcons();
    }

    if (btnDepositsPrev) {
        btnDepositsPrev.addEventListener('click', () => {
            if (depositsCurrentPage > 1) {
                depositsCurrentPage--;
                renderDepositsTable();
            }
        });
    }

    if (btnDepositsNext) {
        btnDepositsNext.addEventListener('click', () => {
            const activePort = getActivePortfolio();
            if (activePort) {
                const manualDeposits = activePort.manualDeposits || [];
                const totalPages = Math.ceil(manualDeposits.length / 15);
                if (depositsCurrentPage < totalPages) {
                    depositsCurrentPage++;
                    renderDepositsTable();
                }
            }
        });
    }

    // Set today's date in form on load
    if (inputDepositDate) {
        inputDepositDate.value = new Date().toISOString().substring(0, 10);
    }

    if (formAddDeposit) {
        formAddDeposit.addEventListener('submit', async (e) => {
            e.preventDefault();
            const activePort = getActivePortfolio();
            if (!activePort) {
                alert("Nessun portafoglio attivo.");
                return;
            }

            const dateVal = inputDepositDate.value;
            const amountVal = parseFloat(inputDepositAmount.value);
            const descVal = inputDepositDesc.value;

            if (!dateVal || isNaN(amountVal) || amountVal === 0) {
                alert("Inserisci una data e un importo validi (diverso da zero).");
                return;
            }

            // Adjust value if it is a withdrawal (Prelievo)
            let value = amountVal;
            if (descVal === "Prelievo bonifico") {
                value = -Math.abs(amountVal);
            } else {
                value = Math.abs(amountVal);
            }

            if (!activePort.manualDeposits) {
                activePort.manualDeposits = [];
            }

            // Append to local deposits list
            activePort.manualDeposits.push({
                date: dateVal,
                desc: descVal,
                value: value
            });

            // Save to backend via metadata sync or localStorage
            const saveBtn = document.getElementById('btn-save-deposit');
            const origText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerText = "Salvataggio...";
            
            try {
                await savePortfolioMetadata();
            } catch (err) {
                console.error("Error saving deposits metadata:", err);
                alert("Errore durante il salvataggio dei dati.");
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = origText;
            }

            // Clear amount input
            inputDepositAmount.value = '';

            // Update grid
            depositsCurrentPage = 1;
            renderDepositsTable();
        });
    }

    const btnSyncPatrimonioDeposits = document.getElementById('btn-sync-patrimonio-deposits');
    if (btnSyncPatrimonioDeposits) {
        btnSyncPatrimonioDeposits.addEventListener('click', async () => {
            const activePort = getActivePortfolio();
            if (!activePort) {
                alert("Nessun portafoglio attivo.");
                return;
            }

            const origContent = btnSyncPatrimonioDeposits.innerHTML;
            btnSyncPatrimonioDeposits.disabled = true;
            btnSyncPatrimonioDeposits.innerHTML = '<i data-lucide="loader-2" class="spinning" style="width: 14px; height: 14px;"></i> Recupero...';
            lucide.createIcons();

            // Proactively fetch latest CSV text if server mode is active
            let fileFound = false;
            if (serverMode) {
                try {
                    const res = await apiFetch(`/api/patrimonio?portfolio=${encodeURIComponent(activePort.name)}`);
                    if (res.ok) {
                        const csvText = await res.text();
                        const parsedData = parseBrokerCsv(csvText);
                        activePort.patrimonioCsvData = parsedData;
                        activePort.patrimonioCsvText = csvText;
                        fileFound = true;
                    }
                } catch (err) {
                    console.error("Failed to load folder CSV for sync:", err);
                }
            } else {
                // In offline mode, check if we have imported CSV content
                if (activePort.patrimonioCsvText) {
                    fileFound = true;
                }
            }

            if (!fileFound) {
                alert("Dati non presenti");
                btnSyncPatrimonioDeposits.disabled = false;
                btnSyncPatrimonioDeposits.innerHTML = origContent;
                lucide.createIcons();
                return;
            }

            const csvData = activePort.patrimonioCsvData;
            const csvDeposits = (csvData && csvData.rawDeposits) ? csvData.rawDeposits : [];

            if (csvDeposits.length === 0) {
                alert("Nessun versamento rilevato nel file patrimonio.csv per questo portafoglio.");
                btnSyncPatrimonioDeposits.disabled = false;
                btnSyncPatrimonioDeposits.innerHTML = origContent;
                lucide.createIcons();
                return;
            }

            // Overwrite the manual deposits array completely with the ones retrieved from the CSV
            activePort.manualDeposits = csvDeposits.map(cd => ({
                date: cd.date,
                desc: cd.desc,
                value: cd.value
            }));

            try {
                await savePortfolioMetadata();
                alert(`Recupero completato. La griglia è stata sovrascritta con i ${csvDeposits.length} versamenti presenti nel file patrimonio.csv.`);
            } catch (err) {
                console.error("Error saving synced deposits:", err);
                alert("Errore durante il salvataggio dei dati.");
            }

            btnSyncPatrimonioDeposits.disabled = false;
            btnSyncPatrimonioDeposits.innerHTML = origContent;
            lucide.createIcons();

            depositsCurrentPage = 1;
            renderDepositsTable();
        });
    }

    // --------------------------------------------------------------------------
    // 13. GENERAL HELPERS & FORMATTING
    // --------------------------------------------------------------------------
    function formatMoney(num) {
        if (isPrivacyMode) return '*****';
        if (num === undefined || num === null) return "0,00";
        return num.toLocaleString('it-IT', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function formatDateShort(dateStr) {
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}/${parts[1]}`;
    }

    function escapeHTML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --------------------------------------------------------------------------
    // --------------------------------------------------------------------------
    // 14. SECTION: GLOBAL PRODUCT TYPOLOGY MANAGER
    // --------------------------------------------------------------------------
    const btnOpenTypologyManager = document.getElementById('btn-open-typology-manager');
    const typologyManagementModal = document.getElementById('typology-management-modal');
    const btnCloseTypologyManager = document.getElementById('btn-close-typology-manager');
    const btnCloseTypologyManagerFooter = document.getElementById('btn-close-typology-manager-footer');
    
    const formMgrAddTypology = document.getElementById('form-mgr-add-typology');
    const typologyMgrName = document.getElementById('typology-mgr-name');
    const typologyMgrStocks = document.getElementById('typology-mgr-stocks');
    const typologyMgrBond = document.getElementById('typology-mgr-bond');
    const typologyMgrSumLabel = document.getElementById('typology-mgr-sum-label');
    const typologyPreviewStocks = document.getElementById('typology-preview-stocks');
    const typologyPreviewBond = document.getElementById('typology-preview-bond');
    const btnSaveMgrTypology = document.getElementById('btn-save-mgr-typology');
    const typologyMgrList = document.getElementById('typology-mgr-list');
    const typologyMgrCount = document.getElementById('typology-mgr-count');

    // Also support button inside add asset modal (+ Tipologia)
    const btnAddTypologyTrigger = document.getElementById('btn-add-typology-trigger');

    function openTypologyManagerModal() {
        if (!typologyManagementModal) return;
        if (typologyMgrName) typologyMgrName.value = '';
        if (typologyMgrStocks) typologyMgrStocks.value = '60';
        if (typologyMgrBond) typologyMgrBond.value = '40';
        updateTypologySplitPreview();
        renderTypologyManagerList();
        typologyManagementModal.classList.remove('hidden');
    }

    function closeTypologyManagerModal() {
        if (!typologyManagementModal) return;
        typologyManagementModal.classList.add('hidden');
    }

    function updateTypologySplitPreview() {
        const stocksVal = parseInt(typologyMgrStocks ? typologyMgrStocks.value : 0) || 0;
        const bondVal = parseInt(typologyMgrBond ? typologyMgrBond.value : 0) || 0;
        const total = stocksVal + bondVal;

        if (typologyPreviewStocks) typologyPreviewStocks.style.width = `${Math.max(0, Math.min(100, stocksVal))}%`;
        if (typologyPreviewBond) typologyPreviewBond.style.width = `${Math.max(0, Math.min(100, bondVal))}%`;

        if (typologyMgrSumLabel) {
            typologyMgrSumLabel.innerText = `Totale: ${total}%`;
            if (total === 100) {
                typologyMgrSumLabel.className = 'font-semibold text-success';
                if (btnSaveMgrTypology) btnSaveMgrTypology.disabled = false;
            } else {
                typologyMgrSumLabel.className = 'font-semibold text-danger';
                if (btnSaveMgrTypology) btnSaveMgrTypology.disabled = true;
            }
        }
    }

    if (typologyMgrStocks) {
        typologyMgrStocks.addEventListener('input', (e) => {
            let s = parseInt(e.target.value);
            if (isNaN(s)) s = 0;
            if (s > 100) s = 100;
            if (s < 0) s = 0;
            typologyMgrStocks.value = s;
            if (typologyMgrBond) typologyMgrBond.value = 100 - s;
            updateTypologySplitPreview();
        });
    }

    if (typologyMgrBond) {
        typologyMgrBond.addEventListener('input', (e) => {
            let b = parseInt(e.target.value);
            if (isNaN(b)) b = 0;
            if (b > 100) b = 100;
            if (b < 0) b = 0;
            typologyMgrBond.value = b;
            if (typologyMgrStocks) typologyMgrStocks.value = 100 - b;
            updateTypologySplitPreview();
        });
    }

    if (btnOpenTypologyManager) {
        btnOpenTypologyManager.addEventListener('click', openTypologyManagerModal);
    }
    if (btnAddTypologyTrigger) {
        btnAddTypologyTrigger.addEventListener('click', openTypologyManagerModal);
    }
    if (btnCloseTypologyManager) {
        btnCloseTypologyManager.addEventListener('click', closeTypologyManagerModal);
    }
    if (btnCloseTypologyManagerFooter) {
        btnCloseTypologyManagerFooter.addEventListener('click', closeTypologyManagerModal);
    }
    if (typologyManagementModal) {
        typologyManagementModal.addEventListener('click', (e) => {
            if (e.target === typologyManagementModal) closeTypologyManagerModal();
        });
    }

    function renderTypologyManagerList() {
        if (!typologyMgrList) return;
        typologyMgrList.innerHTML = '';

        const activePort = getActivePortfolio();
        const merged = getMergedTypologies(activePort);
        const keys = Object.keys(merged);

        if (typologyMgrCount) {
            typologyMgrCount.innerText = `${keys.length} censite`;
        }

        if (keys.length === 0) {
            typologyMgrList.innerHTML = '<div class="text-xs text-muted text-center py-4">Nessuna tipologia personalizzata censita.</div>';
            return;
        }

        keys.forEach(k => {
            const item = merged[k];
            const isStandardNative = ['Stocks', 'Bond', 'Hard assets', 'CASH', 'Crypto'].includes(k);
            const isMixed = item.type === 'mixed';
            const alloc = item.allocation || {};

            const card = document.createElement('div');
            card.className = 'typology-card-item';

            let badgesHtml = '';
            if (isMixed) {
                const sPct = alloc['Stocks'] || 0;
                const bPct = alloc['Bond'] || 0;
                badgesHtml = `
                    <span class="typology-badge-stocks"><span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span> Stocks ${sPct}%</span>
                    <span class="typology-badge-bond"><span style="width:6px;height:6px;border-radius:50%;background:#3b82f6;"></span> Bond ${bPct}%</span>
                `;
                // If there are other assets in allocation
                Object.keys(alloc).forEach(cat => {
                    if (cat !== 'Stocks' && cat !== 'Bond') {
                        badgesHtml += `<span class="badge" style="font-size:0.75rem;">${escapeHTML(cat)} ${alloc[cat]}%</span>`;
                    }
                });
            } else {
                badgesHtml = `<span class="badge" style="font-size:0.75rem;">Singola</span>`;
            }

            card.innerHTML = `
                <div class="typology-info">
                    <span class="typology-name">${escapeHTML(k)}</span>
                    <div class="typology-meta">
                        ${badgesHtml}
                    </div>
                </div>
                <div>
                    ${!isStandardNative ? `
                        <button type="button" class="btn-tiny text-danger btn-del-typology" data-name="${escapeHTML(k)}" title="Elimina tipologia">
                            <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
                        </button>
                    ` : ''}
                </div>
            `;

            const btnDel = card.querySelector('.btn-del-typology');
            if (btnDel) {
                btnDel.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const nameToDelete = btnDel.getAttribute('data-name');
                    if (confirm(`Sei sicuro di voler eliminare la tipologia "${nameToDelete}"?`)) {
                        delete globalCustomTypologies[nameToDelete];
                        if (activePort && activePort.customTypologies && activePort.customTypologies[nameToDelete]) {
                            delete activePort.customTypologies[nameToDelete];
                            await savePortfolioMetadata();
                        }
                        await saveGlobalTypologies();
                        renderTypologyManagerList();
                        populateAssetTypeDropdown();
                        if (getActivePortfolio()) {
                            sortAndRenderHoldingsTable();
                            updateQuickStatsAndPie();
                            renderEquityPieChart();
                        }
                    }
                });
            }

            typologyMgrList.appendChild(card);
        });

        lucide.createIcons();
    }

    if (formMgrAddTypology) {
        formMgrAddTypology.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = typologyMgrName ? typologyMgrName.value.trim() : '';
            if (!name) {
                alert("Inserisci un nome valido per la tipologia.");
                return;
            }

            const standardTypes = ['stocks', 'bond', 'hard assets', 'cash', 'crypto'];
            if (standardTypes.includes(name.toLowerCase())) {
                alert("Non puoi sovrascrivere una classe di attivo base standard di sistema.");
                return;
            }

            const stocksVal = parseInt(typologyMgrStocks ? typologyMgrStocks.value : 0) || 0;
            const bondVal = parseInt(typologyMgrBond ? typologyMgrBond.value : 0) || 0;

            if (stocksVal + bondVal !== 100) {
                alert("La somma delle percentuali di Stocks e Bond deve essere esattamente 100%.");
                return;
            }

            if (globalCustomTypologies[name]) {
                if (!confirm(`La tipologia "${name}" esiste già. Vuoi aggiornare la sua allocazione?`)) {
                    return;
                }
            }

            btnSaveMgrTypology.disabled = true;
            btnSaveMgrTypology.innerHTML = '<i data-lucide="loader-2" class="spinning" style="width:14px;height:14px;"></i> Salvataggio...';

            try {
                globalCustomTypologies[name] = {
                    type: 'mixed',
                    allocation: {
                        'Stocks': stocksVal,
                        'Bond': bondVal
                    }
                };

                await saveGlobalTypologies();
                renderTypologyManagerList();
                populateAssetTypeDropdown();
                
                const activePort = getActivePortfolio();
                if (activePort) {
                    sortAndRenderHoldingsTable();
                    updateQuickStatsAndPie();
                    renderEquityPieChart();
                }

                if (typologyMgrName) typologyMgrName.value = '';
                if (typologyMgrStocks) typologyMgrStocks.value = '60';
                if (typologyMgrBond) typologyMgrBond.value = '40';
                updateTypologySplitPreview();

            } catch (err) {
                console.error("Error saving global typology:", err);
                alert("Errore durante il salvataggio della tipologia.");
            } finally {
                btnSaveMgrTypology.disabled = false;
                btnSaveMgrTypology.innerHTML = '<i data-lucide="check" style="width: 14px; height: 14px;"></i> Salva Tipologia';
                lucide.createIcons();
            }
        });
    }

    // Startup check
    async function startApp() {
        await checkServerStatus();
        await loadGlobalTypologies();
        await loadAllPortfolios();
        updatePrivacyUI();
        showScreen('selector');
    }

    startApp();
});
