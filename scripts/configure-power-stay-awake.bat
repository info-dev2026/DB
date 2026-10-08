@echo off
echo ============================================================
echo   Saaphzone OCEMS - Keep Laptop Awake Configuration
echo ============================================================
echo Configuring Windows Power Management so data transmission
echo continues uninterrupted when the laptop lid is closed...
echo.

:: 1. Set Lid Close Action to Do Nothing (0) for AC and DC
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0

:: 2. Disable USB Selective Suspend (Prevents Modbus USB-RS485 adapter disconnects)
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0

:: 3. Set Wireless Adapter to Maximum Performance (Prevents Wi-Fi sleep)
powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0
powercfg /setdcvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0

:: 4. Disable Standby Idle & Hibernate Idle Timeouts
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0

:: Apply active power scheme
powercfg /setactive SCHEME_CURRENT

echo.
echo [SUCCESS] Windows Power Scheme updated!
echo - When lid is closed: DO NOTHING (Laptop stays awake)
echo - USB serial / Modbus adapters: ALWAYS ON
echo - Wi-Fi network: MAXIMUM PERFORMANCE (Never drops)
echo - Sleep / Hibernate timeouts: DISABLED
echo ============================================================
if "%1"=="" (
    pause
)
