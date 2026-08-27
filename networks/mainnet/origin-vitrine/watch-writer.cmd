@echo off
REM If :4478 is already the live writer, do nothing. If it died, detach-start.
REM Safe to run every minute. Never a second ORIGIN-WRITER while 4478 listens.
setlocal
netstat -ano | findstr ":4478" | findstr "LISTENING" >nul
if %ERRORLEVEL%==0 exit /b 0
cd /d "%~dp0"
call start-writer-detached.cmd
exit /b 0
