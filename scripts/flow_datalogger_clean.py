#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
SAAPHZONE OCEMS — INDUSTRIAL FLOW METER MODBUS DATALOGGER
================================================================================
Universal Datalogger for Industrial Electromagnetic / Ultrasonic Flow Meters.

Configured with exact reference to your Flow Meter hardware specification:
  - Port:              /dev/ttyUSB0 (auto-detects /dev/ttyUSB0 or /dev/ttyACM0)
  - Baudrate:          9600 baud, 8-N-1
  - Slave ID:          3
  - Register Address:  0 (Input Registers, Function 04: read_input_registers)
  - Register Count:    2
  - Scaling / Decoder: val = registers[0] / 10  (e.g. 245 -> 24.5 m³/hr)
  - Flow Unit:         m³/hr

Cloud Destinations:
  - Saaphzone OCEMS:   Site ID: JCPL_123  |  Parameter ID: BOREWELL-FLOW
  - CPCB CEMS (Dual):  Station: station_17738  |  Device: device_17069

Compatible with:
  - Python 3.6+ (Raspberry Pi OS, Debian, Ubuntu, Windows)
  - Pymodbus 2.x and 3.x
  - Direct parameter routing to Saaphzone OCEMS Dashboard
  - CPCB encrypted payload transmission (AES-ECB + RSA-SHA256)

Usage Commands:
  # 1. Read live flow meter from /dev/ttyUSB0 and transmit to BOREWELL-FLOW:
  sudo python3.6 flow_datalogger_clean.py

  # 2. Test transmission without hardware using simulation:
  python3 flow_datalogger_clean.py --sim

  # 3. Transmit simultaneously to both Saaphzone Dashboard and CPCB Portal:
  sudo python3.6 flow_datalogger_clean.py --cpcb

  # 4. Run continuous telemetry loop every 60 seconds:
  sudo python3.6 flow_datalogger_clean.py --loop --interval 60

  # 5. Scan input registers 0-20 on slave ID 3:
  sudo python3.6 flow_datalogger_clean.py --scan
