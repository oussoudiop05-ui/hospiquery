@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python est introuvable. Installez Python ou ajoutez-le au PATH.
  pause
  exit /b 1
)

curl --silent --fail http://127.0.0.1:8778/_hq/health >nul 2>nul
if errorlevel 1 (
  start "HospiQuery serveur local" /min cmd /c "cd /d ""%~dp0"" && python local_server.py"
  set /a attempts=0
  :wait_for_server
  curl --silent --fail http://127.0.0.1:8778/_hq/health >nul 2>nul
  if not errorlevel 1 goto open_app
  set /a attempts+=1
  if %attempts% geq 20 (
    echo Le serveur HospiQuery n'a pas demarre sur le port 8778.
    pause
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  goto wait_for_server
)

:open_app
start "" http://localhost:8778
endlocal
