#!/usr/bin/env python3
"""
================================================================================
🏭 SAAPHZONE OCEMS · PM MODSCAN TELEMETRY DIVERTER
================================================================================

Description:
  Reads Particulate Matter (PM / SPM / Opacity) analyzer readings from ModScan
  or physical Modbus RTU/TCP hardware, applies real-time diversion/calibration,
  and diverts the telemetry response directly to the target PARAMETER ID (PID)
  with explicit SITE ID mapping for 100% reliable dashboard ingestion.

  The Saaphzone ingestion engine uses the Site ID and Parameter ID to update
  live charts, buffer rolling history, evaluate CPCB limit exceedance, and
  broadcast real-time WebSocket updates to dashboard.saaphzone.com.

Supported ModScan Sources:
  1. Modbus TCP: Connects to ModScan32 / ModScan64 / PLC (e.g. 127.0.0.1:502)
  2. Modbus RTU: Connects to Serial RS-485 COM port (e.g. COM3 or /dev/ttyUSB0)
  3. ModScan Log: Tails and parses active ModScan CSV / TXT log exports
  4. Simulation:  Generates realistic PM register responses for bench testing

Usage Examples:
  # 1. Read ModScan via TCP (port 502) and divert for site EOCP_123 / STACK 1:
  python scripts/pm_modscan_diverter.py --tcp 127.0.0.1:502 --site EOCP_123 --stack-name "STACK 1"

  # 2. Read ModScan via RTU Serial (COM3) and divert to specific Parameter ID:
  python scripts/pm_modscan_diverter.py --rtu COM3 --baud 9600 --site EOCP_123 --pid EOC-STACK-1

  # 3. Read ModScan simulation and divert with 10% offset:
  python scripts/pm_modscan_diverter.py --sim --site EOCP_123 --stack "STACK 1" --divert-factor 0.95

  # 4. Single-shot hit and exit:
  python scripts/pm_modscan_diverter.py --sim --site EOCP_123 --pid EOC-STACK-1 --once

  # 5. List all active Parameter IDs from dashboard:
  python scripts/pm_modscan_diverter.py --list-pids
================================================================================
"""

import sys
import os
import time
import json
import struct
import random
import argparse
from datetime import datetime, timezone

# Windows console encoding fix
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Dependency check
try:
    import requests
except ImportError:
    print("❌ Error: 'requests' package is missing. Run: pip install requests")
    sys.exit(1)

# Optional pymodbus for direct Modbus TCP/RTU reading
try:
    from pymodbus.client import ModbusTcpClient, ModbusSerialClient
    PYMODBUS_AVAILABLE = True
except ImportError:
    try:
        from pymodbus.client.sync import ModbusTcpClient, ModbusSerialClient
        PYMODBUS_AVAILABLE = True
    except ImportError:
        PYMODBUS_AVAILABLE = False


# ==============================================================================
# 1. STACK NAME DECLARATION & AUTO PARAMETER ID GENERATION
# ==============================================================================
def generate_param_id_from_stack(stack_name: str, param_key: str = "PM", site_code: str = None) -> str:
    """
    Automatically generates a Parameter ID with reference to the manually declared stack name.
    Strictly guarantees that the Parameter ID contains BOTH character and number.

    Examples:
      - 'STACK 1'        -> 'EOC-STACK-1' (for site EOCP_123) or 'STACK-1-PM'
      - 'STACK 2'        -> 'STACK-2-PM'
      - 'Boiler Stack 1' -> 'BOILER-STACK-1-PM'
      - 'Furnace Stack'  -> 'FURNACE-STACK-1-PM' (auto-appends number 1)
      - '1'              -> 'STACK-1-PM'         (auto-prepends character STACK)
    """
    import re
    if not stack_name or not str(stack_name).strip():
        stack_name = "STACK 1"

    raw = str(stack_name).strip()
    upper_raw = raw.upper()

    # Extract numeric digits
    numbers = re.findall(r"\d+", raw)
    num_str = numbers[0] if numbers else "1"

    # Site-specific registered stack profiles (e.g. EOCP_123)
    clean_site = str(site_code or "").replace("_", "").replace("-", "").upper()
    if clean_site == "EOCP123":
        if num_str == "1" or "STACK 1" in upper_raw or "STACK-1" in upper_raw or "STACK_1" in upper_raw:
            return "EOC-STACK-1"
        elif num_str == "2" or "STACK 2" in upper_raw or "STACK-2" in upper_raw or "STACK_2" in upper_raw:
            return "STACK-2-PM"

    # Build clean uppercase slug
    slug = re.sub(r"[^A-Za-z0-9]+", "-", raw).strip("-").upper()

    # Ensure slug contains alphabetic characters
    if not re.search(r"[A-Z]", slug):
        slug = f"STACK-{slug}"

    # Ensure slug contains numeric digits
    if not re.search(r"[0-9]", slug):
        slug = f"{slug}-{num_str}"

    # Append parameter key if not already present
    clean_key = (param_key or "PM").strip().upper()
    if clean_key and clean_key not in slug:
        slug = f"{slug}-{clean_key}"

    return slug


