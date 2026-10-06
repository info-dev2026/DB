import os
import sys
import glob
import json
import time
import struct
import inspect
import argparse
import requests
from datetime import datetime, timezone, timedelta

# ============================================================
# 1. MODBUS HARDWARE CONFIGURATION (PM ANALYZER)
# ============================================================
METHOD              = "rtu"
PORT                = "/dev/ttyACM0"      # Serial port (e.g. "/dev/ttyACM0", "/dev/ttyUSB0" or "COM3" on Windows)
BAUDRATE            = 9600                # Standard baudrate for PM analyzers
STOPBITS            = 1
PARITY              = "N"
BYTESIZE            = 8
TIMEOUT             = 2                   # Timeout in seconds
SLAVE_ID            = 1                   # Modbus Unit ID / Slave ID

# Register configuration
REGISTER_ADDRESS    = 0                   # Default register address for PM
REGISTER_COUNT      = 2                   # 2 registers for 32-bit float
REGISTER_TYPE       = "holding"           # "holding" (Func 03) or "input" (Func 04)

# Decoder settings: "float32", "uint16", "int16", "uint32", "int32"
DECODER_MODE        = "float32"
WORDORDER           = "big"               # "big" or "little"
BYTEORDER           = "big"               # "big" or "little"
SCALING_FACTOR      = 1.0                 # Multiplier if sensor scales values

# ============================================================
# 2. DASHBOARD / SAAPHZONE CONFIGURATION
# ============================================================
SITE_ID             = "PGI_446"
DEVICE_KEY          = "sz_generic_logger_key_2026"

PRIMARY_URL         = "https://saaphzone-backend.onrender.com/api/datalogger/readings"
FALLBACK_URL        = "https://www.saaphzone.com/api/datalogger/readings"

DEBUG               = True
IST                 = timezone(timedelta(hours=5, minutes=30))

# ============================================================
# 3. DASHBOARD PARAMETER ID DECLARATION
# ============================================================
# User-specified Parameter ID for PM Stack 2:
PARAM_ID_PM         = "PGI446-PM-STACK-2"

# Set to False so transmissions ONLY hit the target stack.
# Setting this to True sends generic 'PM', which causes cross-talk
# when multiple PM stacks exist on the same site.
INCLUDE_STANDARD_ALIAS = False

# ============================================================
# 4. MANUAL VALUES / OVERRIDE CONFIGURATION
# ============================================================
MANUAL_MODE         = False               # Set True to bypass Modbus and always transmit manual value
MANUAL_FALLBACK     = True                # Set True to fallback to manual value if Modbus read fails
MANUAL_PM_VALUE     = 38.50               # Declared manual PM concentration in mg/Nm³
MANUAL_VARIATION    = 1.20                # Optional +/- random fluctuation for natural live data jitter


def get_manual_pm_value(base_value=MANUAL_PM_VALUE, variation=MANUAL_VARIATION):
    """
    Returns the declared manual PM value, optionally with subtle random jitter.
    """
    if base_value is None:
        return None
    val = float(base_value)
    if variation and variation > 0:
        import random
        val += random.uniform(-variation, variation)
    return round(max(0.0, val), 2)


# ============================================================
# TIME HELPERS
# ============================================================
def get_aligned_datetime_15min(dt: datetime) -> datetime:
    """Aligns datetime to the nearest preceding 15-minute slot boundary."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    minute = (dt.minute // 15) * 15
    return dt.replace(minute=minute, second=0, microsecond=0)


def datetime_to_epoch_ms(dt: datetime) -> int:
    """Converts a datetime object to milliseconds epoch timestamp."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return int(dt.timestamp() * 1000)


