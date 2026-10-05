# LetsGoSport

LetsGoSport è un'applicazione web per la gestione di un'associazione sportiva. Riunisce in un solo sito la pubblicazione di corsi e gare, la registrazione degli utenti, le iscrizioni, il profilo personale e la comunicazione in tempo reale.

L'obiettivo è offrire un punto unico per consultare le attività e gestire utenti, partecipazioni e comunicazioni.

Funzioni principali:

- catalogo pubblico di corsi, gare e coach;
- registrazione, login, logout e profilo personale;
- iscrizione e disiscrizione da corsi e gare;
- chat generale, chat di corsi e gare e chat private;
- allegati e messaggi vocali;
- chiamate audio/video e condivisione dello schermo;
- gestione di utenti, corsi e gare;
- interfaccia responsive e supporto PWA parziale.

I ruoli applicativi sono:

- **PARTNER**: consulta le attività, gestisce il profilo, si iscrive e usa le chat autorizzate;
- **COACH**: dispone anche dell'area coach, visualizza i propri corsi e gli iscritti e modera le chat consentite;
- **ADMIN**: gestisce utenti, ruoli, corsi, gare e contenuti delle chat.

## Tecnologie utilizzate

| Tecnologia | Utilizzo nel progetto |
| --- | --- |
| HTML5, CSS3 e JavaScript | Interfaccia, responsive design e logica eseguita nel browser |
| Node.js ed Express 5 | Server HTTP, API e middleware |
| MySQL e `mysql2` | Persistenza di utenti, corsi, gare, iscrizioni, messaggi e sessioni |
| Socket.IO | Chat, presenza, digitazione e segnalazione delle chiamate |
| WebRTC e MediaRecorder | Audio, video, condivisione schermo e messaggi vocali |
| Multer | Caricamento controllato di immagini, PDF e audio |
| bcrypt | Hash e verifica delle password |
| `express-session` e `express-mysql-session` | Sessioni autenticate conservate in MySQL |
| Axios | Verifica server-side di Google reCAPTCHA |
| Manifest e service worker | Installazione PWA e cache degli asset statici |
| dotenv | Caricamento della configurazione da `.env` |
| Render | Predisposizione per la distribuzione online tramite `PORT`, proxy HTTPS e variabili d'ambiente |

Il progetto **non usa PHP**: il backend è interamente implementato con Node.js ed Express.

## Struttura del progetto

```text
Letsgosport/
├── server.js                       # avvio HTTP, Socket.IO e WebRTC signaling
├── routes/                         # API di autenticazione, utenti, coach e admin
├── config/                         # connessione MySQL e configurazione upload
├── utils/                          # validazione e controlli di sicurezza
├── database/
│   ├── consegna_universitaria.sql  # creazione completa del database
│   └── migrations/                 # migrazioni incrementali
└── public/
    ├── index.html                  # interfaccia principale
    ├── js/                         # moduli JavaScript del browser
    ├── css/                        # stili generali e delle aree applicative
    ├── uploads/                    # asset statici e file caricati dall'applicazione
    ├── manifest.json               # configurazione PWA
    └── sw.js                       # service worker
```

File e cartelle principali:

- `server.js` configura Express, sessioni, file statici, API, Socket.IO, chat e segnalazione WebRTC;
- `routes/` contiene le route pubbliche, di autenticazione, utente, coach e amministratore;
- `config/db.js` crea il pool MySQL e verifica la connessione prima dell'avvio;
- `config/upload.js` configura Multer e controlla dimensione, MIME, estensione e firma dei file;
- `utils/` contiene validazione, percorsi sicuri, token degli allegati e controlli Socket.IO;
- `database/consegna_universitaria.sql` crea lo schema completo;
- `public/js/` contiene la logica dell'interfaccia, della chat e delle chiamate;
- `public/css/` contiene gli stili responsive;
- `public/uploads/` contiene pulsanti, immagini predefinite, catalogo, slider e upload dinamici.

## Requisiti per l'avvio locale

- **Node.js 18 o successivo**. `package.json` non blocca una versione precisa, ma Express 5.2.1 e bcrypt 6 richiedono Node.js almeno 18. È consigliata una versione LTS.
- **npm**, normalmente installato insieme a Node.js.
- **MySQL Server** raggiungibile dal computer.
- **Git**, necessario se il repository viene clonato.
- **MySQL Workbench** o un altro client MySQL per importare lo script SQL.

Non sono richiesti PHP, Apache o XAMPP.

## Installazione locale

### 1. Scaricare il progetto

Clonazione con Git:

```powershell
git clone https://github.com/zRoby03/Letsgosport.git
cd Letsgosport
```

