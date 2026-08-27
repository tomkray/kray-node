@echo off
REM MAINNET writer. Ignition. Do not run until probe.cmd is green.
setlocal
call "%~dp0_house.cmd"
if not exist "%ROOT%\hot\ORIGIN-WRITER" (
  echo refuse: touch %ROOT%\hot\ORIGIN-WRITER after probe.cmd is green
  exit /b 1
)
if not exist "%ROOT%\hot\origin-local.env" if not exist "%ROOT%\hot\machine.env" (
  echo refuse: copy machine.env.example to %ROOT%\hot\machine.env and fill THIS bitcoin.conf
  exit /b 1
)
cd /d "%ROOT%\code"
set "KRAY_HOT=%ROOT%\hot\node-hot.env"
set "KRAY_LOCAL_OVERLAY=%ROOT%\hot\origin-local.env"
set "KRAY_MACHINE_OVERLAY=%ROOT%\hot\machine.env"
set "KRAY_DATA=%ROOT%\state\data-main"
"%NODE%" --use-system-ca scripts\operator\start-mainnet-writer.mjs