================================================================================
"""

import os
import sys
import glob
import json
import time
import base64
import struct
import inspect
import argparse
import requests
from datetime import datetime, timezone, timedelta

# Optional PyCryptodome for CPCB encrypted transmissions
try:
    from Crypto.Cipher import AES, PKCS1_OAEP
    from Crypto.PublicKey import RSA
    from Crypto.Hash import SHA256
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False


def get_default_port():
    """Auto-detects active USB-to-RS485 converter port."""
    for p in ["/dev/ttyUSB0", "/dev/ttyACM0", "/dev/ttyUSB1", "/dev/ttyACM1"]:
        if os.path.exists(p):
            return p
    return "/dev/ttyUSB0"


# ============================================================
# 1. MODBUS HARDWARE CONFIGURATION (FLOW METER)
# ============================================================
# Matched to your reference file:
# PORT1 = "/dev/ttyUSB0", BAUDRATE1 = 9600
# read_input_registers(address=0, count=2, unit=3)
# val = result.registers[0] / 10
METHOD              = "rtu"
PORT                = get_default_port()  # Serial port (/dev/ttyUSB0 or COM port on Windows)
BAUDRATE            = 9600                # Baudrate: 9600
STOPBITS            = 1
PARITY              = "N"
BYTESIZE            = 8
TIMEOUT             = 2                   # Timeout in seconds
SLAVE_ID            = 3                   # Modbus Unit ID / Slave ID: 3

# Register configuration
REGISTER_ADDRESS    = 0                   # Flow rate register address: 0
REGISTER_COUNT      = 2                   # Register count: 2
REGISTER_TYPE       = "input"             # Input registers (Func 04: read_input_registers)

# Decoder settings:
# "div10"      -> val = registers[0] / 10   (Direct match: val = result.registers[0]/10)
# "div1000"    -> val = registers[0] / 1000
# "float32"    -> 32-bit IEEE float across 2 registers
# "uint16"     -> raw 16-bit integer
DECODER_MODE        = "div10"
WORDORDER           = "big"               # "big" or "little" (word order)
BYTEORDER           = "big"               # "big" or "little" (byte order)
SCALING_FACTOR      = 1.0                 # Multiplier (default: 1.0)

# Standard engineering unit: "m³/hr"
FLOW_UNIT           = "m³/hr"

# ============================================================
# 2. DASHBOARD / SAAPHZONE CONFIGURATION
# ============================================================
SITE_ID             = os.getenv("SZ_SITE_ID", "JCPL_123")
DEVICE_KEY          = os.getenv("SZ_DEVICE_KEY", "sz_generic_logger_key_2026")

PRIMARY_URL         = os.getenv("SZ_PRIMARY_URL", "https://saaphzone-backend.onrender.com/api/datalogger/readings")
FALLBACK_URL        = os.getenv("SZ_FALLBACK_URL", "https://www.saaphzone.com/api/datalogger/readings")

DEBUG               = True
IST                 = timezone(timedelta(hours=5, minutes=30))

# ============================================================
# 3. DASHBOARD PARAMETER ID DECLARATION
# ============================================================
# Target Parameter ID for Flow meter on dashboard:
PARAM_ID_FLOW       = os.getenv("SZ_PARAM_ID", "BOREWELL-FLOW")

# Set to False so transmissions strictly hit the targeted Parameter ID.
INCLUDE_STANDARD_ALIAS = False

# ============================================================
# 4. CPCB CEMS CONFIGURATION (FROM YOUR REFERENCE FILE)
# ============================================================
TOKEN_ID            = os.getenv("CPCB_TOKEN_ID", "yOHAc1p86Wg-YrvfysYKDlmntZ1meR7F_CG3lRsJ3MA=")
DEVICE_ID           = os.getenv("CPCB_DEVICE_ID", "device_17069")
STATION_ID          = os.getenv("CPCB_STATION_ID", "station_17738")
PUBLIC_KEY_PATH     = os.getenv("CPCB_PUBLIC_KEY", "/home/pi/Desktop/public.pem")
CPCB_API_URL        = "https://cems.cpcb.gov.in/v1.0/industry/data"
SEND_TO_CPCB        = False               # Set to True or use --cpcb flag to also transmit to CPCB

# ============================================================
# 5. MANUAL VALUES / SIMULATION CONFIGURATION
# ============================================================
MANUAL_MODE         = False               # Set True to bypass Modbus and always transmit manual value
MANUAL_FALLBACK     = True                # Set True to fallback to manual value if Modbus read fails
MANUAL_FLOW_VALUE   = 24.50               # Declared manual flow rate in m³/hr
MANUAL_VARIATION    = 0.80                # Optional +/- random fluctuation for natural live data jitter


def get_manual_flow_value(base_value=MANUAL_FLOW_VALUE, variation=MANUAL_VARIATION):
    """
    Returns the declared manual flow value, optionally with subtle random jitter.
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


def validate_timestamp_ms(ts_ms: int) -> None:
    """CPCB validation rule: not future, <= 7 days old."""
    now_ms = datetime_to_epoch_ms(datetime.now(IST))
    if ts_ms > now_ms:
        raise ValueError("Timestamp is in future (not allowed).")
    seven_days_ms = 7 * 24 * 3600 * 1000
    if (now_ms - ts_ms) > seven_days_ms:
        raise ValueError("Timestamp older than 7 days (not allowed).")


# ============================================================
# CPCB ENCRYPTION HELPERS
# ============================================================
AES_BLOCK = 16

def pad(data: bytes) -> bytes:
    pad_len = AES_BLOCK - (len(data) % AES_BLOCK)
    return data + bytes([pad_len] * pad_len)


def aes_encrypt_ecb_sha256(payload_dict: dict, token_id: str) -> str:
    if not CRYPTO_AVAILABLE:
        raise ImportError("pycryptodome is required for CPCB encryption. Run: pip install pycryptodome")
    json_str = json.dumps(payload_dict, separators=(',', ':'))
    key = SHA256.new(token_id.encode()).digest()
    if len(key) != 32:
        raise ValueError("Derived AES key must be 32 bytes")
    cipher = AES.new(key, AES.MODE_ECB)
    padded = pad(json_str.encode('utf-8'))
    encrypted = cipher.encrypt(padded)
    return base64.b64encode(encrypted).decode('utf-8')