# Step 1: Default Site ID
DEFAULT_SITE_ID = os.getenv("SZ_SITE_ID", "EOCP_123")

# Step 2: Stack name declared manually (e.g. "STACK 1", "STACK 2", "Boiler Stack 1")
DEFAULT_STACK_NAME = os.getenv("SZ_STACK_NAME", "STACK 1")

# Step 3: Parameter ID generated automatically based on stack name (character + number)
DEFAULT_PARAMETER_ID = generate_param_id_from_stack(DEFAULT_STACK_NAME, "PM", DEFAULT_SITE_ID)


# ==============================================================================
# 2. CONFIGURATION DEFAULTS
# ==============================================================================
DEFAULT_CONFIG = {
    # Dashboard API ingest endpoint
    "endpoint_url": os.getenv("SZ_API_URL", "https://saaphzone-backend.onrender.com/api/datalogger/readings"),
    # Local fallback endpoint
    "fallback_url": "http://localhost:4000/api/datalogger/readings",
    # Device / Logger API Key
    "api_key": os.getenv("SZ_DEVICE_KEY", "sz_generic_logger_key_2026"),
    # Target Site ID
    "site_id": DEFAULT_SITE_ID,
    # Stack name declared manually
    "stack_name": DEFAULT_STACK_NAME,
    # Parameter ID auto-generated from stack name (strictly contains character & number)
    "parameter_id": DEFAULT_PARAMETER_ID,
    # ModScan register address (ModScan 40008 or 40001)
    "register_address": 40008,
    # Register data type: 'float32', 'int16', 'uint16', 'int32'
    "data_type": "float32",
    # Float byte order: 'CDAB' (Modicon word swapped), 'ABCD' (Big Endian), 'BADC', 'DCBA'
    "byte_order": "CDAB",
    # Scale factor applied to raw integer registers (e.g. raw 385 -> 38.5)
    "scale_factor": 1.0,
    # Polling frequency in seconds
    "poll_interval": 5.0,
    # Diversion parameters
    "divert_factor": 1.0,   # Multiplier: 1.0 = actual reading
    "divert_offset": 0.0,   # Additive offset
    "clamp_min": 0.0,       # Minimum permitted value
    "clamp_max": 200.0,     # Maximum permitted value
}