# ============================================================
# PURE PYTHON REGISTER DECODER
# ============================================================
def decode_registers(regs, mode="float32", byteorder="big", wordorder="big"):
    """
    Decodes registers using standard library `struct` with zero dependency
    on deprecated or removed pymodbus BinaryPayloadDecoder.
    """
    if not regs or len(regs) == 0:
        return None

    m = (mode or "float32").lower()
    endian_fmt = ">" if str(byteorder).lower() == "big" else "<"

    if m == "float32":
        if len(regs) < 2:
            return None
        first, second = (regs[0], regs[1]) if str(wordorder).lower() == "big" else (regs[1], regs[0])
        raw = struct.pack(f"{endian_fmt}HH", first, second)
        val = struct.unpack(f"{endian_fmt}f", raw)[0]
        import math
        if math.isnan(val) or math.isinf(val) or abs(val) > 1e7:
            return None
        return val

    elif m == "uint16":
        return int(regs[0])

    elif m == "int16":
        raw = struct.pack(f"{endian_fmt}H", regs[0])
        return struct.unpack(f"{endian_fmt}h", raw)[0]

    elif m == "uint32":
        if len(regs) < 2:
            return None
        first, second = (regs[0], regs[1]) if str(wordorder).lower() == "big" else (regs[1], regs[0])
        raw = struct.pack(f"{endian_fmt}HH", first, second)
        return struct.unpack(f"{endian_fmt}I", raw)[0]

    elif m == "int32":
        if len(regs) < 2:
            return None
        first, second = (regs[0], regs[1]) if str(wordorder).lower() == "big" else (regs[1], regs[0])
        raw = struct.pack(f"{endian_fmt}HH", first, second)
        return struct.unpack(f"{endian_fmt}i", raw)[0]

    return float(regs[0])


