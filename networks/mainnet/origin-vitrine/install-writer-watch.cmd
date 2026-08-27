@echo off
REM Minute watchdog + ONLOGON. Leaves a live :4478 alone. No secrets.
REM Logoff-proof needs the Windows password ONCE — see the last echo.
setlocal
call "%~dp0_house.cmd"
set "WATCH=%~dp0watch-writer.cmd"
if not exist "%WATCH%" (
  echo refuse: watch-writer.cmd missing
  exit /b 1
)
schtasks /Create /F /TN "KRAY-ORIGIN-WRITER-WATCH" /TR "\"%WATCH%\"" /SC MINUTE /MO 1
if errorlevel 1 (
  echo refuse: could not register the minute watch
  exit /b 1
)
schtasks /Create /F /TN "KRAY-ORIGIN-WRITER-ONLOGON" /TR "\"%WATCH%\"" /SC ONLOGON
if errorlevel 1 (
  echo refuse: minute watch is up; ONLOGON failed
  exit /b 1
)
echo   watch    KRAY-ORIGIN-WRITER-WATCH   every 1 min
echo   onlogon  KRAY-ORIGIN-WRITER-ONLOGON
echo   live     :4478 is left alone
echo   logoff   lock the screen — do not Sign Out.
echo   durable  on Origin, type YOUR Windows password once:
echo            schtasks /Change /TN KRAY-ORIGIN-WRITER-WATCH /RU %%USERNAME%% /RP
echo            schtasks /Change /TN KRAY-ORIGIN-WRITER-ONLOGON /RU %%USERNAME%% /RP
exit /b 0
