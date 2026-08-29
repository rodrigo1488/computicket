@echo off
setlocal
cd /d "%~dp0"

set "VENV_PY=%~dp0app\.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo [ERRO] Venv nao encontrado em app\.venv
  echo Crie com: python -m venv app\.venv
  echo Depois: app\.venv\Scripts\pip install -r requirements.txt
  pause
  exit /b 1
)

echo Iniciando API Flask em http://127.0.0.1:5000 ...
"%VENV_PY%" run.py
pause