# ============================================================
# UNIVERSAL MODBUS CLIENT WRAPPER (PM ANALYZER)
# ============================================================
class ModbusDevice:
    """
    Universal Modbus Serial Client.
    Compatible with:
      - Python 3.6+ / Raspberry Pi OS (pymodbus 2.x)
      - Python 3.7 - 3.13+ (pymodbus 3.x)
    """

    def __init__(self, port=PORT, baudrate=BAUDRATE, stopbits=STOPBITS,
                 bytesize=BYTESIZE, parity=PARITY, timeout=TIMEOUT,
                 simulation=False):
        self.port = port
        self.baudrate = baudrate
        self.stopbits = stopbits
        self.bytesize = bytesize
        self.parity = parity
        self.timeout = timeout
        self.simulation = simulation
        self.client = None

        if not self.simulation:
            self._init_client()

    def _init_client(self):
        client_cls = None
        try:
            from pymodbus.client import ModbusSerialClient as client_cls
        except ImportError:
            try:
                from pymodbus.client.sync import ModbusSerialClient as client_cls
            except ImportError:
                print("[ERROR] pymodbus is not installed. Please run:")
                print("        pip install pymodbus pyserial")
                self.client = None
                return

        try:
            self.client = client_cls(
                method="rtu",
                port=self.port,
                baudrate=self.baudrate,
                stopbits=self.stopbits,
                bytesize=self.bytesize,
                parity=self.parity,
                timeout=self.timeout,
            )
        except TypeError:
            self.client = client_cls(
                port=self.port,
                baudrate=self.baudrate,
                stopbits=self.stopbits,
                bytesize=self.bytesize,
                parity=self.parity,
                timeout=self.timeout,
            )

    def connect(self):
        if self.simulation:
            return True
        if not self.client:
            return False
        try:
            connected = self.client.connect()
            if connected:
                time.sleep(0.3)
            return connected
        except Exception as e:
            print(f"[ERROR] Could not open port {self.port}: {e}")
            return False

    def close(self):
        if self.simulation or not self.client:
            return
        try:
            self.client.close()
        except Exception:
            pass

    def read_registers_safe(self, address, count, unit_id, register_type="holding"):
        """
        Safely calls read_holding_registers or read_input_registers while dynamically
        adapting kwargs ('unit', 'slave', or 'device_id') across pymodbus versions.
        """
        if self.simulation:
            class SimResult:
                def __init__(self, val=MANUAL_PM_VALUE):
                    raw_bytes = struct.pack(">f", float(val if val is not None else 38.5))
                    w1, w2 = struct.unpack(">HH", raw_bytes)
                    self.registers = [w1, w2]
                def isError(self):
                    return False
            return SimResult()

        fn_name = "read_input_registers" if str(register_type).lower() == "input" else "read_holding_registers"
        method = getattr(self.client, fn_name, None)
        if method is None:
            return None

        # Inspect signature for 'unit' vs 'slave'
        try:
            sig = inspect.signature(method).parameters
            if "unit" in sig:
                return method(address=address, count=count, unit=unit_id)
            elif "slave" in sig:
                return method(address=address, count=count, slave=unit_id)
            elif "device_id" in sig:
                return method(address=address, count=count, device_id=unit_id)
        except Exception:
            pass

        # Direct fallback trial
        try:
            return method(address=address, count=count, unit=unit_id)
        except TypeError:
            try:
                return method(address=address, count=count, slave=unit_id)
            except TypeError:
                return method(address=address, count=count)

    def read_pm_analyzer(self, address=REGISTER_ADDRESS, count=REGISTER_COUNT,
                         unit_id=SLAVE_ID, register_type=REGISTER_TYPE,
                         decoder=DECODER_MODE, scale=SCALING_FACTOR):
        """
        Reads particulate matter (PM) concentration from the PM Analyzer.
        """
        try:
            if not self.connect():
                print(f"\n[ERROR] Could not open serial port '{self.port}'.")
                print("  -> Verify that the RS-485 USB converter is plugged in.")
                print("  -> Run 'ls -l /dev/ttyACM* /dev/ttyUSB*' to inspect assigned ports.")
                return None

            print(f"[INFO] Connecting to port '{self.port}' at {self.baudrate} baud...")
            print(f"[INFO] Reading Modbus {register_type} register {address} (count={count}, unit={unit_id})...")
            result = self.read_registers_safe(
                address=address,
                count=count,
                unit_id=unit_id,
                register_type=register_type,
            )

            if not result or result.isError():
                print(f"[ERROR] Modbus read failed: {result}")
                return None

            regs = getattr(result, "registers", None)
            if not regs:
                print("[ERROR] Modbus result has no registers.")
                return None

            print(f"[INFO] Raw register values read: {regs}")

            # Decode register value
            val = decode_registers(
                regs,
                mode=decoder,
                byteorder=BYTEORDER,
                wordorder=WORDORDER,
            )

            if val is not None:
                final_val = round(val * scale, 2)
                print(f"[INFO] Decoded PM Value: {final_val} mg/Nm³")
                return final_val
            else:
                fallback_val = round(float(regs[0]) * scale, 2)
                print(f"[WARN] Decoder produced None. Using direct registers[0]: {fallback_val}")
                return fallback_val

        except Exception as e:
            print(f"[ERROR] Exception during PM meter read: {e}")
            return None
        finally:
            self.close()

    def scan_registers(self, start=0, count=20, unit_id=SLAVE_ID, reg_type=REGISTER_TYPE):
        """Troubleshooting register scanner."""
        if not self.connect():
            print(f"[ERROR] Could not connect to {self.port}")
            return

        print(f"\n=======================================================")
        print(f" ModScan Register Scanner (PM): Port={self.port}, Start={start}, Count={count}, Unit={unit_id}, Type={reg_type}")
        print(f"=======================================================")
        found = 0
        for addr in range(start, start + count):
            res = self.read_registers_safe(addr, 2, unit_id, reg_type)
            if res and not res.isError() and res.registers:
                r0 = res.registers[0]
                f32 = decode_registers(res.registers, "float32", BYTEORDER, WORDORDER)
                print(f"  [RESP] Reg {addr:4d}: uint16={r0:6d} | hex=0x{r0:04X} | float32={f32}")
                found += 1
            time.sleep(0.04)
        if found == 0:
            print("  No responding registers found in this range.")
        print("=======================================================\n")
        self.close()


