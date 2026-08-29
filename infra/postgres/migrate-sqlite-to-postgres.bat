@echo off
setlocal EnableExtensions
chcp 65001 >nul

REM ============================================================
REM  Migra tickets.sqlite3 -> PostgreSQL (database computicket)
REM  Uso:  migrate-sqlite-to-postgres.bat
REM        migrate-sqlite-to-postgres.bat "C:\caminho\tickets.sqlite3"
REM ============================================================

set "ROOT=%~dp0"
REM Sobe ate a raiz do repo se o .bat estiver em infra\postgres\
if exist "%ROOT%..\..\docker-compose.whatsapp.yml" (
  pushd "%ROOT%..\.."
) else if exist "%ROOT%docker-compose.whatsapp.yml" (
  pushd "%ROOT%"
) else (
  echo [ERRO] Nao encontrei docker-compose.whatsapp.yml a partir de "%ROOT%"
  exit /b 1
)

set "REPO=%CD%"
set "APP_DIR=%REPO%\api\app"
set "COMPOSE=%REPO%\docker-compose.whatsapp.yml"
set "URI=postgresql+psycopg2://computicket:computicket@localhost:15432/computicket"
set "SQLALCHEMY_DATABASE_URI=%URI%"

set "PY=%APP_DIR%\.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo.
echo === Computicket: migracao SQLite -^> PostgreSQL ===
echo Repo:   %REPO%
echo App:    %APP_DIR%
echo Destino: %URI%
echo.

REM ---- 1) Postgres no Docker ----
echo [1/4] Subindo Postgres (docker compose)...
docker compose -f "%COMPOSE%" up -d postgres
if errorlevel 1 (
  echo [ERRO] Falha ao subir o Postgres. O Docker Desktop esta rodando?
  popd
  exit /b 1
)

echo Aguardando Postgres ficar healthy...
set /a _tries=0
:wait_pg
set /a _tries+=1
docker compose -f "%COMPOSE%" exec -T postgres pg_isready -U computicket >nul 2>&1
if errorlevel 1 (
  if %_tries% GEQ 30 (
    echo [ERRO] Timeout aguardando Postgres.
    popd
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto wait_pg
)
echo       Postgres OK.

REM ---- 2) Database computicket ----
echo [2/4] Garantindo database "computicket"...
docker compose -f "%COMPOSE%" exec -T postgres psql -U computicket -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='computicket'" | findstr /r "^1" >nul
if errorlevel 1 (
  docker compose -f "%COMPOSE%" exec -T postgres psql -U computicket -d postgres -c "CREATE DATABASE computicket;"
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel criar o database computicket.
    popd
    exit /b 1
  )
  echo       Database criado.
) else (
  echo       Database ja existe.
)

REM ---- 3) Fonte SQLite ----
set "SQLITE=%~1"
if not "%SQLITE%"=="" goto have_sqlite

set "CAND_A=%REPO%\api\instance\tickets.sqlite3"
set "CAND_B=%APP_DIR%\instance\tickets.sqlite3"
set "SIZE_A=0"
set "SIZE_B=0"
if exist "%CAND_A%" for %%A in ("%CAND_A%") do set "SIZE_A=%%~zA"
if exist "%CAND_B%" for %%B in ("%CAND_B%") do set "SIZE_B=%%~zB"

if %SIZE_A% GEQ %SIZE_B% (
  if exist "%CAND_A%" (set "SQLITE=%CAND_A%") else if exist "%CAND_B%" (set "SQLITE=%CAND_B%")
) else (
  set "SQLITE=%CAND_B%"
)

:have_sqlite
if "%SQLITE%"=="" (
  echo [ERRO] Nenhum tickets.sqlite3 encontrado.
  echo        Passe o caminho: migrate-sqlite-to-postgres.bat "C:\caminho\tickets.sqlite3"
  popd
  exit /b 1
)
if not exist "%SQLITE%" (
  echo [ERRO] Arquivo nao encontrado: %SQLITE%
  popd
  exit /b 1
)
echo [3/4] Fonte SQLite: %SQLITE%

REM ---- 4) Migrar ----
echo [4/4] Executando migrate_sqlite_to_postgres.py --wipe ...
echo.
pushd "%APP_DIR%"
"%PY%" tools\migrate_sqlite_to_postgres.py --wipe --sqlite "%SQLITE%" --uri "%URI%"
set "RC=%ERRORLEVEL%"
popd

echo.
if not "%RC%"=="0" (
  echo [FALHA] Migracao terminou com codigo %RC%.
  popd
  exit /b %RC%
)

echo [OK] Migracao concluida.
echo      Reinicie a API (run.py) para usar o Postgres.
echo      URI no .env: SQLALCHEMY_DATABASE_URI=%URI%
echo.
popd
endlocal
exit /b 0