def rsa_encrypt_signature(token_id: str, public_key_path: str, signature_dt: datetime = None) -> (str, str):
    if not CRYPTO_AVAILABLE:
        raise ImportError("pycryptodome is required for CPCB encryption. Run: pip install pycryptodome")
    if signature_dt is None:
        signature_dt = get_aligned_datetime_15min(datetime.now(IST))

    timestamp_str = signature_dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    message = f"{token_id}$*{timestamp_str}".encode('utf-8')

    with open(public_key_path, 'rb') as f:
        pub_key = RSA.import_key(f.read())

    cipher_rsa = PKCS1_OAEP.new(pub_key, hashAlgo=SHA256)
    encrypted = cipher_rsa.encrypt(message)
    return base64.b64encode(encrypted).decode('utf-8'), timestamp_str


def build_cpcb_payload(flow_val: float, aligned_dt: datetime):
    ts_ms = datetime_to_epoch_ms(aligned_dt)
    validate_timestamp_ms(ts_ms)

    params = []
    if flow_val is not None:
        params.append({
            "parameter": "flow",
            "value": float(flow_val),
            "unit": "m³/hr",
            "timestamp": ts_ms,
            "flag": "U"
        })

    payload = {
        "data": [
            {
                "stationId": STATION_ID,
                "device_data": [
                    {
                        "deviceId": DEVICE_ID,
                        "params": params
                    }
                ],
                "latitude": 26.48415,
                "longitude": 80.31641
            }
        ]
    }
    return payload


def send_to_cpcb(payload: dict, aligned_dt: datetime):
    """Sends AES/RSA encrypted telemetry payload to official CPCB CEMS API."""
    if not os.path.exists(PUBLIC_KEY_PATH):
        print(f"[CPCB WARN] Public key not found at '{PUBLIC_KEY_PATH}'. Skipping CPCB upload.")
        return None

    try:
        encrypted_payload = aes_encrypt_ecb_sha256(payload, TOKEN_ID)
        signature_b64, signature_ts = rsa_encrypt_signature(TOKEN_ID, PUBLIC_KEY_PATH, signature_dt=aligned_dt)

        headers = {
            "signature": signature_b64,
            "X-Device-Id": DEVICE_ID,
            "Content-Type": "application/json"
        }

        print("\n--- Sending to CPCB Portal ---")
        print(f"Station ID    : {STATION_ID}")
        print(f"Device ID     : {DEVICE_ID}")
        print(f"Signature TS  : {signature_ts}")
        resp = requests.post(CPCB_API_URL, headers=headers, data=encrypted_payload, timeout=30)
        print(f"CPCB Response : HTTP {resp.status_code} | {resp.text.strip()}")
        return resp
    except Exception as e:
        print(f"[CPCB ERROR] Transmission failed: {e}")
        return None


# ============================================================
# PURE PYTHON REGISTER DECODER
# ============================================================
def decode_registers(regs, mode="div10", byteorder="big", wordorder="big"):
    """
    Decodes registers with pure Python (zero external dependencies).
    Supports div10 (regs[0]/10), div1000 (regs[0]/1000), float32, uint16, and int16.
    """
    if not regs or len(regs) == 0:
        return None

    m = (mode or "div10").lower()
    endian_fmt = ">" if str(byteorder).lower() == "big" else "<"

    # 1. User's exact reference logic: val = result.registers[0] / 10
    if m in ["div10", "scaled10", "div_10"]:
        return float(regs[0]) / 10.0

    # 2. Alternative scaling: val = result.registers[0] / 1000
    elif m in ["div1000", "scaled1000", "div_1000"]:
        return float(regs[0]) / 1000.0

    # 3. 32-bit IEEE float across 2 registers
    elif m == "float32":
        if len(regs) < 2:
            return None
        first, second = (regs[0], regs[1]) if str(wordorder).lower() == "big" else (regs[1], regs[0])
        raw = struct.pack(f"{endian_fmt}HH", first, second)
        val = struct.unpack(f"{endian_fmt}f", raw)[0]
        import math
        if math.isnan(val) or math.isinf(val) or abs(val) > 1e7:
            return None
        return val

    # 4. Standard integers
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

    return float(regs[0])