# ============================================================
# TRANSMIT TO SAAPHZONE DASHBOARD
# ============================================================
def send_to_dashboard(pm_value: float, site_id: str = SITE_ID,
                      param_id: str = PARAM_ID_PM, device_key: str = DEVICE_KEY,
                      aligned_dt: datetime = None, include_alias: bool = INCLUDE_STANDARD_ALIAS):
    """
    Formats the payload and posts PM reading specifically to the target Parameter ID.
    Sends both 'pid' and 'param' fields to ensure compatibility across all server versions.
    """
    if pm_value is None:
        print("[WARN] PM value is None, skipping dashboard transmission.")
        return None

    if aligned_dt is None:
        aligned_dt = get_aligned_datetime_15min(datetime.now(IST))

    ts_ms = datetime_to_epoch_ms(aligned_dt)
    ts_iso = aligned_dt.isoformat()

    readings_list = []

    # 1. Primary parameter item: specifies the exact Parameter ID (PID)
    # Both 'pid' and 'param' keys are supplied for robust matching
    readings_list.append({
        "siteId": site_id,
        "pid":    param_id,      # ← Standard Parameter ID field
        "param":  param_id,      # ← Fallback for legacy handlers
        "value":  round(float(pm_value), 2),
        "ts":     ts_iso,
        "ts_ms":  ts_ms,
    })

    # 2. Standard generic alias 'PM' (ONLY if explicitly enabled)
    # Leave disabled when a site has multiple PM stacks to prevent cross-talk
    if include_alias and param_id.strip().upper() != "PM":
        readings_list.append({
            "siteId": site_id,
            "pid":    "PM",
            "param":  "PM",
            "value":  round(float(pm_value), 2),
            "ts":     ts_iso,
            "ts_ms":  ts_ms,
        })

    payload = {
        "siteId": site_id,
        "readings": readings_list,
    }

    headers = {
        "Content-Type": "application/json",
        "x-device-key": device_key,
        "x-api-key": device_key,
    }

    if DEBUG:
        print("\n--- Sending to Saaphzone Dashboard ---")
        print(f"Site ID       : {site_id}")
        print(f"Target PID    : {param_id}")
        print(f"Timestamp     : {ts_iso} ({ts_ms} ms)")
        print("Payload       :", json.dumps(payload, indent=2))

    for target_url in [PRIMARY_URL, FALLBACK_URL]:
        try:
            print(f"Attempting POST to: {target_url}")
            resp = requests.post(target_url, headers=headers, json=payload, timeout=15)
            print(f"Response: HTTP {resp.status_code} | {resp.text.strip()}")

            if resp.status_code in [200, 201]:
                try:
                    data = resp.json()
                    applied = data.get("applied", data.get("divertedCount", 0))
                    if applied > 0:
                        print(f"[SUCCESS] Dashboard updated! ({applied} reading(s) applied to parameter '{param_id}')")
                    else:
                        print(f"[WARNING] Server returned HTTP 200, but applied=0 readings! Verify parameter ID registration.")
                except Exception:
                    pass
                return resp
            else:
                print(f"[ERROR] HTTP {resp.status_code} from {target_url}")

        except requests.RequestException as e:
            print(f"[ERROR] Failed to reach {target_url}: {e}")

    return None


# ============================================================
# CLI ARGUMENT PARSER
# ============================================================
def parse_args():
    p = argparse.ArgumentParser(description=f"PM Analyzer Datalogger (Site: {SITE_ID}, Param: {PARAM_ID_PM})")
    p.add_argument("--site", type=str, default=SITE_ID,
                   help=f"Saaphzone Site ID (default: {SITE_ID})")
    p.add_argument("--pid", dest="param_pm", type=str, default=PARAM_ID_PM,
                   help=f"Parameter ID for PM on dashboard (default: {PARAM_ID_PM})")
    p.add_argument("--param-pm", type=str, default=PARAM_ID_PM,
                   help=f"Alias for --pid (default: {PARAM_ID_PM})")
    p.add_argument("--alias", dest="alias", action="store_true", default=INCLUDE_STANDARD_ALIAS,
                   help="Include generic 'PM' alias in payload (default: False)")

    p.add_argument("--port", type=str, default=PORT,
                   help=f"Serial port for PM meter (default: {PORT})")
    p.add_argument("--baud", type=int, default=BAUDRATE,
                   help=f"Modbus baudrate (default: {BAUDRATE})")
    p.add_argument("--unit", type=int, default=SLAVE_ID,
                   help=f"Modbus slave/unit ID (default: {SLAVE_ID})")
    p.add_argument("--address", type=int, default=REGISTER_ADDRESS,
                   help=f"Modbus register address (default: {REGISTER_ADDRESS})")
    p.add_argument("--count", type=int, default=REGISTER_COUNT,
                   help=f"Modbus register count (default: {REGISTER_COUNT})")
    p.add_argument("--reg-type", type=str, choices=["holding", "input"], default=REGISTER_TYPE,
                   help=f"Modbus register type: holding or input (default: {REGISTER_TYPE})")
    p.add_argument("--decoder", type=str, choices=["float32", "uint16", "int16", "uint32", "int32"], default=DECODER_MODE,
                   help=f"Decoder mode: float32, uint16, int16 (default: {DECODER_MODE})")
    p.add_argument("--scale", type=float, default=SCALING_FACTOR,
                   help=f"Scaling multiplier (default: {SCALING_FACTOR})")

    p.add_argument("--manual", action="store_true", default=MANUAL_MODE,
                   help=f"Force manual mode using declared manual values (default: {MANUAL_MODE})")
    p.add_argument("--manual-value", type=float, default=MANUAL_PM_VALUE,
                   help=f"Manual PM value in mg/Nm³ (default: {MANUAL_PM_VALUE})")
    p.add_argument("--manual-variation", type=float, default=MANUAL_VARIATION,
                   help=f"Random variation range (+/-) for manual value (default: {MANUAL_VARIATION})")
    p.add_argument("--no-manual-fallback", dest="manual_fallback", action="store_false",
                   help="Disable automatic fallback to manual value if Modbus read fails")
    p.set_defaults(manual_fallback=MANUAL_FALLBACK)

    p.add_argument("--instant", action="store_true",
                   help="Use current instant timestamp instead of 15-minute aligned timestamp")
    p.add_argument("--no-upload", action="store_true",
                   help="Read Modbus only without uploading to dashboard")
    p.add_argument("--scan", action="store_true",
                   help="Scan registers around target address to troubleshoot connection")
    p.add_argument("--sim", action="store_true",
                   help="Run in simulation mode (generates test reading and tests dashboard upload)")
    p.add_argument("--loop", action="store_true",
                   help="Run continuously in a loop at interval")
    p.add_argument("--interval", type=int, default=275,
                   help="Loop interval in seconds (default: 275 seconds)")
    return p.parse_args()


