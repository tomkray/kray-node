@echo off
REM Detached ignition. Hidden window — closing an SSH console cannot take it with you.
REM A visible console only appears if YOU double-click start-writer.cmd on the
REM Origin desktop. Starting Normal from SSH dies with that session (502).
REM watch-writer.cmd is the only caller that should start this while :4478 is down.
cd /d "%~dp0"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%~dp0start-writer.cmd' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
exit /b 0
