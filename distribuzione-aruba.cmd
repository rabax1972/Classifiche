@echo off
rem Crea la distribuzione per Aruba (doppio clic o da terminale): build completa in aruba\classifiche e, in aruba\modifiche,
rem solo i file nuovi o cambiati dall'ultima pubblicazione confermata (scripts/dist-aruba.ts).
rem Scarica prima i dati aggiornati dal cron giornaliero di GitHub.
rem Con "distribuzione-aruba.cmd --update" aggiorna anche i dati in locale (richiede le chiavi nel .env);
rem con "distribuzione-aruba.cmd --tutto" aruba\modifiche contiene tutti i file.
setlocal
cd /d "%~dp0"

echo Scarico gli ultimi dati da GitHub...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo git pull non riuscito: controlla le modifiche locali. Continuo con i dati presenti.
)

if not exist node_modules (
  echo Installo le dipendenze...
  call npm ci || goto :errore
)

call npm run dist:aruba -- %* || goto :errore

echo.
echo Carica con FileZilla il contenuto di aruba\modifiche nella cartella /classifiche del sito, sovrascrivendo i file.
if exist aruba\da-eliminare.txt echo Poi elimina dal sito i file elencati in aruba\da-eliminare.txt.
explorer "%~dp0aruba\modifiche"
echo.
choice /C SN /M "Hai finito di caricare i file sul sito"
if errorlevel 2 (
  echo.
  echo Pubblicazione non confermata: la prossima volta aruba\modifiche conterra' anche questi file.
  pause
  exit /b 0
)
call npm run dist:aruba -- --conferma || goto :errore
pause
exit /b 0

:errore
echo.
echo Distribuzione NON creata: vedi gli errori sopra.
pause
exit /b 1