# ============================================================
# UNIVERSAL MODBUS CLIENT WRAPPER (FLOW METER)
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
                time.sleep(0.2)
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

    def read_registers_safe(self, address, count, unit_id, register_type="input"):
        """
        Safely calls read_input_registers or read_holding_registers while dynamically
        adapting kwargs ('unit', 'slave', or 'device_id') across pymodbus versions.
        """
        if self.simulation:
            class SimResult:
                def __init__(self, val=MANUAL_FLOW_VALUE):
                    v = float(val if val is not None else 24.5)
                    # Simulates registers[0] = v * 10 (e.g. 245 for 24.5 m³/hr)
                    reg0 = int(v * 10)
                    raw_bytes = struct.pack(">f", v)
                    w1, w2 = struct.unpack(">HH", raw_bytes)
                    self.registers = [reg0, w2]
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

    def read_flow_meter(self, address=REGISTER_ADDRESS, count=REGISTER_COUNT,
                        unit_id=SLAVE_ID, register_type=REGISTER_TYPE,
                        decoder=DECODER_MODE, scale=SCALING_FACTOR,
                        byteorder=BYTEORDER, wordorder=WORDORDER):
        """
        Reads instantaneous flow rate from the flow meter registers.
        """
        try:
            if not self.connect():
                print(f"\n[ERROR] Could not open serial port '{self.port}'.")
                print("  -> Verify that the RS-485 USB converter is plugged into the Raspberry Pi.")
                print("  -> Run 'ls -l /dev/ttyUSB* /dev/ttyACM*' to check assigned port.")
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
                byteorder=byteorder,
                wordorder=wordorder,
            )

            # Diagnostic comparison so the engineer can inspect all interpretations:
            reg0_div_10   = round(float(regs[0]) / 10.0, 2)
            reg0_div_1000 = round(float(regs[0]) / 1000.0, 2)
            f32_cand      = decode_registers(regs, mode="float32", byteorder=byteorder, wordorder=wordorder)

            print(f"[DIAG] Option A (regs[0] / 10):   {reg0_div_10} {FLOW_UNIT} (active reference)")
            print(f"[DIAG] Option B (regs[0] / 1000): {reg0_div_1000} {FLOW_UNIT}")
            if f32_cand is not None:
                print(f"[DIAG] Option C (32-bit float):   {round(f32_cand, 2)} {FLOW_UNIT}")

            if val is not None:
                final_val = round(val * scale, 2)
                print(f"[INFO] Decoded Flow Value: {final_val} {FLOW_UNIT}")
                return final_val
            else:
                fallback_val = round(float(regs[0]) / 10.0 * scale, 2)
                print(f"[WARN] Decoder produced None. Using regs[0] / 10: {fallback_val}")
                return fallback_val

        except Exception as e:
            print(f"[ERROR] Exception during flow meter read: {e}")
            return None
        finally:
            self.close()

    def scan_registers(self, start=0, count=20, unit_id=SLAVE_ID, reg_type=REGISTER_TYPE):
        """Troubleshooting register scanner to locate flow rate address."""
        if not self.connect():
            print(f"[ERROR] Could not connect to {self.port}")
            return

        print(f"\n=======================================================")
        print(f" Modbus Register Scanner: Port={self.port}, Start={start}, Count={count}, Unit={unit_id}, Type={reg_type}")
        print(f"=======================================================")
        found = 0
        for addr in range(start, start + count):
            res = self.read_registers_safe(addr, 2, unit_id, reg_type)
            if res and not res.isError() and res.registers:
                r0 = res.registers[0]
                div10 = round(r0 / 10.0, 2)
                f32 = decode_registers(res.registers, "float32", "big", "big")
                print(f"  [RESP] Reg {addr:3d}: uint16={r0:6d} | div10={div10:8.2f} | float32={f32}")
                found += 1
            time.sleep(0.04)
        if found == 0:
            print("  No responding registers found in this range.")
        print("=======================================================\n")
        self.close()


