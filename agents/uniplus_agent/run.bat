@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo Uniplus Agent - Computicket
echo ========================================
echo.

REM Preferir o .exe gerado pelo PyInstaller (producao)
if exist "dist\UniplusAgent.exe" (
  echo Iniciando dist\UniplusAgent.exe ...
  echo UI: http://localhost:5100
  echo.
  "dist\UniplusAgent.exe"
  set EXITCODE=%ERRORLEVEL%
  goto :after_run
)

REM Desenvolvimento: Python via .venv
where python >nul 2>&1
if errorlevel 1 (
  echo ERRO: Python nao encontrado no PATH e dist\UniplusAgent.exe ausente.
  echo Rode build.bat para gerar o .exe, ou instale Python 3.10+.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Ambiente .venv nao encontrado. Executando build.bat (gera .exe)...
  call "%~dp0build.bat"
  if errorlevel 1 (
    echo ERRO: build falhou.
    pause
    exit /b 1
  )
  if exist "dist\UniplusAgent.exe" (
    echo Iniciando dist\UniplusAgent.exe ...
    "dist\UniplusAgent.exe"
    set EXITCODE=%ERRORLEVEL%
    goto :after_run
  )
)

echo Iniciando UI em http://localhost:5100 (modo Python / .venv)...
echo.
call ".venv\Scripts\python.exe" app.py
set EXITCODE=%ERRORLEVEL%

:after_run
if not "%EXITCODE%"=="0" (
  echo.
  echo Agente encerrou com codigo %EXITCODE%.
)
pause
endlocal
exit /b %EXITCODE%