In alternativa, estrarre l'archivio del progetto e aprire PowerShell nella cartella che contiene `package.json`.

### 2. Installare le dipendenze

Poiché il repository contiene `package-lock.json`, il comando consigliato è:

```powershell
npm ci
```

In alternativa è possibile usare `npm install`.

### 3. Creare il database

Avviare MySQL e importare:

```text
database/consegna_universitaria.sql
```

Lo script crea il database `letsgosport`, tutte le tabelle necessarie e un account amministratore dimostrativo. Non inserisce corsi o gare dimostrativi. **Attenzione:** contiene istruzioni `DROP TABLE`; deve quindi essere importato soltanto in un ambiente locale o in un database che può essere ricreato.

Con MySQL Workbench è possibile aprire il file ed eseguirlo. Da PowerShell, se il client `mysql` è disponibile nel `PATH`:

```powershell
Get-Content .\database\consegna_universitaria.sql -Raw | mysql -u root -p
```

#### Account amministratore locale

Dopo l'importazione dello script è disponibile questo account per la valutazione:

| Ruolo | Email | Password |
| --- | --- | --- |
| `ADMIN` | `adminlocale@test.it` | `11111111` |

La password non viene salvata in chiaro nel database: lo script contiene il relativo hash bcrypt. L'account è destinato esclusivamente alle prove locali e alla consegna universitaria. Non usare queste credenziali in produzione e non importare lo script senza modifiche in un database pubblico.

### 4. Creare il file `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Compilare almeno `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` e `SESSION_SECRET`.

### 5. Avviare il server

```powershell
npm start
```

Con la configurazione predefinita il terminale deve mostrare:

```text
Connessione al database verificata.
Server attivo sulla porta 3000
```

Aprire quindi [http://localhost:3000](http://localhost:3000).

Il sito deve essere aperto tramite il server Node.js. **Non aprire direttamente `public/index.html`**, perché le API, le sessioni e Socket.IO non sarebbero disponibili.

## Avvio del progetto

I comandi definiti e compatibili con `package.json` sono:

```powershell
npm ci
npm start
```

`npm start` esegue `node server.js`. È disponibile anche `npm run dev`, che al momento esegue lo stesso comando.

Indirizzi utili:

- applicazione: [http://localhost:3000](http://localhost:3000);
- health check: [http://localhost:3000/api/health](http://localhost:3000/api/health).

Una risposta corretta del health check contiene `status: "ok"`, `database: "connected"` e `release: "local"`.

## Versione online

### Visitare il sito già pubblicato

La versione pubblica è disponibile su Render:

- **applicazione:** [https://letsgosport.onrender.com](https://letsgosport.onrender.com);
- **controllo server e database:** [https://letsgosport.onrender.com/api/health](https://letsgosport.onrender.com/api/health).

Per visitarla non servono Node.js, MySQL o l'installazione del repository: è sufficiente aprire il primo collegamento in un browser moderno con JavaScript e cookie abilitati. La registrazione pubblica crea un account `PARTNER`; le aree `COACH` e `ADMIN` richiedono account con quei ruoli già presenti nel database online. Per chiamate, videochiamate, messaggi vocali e condivisione dello schermo il browser chiederà anche i relativi permessi.

Il primo caricamento può richiedere più tempo se il servizio Render è inattivo e deve riavviarsi. In tal caso attendere qualche secondo, ricaricare la pagina e controllare l'endpoint `/api/health`.

### Come funziona il collegamento online

1. Il browser apre il dominio Render tramite HTTPS e riceve `index.html`, CSS, JavaScript e immagini dal server Express.
2. Il frontend usa richieste `fetch` verso le API `/api/...` dello stesso dominio. Express valida i dati e la sessione, interroga il database MySQL remoto e restituisce JSON.
3. Il cookie di sessione è `httpOnly`, `sameSite=lax` e, in produzione, `secure`; la sessione viene conservata in MySQL e non nel browser.
4. Socket.IO mantiene il canale in tempo reale per chat, presenza, digitazione e segnalazione delle chiamate.
5. Dopo la segnalazione, audio, video e schermo viaggiano tramite WebRTC tra i browser quando la rete lo consente. Il progetto usa server STUN ma non configura un server TURN, quindi alcune reti aziendali, universitarie o particolarmente restrittive possono impedire la chiamata.

La versione locale e quella online sono due esecuzioni separate: usano indirizzi e database differenti. Un account creato in locale non compare automaticamente online e viceversa. Di conseguenza, l'account `adminlocale@test.it` è garantito soltanto dopo l'importazione locale di `database/consegna_universitaria.sql` e non deve essere considerato disponibile sul sito Render.
