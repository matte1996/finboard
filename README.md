# Finboard - Financial Dashboard SPA

Finboard è una dashboard finanziaria premium sviluppata in modalità Single-Page Application (SPA) client-side. L'applicazione è progettata per essere estremamente leggera, sicura ed efficiente, offrendo al contempo una sincronizzazione e persistenza fisica dei dati tramite un backend PowerShell locale.

## 🚀 Come Iniziare

Puoi avviare Finboard in due modalità:

### 1. Modalità Server Locale (Consigliata)
Questa modalità abilita il caricamento/salvataggio dei dati direttamente sul disco (cartelle dei portafogli fisiche) ed evita i limiti delle API pubbliche e del CORS.
1. Fai doppio clic sul file **`start.bat`** per avviare il server PowerShell locale (`server.ps1`).
2. Il server si avvierà in background sulla porta `8080` e aprirà automaticamente l'applicazione nel browser predefinito all'indirizzo:
   👉 **http://localhost:8080/**

### 2. Modalità Statico (Senza Server)
Se desideri una consultazione rapida senza backend locale:
1. Apri direttamente nel browser il file:
   👉 **[index.html](index.html)**
   *Nota: In questa modalità i dati del portafoglio sono salvati nel `localStorage` del browser e viene usato il fallback CORS pubblico per le API.*

---

## ✨ Funzionalità Chiave

1. **Sincronizzazione Fisica e Multi-Portafoglio**:
   - Crea, modifica ed elimina portafogli reali.
   - Ogni portafoglio è memorizzato in una cartella fisica all'interno della directory `input/` (`finboard/input/<nome_portafoglio>/`) contenente:
     - `metadata.json`: Informazioni sulle posizioni (Ticker, quantità, P.M.C., liquidità).
     - `patrimonio.csv`: Storico giornaliero del patrimonio.
   - La cartella `input/` è esclusa da `.gitignore` per tutelare la privacy e sicurezza dei dati finanziari personali, lasciando facoltativamente tracciato solo il `Portafoglio Demo`.
2. **Andamento Real-Time e Storico Integrato**:
   - Calcola il valore in tempo reale del portafoglio prendendo come riferimento i prezzi correnti delle posizioni.
   - I dati della homepage mostrano i totali sincronizzati in tempo reale e aggiornati.
3. **Sezione 'Patrimonio'**:
   - Visualizza l'andamento nel tempo del portafoglio tramite grafici Chart.js interattivi generati a partire dal file `patrimonio.csv`.
4. **Supporto Asset Speciali (Titoli di Stato, Fondi Pensione e Classificazioni Miste)**:
   - **BTP Italiani**: Gestione nativa dei BTP tramite ISIN (es. `IT0005442097`). I dati su nome, quotazione e storico per i grafici sparkline vengono recuperati automaticamente in tempo reale tramite scraping da Borsa Italiana.
   - **Fondo Fonte Dinamico**: Gestione nativa inserendo `FONTE-DINAMICO`. Il sistema recupera i valori quota mensili ufficiali dal sito Fondo Fonte e ne ricostruisce lo storico reale degli ultimi 25 mesi. Classificato come `Mixed (60/40)` (60% Azionario, 40% Obbligazionario).
   - **Amundi Secondapensione Espansione ESG**: Gestione nativa tramite ISIN `QS0000003561` o inserendo `AMUNDI-ESPANSIONE`. Il server interroga le API REST ufficiali di Amundi ricavando il NAV corrente e ricostruendo lo storico degli ultimi 30 mesi per gli sparkline. Classificato come `Mixed (80/20)` (80% Azionario, 20% Obbligazionario).
   - **Asset Allocation Dinamica**: I prodotti classificati come `Mixed (60/40)` e `Mixed (80/20)` vengono scorporati automaticamente nei calcoli di allocazione per mostrare correttamente le quote di Azionario e Obbligazionario nel grafico a torta.
5. **Cerca Titolo**:
   - Ricerca in tempo reale azioni ed ETF globali con suggerimenti automatici, grafici sparkline e statistiche di prezzo.

---

## 📂 Struttura del Progetto

- **`input/`**: Directory contenitore di tutti i singoli portafogli fisici gestiti dall'app (ciascuno con i relativi `metadata.json` e `patrimonio.csv`).
- **`index.html`**: Layout dell'applicazione, pannelli e modali.
- **`styles.css`**: Fogli di stile CSS con tema scuro premium e responsive design.
- **`app.js`**: Logica applicativa frontend, gestione grafici Chart.js e integrazione con il backend locale.
- **`server.ps1`**: Server web locale e proxy API CORS-free scritto in PowerShell. Implementa i motori di scraping per BTP, Fondo Fonte ed Amundi.
- **`start.bat`**: Script batch Windows per avviare rapidamente il server.
- **`.gitignore`**: Esclude i dati finanziari personali in `input/` consentendo il controllo versione del codice in sicurezza.

---

## 📊 Specifiche e Struttura del file `patrimonio.csv`

L'applicazione analizza lo storico del patrimonio caricando il file `patrimonio.csv` associato al portafoglio. Qualora la struttura del file fornito dal broker dovesse cambiare, le modifiche dovranno essere apportate alla funzione `parseBrokerCsv` in `app.js`.

Ecco i dettagli della struttura attesa ed i punti testati dal codice:

### 1. Formato Generale
* **Delimitatore**: Punto e virgola (`;`).
* **Righe di Intestazione**: La riga **8** (riga a indice 7 nel codice) contiene le intestazioni di colonna (`Date;Liquidità;...`). I dati effettivi iniziano a partire dalla riga **9** (indice 8).

### 2. Mappatura delle Colonne (0-indexed)
* **Colonna A (Indice 0) - Data Storico**: Contiene la data della rilevazione temporale del patrimonio (es: `8/17/23` o `17-08-2023`).
* **Colonna F (Indice 5) - Valore Patrimonio**: Il valore totale del patrimonio a quella data (es: `12500,50` o `€ 12.500,50`). Il parser rimuove i caratteri non numerici ed effettua la conversione automatica dei decimali con la virgola.
* **Colonna I (Indice 8) - Data Transazione**: Contiene la data in cui è avvenuto un versamento, prelievo o addebito di bollo.
* **Colonna J (Indice 9) - Descrizione Movimento**: La causale del movimento. Viene confrontata (case-insensitive) con le seguenti parole chiave per catalogare l'operazione:
  * `"conferimento titoli"` o `"conferimento con bonifico"`: Riconosciuto come **Versamento** (accumula con segno positivo).
  * `"prelievo bonifico"`: Riconosciuto come **Prelievo** (accumula con segno negativo).
  * `"bollo"`: Riconosciuto come addebito di bollo (accumulato nel totale dei bolli pagati).
* **Colonna K (Indice 10) - Importo Movimento**: L'importo monetario del versamento/prelievo/bollo associato alla transazione (es: `1000` o `1.000,00`).

### 3. Formati Data Supportati
Il parser implementa una logica flessibile di decodifica nella funzione `parseBrokerDate`:
1. `M/D/Y` o `MM/DD/YYYY` (es. `12/31/24` o `12/31/2024`) -> Convertito in standard ISO `YYYY-MM-DD`.
2. `YYYY-MM-DD` o `YYYY.MM.DD` -> Riconosciuto direttamente.
3. `DD-MM-YYYY` o `DD.MM.YYYY` (es. `31-12-2024`) -> Convertito invertendo l'ordine in `YYYY-MM-DD`.