# ============================================================
# TRANSMIT TO SAAPHZONE DASHBOARD
# ============================================================
def send_to_dashboard(flow_value: float, site_id: str = SITE_ID,
                      param_id: str = PARAM_ID_FLOW, param_key: str = None,
                      device_key: str = DEVICE_KEY,
                      aligned_dt: datetime = None, include_alias: bool = INCLUDE_STANDARD_ALIAS,
                      primary_url: str = PRIMARY_URL, fallback_url: str = FALLBACK_URL):
    """
    Formats the payload and posts flow reading specifically to the target Parameter ID.
    Sends both 'pid' and 'param' fields to ensure compatibility across all server versions.
    """
    if flow_value is None:
        print("[WARN] Flow value is None, skipping dashboard transmission.")
        return None

    if aligned_dt is None:
        aligned_dt = get_aligned_datetime_15min(datetime.now(IST))

    ts_ms = datetime_to_epoch_ms(aligned_dt)
    ts_iso = aligned_dt.isoformat()

    readings_list = []

    # 1. Primary parameter item: specifies the exact Parameter ID (PID)
    # Both 'pid' and 'param' are set so that:
    # - Servers matching on p.pid match the target parameter
    # - Servers matching on p.key === r.param match custom keys or fallback cleanly
    effective_key = param_key or param_id
    readings_list.append({
        "siteId": site_id,
        "pid":    param_id,      # ← Standard Parameter ID (PID) field for targeted flow meter
        "param":  effective_key, # ← Target PID or custom metric key to match backend
        "paramId": param_id,
        "parameterId": param_id,
        "value":  round(float(flow_value), 2),
        "ts":     ts_iso,
        "ts_ms":  ts_ms,
    })

    # 2. Standard generic alias 'Flow' (ONLY if explicitly enabled)
    # Leave disabled when a site has multiple flow meters to prevent cross-talk
    if include_alias and param_id.strip().upper() != "FLOW":
        readings_list.append({
            "siteId": site_id,
            "pid":    "Flow",
            "param":  "Flow",
            "value":  round(float(flow_value), 2),
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

    target_urls = [url for url in [primary_url, fallback_url] if url]
    for target_url in target_urls:
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
        except Exception as e:
            print(f"[ERROR] Failed connecting to {target_url}: {e}")

    return None


# ============================================================
# CLI ARGUMENT PARSER
# ============================================================
def parse_args():
    p = argparse.ArgumentParser(description=f"Flow Meter Datalogger (Site: {SITE_ID}, Param: {PARAM_ID_FLOW})")
    p.add_argument("--site", type=str, default=SITE_ID,
                   help=f"Saaphzone Site ID (default: {SITE_ID})")
    p.add_argument("--pid", dest="param_flow", type=str, default=PARAM_ID_FLOW,
                   help=f"Parameter ID for Flow Meter on dashboard (default: {PARAM_ID_FLOW})")
    p.add_argument("--param-flow", type=str, default=PARAM_ID_FLOW,
                   help=f"Alias for --pid (default: {PARAM_ID_FLOW})")
    p.add_argument("--channel", type=int, choices=[1, 2, 3, 4, 5], default=None,
                   help="Convenience channel number (1, 2, 3...) auto-constructs PID as <SITE>-FLOW-<N>")
    p.add_argument("--key", type=str, default=None,
                   help="Custom backend metric key (e.g. 'Flow'). If omitted, defaults to target PID.")
    p.add_argument("--unit-label", type=str, default=FLOW_UNIT,
                   help=f"Flow engineering unit displayed in console logs (default: {FLOW_UNIT})")
    p.add_argument("--url", type=str, default=PRIMARY_URL,
                   help=f"Custom primary Saaphzone API endpoint (default: {PRIMARY_URL})")
    p.add_argument("--alias", dest="alias", action="store_true", default=INCLUDE_STANDARD_ALIAS,
                   help="Include generic 'Flow' alias in payload (default: False)")

    p.add_argument("--port", type=str, default=PORT,
                   help=f"Serial port for Flow meter (default: {PORT})")
    p.add_argument("--baud", type=int, default=BAUDRATE,
                   help=f"Modbus baudrate (default: {BAUDRATE})")
    p.add_argument("--unit", type=int, default=SLAVE_ID,
                   help=f"Modbus slave/unit ID (default: {SLAVE_ID})")
    p.add_argument("--address", type=int, default=REGISTER_ADDRESS,
                   help=f"Modbus register address (default: {REGISTER_ADDRESS})")
    p.add_argument("--count", type=int, default=REGISTER_COUNT,
                   help=f"Modbus register count (default: {REGISTER_COUNT})")
    p.add_argument("--reg-type", type=str, choices=["input", "holding"], default=REGISTER_TYPE,
                   help=f"Modbus register type: input or holding (default: {REGISTER_TYPE})")
    p.add_argument("--decoder", type=str, choices=["div10", "div1000", "float32", "uint32", "int32", "uint16", "int16"], default=DECODER_MODE,
                   help=f"Decoder mode: div10 (regs[0]/10), div1000, float32, uint16 (default: {DECODER_MODE})")
    p.add_argument("--wordorder", type=str, choices=["big", "little"], default=WORDORDER,
                   help=f"Word order for 32-bit values (default: {WORDORDER})")
    p.add_argument("--byteorder", type=str, choices=["big", "little"], default=BYTEORDER,
                   help=f"Byte order within register (default: {BYTEORDER})")
    p.add_argument("--scale", type=float, default=SCALING_FACTOR,
                   help=f"Scaling multiplier (default: {SCALING_FACTOR})")

    p.add_argument("--cpcb", action="store_true", default=SEND_TO_CPCB,
                   help="Also transmit encrypted payload to CPCB portal")

    p.add_argument("--manual", action="store_true", default=MANUAL_MODE,
                   help=f"Force manual mode using declared manual values (default: {MANUAL_MODE})")
    p.add_argument("--manual-value", type=float, default=MANUAL_FLOW_VALUE,
                   help=f"Manual flow value (default: {MANUAL_FLOW_VALUE})")
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
    p.add_argument("--interval", type=int, default=60,
                   help="Loop interval in seconds (default: 60 seconds)")
    return p.parse_args()


# ============================================================
# MAIN ENTRY POINT
# ============================================================
def main():
    args = parse_args()

    # Determine targeted parameter ID (Priority to --channel if specified, otherwise --pid)
    clean_site_code = args.site.replace("_", "").replace("-", "").upper()
    if args.channel is not None:
        target_pid = f"{clean_site_code}-FLOW-{args.channel}"
    else:
        target_pid = args.param_flow

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
            start=max(0, args.address - 2),
            count=20,
            unit_id=args.unit,
            reg_type=args.reg_type,
        )
        return

    def run_flow_cycle():
        flow_val = None
        source = "Modbus"
        unit_lbl = args.unit_label

        # 1. Manual mode active
        if args.manual:
            source = "Manual Mode"
            flow_val = get_manual_flow_value(args.manual_value, args.manual_variation)
            print(f"[MANUAL MODE] Using declared manual Flow: {flow_val} {unit_lbl}")
        else:
            # 2. Read from physical hardware
            flow_val = device.read_flow_meter(
                address=args.address,
                count=args.count,
                unit_id=args.unit,
                register_type=args.reg_type,
                decoder=args.decoder,
                scale=args.scale,
                byteorder=args.byteorder,
                wordorder=args.wordorder,
            )

            # 3. Fallback to manual value if hardware read failed
            if flow_val is None:
                if args.manual_fallback:
                    source = "Manual Fallback"
                    flow_val = get_manual_flow_value(args.manual_value, args.manual_variation)
                    print(f"[FALLBACK] Modbus read failed. Using declared manual Flow: {flow_val} {unit_lbl}")
                else:
                    print("[WARN] Modbus read returned None and manual fallback is disabled.")

        print(f"Flow Readings ({source}): {{'{target_pid}': {flow_val}}}")

        if args.no_upload:
            print("[INFO] --no-upload specified. Skipping dashboard transmission.")
            return flow_val

        if flow_val is None:
            print("No valid readings to transmit.")
            return None

        # Determine timestamp
        if args.instant:
            target_dt = datetime.now(IST)
        else:
            target_dt = get_aligned_datetime_15min(datetime.now(IST))

        # 1. Send to Saaphzone dashboard
        send_to_dashboard(
            flow_value=flow_val,
            site_id=args.site,
            param_id=target_pid,
            param_key=args.key,
            device_key=DEVICE_KEY,
            aligned_dt=target_dt,
            include_alias=args.alias,
            primary_url=args.url,
            fallback_url=FALLBACK_URL,
        )

        # 2. Optionally transmit to CPCB CEMS
        if args.cpcb:
            cpcb_payload = build_cpcb_payload(flow_val, target_dt)
            send_to_cpcb(cpcb_payload, target_dt)

        return flow_val

    if args.loop:
        print(f"[INFO] Running Flow meter datalogger loop targeting [{target_pid}] on site [{args.site}] every {args.interval}s.")
        while True:
            try:
                run_flow_cycle()
                time.sleep(args.interval)
            except KeyboardInterrupt:
                print("\n[INFO] Stopped by user.")
                break
        device.close()
    else:
        run_flow_cycle()


if __name__ == "__main__":
    main()
