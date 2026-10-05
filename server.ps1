# ==========================================================================
# FINBOARD LOCAL POWERSHELL SERVER & FILE-SYSTEM API
# Serves static files and acts as a local backend for directory creation,
# CSV reading/writing, and CORS-free Yahoo Finance quote proxying.
# ==========================================================================

$port = 8081
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
} catch {
    Write-Host "Errore: Impossibile avviare il server. La porta $port potrebbe essere gia' in uso." -ForegroundColor Red
    Write-Host "Dettagli: $_" -ForegroundColor Red
    Pause
    Exit
}

Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "   FINBOARD BACKEND SERVER AVVIATO" -ForegroundColor Green
Write-Host "   L'applicazione e' disponibile all'indirizzo: http://localhost:$port/" -ForegroundColor Green
Write-Host "   Sincronizzazione cartelle di lavoro ATTIVA" -ForegroundColor Green
Write-Host "==========================================================================" -ForegroundColor Green
Write-Host "Premere CTRL+C per arrestare il server." -ForegroundColor Yellow
Write-Host ""

# Open the default web browser to the server page
Start-Process "http://localhost:$port/"

# Set global TLS protocols for scraping
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

# BTP List Database Helper Functions
function Update-BtpList {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    Write-Host "Scraping BTPs from SimpleToolsForInvestors..." -ForegroundColor Cyan
    $url = "https://www.simpletoolsforinvestors.eu/monitor_info.php?monitor=5&yieldtype=G&timescale=DUR"
    try {
        $r = Invoke-WebRequest -Uri $url -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -TimeoutSec 10 -UseBasicParsing
        $html = $r.Content
        
        # Parse BTP data
        $patternRow = '(?s)<tr>\s*<td class=''text-center''>([A-Z0-9]{12})</td>.*?</tr>'
        $matches = [regex]::Matches($html, $patternRow)
        
        $btpDict = @{}
        foreach ($m in $matches) {
            $rowHtml = $m.Value
            $patternCells = '(?s)<td[^>]*>(.*?)</td>'
            $cellMatches = [regex]::Matches($rowHtml, $patternCells)
            
            if ($cellMatches.Count -ge 10) {
                $isin = $cellMatches[0].Groups[1].Value.Trim()
                $desc = $cellMatches[3].Groups[1].Value -replace '<[^>]+>', ''
                $desc = $desc.Trim()
                
                $priceStr = $cellMatches[9].Groups[1].Value -replace '<[^>]+>', ''
                $priceStr = $priceStr.Replace(",", ".").Trim()
                
                $price = 0.0
                if ([double]::TryParse($priceStr, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$price)) {
                    $btpDict[$isin] = @{
                        isin = $isin
                        name = $desc
                        price = $price
                        updated = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    }
                }
            }
        }
        
        if ($btpDict.Count -gt 0) {
            $cachePath = Join-Path $PSScriptRoot "btp_list.json"
            $json = $btpDict | ConvertTo-Json -Depth 5
            $json | Out-File -FilePath $cachePath -Encoding UTF8
            Write-Host "BTP database updated: $($btpDict.Count) bonds cached." -ForegroundColor Green
            return Get-BtpList
        } else {
            Write-Host "Warning: No BTPs parsed from scraping." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Failed to scrape BTP list: $_" -ForegroundColor Red
    }
    return $null
}

function Get-BtpList {
    $cachePath = Join-Path $PSScriptRoot "btp_list.json"
    if (Test-Path $cachePath) {
        try {
            $content = Get-Content -Path $cachePath -Raw -Encoding UTF8
            $cache = $content | ConvertFrom-Json
            return $cache
        } catch {
            Write-Host "Error reading btp_list.json: $_" -ForegroundColor Yellow
        }
    }
    return $null
}

function Get-BtpListFreshness {
    $cachePath = Join-Path $PSScriptRoot "btp_list.json"
    if (Test-Path $cachePath) {
        $lastWrite = (Get-Item $cachePath).LastWriteTime
        $diff = (Get-Date) - $lastWrite
        return $diff.TotalHours -lt 1
    }
    return $false
}

# Pension Parameters Database Helper Functions
function Get-PensionParameters {
    $rootDir = if ($script:PSScriptRoot) { $script:PSScriptRoot } elseif ($PSScriptRoot) { $PSScriptRoot } else { (Get-Item .).FullName }
    $paramPath = Join-Path $rootDir "pension_parameters.json"
    if (Test-Path $paramPath) {
        try {
            $content = Get-Content -Path $paramPath -Raw -Encoding UTF8
            return ($content | ConvertFrom-Json)
        } catch {
            Write-Host "Error reading pension_parameters.json: $_" -ForegroundColor Yellow
        }
    }
    return $null
}

function Find-PensionFund {
    param([string]$queryStr)
    if ([string]::IsNullOrWhiteSpace($queryStr)) { return $null }
    $qNorm = $queryStr.Trim().ToUpper()
    $params = Get-PensionParameters
    if ($null -eq $params) { return $null }

    foreach ($prop in $params.PSObject.Properties) {
        $fund = $prop.Value
        if ($prop.Name.ToUpper() -eq $qNorm) { return $fund }
        if ($fund.symbol -and $fund.symbol.ToUpper() -eq $qNorm) { return $fund }
        if ($fund.isin -and $fund.isin.ToUpper() -eq $qNorm) { return $fund }
        if ($fund.aliases) {
            foreach ($alias in $fund.aliases) {
                if ($alias.ToUpper() -eq $qNorm) { return $fund }
                $aliasClean = $alias -replace "[-_ ]", ""
                $qClean = $qNorm -replace "[-_ ]", ""
                if ($aliasClean.ToUpper() -eq $qClean) { return $fund }
            }
        }
    }
    return $null
}

function Search-PensionFunds {
    param([string]$queryStr)
    if ([string]::IsNullOrWhiteSpace($queryStr)) { return @() }
    $qNorm = $queryStr.Trim().ToUpper()
    $params = Get-PensionParameters
    if ($null -eq $params) { return @() }

    $matchedFunds = @()
    foreach ($prop in $params.PSObject.Properties) {
        $fund = $prop.Value
        $isMatch = $false

        if ($fund.symbol -and ($fund.symbol.ToUpper().Contains($qNorm) -or $qNorm.Contains($fund.symbol.ToUpper()))) { $isMatch = $true }
        if ($fund.isin -and ($fund.isin.ToUpper().Contains($qNorm) -or $qNorm.Contains($fund.isin.ToUpper()))) { $isMatch = $true }
        if ($fund.name -and $fund.name.ToUpper().Contains($qNorm)) { $isMatch = $true }
        
        if (-not $isMatch -and $fund.aliases) {
            foreach ($alias in $fund.aliases) {
                if ($alias.ToUpper().Contains($qNorm) -or $qNorm.Contains($alias.ToUpper())) {
                    $isMatch = $true
                    break
                }
            }
        }

        if (-not $isMatch -and $fund.searchKeywords) {
            foreach ($kw in $fund.searchKeywords) {
                if ($kw.ToUpper().Contains($qNorm) -or $qNorm.Contains($kw.ToUpper())) {
                    $isMatch = $true
                    break
                }
            }
        }

        if ($isMatch) {
            $matchedFunds += $fund
        }
    }
    return ,$matchedFunds
}

# Portfolios physical container directory (all user portfolios are stored inside /input)
$portfoliosDir = Join-Path $PSScriptRoot "input"
if (-not (Test-Path $portfoliosDir)) {
    New-Item -ItemType Directory -Path $portfoliosDir | Out-Null
}

# Simple request router loop
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # Add CORS Headers for local development and file:// access
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        
        # Handle OPTIONS preflight request
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/") {
            $urlPath = "/index.html"
        }
        $query = $request.QueryString
        
        # ----------------------------------------------------------------------
        # API ROUTING SECTION
        # ----------------------------------------------------------------------
        
        # 1. Server status ping
        if ($urlPath -eq "/api/status") {
            $response.ContentType = "application/json; charset=utf-8"
            $json = '{"status":"ok","mode":"filesystem"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        
        # 2. CORS-free Yahoo Finance Quote Proxy
        # Handles range and interval for live performance tables and sparklines
        elseif ($urlPath -eq "/api/quote") {
            $ticker = $query["ticker"]
            if ($ticker) {
                $ticker = $ticker.Trim()
                if ($ticker.Contains('.')) {
                    $parts = $ticker.Split('.')
                    $lastPart = $parts[-1]
                    if ($lastPart.Length -eq 1 -and @("F", "L", "T", "V") -notcontains $lastPart.ToUpper()) {
                        $base = $parts[0..($parts.Length - 2)] -join '.'
                        $ticker = "$base-$lastPart"
                    }
                }
            }
            
            # Detect Generic BOND or CASH Quote
            $tickerUpper = if ($ticker) { $ticker.ToUpper() } else { "" }
            if ($tickerUpper -eq "BOND" -or $tickerUpper -eq "BOT" -or $tickerUpper -eq "CASH") {
                $displayName = if ($tickerUpper -eq "BOT") {
                    "BOT / Titoli di Stato a breve"
                } elseif ($tickerUpper -eq "CASH") {
                    "Liquidità"
                } else {
                    "Obbligazioni Generiche (BOND)"
                }
                $days = 10
                $baseTime = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - ($days * 24 * 3600)
                $timestamps = @()
                $closePrices = @()
                for ($i = 0; $i -lt $days; $i++) {
                    $timestamps += [int]($baseTime + ($i * 24 * 3600))
                    $closePrices += 1.0
                }
                $resultObj = @{
                    chart = @{
                        result = @(
                            @{
                                meta = @{
                                    symbol = if ($tickerUpper -eq "CASH") { "CASH" } else { "BOND" }
                                    longName = $displayName
                                    regularMarketPrice = 1.0
                                    currency = "EUR"
                                    exchangeName = if ($tickerUpper -eq "CASH") { "CASH" } else { "BOND" }
                                    previousClose = 1.0
                                    dayHigh = 1.0
                                    dayLow = 1.0
                                }
                                timestamp = $timestamps
                                indicators = @{
                                    quote = @(
                                        @{
                                            close = $closePrices
                                        }
                                    )
                                }
                            }
                        )
                        error = $null
                    }
                }
                $json = $resultObj | ConvertTo-Json -Depth 10
                $response.ContentType = "application/json; charset=utf-8"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }
            
            # Detect Pension Fund Quote
            $pensionFund = $null
            if ($ticker) {
                $pensionFund = Find-PensionFund -queryStr $ticker
            }
            
            if ($null -ne $pensionFund) {
                Write-Host "Scraping pension fund quote: $($pensionFund.symbol) ($($pensionFund.scraper))" -ForegroundColor Cyan
                $symbol = $pensionFund.symbol
                $name = $pensionFund.name
                $exchange = $pensionFund.exchange
                $price = if ($pensionFund.lastKnownPrice) { [double]$pensionFund.lastKnownPrice } else { [double]$pensionFund.fallbackPrice }
                $prevClose = [Math]::Round($price * 0.995, 4)
                $timestamps = @()
                $closePrices = @()
                $success = $false

                if ($pensionFund.scraper -eq "fondofonte_html") {
                    try {
                        $url = $pensionFund.url
                        $r = Invoke-WebRequest -Uri $url -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -TimeoutSec 5 -UseBasicParsing
                        $html = $r.Content
                        $pattern = '(?s)<div class="toggle_element_row">\s*<span>\s*([^<]+?)\s*</span>\s*<span>\s*([^<]+?)\s*</span>'
                        $matches = [regex]::Matches($html, $pattern)
                        $parsedQuotes = @()
                        foreach ($m in $matches) {
                            $col1 = $m.Groups[1].Value.Trim()
                            $col2 = $m.Groups[2].Value.Trim()
                            if ($col1 -ne "Periodo" -and $col1 -ne "") {
                                $pVal = [double]($col2.Replace(",", ".").Trim())
                                $parsedQuotes += @{ month = $col1; price = $pVal }
                            }
                        }
                        if ($parsedQuotes.Count -gt 0) {
                            $price = $parsedQuotes[0].price
                            $prevClose = if ($parsedQuotes.Count -gt 1) { $parsedQuotes[1].price } else { [Math]::Round($price * 0.995, 4) }
                            $success = $true
                            [array]::Reverse($parsedQuotes)
                            if ($parsedQuotes.Count -gt 25) {
                                $parsedQuotes = $parsedQuotes[-25..-1]
                            }
                            $days = $parsedQuotes.Count
                            $baseTime = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - ($days * 30 * 24 * 3600)
                            for ($i = 0; $i -lt $days; $i++) {
                                $timestamps += [int]($baseTime + ($i * 30 * 24 * 3600))
                                $closePrices += $parsedQuotes[$i].price
                            }
                            $closePrices[-1] = $price
                        }
                    } catch {
                        Write-Host "Failed to scrape fondofonte_html: $_" -ForegroundColor Yellow
                    }
                }
                elseif ($pensionFund.scraper -eq "secondapensione_json") {
                    try {
                        $url = $pensionFund.url
                        $body = if ($pensionFund.body) { $pensionFund.body } else { '{"fields":["isin","currency","lastNav","navHistory"]}' }
                        $r = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/json" -UserAgent "Mozilla/5.0" -TimeoutSec 5 -UseBasicParsing
                        $obj = $r.Content | ConvertFrom-Json
                        $lastNav = $obj[0].lastNav
                        $navHistory = $obj[0].navHistory
                        if ($lastNav -and $lastNav.value) {
                            $price = [double]$lastNav.value
                        }
                        if ($navHistory -and $navHistory.Count -gt 0) {
                            $history = @($navHistory)
                            [array]::Reverse($history)
                            if ($history.Count -gt 30) {
                                $history = $history[-30..-1]
                            }
                            foreach ($h in $history) {
                                if ($h.date -and $h.value) {
                                    $dt = [DateTime]::ParseExact($h.date, "yyyy-MM-dd", $null)
                                    $dto = New-Object DateTimeOffset($dt)
                                    $timestamps += [int]$dto.ToUnixTimeSeconds()
                                    $closePrices += [double]$h.value
                                }
                            }
                            if ($closePrices.Count -gt 0) {
                                $closePrices[-1] = $price
                            }
                            $prevClose = if ($closePrices.Count -gt 1) { $closePrices[-2] } else { [Math]::Round($price * 0.995, 4) }
                            $success = $true
                        }
                    } catch {
                        Write-Host "Failed to scrape secondapensione_json: $_" -ForegroundColor Yellow
                    }
                }
                elseif ($pensionFund.scraper -eq "borsa_italiana_fondi") {
                    try {
                        $url = $pensionFund.url
                        $r = Invoke-WebRequest -Uri $url -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -TimeoutSec 5 -UseBasicParsing
                        $html = $r.Content
                        
                        # Extract title / name if available
                        if ($html -match '(?si)<title>\s*([^<]+?)\s*-\s*Quotazioni') {
                            $name = $matches[1].Trim()
                        }
                        
                        # Extract last NAV price
                        $priceMatched = $false
                        if ($html -match '(?si)<span[^>]*class="[^"]*formatPrice[^"]*"[^>]*>\s*<strong>\s*([0-9.,]+)\s*</strong>') {
                            $priceStr = $matches[1].Replace(",", ".").Trim()
                            $price = [double]$priceStr
                            $priceMatched = $true
                        } elseif ($html -match '(?si)<span[^>]*class="[^"]*t-text -right[^"]*"[^>]*>\s*([0-9.,]+)\s*</span>') {
                            $priceStr = $matches[1].Replace(",", ".").Trim()
                            $price = [double]$priceStr
                            $priceMatched = $true
                        }
                        
                        # Extract previous close
                        if ($html -match '(?si)Precedente.*?<span[^>]*class="[^"]*t-text -right[^"]*"[^>]*>\s*([0-9.,]+)\s*</span>') {
                            $prevStr = $matches[1].Replace(",", ".").Trim()
                            $prevClose = [double]$prevStr
                        } else {
                            $prevClose = [Math]::Round($price * 0.995, 4)
                        }
                        
                        if ($priceMatched) {
                            $success = $true
                        }
                    } catch {
                        Write-Host "Failed to scrape borsa_italiana_fondi: $_" -ForegroundColor Yellow
                    }
                }
                elseif ($pensionFund.scraper -eq "teleborsa_fondi") {
                    try {
                        $url = $pensionFund.url
                        $lines = & curl.exe -s --max-time 10 $url -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                        $html = $lines -join "`n"

                        if ($html -match '(?si)<h1[^>]*class="title[^"]*"[^>]*>\s*([^<]+?)\s*</h1>') {
                            $name = $matches[1].Trim()
                        }
                        if ($html -match '(?si)id="[^"]*lblPrice"[^>]*>\s*([0-9.,]+)\s*<') {
                            $price = [double]($matches[1].Replace(",", ".").Trim())
                        }
                        if ($html -match '(?si)id="[^"]*lblPercentChange"[^>]*>\s*([+-]?[0-9.,]+)%\s*<') {
                            $changePct = [double]($matches[1].Replace(",", ".").Trim())
                            if ($changePct -ne 0 -and $price -gt 0) {
                                $prevClose = [Math]::Round($price / (1 + ($changePct / 100.0)), 4)
                            }
                        }
                        # Extract real historical series from script
                        if ($html -match 'historical:\s*(\[\[.*?\]\])') {
                            $histJson = $matches[1]
                            $histArr = $histJson | ConvertFrom-Json
                            if ($histArr.Count -gt 0) {
                                $recent = if ($histArr.Count -gt 30) { $histArr[-30..-1] } else { $histArr }
                                foreach ($pt in $recent) {
                                    $timestamps += [int]($pt[0] / 1000)
                                    $closePrices += [double]$pt[1]
                                }
                                if ($closePrices.Count -gt 1) {
                                    $prevClose = $closePrices[-2]
                                }
                                $price = $closePrices[-1]
                                $success = $true
                            }
                        }
                        if ($price -gt 0) {
                            $success = $true
                        }
                    } catch {
                        Write-Host "Failed to scrape teleborsa_fondi: $_" -ForegroundColor Yellow
                    }
                }

                # If no history generated (e.g. borsa_italiana_fondi or fallback), create a synthetic series ending at $price
                if ($timestamps.Count -eq 0) {
                    $days = 20
                    $baseTime = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - ($days * 24 * 3600)
                    $curP = $prevClose
                    for ($i = 0; $i -lt $days; $i++) {
                        $timestamps += [int]($baseTime + ($i * 24 * 3600))
                        $closePrices += $curP
                    }
                    $closePrices[-1] = $price
                }

                $resultObj = @{
                    chart = @{
                        result = @(
                            @{
                                meta = @{
                                    symbol = $symbol
                                    longName = $name
                                    regularMarketPrice = $price
                                    currency = "EUR"
                                    exchangeName = $exchange
                                    previousClose = $prevClose
                                    dayHigh = $price
                                    dayLow = $price
                                }
                                timestamp = $timestamps
                                indicators = @{
                                    quote = @(
                                        @{
                                            close = $closePrices
                                        }
                                    )
                                }
                            }
                        )
                        error = $null
                    }
                }
                $json = $resultObj | ConvertTo-Json -Depth 10
                $response.ContentType = "application/json; charset=utf-8"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }
            
            # Detect BTP ISIN (starts with IT, 12 chars)
            $isBtp = $false
            if ($ticker) {
                $tickerUpper = $ticker.ToUpper()
                if ($tickerUpper -match "^IT[A-Z0-9]{10}$") {
                    $isBtp = $true
                }
            }
            
            if ($isBtp) {
                Write-Host "Serving BTP quote: $tickerUpper" -ForegroundColor Cyan
                
                # Check database freshness and load database
                $isFresh = Get-BtpListFreshness
                $cache = Get-BtpList
                
                # If database is stale or ticker is not found, scrape to update
                if (-not $isFresh -or $null -eq $cache -or $null -eq $cache.$tickerUpper) {
                    $cache = Update-BtpList
                }
                
                $success = $false
                if ($null -ne $cache -and $null -ne $cache.$tickerUpper) {
                    $b = $cache.$tickerUpper
                    $price = $b.price
                    $name = $b.name
                    $success = $true
                }
                
                if ($success) {
                    # Generate historical mock data ending at actual price for the sparkline chart
                    $days = 20
                    $baseTime = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - ($days * 24 * 3600)
                    $timestamps = @()
                    $closePrices = @()
                    $curPrice = $price * 0.995
                    for ($i = 0; $i -lt $days; $i++) {
                        $timestamps += [int]($baseTime + ($i * 24 * 3600))
                        # add tiny fluctuation
                        $randPercent = ((Get-Random -Minimum 0 -Maximum 100) - 48) / 10000.0
                        $curPrice = [Math]::Round($curPrice * (1 + $randPercent), 4)
                        $closePrices += $curPrice
                    }
                    $closePrices[-1] = $price
                    
                    $resultObj = @{
                        chart = @{
                            result = @(
                                @{
                                    meta = @{
                                        symbol = $tickerUpper
                                        longName = $name
                                        regularMarketPrice = $price
                                        currency = "EUR"
                                        exchangeName = "Milano"
                                        previousClose = [Math]::Round($price * 0.998, 4)
                                        dayHigh = $price
                                        dayLow = $price
                                    }
                                    timestamp = $timestamps
                                    indicators = @{
                                        quote = @(
                                            @{
                                                close = $closePrices
                                            }
                                        )
                                    }
                                }
                            )
                            error = $null
                        }
                    }
                    $json = $resultObj | ConvertTo-Json -Depth 10
                    $response.ContentType = "application/json; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                } else {
                    # Return HTTP 400 Bad Request with JSON error "Isin non valido"
                    $response.StatusCode = 400
                    $response.ContentType = "application/json; charset=utf-8"
                    $json = '{"error":"Isin non valido"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
            }
            
            $range = $query["range"]
            if (-not $range) { $range = "1d" }
            $interval = $query["interval"]
            if (-not $interval) { $interval = "1m" }
            if ($range -eq "1mo") { $interval = "1d" }
            
            # Robust fallback URLs (Query2 -> Query1, primary range -> fallback range 5d/1d)
            $urls = @()
            $urls += "https://query2.finance.yahoo.com/v8/finance/chart/$($ticker)?range=$($range)&interval=$($interval)"
            $urls += "https://query2.finance.yahoo.com/v8/finance/chart/$($ticker)?range=5d&interval=1d"
            
            if ($ticker.EndsWith(".MI")) {
                $etfTicker = $ticker.Replace(".MI", "-ETFP.MI")
                $urls += "https://query2.finance.yahoo.com/v8/finance/chart/$($etfTicker)?range=$($range)&interval=$($interval)"
                $urls += "https://query2.finance.yahoo.com/v8/finance/chart/$($etfTicker)?range=5d&interval=1d"
            }
            
            $urls += "https://query1.finance.yahoo.com/v8/finance/chart/$($ticker)?range=$($range)&interval=$($interval)"
            $urls += "https://query1.finance.yahoo.com/v8/finance/chart/$($ticker)?range=5d&interval=1d"
            
            if ($ticker.EndsWith(".MI")) {
                $etfTicker = $ticker.Replace(".MI", "-ETFP.MI")
                $urls += "https://query1.finance.yahoo.com/v8/finance/chart/$($etfTicker)?range=$($range)&interval=$($interval)"
                $urls += "https://query1.finance.yahoo.com/v8/finance/chart/$($etfTicker)?range=5d&interval=1d"
            }
            
            $json = $null
            $success = $false
            
            foreach ($url in $urls) {
                try {
                    $webRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($url)
                    $webRequest.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    $webRequest.Timeout = 5000
                    
                    $webResponse = $webRequest.GetResponse()
                    $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
                    $json = $reader.ReadToEnd()
                    $reader.Close()
                    $webResponse.Close()
                    
                    if ($json -and $json.Contains('"result":[')) {
                        $success = $true
                        break
                    }
                } catch {
                    Write-Host "URL $url failed: $_" -ForegroundColor Yellow
                    # Try next URL
                }
            }
            
            if ($success) {
                $response.ContentType = "application/json; charset=utf-8"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                Write-Host "API quote failed for $ticker on all fallbacks" -ForegroundColor Red
                $response.StatusCode = 500
                $err = '{"chart":{"result":null,"error":{"code":"500","description":"Proxy fetch failed"}}}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 3. CORS-free Yahoo Finance Autocomplete Search Suggestion Proxy
        elseif ($urlPath -eq "/api/search") {
            $q = $query["q"]
            if ($q) {
                $q = $q.Trim()
                $qUpper = $q.ToUpper()
                
                # Detect Generic BOND or CASH Search
                if ($qUpper -eq "BOND" -or $qUpper -eq "BOT" -or $qUpper -eq "CASH" -or $qUpper.StartsWith("BOND") -or $qUpper.StartsWith("BOT")) {
                    $sym = if ($qUpper.StartsWith("CASH")) { "CASH" } else { "BOND" }
                    $desc = if ($sym -eq "CASH") {
                        "CASH - Liquidità di portafoglio (Fisso 1 €)"
                    } elseif ($qUpper.StartsWith("BOT")) {
                        "BOND - BOT / Titoli di Stato a breve termine (Fisso 1 €)"
                    } else {
                        "BOND - Obbligazioni Generiche / BOT (Senza tracking - Fisso 1 €)"
                    }
                    $searchResult = @{
                        quotes = @(
                            @{
                                symbol = $sym
                                shortname = $desc
                                exchange = $sym
                                quoteType = "EQUITY"
                            }
                        )
                    }
                    $json = $searchResult | ConvertTo-Json -Depth 5
                    $response.ContentType = "application/json; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
                
                # Detect Pension Funds Search
                $matchedPensionFunds = @(Search-PensionFunds -queryStr $q)
                if ($matchedPensionFunds.Count -gt 0) {
                    Write-Host "Searching pension funds: $($matchedPensionFunds.Count) matches" -ForegroundColor Cyan
                    $pensionQuotes = @()
                    foreach ($pf in $matchedPensionFunds) {
                        $pPrice = if ($pf.lastKnownPrice) { $pf.lastKnownPrice } else { $pf.fallbackPrice }
                        $displayName = "$($pf.name) ($($pPrice) €)"
                        $pensionQuotes += @{
                            symbol = $pf.symbol
                            shortname = $displayName
                            exchange = $pf.exchange
                            quoteType = "EQUITY"
                        }
                    }
                    $searchResult = @{ quotes = $pensionQuotes }
                    $json = $searchResult | ConvertTo-Json -Depth 5
                    $response.ContentType = "application/json; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
                
                if ($qUpper -match "^IT[A-Z0-9]{10}$") {
                    Write-Host "Searching BTP from Borsa Italiana: $qUpper" -ForegroundColor Cyan
                    $url = "https://www.borsaitaliana.it/borsa/obbligazioni/mot/btp/scheda/$($qUpper).html?lang=it"
                    $name = "Btp Obbligazione ($qUpper)"
                    try {
                        $r = Invoke-WebRequest -Uri $url -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" -TimeoutSec 3 -UseBasicParsing
                        $html = $r.Content
                        if ($html -match '<title>(.+?)\s+quotazioni') {
                            $name = $Matches[1].Trim()
                        }
                    } catch {
                        # ignore error, use default name
                    }
                    
                    $searchResult = @{
                        quotes = @(
                            @{
                                symbol = $qUpper
                                shortname = $name
                                exchange = "Milano"
                                quoteType = "EQUITY"
                            }
                        )
                    }
                    $json = $searchResult | ConvertTo-Json -Depth 5
                    $response.ContentType = "application/json; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
                
                if ($q.Contains('.')) {
                    $parts = $q.Split('.')
                    $lastPart = $parts[-1]
                    if ($lastPart.Length -eq 1 -and @("F", "L", "T", "V") -notcontains $lastPart.ToUpper()) {
                        $base = $parts[0..($parts.Length - 2)] -join '.'
                        $q = "$base-$lastPart"
                    }
                }
            }
            
            $urls = @(
                "https://query2.finance.yahoo.com/v1/finance/search?q=$($q)&quotesCount=8&newsCount=0",
                "https://query1.finance.yahoo.com/v1/finance/search?q=$($q)&quotesCount=8&newsCount=0"
            )
            
            $json = $null
            $success = $false
            
            foreach ($url in $urls) {
                try {
                    $webRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($url)
                    $webRequest.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                    $webRequest.Timeout = 5000
                    
                    $webResponse = $webRequest.GetResponse()
                    $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
                    $json = $reader.ReadToEnd()
                    $reader.Close()
                    $webResponse.Close()
                    
                    if ($json -and $json.Contains('"quotes":[')) {
                        $success = $true
                        break
                    }
                } catch {
                    # Try next URL
                }
            }
            
            if ($success) {
                $response.ContentType = "application/json; charset=utf-8"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 500
                $err = '{"quotes":[],"error":"Failed to search"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 3.5. CORS-free ISIN Resolver Proxy (tries Yahoo Finance first, then OpenFIGI)
        elseif ($urlPath -eq "/api/resolve-isin") {
            $isin = $query["isin"]
            if ($isin) { 
                $isin = $isin.Trim().ToUpper() 
                if ($isin -eq "BOND" -or $isin -eq "BOT") {
                    $response.ContentType = "application/json; charset=utf-8"
                    $resJson = '{"isin":"BOND","ticker":"BOND"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
                if ($isin -eq "CASH") {
                    $response.ContentType = "application/json; charset=utf-8"
                    $resJson = '{"isin":"CASH","ticker":"CASH"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
                $pFund = Find-PensionFund -queryStr $isin
                if ($null -ne $pFund) {
                    $response.ContentType = "application/json; charset=utf-8"
                    $resJson = '{"isin":"' + $isin + '","ticker":"' + $pFund.symbol + '"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $response.Close()
                    continue
                }
                if ($isin -match "^IT[A-Z0-9]{10}$") {
                    $cache = Get-BtpList
                    if ($null -eq $cache -or $null -eq $cache.$isin) {
                        $cache = Update-BtpList
                    }
                    
                    if ($null -ne $cache -and $null -ne $cache.$isin) {
                        $response.ContentType = "application/json; charset=utf-8"
                        $resJson = '{"isin":"' + $isin + '","ticker":"' + $isin + '"}'
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
                        $response.ContentLength64 = $bytes.Length
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                        $response.Close()
                        continue
                    } else {
                        $response.StatusCode = 400
                        $response.ContentType = "application/json; charset=utf-8"
                        $resJson = '{"error":"Isin non valido"}'
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
                        $response.ContentLength64 = $bytes.Length
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                        $response.Close()
                        continue
                    }
                }
            }
            
            $resolvedTicker = $null
            $yahooTicker = $null
            $yahooHasPreferred = $false
            
            # 1. Try Yahoo Finance Search API
            $yahooSearchUrl = "https://query2.finance.yahoo.com/v1/finance/search?q=$($isin)&quotesCount=5&newsCount=0"
            try {
                $webRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($yahooSearchUrl)
                $webRequest.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                $webRequest.Timeout = 5000
                
                $webResponse = $webRequest.GetResponse()
                $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
                $json = $reader.ReadToEnd()
                $reader.Close()
                $webResponse.Close()
                
                $searchResult = $json | ConvertFrom-Json
                if ($searchResult.quotes -and $searchResult.quotes.Count -gt 0) {
                    foreach ($q in $searchResult.quotes) {
                        if ($q.symbol -and ($q.symbol.EndsWith(".MI") -or $q.symbol.EndsWith(".DE") -or $q.symbol.EndsWith(".F") -or $q.symbol.EndsWith(".SG"))) {
                            $yahooTicker = $q.symbol
                            $yahooHasPreferred = $true
                            break
                        }
                    }
                    
                    if (-not $yahooTicker) {
                        foreach ($q in $searchResult.quotes) {
                            if ($q.symbol -and ($q.symbol.EndsWith(".PA") -or $q.symbol.EndsWith(".AS") -or $q.symbol.EndsWith(".BR") -or $q.symbol.EndsWith(".MC") -or $q.symbol.EndsWith(".LS") -or $q.symbol.EndsWith(".SG"))) {
                                $yahooTicker = $q.symbol
                                break
                            }
                        }
                    }
                    
                    if (-not $yahooTicker) {
                        $yahooTicker = $searchResult.quotes[0].symbol
                    }
                }
            } catch {
                # Yahoo failed
            }
            
            # If Yahoo resolved ticker is preferred (Milan/Xetra/Frankfurt), we use it immediately.
            # Otherwise, we query OpenFIGI to see if it has a Milan/Xetra/Frankfurt listing.
            if ($yahooHasPreferred) {
                $resolvedTicker = $yahooTicker
            } else {
                # 2. Try OpenFIGI API
                try {
                    $figiUrl = "https://api.openfigi.com/v3/mapping"
                    $body = '[{"idType":"ID_ISIN","idValue":"' + $isin + '"}]'
                    
                    $webRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($figiUrl)
                    $webRequest.Method = "POST"
                    $webRequest.ContentType = "application/json"
                    $webRequest.Timeout = 5000
                    
                    $writer = New-Object System.IO.StreamWriter($webRequest.GetRequestStream())
                    $writer.Write($body)
                    $writer.Close()
                    
                    $webResponse = $webRequest.GetResponse()
                    $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
                    $json = $reader.ReadToEnd()
                    $reader.Close()
                    $webResponse.Close()
                    
                    $figiResult = $json | ConvertFrom-Json
                    if ($figiResult -and $figiResult[0].data -and $figiResult[0].data.Count -gt 0) {
                        $results = $figiResult[0].data
                        
                        $FIGI_EXCH_MAP = @{
                            "IM" = ".MI"
                            "GY" = ".DE"
                            "GR" = ".F"
                            "LN" = ".L"
                            "FP" = ".PA"
                            "NA" = ".AS"
                            "BB" = ".BR"
                            "PL" = ".LS"
                            "SM" = ".MC"
                            "US" = ""
                        }
                        
                        $figiPreferred = $null
                        # Pass 1: Milan
                        foreach ($r in $results) {
                            if ($r.exchCode -eq "IM") {
                                $figiPreferred = $r.ticker + $FIGI_EXCH_MAP[$r.exchCode]
                                break
                            }
                        }
                        # Pass 2: Germany
                        if (-not $figiPreferred) {
                            foreach ($r in $results) {
                                if ($r.exchCode -eq "GY" -or $r.exchCode -eq "GR") {
                                    $figiPreferred = $r.ticker + $FIGI_EXCH_MAP[$r.exchCode]
                                    break
                                }
                            }
                        }
                        
                        if ($figiPreferred) {
                            $resolvedTicker = $figiPreferred
                        } else {
                            foreach ($r in $results) {
                                if ($FIGI_EXCH_MAP.ContainsKey($r.exchCode)) {
                                    $resolvedTicker = $r.ticker + $FIGI_EXCH_MAP[$r.exchCode]
                                    break
                                }
                            }
                        }
                    }
                } catch {
                    # OpenFIGI failed
                }
            }
            
            if (-not $resolvedTicker) {
                if ($yahooTicker) {
                    $resolvedTicker = $yahooTicker
                } else {
                    $resolvedTicker = $isin
                }
            }
            
            # Normalize Milan ETP/ETF tickers: if they end in .MI, check if it's an ETF that needs -ETFP.MI
            if ($resolvedTicker -and $resolvedTicker.EndsWith(".MI")) {
                $testUrl = "https://query2.finance.yahoo.com/v8/finance/chart/$resolvedTicker?range=1d&interval=1m"
                $directWorks = $false
                try {
                    $webRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($testUrl)
                    $webRequest.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    $webRequest.Timeout = 2500
                    $webResponse = $webRequest.GetResponse()
                    $webResponse.Close()
                    $directWorks = $true
                } catch {
                    # Direct .MI failed, probably an ETF/ETC
                }
                
                if (-not $directWorks) {
                    $etfTicker = $resolvedTicker.Replace(".MI", "-ETFP.MI")
                    $testUrlEtf = "https://query2.finance.yahoo.com/v8/finance/chart/$etfTicker?range=1d&interval=1m"
                    try {
                        $webRequest = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($testUrlEtf)
                        $webRequest.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                        $webRequest.Timeout = 2500
                        $webResponse = $webRequest.GetResponse()
                        $webResponse.Close()
                        $resolvedTicker = $etfTicker
                    } catch {
                        # If fallback also fails, keep original .MI ticker
                    }
                }
            }
            
            $response.ContentType = "application/json; charset=utf-8"
            $resJson = '{"isin":"' + $isin + '","ticker":"' + $resolvedTicker + '"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        
        # 4. Scan local workspace directories for portfolios
        elseif ($urlPath -eq "/api/portfolios") {
            $portfolios = @()
            $excludeDirs = @(".git", "node_modules", "scratch")
            
            $subdirs = Get-ChildItem -Path $portfoliosDir -Directory
            foreach ($dir in $subdirs) {
                if ($excludeDirs -contains $dir.Name) { continue }
                
                $metaPath = Join-Path $dir.FullName "metadata.json"
                $meta = @{
                    id = "port-" + $dir.Name.ToLower().Replace(" ", "-")
                    name = $dir.Name
                    desc = "Portafoglio locale sincronizzato fisicamente."
                    cash = 0.00
                    lastRealTimeValue = $null
                    holdings = @()
                    customTypologies = @{}
                    manualDeposits = @()
                }
                
                if (Test-Path $metaPath) {
                    try {
                        # Load folder metadata
                        $metaContent = Get-Content -Path $metaPath -Raw -Encoding UTF8
                        $metaJson = $metaContent | ConvertFrom-Json
                        if ($metaJson.id) { $meta.id = $metaJson.id }
                        if ($metaJson.name) { $meta.name = $metaJson.name }
                        if ($metaJson.desc) { $meta.desc = $metaJson.desc }
                        if ($metaJson.cash -ne $null) { $meta.cash = [double]$metaJson.cash }
                        if ($metaJson.lastRealTimeValue -ne $null) { $meta.lastRealTimeValue = [double]$metaJson.lastRealTimeValue }
                        if ($metaJson.holdings) { $meta.holdings = $metaJson.holdings }
                        if ($metaJson.customTypologies) { $meta.customTypologies = $metaJson.customTypologies }
                        if ($metaJson.manualDeposits) { $meta.manualDeposits = $metaJson.manualDeposits }
                    } catch {
                        # Corrupted metadata.json will be rewritten
                    }
                } else {
                    # Create metadata.json with defaults
                    $meta | ConvertTo-Json -Depth 4 | Out-File -FilePath $metaPath -Encoding UTF8
                }
                
                $portfolios += $meta
            }
            
            $response.ContentType = "application/json; charset=utf-8"
            $json = $portfolios | ConvertTo-Json -Depth 5
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        
        # 5. Create a physical portfolio folder and files
        elseif ($urlPath -eq "/api/create-portfolio") {
            $name = $query["name"]
            $cashStr = $query["cash"]
            $cash = 0.00
            [double]::TryParse($cashStr, [ref]$cash)
            $desc = $query["desc"]
            if (-not $desc) { $desc = "Portafoglio locale sincronizzato fisicamente." }
            
            if ($name) {
                $dirPath = Join-Path $portfoliosDir $name
                if (-not (Test-Path $dirPath)) {
                    New-Item -ItemType Directory -Path $dirPath | Out-Null
                    
                    # Create default patrimonio.csv
                    $csvPath = Join-Path $dirPath "patrimonio.csv"
                    $csvHeader = "Date;Liquidità;Finanziamento long;Garanzia short;Portafoglio;Patrimonio;Note`r`n"
                    $csvHeader | Out-File -FilePath $csvPath -Encoding utf8
                    
                    # Create default metadata.json
                    $meta = @{
                        id = "port-" + $name.ToLower().Replace(" ", "-")
                        name = $name
                        desc = $desc
                        cash = $cash
                        holdings = @()
                        customTypologies = @{}
                        manualDeposits = @()
                    }
                    $metaPath = Join-Path $dirPath "metadata.json"
                    $meta | ConvertTo-Json -Depth 4 | Out-File -FilePath $metaPath -Encoding UTF8
                    
                    $json = '{"success":true}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    $response.StatusCode = 409
                    $json = '{"error":"Folder already exists"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } else {
                $response.StatusCode = 400
                $json = '{"error":"Name required"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 5b. Rename a portfolio folder and files
        elseif ($urlPath -eq "/api/rename-portfolio") {
            $oldName = $query["oldName"]
            $newName = $query["newName"]
            
            if ($oldName -and $newName) {
                $oldName = $oldName.Trim()
                $newName = $newName.Trim()
                
                # Check for invalid characters in folder name
                $invalidChars = [System.IO.Path]::GetInvalidFileNameChars()
                $hasInvalid = $false
                foreach ($char in $invalidChars) {
                    if ($newName.Contains($char)) {
                        $hasInvalid = $true
                        break
                    }
                }
                
                if ($hasInvalid) {
                    $response.StatusCode = 400
                    $json = '{"error":"Il nome contiene caratteri non validi"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
                else {
                    $oldPath = Join-Path $portfoliosDir $oldName
                    $newPath = Join-Path $portfoliosDir $newName
                    
                    if (Test-Path $oldPath -PathType Container) {
                        if (-not (Test-Path $newPath)) {
                            try {
                                # Rename directory on disk
                                Rename-Item -Path $oldPath -NewName $newName -ErrorAction Stop
                                
                                # Update metadata.json inside the renamed directory
                                $metaPath = Join-Path $newPath "metadata.json"
                                if (Test-Path $metaPath) {
                                    $metaContent = Get-Content -Path $metaPath -Raw -Encoding UTF8
                                    $meta = $metaContent | ConvertFrom-Json
                                    
                                    # Update name and id
                                    $meta.name = $newName
                                    $meta.id = "port-" + $newName.ToLower().Replace(" ", "-")
                                    
                                    # Save metadata
                                    $meta | ConvertTo-Json -Depth 4 | Out-File -FilePath $metaPath -Encoding UTF8
                                }
                                
                                $json = '{"success":true}'
                                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                                $response.ContentType = "application/json; charset=utf-8"
                                $response.ContentLength64 = $bytes.Length
                                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                            } catch {
                                $response.StatusCode = 500
                                $errMsg = $_.Exception.Message.Replace('"', '\"')
                                $json = '{"error":"Errore durante la ridenominazione: ' + $errMsg + '"}'
                                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                                $response.ContentType = "application/json; charset=utf-8"
                                $response.ContentLength64 = $bytes.Length
                                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                            }
                        } else {
                            $response.StatusCode = 409
                            $json = '{"error":"Esiste gia un portafoglio con questo nome"}'
                            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                            $response.ContentType = "application/json; charset=utf-8"
                            $response.ContentLength64 = $bytes.Length
                            $response.OutputStream.Write($bytes, 0, $bytes.Length)
                        }
                    } else {
                        $response.StatusCode = 404
                        $json = '{"error":"Cartella del portafoglio di origine non trovata"}'
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                        $response.ContentType = "application/json; charset=utf-8"
                        $response.ContentLength64 = $bytes.Length
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                }
            } else {
                $response.StatusCode = 400
                $json = '{"error":"I parametri oldName e newName sono obbligatori"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 6. Save assets/cash metadata inside the portfolio folder
        elseif ($urlPath -eq "/api/save-portfolio" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $metaJson = $body | ConvertFrom-Json
                $name = $metaJson.name
                
                if ($name) {
                    $dirPath = Join-Path $portfoliosDir $name
                    if (Test-Path $dirPath) {
                        $metaPath = Join-Path $dirPath "metadata.json"
                        $body | Out-File -FilePath $metaPath -Encoding UTF8
                        
                        $json = '{"success":true}'
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                        $response.ContentType = "application/json; charset=utf-8"
                        $response.ContentLength64 = $bytes.Length
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    } else {
                        $response.StatusCode = 404
                        $json = '{"error":"Folder not found"}'
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                        $response.ContentType = "application/json; charset=utf-8"
                        $response.ContentLength64 = $bytes.Length
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                } else {
                    $response.StatusCode = 400
                    $json = '{"error":"Portfolio name required"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } catch {
                $response.StatusCode = 500
                $json = '{"error":"JSON error parsing post data"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 7. Read the patrimonio.csv for a specific portfolio
        elseif ($urlPath -eq "/api/patrimonio") {
            $portfolio = $query["portfolio"]
            if ($portfolio) {
                $csvPath = Join-Path $portfoliosDir "$portfolio/patrimonio.csv"
                if (Test-Path $csvPath) {
                    $content = Get-Content -Path $csvPath -Raw -Encoding UTF8
                    $response.ContentType = "text/csv; charset=utf-8"
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    $response.StatusCode = 404
                    $json = '{"error":"patrimonio.csv not found"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } else {
                $response.StatusCode = 400
                $json = '{"error":"Portfolio name required"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 8. Write/overwrite patrimonio.csv inside the portfolio folder
        elseif ($urlPath -eq "/api/save-patrimonio" -and $request.HttpMethod -eq "POST") {
            $portfolio = $query["portfolio"]
            $reader = New-Object System.IO.StreamReader($request.InputStream)
            $csvContent = $reader.ReadToEnd()
            $reader.Close()
            
            if ($portfolio) {
                $dirPath = Join-Path $portfoliosDir $portfolio
                if (Test-Path $dirPath) {
                    $csvPath = Join-Path $dirPath "patrimonio.csv"
                    $csvContent | Out-File -FilePath $csvPath -Encoding utf8
                    
                    $json = '{"success":true}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    $response.StatusCode = 404
                    $json = '{"error":"Portfolio folder not found"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } else {
                $response.StatusCode = 400
                $json = '{"error":"Portfolio name required"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 9. Get custom typologies list
        elseif ($urlPath -eq "/api/typologies") {
            $typologiesPath = Join-Path $PSScriptRoot "custom_typologies.json"
            if (-not (Test-Path $typologiesPath)) {
                $defaultTypologies = @{
                    "Mixed (60/40)" = @{
                        type = "mixed"
                        allocation = @{ "Stocks" = 60; "Bond" = 40 }
                    }
                    "Mixed (80/20)" = @{
                        type = "mixed"
                        allocation = @{ "Stocks" = 80; "Bond" = 20 }
                    }
                }
                $defaultTypologies | ConvertTo-Json -Depth 5 | Out-File -FilePath $typologiesPath -Encoding utf8
            }
            
            $content = Get-Content -Path $typologiesPath -Raw -Encoding utf8
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        
        # 10. Save custom typologies list
        elseif ($urlPath -eq "/api/save-typologies" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $reader.Close()
            
            try {
                $typologiesPath = Join-Path $PSScriptRoot "custom_typologies.json"
                $body | Out-File -FilePath $typologiesPath -Encoding utf8
                
                $json = '{"success":true}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
                $json = '{"error":"Failed to save typologies"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # 11. Get pension parameters list
        elseif ($urlPath -eq "/api/pension-parameters") {
            $paramPath = Join-Path $PSScriptRoot "pension_parameters.json"
            if (Test-Path $paramPath) {
                $content = Get-Content -Path $paramPath -Raw -Encoding utf8
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 404
                $json = '{"error":"pension_parameters.json not found"}'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        
        # ----------------------------------------------------------------------
        # STATIC CONTENT FILE SERVING SECTION
        # ----------------------------------------------------------------------
        else {
            # Resolve to physical file path
            $filePath = Join-Path $PSScriptRoot $urlPath
            
            if (Test-Path $filePath -PathType Leaf) {
                $content = [System.IO.File]::ReadAllBytes($filePath)
                
                # Resolve content type
                $ext = [System.IO.Path]::GetExtension($filePath)
                $contentType = "text/plain"
                if ($ext -eq ".html") { $contentType = "text/html; charset=utf-8" }
                elseif ($ext -eq ".css") { $contentType = "text/css" }
                elseif ($ext -eq ".js") { $contentType = "application/javascript" }
                elseif ($ext -eq ".csv") { $contentType = "text/csv; charset=utf-8" }
                elseif ($ext -eq ".png") { $contentType = "image/png" }
                elseif ($ext -eq ".ico") { $contentType = "image/x-icon" }
                elseif ($ext -eq ".json") { $contentType = "application/json; charset=utf-8" }
                
                $response.ContentType = $contentType
                $response.ContentLength64 = $content.Length
                $response.OutputStream.Write($content, 0, $content.Length)
            } else {
                # File not found
                $response.StatusCode = 404
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("File non trovato: $urlPath")
                $response.ContentLength64 = $errBytes.Length
                $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
        }
        $response.Close()
    } catch {
        # Catch unexpected listener client cuts silently
    }
}
