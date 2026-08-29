@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo Uniplus Agent - Build EXE (PyInstaller)
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo ERRO: Python nao encontrado no PATH.
  echo Instale Python 3.10+ e marque "Add python.exe to PATH".
  exit /b 1
)

if not exist "UniplusAgent.spec" (
  echo ERRO: UniplusAgent.spec nao encontrado neste diretorio.
  echo O arquivo deve estar versionado no repositorio.
  exit /b 1
)

if not exist "templates\" (
  echo ERRO: pasta templates\ nao encontrada.
  exit /b 1
)

echo [1/6] Criando/atualizando ambiente virtual (.venv)...
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 (
    echo ERRO: falha ao criar .venv
    exit /b 1
  )
) else (
  echo .venv ja existe — reutilizando.
)

echo.
echo [2/6] Instalando dependencias de runtime e build...
call ".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo ERRO: falha ao atualizar pip.
  exit /b 1
)
call ".venv\Scripts\pip.exe" install -r requirements.txt -r requirements-build.txt
if errorlevel 1 (
  echo ERRO: falha ao instalar requirements.
  exit /b 1
)

echo.
echo [3/6] Gerando icone assets\uniplus_agent.ico...
call ".venv\Scripts\python.exe" make_icon.py
if errorlevel 1 (
  echo ERRO: falha ao gerar icone.
  exit /b 1
)
if not exist "assets\uniplus_agent.ico" (
  echo ERRO: assets\uniplus_agent.ico nao foi gerado.
  exit /b 1
)

echo.
echo [4/6] Smoke-check de imports...
call ".venv\Scripts\python.exe" -c "import flask; import socketio; import websocket; import psycopg2; import pystray; import PIL; import db; import agent; import unico_handler; import tray; import app; print('OK: imports OK')"
if errorlevel 1 (
  echo ERRO: smoke-check de imports falhou.
  exit /b 1
)

echo.
echo [5/6] Verificando PyInstaller...
call ".venv\Scripts\python.exe" -m PyInstaller --version
if errorlevel 1 (
  echo PyInstaller nao encontrado apos instalacao.
  exit /b 1
)

echo.
echo [6/6] Gerando executavel com UniplusAgent.spec (console=False)...
call ".venv\Scripts\python.exe" -m PyInstaller --noconfirm UniplusAgent.spec
if errorlevel 1 (
  echo Build falhou.
  exit /b 1
)

if not exist "dist\UniplusAgent.exe" (
  echo ERRO: dist\UniplusAgent.exe nao foi gerado.
  exit /b 1
)

echo.
echo ========================================
echo Build concluido com sucesso!
echo Saida: %CD%\dist\UniplusAgent.exe
echo ========================================
dir "dist\UniplusAgent.exe"
echo.
echo O .exe roda SEM console (windowed) com icone na bandeja do Windows.
echo Menu: Abrir configuracao / Ver logs / Status / Sair.
echo UI: http://localhost:5100
echo Logs do console: agent_console.log (ao lado do .exe).
echo O agent.db e criado ao lado do .exe.
echo.
endlocal
exit /b 0
