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
    PYMODBUS_AVAILABLE = False


# ==============================================================================
# CONFIGURATION DEFAULTS
# ==============================================================================
DEFAULT_CONFIG = {
    # Dashboard API ingest endpoint (local backend or cloud deployment)
    "endpoint_url": os.getenv("SZ_API_URL", "http://localhost:4000/api/datalogger/readings"),
    # Device / Logger API Key
    "api_key": os.getenv("SZ_DEVICE_KEY", "sz_generic_logger_key_2026"),
    # Target Site Code (e.g. PERFECT_2026, 855, ESK-4417, AFC_123)
    "site_id": os.getenv("SZ_SITE_ID", "PERFECT_2026"),
    # Dashboard Parameter ID for PM (if empty, auto-resolved from dashboard schema or site)
    "parameter_id": "PERFECT_2026-PM-1",
    # ModScan register address (ModScan 40008 or 40001)
    "register_address": 40008,
    # Data type: 'float32', 'int16', 'uint16', 'int32'
    "data_type": "float32",
    # Float byte order: 'CDAB' (Modicon word swapped), 'ABCD' (Big Endian), 'BADC', 'DCBA'
    "byte_order": "CDAB",
    # Scale factor applied to raw integer registers (e.g., raw 385 -> 38.5)
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
# MODBUS REGISTER DECODING UTILITIES
# ==============================================================================
def decode_register_response(registers, data_type="float32", byte_order="CDAB", scale=1.0):
    """
    Decodes raw Modbus 16-bit register words into an engineering floating-point value.
    Handles IEEE-754 32-bit floats and integers with configurable endianness.
    """
    if not registers or not isinstance(registers, (list, tuple)):
        return 0.0

    try:
        # Case 1: 32-bit IEEE 754 Floating Point (Standard for PM instruments & Power Meters)
        if data_type.lower() == "float32":
            if len(registers) < 2:
                # Fallback to single register if only 1 returned
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
# MODSCAN / MODBUS READING CLIENTS
# ==============================================================================
def read_modbus_tcp(host, port, unit_id, register_addr, count=2, is_input=False):
    """
    Connects to Modbus TCP server (PLC, instrument gateway, or ModScan simulation)
    and reads the holding/input registers for PM.
    """
    if not PYMODBUS_AVAILABLE:
        raise RuntimeError("pymodbus is not installed. Install with: pip install pymodbus")

    # ModScan uses 1-based address notation (e.g. 40008 = offset 7; 30001 = offset 0)
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
        # Pymodbus 3.x uses device_id or slave keyword
        try:
            if is_input:
                resp = client.read_input_registers(protocol_addr, count=count, device_id=unit_id)
            else:
                resp = client.read_holding_registers(protocol_addr, count=count, device_id=unit_id)
        except TypeError:
            # Fallback for earlier pymodbus versions
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
    Connects to Modbus RTU serial device (RS485 COM port)
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
            raise IOError(f"Modbus serial error response: {resp}")

        return list(resp.registers)
    finally:
        client.close()


def read_modscan_log_file(file_path):
    """
    Reads the latest line from a ModScan32 / ModScan64 log file or CSV export.
    Parses comma/space/tab delimited register lines.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"ModScan log file not found: {file_path}")

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = [line.strip() for line in f if line.strip()]

    if not lines:
        raise ValueError(f"ModScan log file is empty: {file_path}")

    # Read the newest recorded row
    last_line = lines[-1]
    tokens = [t.strip() for t in last_line.replace("\t", ",").replace(";", ",").split(",") if t.strip()]

    # Extract numerical tokens
    nums = []
    for t in tokens:
        try:
            nums.append(float(t))
        except ValueError:
            pass

    if not nums:
        raise ValueError(f"Could not parse numerical register value from log line: '{last_line}'")

    # If two consecutive integers are logged, return them as registers
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

    # Pack float into CDAB Modbus words (word-swapped)
    packed_abcd = struct.pack(">f", sim_value)
    w1, w2 = struct.unpack(">HH", packed_abcd)
    # CDAB: w2 is register[0], w1 is register[1]
    return [w2, w1], round(sim_value, 2)


# ==============================================================================
# DASHBOARD PID RESOLVER & TELEMETRY DIVERTER
# ==============================================================================
def resolve_dashboard_pm_pid(endpoint_url, api_key, site_id):
    """
    Queries the dashboard API schema endpoint to find the exact configured
    Parameter ID (PID) for PM on the target site.
    """
    base_url = endpoint_url.split("/api/")[0]
    schema_url = f"{base_url}/api/datalogger/schema/{site_id}"
    headers = {"x-device-key": api_key, "x-api-key": api_key}

    try:
        resp = requests.get(schema_url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            params = data.get("parameters", [])
            pm_params = [
                p for p in params
                if str(p.get("key", "")).upper() == "PM" or "PM" in str(p.get("pid", "")).upper()
            ]
            if len(pm_params) > 1:
                print(f"ℹ️ Found {len(pm_params)} PM parameters for site '{site_id}':")
                for idx, p in enumerate(pm_params, 1):
                    print(f"   [{idx}] PID: {p.get('pid')}  Name: {p.get('name', p.get('key'))}")
                print(f"👉 Targeting first: [{pm_params[0].get('pid')}]. Use --pid <PID> to divert to another parameter.\n")
                return pm_params[0].get("pid"), pm_params[0].get("limit", 50.0), pm_params[0].get("unit", "mg/m3")
            elif pm_params:
                return pm_params[0].get("pid"), pm_params[0].get("limit", 50.0), pm_params[0].get("unit", "mg/m3")
    except Exception:
        pass

    # Standard fallback convention
    return f"{site_id}-PM", 50.0, "mg/m3"


def divert_pm_response(actual_value, config, override_pid=None):
    """
    Performs diversion calculation on the actual ModScan response and
    transmits the diverted value with reference to the Parameter ID (PID).

    Diversion Equation:
        V_diverted = (V_actual * divert_factor) + divert_offset
        V_diverted = clamp(V_diverted, clamp_min, clamp_max)
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

    # 2. Determine Parameter ID
    pid = override_pid or config.get("parameter_id") or f"{config['site_id']}-PM"
    timestamp = datetime.now(timezone.utc).isoformat()

    # 3. Build Telemetry Payload
    payload = {
        "siteId": config["site_id"],
        "readings": [
            {
                "siteId": config["site_id"],
                "pid": pid,
                "param": "PM",
                "paramId": pid,
                "parameterId": pid,
                "value": diverted_val,
                "actualRaw": actual_value,
                "ts": timestamp,
            }
        ],
    }

    headers = {
        "Content-Type": "application/json",
        "x-device-key": config["api_key"],
        "x-api-key": config["api_key"],
    }

    # 4. Transmit to Dashboard API
    try:
        resp = requests.post(config["endpoint_url"], json=payload, headers=headers, timeout=8)
        if resp.status_code in [200, 201]:
            data = resp.json()
            return {
                "ok": True,
                "pid": pid,
                "actual": actual_value,
                "diverted": diverted_val,
                "delta": delta,
                "timestamp": timestamp,
                "response": data,
            }
        else:
            return {
                "ok": False,
                "pid": pid,
                "actual": actual_value,
                "diverted": diverted_val,
                "error": f"HTTP {resp.status_code}: {resp.text}",
            }
    except Exception as err:
        return {
            "ok": False,
            "pid": pid,
            "actual": actual_value,
            "diverted": diverted_val,
            "error": str(err),
        }


# ==============================================================================
# MAIN CLI ENTRYPOINT
# ==============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="PM (Particulate Matter / Power Meter) ModScan Telemetry Diverter"
    )

    # Source Options
    src_group = parser.add_argument_group("Data Source Options")
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

    # Dashboard & PID Options
    dash_group = parser.add_argument_group("Dashboard & PID Mapping Options")
    dash_group.add_argument("--endpoint", default=DEFAULT_CONFIG["endpoint_url"],
                            help=f"Dashboard API URL (default: {DEFAULT_CONFIG['endpoint_url']})")
    dash_group.add_argument("--key", default=DEFAULT_CONFIG["api_key"],
                            help="Device/Logger Authentication Key")
    dash_group.add_argument("--site", default=DEFAULT_CONFIG["site_id"],
                            help=f"Target Site Code (default: {DEFAULT_CONFIG['site_id']})")
    dash_group.add_argument("--pid", default=None,
                            help="Dashboard Parameter ID for PM (e.g. PERFECT_2026-PM-1, 855-PM, P-PM)")

    # Diversion Logic Options
    div_group = parser.add_argument_group("Diversion & Calibration Options")
    div_group.add_argument("--divert-factor", type=float, default=1.0,
                           help="Diversion calibration multiplier (default: 1.0 = actual)")
    div_group.add_argument("--divert-offset", type=float, default=0.0,
                           help="Diversion additive offset (default: 0.0)")
    div_group.add_argument("--clamp-max", type=float, default=200.0,
                           help="Upper clamp threshold (default: 200.0)")

    # Execution Options
    exec_group = parser.add_argument_group("Execution Options")
    exec_group.add_argument("--interval", type=float, default=DEFAULT_CONFIG["poll_interval"],
                            help="Polling interval in seconds (default: 5.0)")
    exec_group.add_argument("--once", action="store_true", help="Read, divert once, and exit")

    args = parser.parse_args()

    # Determine execution mode
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

    # Merge Configuration
    config = {
        "endpoint_url": args.endpoint,
        "api_key": args.key,
        "site_id": args.site,
        "parameter_id": args.pid,
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

    # Resolve Parameter ID from Dashboard if not provided
    resolved_pid = config["parameter_id"]
    param_limit = 50.0
    param_unit = "mg/m3"

    if not resolved_pid:
        print("🔍 Querying dashboard schema for PM Parameter ID...")
        auto_pid, lim, unit = resolve_dashboard_pm_pid(config["endpoint_url"], config["api_key"], config["site_id"])
        resolved_pid = auto_pid
        param_limit = lim
        param_unit = unit

    config["parameter_id"] = resolved_pid

    print("=" * 72)
    print(" 🏭 SAAPHZONE OCEMS · PM MODSCAN TELEMETRY DIVERTER")
    print("=" * 72)
    print(f" Source Mode:       {mode.upper()}")
    if mode == "tcp":
        print(f" Target Modbus TCP: {tcp_host}:{tcp_port} (Unit ID: {args.slave})")
    elif mode == "rtu":
        print(f" Target Modbus RTU: {args.rtu} @ {args.baud} baud (Unit ID: {args.slave})")
    elif mode == "file":
        print(f" ModScan Log File:  {args.file}")
    elif mode == "sim":
        print(" ModScan Simulator: ACTIVE (Generating live responses)")

    print(f" Register Address:  {config['register_address']} ({'Input' if args.input else 'Holding'})")
    print(f" Data Format:       {config['data_type'].upper()} (Byte Order: {config['byte_order']})")
    print("-" * 72)
    print(f" Dashboard Site:    {config['site_id']}")
    print(f" Dashboard PID:     \033[96m{config['parameter_id']}\033[0m")
    print(f" CPCB Limit:        {param_limit} {param_unit}")
    print(f" Target Ingest API: {config['endpoint_url']}")
    if config["divert_factor"] != 1.0 or config["divert_offset"] != 0.0:
        print(f" Diversion Math:    V_div = (V_act * {config['divert_factor']}) + {config['divert_offset']}")
    else:
        print(" Diversion Math:    1:1 Direct Telemetry Pass-Through")
    print("=" * 72 + "\n")

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
            # 2. Perform Diversion with reference to Dashboard Parameter ID
            # ------------------------------------------------------------------
            result = divert_pm_response(actual_pm, config, override_pid=config["parameter_id"])

            # ------------------------------------------------------------------
            # 3. Display Detailed Telemetry Report
            # ------------------------------------------------------------------
            if result["ok"]:
                diverted_val = result["diverted"]
                if diverted_val == "NA":
                    print(f"[{now_str}] Cycle #{cycle} · ⚪ [DATA NOT RECEIVING / NA]")
                    print(f"   ├─ Raw ModScan:           NO READING")
                    print(f"   ├─ Actual PM Response:    NA")
                    print(f"   ├─ Parameter ID:          \033[93m[{config['parameter_id']}]\033[0m")
                    print(f"   └─ Dashboard Status:      ✅ Transmitted 'NA' to dashboard\n")
                else:
                    over_limit = diverted_val > param_limit
                    cpcb_tag = "🔴 [EXCEEDANCE]" if over_limit else "🟢 [COMPLIANT]"

                    print(f"[{now_str}] Cycle #{cycle} · {cpcb_tag}")
                    print(f"   ├─ Raw ModScan Registers: {raw_regs}")
                    print(f"   ├─ Actual PM Response:    {actual_pm:.2f} {param_unit}")
                    print(f"   ├─ Diverted Telemetry:    {diverted_val:.2f} {param_unit} (Δ: {result['delta']:+.2f})")
                    print(f"   ├─ Parameter ID:          \033[93m[{config['parameter_id']}]\033[0m")
                    print(f"   └─ Dashboard Status:      ✅ Transmitted successfully (applied: {result['response'].get('applied', 1)})\n")
            else:
                print(f"[{now_str}] Cycle #{cycle} · ❌ Diversion Failed!")
                print(f"   ├─ Actual PM Response:    {actual_pm}")
                print(f"   ├─ Parameter ID:          [{config['parameter_id']}]")
                print(f"   └─ Error:                 {result.get('error')}\n")

            if args.once:
                break

            time.sleep(config["poll_interval"])
            cycle += 1

        except KeyboardInterrupt:
            print("\n👋 PM ModScan Diverter stopped by user.")
            break
        except Exception as ex:
            print(f"❌ Read/Diversion Error: {ex}")
            # If data is not receiving from ModScan / instrument, transmit NA to dashboard
            try:
                na_result = divert_pm_response("NA", config, override_pid=config["parameter_id"])
                if na_result.get("ok"):
                    print(f"   └─ Data not receiving from instrument · Transmitted 'NA' to dashboard\n")
            except Exception:
                pass
            if args.once:
                sys.exit(1)
            time.sleep(config["poll_interval"])


if __name__ == "__main__":
    main()
