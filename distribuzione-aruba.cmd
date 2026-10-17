@echo off
rem Crea la distribuzione per Aruba in aruba\classifiche (doppio clic o da terminale).
rem Scarica prima i dati aggiornati dal cron giornaliero di GitHub, poi fa la build (scripts/dist-aruba.ts).
rem Con "distribuzione-aruba.cmd --update" aggiorna anche i dati in locale (richiede le chiavi nel .env).
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
echo Fatto. Carica con FileZilla il contenuto di aruba\classifiche nella cartella /classifiche del sito.
explorer "%~dp0aruba\classifiche"
pause
exit /b 0

:errore
echo.
echo Distribuzione NON creata: vedi gli errori sopra.
pause
exit /b 1
