@echo off
echo Building Robotic Arm Controller...
echo.

REM Check if gcc is available
where gcc >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: gcc not found in PATH
    echo Please install MinGW-w64 and add it to your PATH
    echo Download from: https://www.mingw-w64.org/downloads/
    pause
    exit /b 1
)

REM Compile
gcc -Wall -O2 -o robotic_arm_controller.exe robotic_arm_controller.c -lgdi32 -luser32 -lcomdlg32 -lcomctl32

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful!
    echo Executable: robotic_arm_controller.exe
) else (
    echo.
    echo Build failed!
)

pause