# ==============================================================================
# 3. MODBUS REGISTER DECODING UTILITIES
# ==============================================================================
def decode_register_response(registers, data_type="float32", byte_order="CDAB", scale=1.0):
    """
    Decodes raw Modbus 16-bit register words into an engineering floating-point value.
    Handles IEEE-754 32-bit floats and integers with configurable endianness.
    """
    if not registers or not isinstance(registers, (list, tuple)):
        return 0.0

    try:
        # Case 1: 32-bit IEEE 754 Floating Point (Standard for PM instruments)
        if data_type.lower() == "float32":
            if len(registers) < 2:
                return round(float(registers[0]) * scale, 2)

            r1, r2 = registers[0], registers[1]
            if byte_order.upper() == "ABCD":       # Big Endian (Motorola)
                raw_bytes = struct.pack(">HH", r1, r2)
                val = struct.unpack(">f", raw_bytes)[0]
            elif byte_order.upper() == "CDAB":     # Word Swapped (Modicon / Schneider standard)
                raw_bytes = struct.pack(">HH", r2, r1)
                val = struct.unpack(">f", raw_bytes)[0]
            elif byte_order.upper() == "BADC":     # Byte Swapped
                raw_bytes = struct.pack("<HH", r1, r2)
                val = struct.unpack("<f", raw_bytes)[0]
            elif byte_order.upper() == "DCBA":     # Little Endian (Intel)
                raw_bytes = struct.pack("<HH", r2, r1)
                val = struct.unpack("<f", raw_bytes)[0]
            else:
                raw_bytes = struct.pack(">HH", r2, r1)
                val = struct.unpack(">f", raw_bytes)[0]

            import math
            if math.isnan(val) or math.isinf(val) or abs(val) > 1e7:
                return round(float(registers[0]) * scale, 2)

            return round(val * scale, 2)

        # Case 2: 16-bit Unsigned Integer
        elif data_type.lower() in ["uint16", "word"]:
            return round(float(registers[0]) * scale, 2)

        # Case 3: 16-bit Signed Integer
        elif data_type.lower() in ["int16", "short"]:
            raw_bytes = struct.pack(">H", registers[0])
            val = struct.unpack(">h", raw_bytes)[0]
            return round(float(val) * scale, 2)

        # Case 4: 32-bit Integer
        elif data_type.lower() == "int32":
            if len(registers) < 2:
                return round(float(registers[0]) * scale, 2)
            r1, r2 = registers[0], registers[1]
            if byte_order.upper() in ["CDAB", "LITTLE"]:
                raw_bytes = struct.pack(">HH", r2, r1)
            else:
                raw_bytes = struct.pack(">HH", r1, r2)
            val = struct.unpack(">i", raw_bytes)[0]
            return round(float(val) * scale, 2)

        else:
            return round(float(registers[0]) * scale, 2)

    except Exception as e:
        print(f"⚠️ Decoding error ({data_type} / {byte_order}): {e}")
        return round(float(registers[0]) * scale, 2)


# ==============================================================================
# 4. MODSCAN / MODBUS READING CLIENTS
# ==============================================================================
def read_modbus_tcp(host, port, unit_id, register_addr, count=2, is_input=False):
    """
    Connects to Modbus TCP server (PLC, gateway, or ModScan simulator)
    and reads the holding/input registers for PM.
    """
    if not PYMODBUS_AVAILABLE:
        raise RuntimeError("pymodbus is not installed. Install with: pip install pymodbus")

    protocol_addr = register_addr
    if register_addr >= 40001:
        protocol_addr = register_addr - 40001
    elif register_addr >= 30001:
        protocol_addr = register_addr - 30001
    elif register_addr >= 1:
        protocol_addr = register_addr - 1

    client = ModbusTcpClient(host=host, port=port, timeout=3)
    if not client.connect():
        raise ConnectionError(f"Failed to connect to Modbus TCP server at {host}:{port}")

    try:
        try:
            if is_input:
                resp = client.read_input_registers(protocol_addr, count=count, device_id=unit_id)
            else:
                resp = client.read_holding_registers(protocol_addr, count=count, device_id=unit_id)
        except TypeError:
            if is_input:
                resp = client.read_input_registers(protocol_addr, count=count, slave=unit_id)
            else:
                resp = client.read_holding_registers(protocol_addr, count=count, slave=unit_id)

        if resp.isError():
            raise IOError(f"Modbus error response: {resp}")

        return list(resp.registers)
    finally:
        client.close()


def read_modbus_rtu(port, baudrate, unit_id, register_addr, count=2, is_input=False):
    """
    Connects to Modbus RTU serial device (RS485 COM port / USB)
    and reads the registers for PM.
    """
    if not PYMODBUS_AVAILABLE:
        raise RuntimeError("pymodbus is not installed. Install with: pip install pymodbus")

    protocol_addr = register_addr
    if register_addr >= 40001:
        protocol_addr = register_addr - 40001
    elif register_addr >= 30001:
        protocol_addr = register_addr - 30001
    elif register_addr >= 1:
        protocol_addr = register_addr - 1

    client = ModbusSerialClient(
        port=port,
        baudrate=baudrate,
        parity="N",
        stopbits=1,
        bytesize=8,
        timeout=2,
    )
    if not client.connect():
        raise ConnectionError(f"Failed to open Serial port {port} at {baudrate} baud")

    try:
        try:
            if is_input:
                resp = client.read_input_registers(protocol_addr, count=count, device_id=unit_id)
            else:
                resp = client.read_holding_registers(protocol_addr, count=count, device_id=unit_id)
        except TypeError:
            if is_input:
                resp = client.read_input_registers(protocol_addr, count=count, slave=unit_id)
            else:
                resp = client.read_holding_registers(protocol_addr, count=count, slave=unit_id)

        if resp.isError():
            raise IOError(f"Modbus error response: {resp}")

        return list(resp.registers)
    finally:
        client.close()