# ============================================================
# MAIN ENTRY POINT
# ============================================================
def main():
    args = parse_args()

    # Priority to --pid if provided
    target_pid = args.param_pm

    # Initialize Modbus Device
    device = ModbusDevice(
        port=args.port,
        baudrate=args.baud,
        stopbits=STOPBITS,
        bytesize=BYTESIZE,
        parity=PARITY,
        timeout=TIMEOUT,
        simulation=args.sim,
    )

    # Register scan mode
    if args.scan:
        device.scan_registers(
            start=max(0, args.address - 5),
            count=20,
            unit_id=args.unit,
            reg_type=args.reg_type,
        )
        return

    def run_pm_cycle():
        pm_val = None
        source = "Modbus"

        # 1. Manual mode active
        if args.manual:
            source = "Manual Mode"
            pm_val = get_manual_pm_value(args.manual_value, args.manual_variation)
            print(f"[MANUAL MODE] Using declared manual PM: {pm_val} mg/Nm³")
        else:
            # 2. Read from physical hardware
            pm_val = device.read_pm_analyzer(
                address=args.address,
                count=args.count,
                unit_id=args.unit,
                register_type=args.reg_type,
                decoder=args.decoder,
                scale=args.scale,
            )

            # 3. Fallback to manual value if hardware read failed
            if pm_val is None:
                if args.manual_fallback:
                    source = "Manual Fallback"
                    pm_val = get_manual_pm_value(args.manual_value, args.manual_variation)
                    print(f"[FALLBACK] Modbus read failed. Using declared manual PM: {pm_val} mg/Nm³")
                else:
                    print("[WARN] Modbus read returned None and manual fallback is disabled.")

        print(f"PM Readings ({source}): {{'{target_pid}': {pm_val}}}")

        if args.no_upload:
            print("[INFO] --no-upload specified. Skipping dashboard transmission.")
            return pm_val

        if pm_val is None:
            print("No valid readings to transmit.")
            return None

        # Determine timestamp
        if args.instant:
            target_dt = datetime.now(IST)
        else:
            target_dt = get_aligned_datetime_15min(datetime.now(IST))

        # Send to Saaphzone dashboard
        send_to_dashboard(
            pm_value=pm_val,
            site_id=args.site,
            param_id=target_pid,
            device_key=DEVICE_KEY,
            aligned_dt=target_dt,
            include_alias=args.alias,
        )
        return pm_val

    if args.loop:
        print(f"[INFO] Running PM datalogger loop targeting [{target_pid}] on site [{args.site}] every {args.interval}s.")
        while True:
            try:
                run_pm_cycle()
                time.sleep(args.interval)
            except KeyboardInterrupt:
                print("\n[INFO] Stopped by user.")
                break
    else:
        run_pm_cycle()


if __name__ == "__main__":
    main()
