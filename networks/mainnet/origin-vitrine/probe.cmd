@echo off
REM Prove THIS disk. Does not ignite the writer.
setlocal
call "%~dp0_house.cmd"
if not exist "%ROOT%\code\apps\kray-net\server.mjs" (
  echo missing %ROOT%\code — run sync-origin-vitrine.sh or pack-writer-vitrine.sh first
  exit /b 1
)
if not exist "%ROOT%\hot\ORIGIN-WRITER" (
  echo. > "%ROOT%\hot\ORIGIN-WRITER"
  echo pinned  %ROOT%\hot\ORIGIN-WRITER
)
cd /d "%ROOT%\code"
set "KRAY_HOT=%ROOT%\hot\node-hot.env"
set "KRAY_LOCAL_OVERLAY=%ROOT%\hot\origin-local.env"
set "KRAY_MACHINE_OVERLAY=%ROOT%\hot\machine.env"
set "KRAY_DATA=%ROOT%\state\data-main"
"%NODE%" --use-system-ca scripts\operator\start-mainnet-writer.mjs --probe-only
if errorlevel 1 exit /b 1
echo.
echo  probe green. writer still dark. tunnel may already be up.