def read_modscan_log_file(file_path):
    """
    Reads the newest line from a ModScan32 / ModScan64 log file or CSV export.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"ModScan log file not found: {file_path}")

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = [line.strip() for line in f if line.strip()]

    if not lines:
        raise ValueError(f"ModScan log file is empty: {file_path}")

    last_line = lines[-1]
    tokens = [t.strip() for t in last_line.replace("\t", ",").replace(";", ",").split(",") if t.strip()]

    nums = []
    for t in tokens:
        try:
            nums.append(float(t))
        except ValueError:
            pass

    if not nums:
        raise ValueError(f"Could not parse numerical register value from log line: '{last_line}'")

    if len(nums) >= 2 and all(n.is_integer() for n in nums[:2]):
        return [int(nums[0]), int(nums[1])]
    return [nums[-1]]


def generate_simulated_pm_registers(base=36.5, variance=4.2):
    """
    Generates realistic PM register responses (Float32 in CDAB format)
    for simulation and testing when physical hardware is not attached.
    """
    delta = (random.random() - 0.5) * 2 * variance
    sim_value = max(2.0, min(140.0, base + delta))

    packed_abcd = struct.pack(">f", sim_value)
    w1, w2 = struct.unpack(">HH", packed_abcd)
    # CDAB: w2 is register[0], w1 is register[1]
    return [w2, w1], round(sim_value, 2)


# ==============================================================================
# 5. DASHBOARD PID & SCHEMA DISCOVERY
# ==============================================================================
def fetch_parameter_metadata(endpoint_url, api_key, target_pid, site_id=None):
    """
    Queries dashboard API to retrieve CPCB limit, unit, and site owner for target PID.
    """
    base_url = endpoint_url.split("/api/")[0]
    headers = {"x-device-key": api_key, "x-api-key": api_key}

    # Try site schema endpoint first if site_id is provided
    if site_id:
        try:
            schema_url = f"{base_url}/api/datalogger/schema/{site_id}"
            resp = requests.get(schema_url, headers=headers, timeout=4)
            if resp.status_code == 200:
                data = resp.json()
                params = data.get("parameters", [])
                for p in params:
                    if str(p.get("pid", "")).strip().upper() == str(target_pid).strip().upper() or \
                       str(p.get("key", "")).strip().upper() == str(target_pid).strip().upper():
                        return {
                            "pid": p.get("pid"),
                            "limit": float(p.get("limit") or 50.0),
                            "unit": p.get("unit") or "mg/m³",
                            "siteCode": site_id,
                            "name": p.get("name") or p.get("key"),
                        }
        except Exception:
            pass

    # Try global parameters endpoint
    try:
        params_url = f"{base_url}/api/datalogger/parameters"
        resp = requests.get(params_url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            params = data.get("parameters", [])
            for p in params:
                pid = str(p.get("pid", "")).strip().upper()
                if pid == str(target_pid).strip().upper():
                    return {
                        "pid": p.get("pid"),
                        "limit": float(p.get("limit") or 50.0),
                        "unit": p.get("unit") or "mg/m³",
                        "siteCode": p.get("siteCode") or site_id,
                        "name": p.get("name") or p.get("key"),
                    }
    except Exception:
        pass

    return {
        "pid": target_pid,
        "limit": 50.0,
        "unit": "mg/m³",
        "siteCode": site_id,
        "name": "PM",
    }


def list_all_dashboard_pids(endpoint_url, api_key):
    """
    Fetches and displays all registered Parameter IDs across all sites.
    """
    base_url = endpoint_url.split("/api/")[0]
    params_url = f"{base_url}/api/datalogger/parameters"
    headers = {"x-device-key": api_key, "x-api-key": api_key}

    print("\n🔍 Querying active Parameter IDs from Saaphzone Server...")
    try:
        resp = requests.get(params_url, headers=headers, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            params = data.get("parameters", [])
            print(f"✅ Found {len(params)} total registered parameters:\n")
            print(f"{'PARAMETER ID (PID)':<25} {'KEY':<10} {'NAME':<20} {'LIMIT':<10} {'SITE OWNER':<18} {'CURRENT':<10}")
            print("-" * 95)
            for p in params:
                val = f"{p.get('currentValue', 'NA')} {p.get('unit', '')}"
                print(f"{p.get('pid', ''):<25} {p.get('key', ''):<10} {p.get('name', ''):<20} {str(p.get('limit', '')):<10} {p.get('siteCode', ''):<18} {val:<10}")
            print("-" * 95 + "\n")
        else:
            print(f"❌ Failed to fetch parameters (HTTP {resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"❌ Error fetching parameters: {e}")


# ==============================================================================
# 6. TELEMETRY DIVERTER (WITH BOTH PARAMETER ID & SITE ID)
# ==============================================================================
def divert_pm_response(actual_value, config, target_pid=None):
    """
    Performs diversion calculation on the ModScan response and transmits the
    reading with both SITE ID and PARAMETER ID for 100% reliable dashboard ingestion.

    Diversion Equation:
        V_diverted = (V_actual * divert_factor) + divert_offset
        V_diverted = clamp(V_diverted, clamp_min, clamp_max)

    Telemetry Ingestion Body:
        {
          "siteId": "EOCP_123",
          "readings": [
            {
              "siteId": "EOCP_123",
              "pid": "EOC-STACK-1",
              "param": "EOC-STACK-1",
              "value": 38.5,
              "actualRaw": 38.5,
              "ts": "..."
            }
          ]
        }
    """
    # 1. Compute diversion or handle NA
    is_na = actual_value is None or str(actual_value).strip().upper() in ["NA", "N/A", "NONE", "NULL"]
    if is_na:
        diverted_val = "NA"
        delta = 0.0
    else:
        diverted_val = (float(actual_value) * config["divert_factor"]) + config["divert_offset"]
        diverted_val = max(config["clamp_min"], min(config["clamp_max"], diverted_val))
        diverted_val = round(diverted_val, 2)
        delta = round(diverted_val - float(actual_value), 2)

    # 2. Target Site ID & Parameter ID
    site_id = config.get("site_id") or "EOCP_123"
    pid = target_pid or config.get("parameter_id") or "EOC-STACK-1"
    timestamp = datetime.now(timezone.utc).isoformat()

    # 3. Build Telemetry Ingestion Payload with BOTH Site ID & Parameter ID
    reading_item = {
        "siteId": str(site_id),
        "pid": str(pid),
        "param": str(pid),
        "paramId": str(pid),
        "parameterId": str(pid),
        "value": diverted_val,
        "actualRaw": actual_value,
        "ts": timestamp,
    }

    payload = {
        "siteId": str(site_id),
        "readings": [reading_item],
    }

    headers = {
        "Content-Type": "application/json",
        "x-device-key": config["api_key"],
        "x-api-key": config["api_key"],
    }

    # 4. Transmit to Ingest API
    target_urls = [config["endpoint_url"], config.get("fallback_url")]
    last_err = None

    for url in [u for u in target_urls if u]:
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=10)
            if resp.status_code in [200, 201]:
                data = resp.json()
                applied = data.get("applied", data.get("divertedCount", 1))
                return {
                    "ok": True,
                    "siteId": site_id,
                    "pid": pid,
                    "actual": actual_value,
                    "diverted": diverted_val,
                    "delta": delta,
                    "applied": applied,
                    "timestamp": timestamp,
                    "url": url,
                    "response": data,
                }
            else:
                last_err = f"HTTP {resp.status_code}: {resp.text}"
        except Exception as err:
            last_err = str(err)

    return {
        "ok": False,
        "siteId": site_id,
        "pid": pid,
        "actual": actual_value,
        "diverted": diverted_val,
        "applied": 0,
        "error": last_err or "Unknown transmission failure",
    }


# ==============================================================================
# 7. MAIN CLI ENTRYPOINT
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="PM ModScan Telemetry Diverter (Routed via Site ID + Parameter ID)"
    )

    # ModScan Source Options
    src_group = parser.add_argument_group("ModScan Data Source Options")
    src_group.add_argument("--tcp", help="Modbus TCP host:port (e.g. 127.0.0.1:502 or 192.168.1.50:502)")
    src_group.add_argument("--rtu", help="Modbus RTU serial COM port (e.g. COM3 or /dev/ttyUSB0)")
    src_group.add_argument("--baud", type=int, default=9600, help="RTU Baudrate (default: 9600)")
    src_group.add_argument("--slave", type=int, default=1, help="Modbus Slave / Unit ID (default: 1)")
    src_group.add_argument("--file", help="Path to ModScan log/CSV export file to tail")
    src_group.add_argument("--sim", action="store_true", help="Simulate ModScan register responses (bench test mode)")

    # ModScan Register Options
    reg_group = parser.add_argument_group("ModScan Register Options")
    reg_group.add_argument("--addr", type=int, default=DEFAULT_CONFIG["register_address"],
                           help=f"ModScan register address (default: {DEFAULT_CONFIG['register_address']})")
    reg_group.add_argument("--type", choices=["float32", "uint16", "int16", "int32"], default="float32",
                           help="Register data type (default: float32)")
    reg_group.add_argument("--endian", choices=["CDAB", "ABCD", "BADC", "DCBA"], default="CDAB",
                           help="Float/Int byte order (default: CDAB - Modicon standard)")
    reg_group.add_argument("--scale", type=float, default=1.0,
                           help="Scale factor for raw register readings (default: 1.0)")
    reg_group.add_argument("--input", action="store_true",
                           help="Read Input Registers (FC 04) instead of Holding Registers (FC 03)")

    # Site ID & Parameter ID Options
    ident_group = parser.add_argument_group("Site ID & Parameter ID Identification")
    ident_group.add_argument("--site", default=DEFAULT_CONFIG["site_id"],
                             help=f"Target Site ID (e.g. EOCP_123, PERFECT_2026) (default: {DEFAULT_CONFIG['site_id']})")
    ident_group.add_argument("--stack-name", default=DEFAULT_CONFIG["stack_name"],
                             help=f"Stack name declared manually (e.g. 'STACK 1', 'Boiler Stack 1') (default: {DEFAULT_CONFIG['stack_name']})")
    ident_group.add_argument("--stack", default=None,
                             help="Convenience alias for --stack-name (e.g. --stack 1 or --stack 'STACK 2')")
    ident_group.add_argument("--pid", default=None,
                             help="Override target Parameter ID directly (e.g. EOC-STACK-1, STACK-1-PM, 1001)")
    ident_group.add_argument("--list-pids", action="store_true",
                             help="Query and print all active Parameter IDs from dashboard and exit")

    # Diversion Calibration Options
    div_group = parser.add_argument_group("Diversion & Calibration Options")
    div_group.add_argument("--divert-factor", type=float, default=1.0,
                           help="Diversion calibration multiplier (default: 1.0 = actual)")
    div_group.add_argument("--divert-offset", type=float, default=0.0,
                           help="Diversion additive offset (default: 0.0)")
    div_group.add_argument("--clamp-max", type=float, default=200.0,
                           help="Upper clamp threshold (default: 200.0)")

    # Dashboard Connection Options
    conn_group = parser.add_argument_group("Dashboard Connection Options")
    conn_group.add_argument("--url", default=DEFAULT_CONFIG["endpoint_url"],
                            help=f"Dashboard Ingest API URL (default: {DEFAULT_CONFIG['endpoint_url']})")
    conn_group.add_argument("--key", default=DEFAULT_CONFIG["api_key"],
                            help="Device/Logger Authentication Key")

    # Execution Options
    exec_group = parser.add_argument_group("Execution Options")
    exec_group.add_argument("--interval", type=float, default=DEFAULT_CONFIG["poll_interval"],
                            help="Polling interval in seconds (default: 5.0)")
    exec_group.add_argument("--once", action="store_true", help="Read, divert once, and exit")

    args = parser.parse_args()

    # If user requests --list-pids, show list and exit immediately
    if args.list_pids:
        list_all_dashboard_pids(args.url, args.key)
        sys.exit(0)

    # 1. Determine Site ID, Stack Name, and Parameter ID
    site_id = args.site.strip()
    stack_name = args.stack if args.stack else args.stack_name

    if args.pid:
        target_pid = args.pid.strip()
    else:
        # Auto-generate Parameter ID based on stack name & site (character + number)
        target_pid = generate_param_id_from_stack(stack_name, "PM", site_code=site_id)

    # 2. Determine execution mode
    mode = "sim"
    tcp_host, tcp_port = "127.0.0.1", 502
    if args.tcp:
        mode = "tcp"
        parts = args.tcp.split(":")
        tcp_host = parts[0]
        tcp_port = int(parts[1]) if len(parts) > 1 else 502
    elif args.rtu:
        mode = "rtu"
    elif args.file:
        mode = "file"
    elif args.sim:
        mode = "sim"

    # 3. Assemble Configuration
    config = {
        "endpoint_url": args.url,
        "fallback_url": DEFAULT_CONFIG["fallback_url"],
        "api_key": args.key,
        "site_id": site_id,
        "stack_name": stack_name,
        "parameter_id": target_pid,
        "register_address": args.addr,
        "data_type": args.type,
        "byte_order": args.endian,
        "scale_factor": args.scale,
        "poll_interval": args.interval,
        "divert_factor": args.divert_factor,
        "divert_offset": args.divert_offset,
        "clamp_min": 0.0,
        "clamp_max": args.clamp_max,
    }

    # 4. Fetch Parameter Metadata (Limit, Unit)
    meta = fetch_parameter_metadata(config["endpoint_url"], config["api_key"], target_pid, site_id=site_id)
    param_limit = meta.get("limit", 50.0)
    param_unit = meta.get("unit", "mg/m³")

    # Print Clean Banner
    print("=" * 76)
    print(" 🏭 SAAPHZONE OCEMS · PM MODSCAN TELEMETRY DIVERTER")
    print("=" * 76)
    print(f" Source Mode:         {mode.upper()}")
    if mode == "tcp":
        print(f" Target Modbus TCP:   {tcp_host}:{tcp_port} (Unit ID: {args.slave})")
    elif mode == "rtu":
        print(f" Target Modbus RTU:   {args.rtu} @ {args.baud} baud (Unit ID: {args.slave})")
    elif mode == "file":
        print(f" ModScan Log File:    {args.file}")
    elif mode == "sim":
        print(" ModScan Simulator:   ACTIVE (Bench simulation generator)")

    print(f" Register Address:    {config['register_address']} ({'Input' if args.input else 'Holding'})")
    print(f" Data Format:         {config['data_type'].upper()} (Byte Order: {config['byte_order']})")
    print("-" * 76)
    print(f" Target Site ID:      \033[92m{config['site_id']}\033[0m")
    print(f" Declared Stack:      {config['stack_name']}")
    print(f" Target Parameter ID: \033[96m{config['parameter_id']}\033[0m (Contains Character + Number)")
    print(f" CPCB Limit:          {param_limit} {param_unit}")
    print(f" Target Ingest API:   {config['endpoint_url']}")
    if config["divert_factor"] != 1.0 or config["divert_offset"] != 0.0:
        print(f" Diversion Math:      V_div = (V_act * {config['divert_factor']}) + {config['divert_offset']}")
    else:
        print(" Diversion Math:      1:1 Direct Telemetry Pass-Through")
    print("=" * 76 + "\n")

    cycle = 1
    reg_count = 2 if config["data_type"] in ["float32", "int32"] else 1

    while True:
        try:
            now_str = datetime.now().strftime("%H:%M:%S")
            raw_regs = []
            actual_pm = 0.0

            # ------------------------------------------------------------------
            # 1. Read Actual Response from ModScan / Modbus
            # ------------------------------------------------------------------
            if mode == "tcp":
                raw_regs = read_modbus_tcp(
                    tcp_host, tcp_port, args.slave, config["register_address"],
                    count=reg_count, is_input=args.input
                )
                actual_pm = decode_register_response(
                    raw_regs, config["data_type"], config["byte_order"], config["scale_factor"]
                )

            elif mode == "rtu":
                raw_regs = read_modbus_rtu(
                    args.rtu, args.baud, args.slave, config["register_address"],
                    count=reg_count, is_input=args.input
                )
                actual_pm = decode_register_response(
                    raw_regs, config["data_type"], config["byte_order"], config["scale_factor"]
                )

            elif mode == "file":
                raw_regs = read_modscan_log_file(args.file)
                if len(raw_regs) == 1 and isinstance(raw_regs[0], float):
                    actual_pm = round(raw_regs[0] * config["scale_factor"], 2)
                else:
                    actual_pm = decode_register_response(
                        raw_regs, config["data_type"], config["byte_order"], config["scale_factor"]
                    )

            elif mode == "sim":
                raw_regs, actual_pm = generate_simulated_pm_registers(base=36.0, variance=5.5)

            # ------------------------------------------------------------------
            # 2. Divert Response with Site ID and Parameter ID
            # ------------------------------------------------------------------
            result = divert_pm_response(actual_pm, config, target_pid=config["parameter_id"])

            # ------------------------------------------------------------------
            # 3. Telemetry Result Reporting
            # ------------------------------------------------------------------
            if result["ok"]:
                diverted_val = result["diverted"]
                applied_count = result.get("applied", 1)

                if diverted_val == "NA":
                    print(f"[{now_str}] Cycle #{cycle} · ⚪ [DATA NOT RECEIVING / NA]")
                    print(f"   ├─ Raw ModScan:           NO READING")
                    print(f"   ├─ Site ID:               \033[92m{config['site_id']}\033[0m")
                    print(f"   ├─ Parameter ID:          \033[93m[{config['parameter_id']}]\033[0m")
                    print(f"   └─ Dashboard Status:      ✅ Diverted 'NA' to dashboard\n")
                else:
                    over_limit = diverted_val > param_limit
                    cpcb_tag = "🔴 [EXCEEDANCE]" if over_limit else "🟢 [COMPLIANT]"

                    if applied_count > 0:
                        status_tag = f"✅ Applied successfully ({applied_count} reading diverted to dashboard)"
                    else:
                        status_tag = f"⚠️ Server received payload, but applied=0. Check site/param registration."

                    print(f"[{now_str}] Cycle #{cycle} · {cpcb_tag}")
                    print(f"   ├─ Raw ModScan Registers: {raw_regs}")
                    print(f"   ├─ Actual PM Fetched:     {actual_pm:.2f} {param_unit}")
                    print(f"   ├─ Diverted Response:     {diverted_val:.2f} {param_unit} (Δ: {result['delta']:+.2f})")
                    print(f"   ├─ Site ID:               \033[92m{config['site_id']}\033[0m")
                    print(f"   ├─ Target Parameter ID:   \033[96m[{config['parameter_id']}]\033[0m")
                    print(f"   └─ Dashboard Status:      {status_tag}\n")
            else:
                print(f"[{now_str}] Cycle #{cycle} · ❌ Diversion Failed!")
                print(f"   ├─ Actual PM Fetched:     {actual_pm}")
                print(f"   ├─ Site ID:               {config['site_id']}")
                print(f"   ├─ Target Parameter ID:   [{config['parameter_id']}]")
                print(f"   └─ Server Error:          {result.get('error')}\n")

            if args.once:
                break

            time.sleep(config["poll_interval"])
            cycle += 1

        except KeyboardInterrupt:
            print("\n👋 PM ModScan Diverter stopped by user.")
            break
        except Exception as ex:
            print(f"❌ Read/Diversion Error: {ex}")
            try:
                na_result = divert_pm_response("NA", config, target_pid=config["parameter_id"])
                if na_result.get("ok"):
                    print(f"   └─ ModScan communication error · Diverted 'NA' to dashboard\n")
            except Exception:
                pass
            if args.once:
                sys.exit(1)
            time.sleep(config["poll_interval"])


if __name__ == "__main__":
    main()
