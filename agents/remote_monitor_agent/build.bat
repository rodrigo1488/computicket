@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
  if errorlevel 1 py -3 -m venv .venv
  if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements-build.txt
if errorlevel 1 exit /b 1
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean ComputicketMonitorAgent.spec
if errorlevel 1 exit /b 1
if not exist "dist\ComputicketMonitorAgent.exe" (
  echo ERRO: binario esperado nao foi gerado.
  exit /b 1
)
echo Gerado: dist\ComputicketMonitorAgent.exe
