@echo off
setlocal
cd /d "%~dp0.."
set "STUDIO_DESIGN_REVIEW=1"
set "STUDIO_DESIGN_REVIEW_ART=1"
set "STUDIO_REVIEW_STORE=%LOCALAPPDATA%\Fivefold Arc\Appearance Studio\custom-skins-review.json"
node qa\appearance-studio-local.mjs 8793
