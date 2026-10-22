@echo off
rem Daily entry point used by Windows Task Scheduler. Runs a full run (DRY_RUN from .env decides drafts vs live).
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ==== %date% %time% ==== >> logs\scheduler.log
call npm start >> logs\scheduler.log 2>&1
