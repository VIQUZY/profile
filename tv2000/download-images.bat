@echo off
rem Downloads all longread images from Tilda into the images\ folder (Windows).
rem Double-click this file. Already downloaded files are skipped.

cd /d "%~dp0"
if not exist images mkdir images

for /f "usebackq tokens=1,2" %%a in ("images.txt") do (
  if not exist "images\%%a" (
    echo %%a
    curl -fsSL --retry 3 -o "images\%%a" "%%b" || echo   FAILED: %%b
  )
)

echo.
echo Done. If some files FAILED, run this file again.
pause
