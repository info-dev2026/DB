#!/usr/bin/env python3
"""
============================================================
scripts/modscan_diverter.py

Generic ModScan & Modbus Telemetry Diverter (Python Version)
Reads ModScan registers / polls Modbus instruments and diverts
real-time data for every parameter to the Saaphzone dashboard
using Parameter IDs (PIDs).

Requirements:
    pip install requests
    (Optional for direct Modbus TCP: pip install pymodbus)

Usage:
    # 1. Continuous simulation mode:
    python scripts/modscan_diverter.py

    # 2. Hit a single parameter reading:
    python scripts/modscan_diverter.py --pid 855-PH --value 7.45 --site ESK-4417

    # 3. Custom endpoint and key:
    python scripts/modscan_diverter.py --endpoint http://localhost:5000/api/datalogger/readings --key sz_generic_logger_key_2026
============================================================
"""

import sys
import time
import json
import random
import argparse
from datetime import datetime

try:
    import requests
except ImportError:
    print("❌ 'requests' library not found. Please run: pip install requests")
    sys.exit(1)

# Default configuration
DEFAULT_CONFIG = {
    "endpoint_url": "http://localhost:5000/api/datalogger/readings",
    "api_key": "sz_generic_logger_key_2026",
    "site_id": "ESK-4417",
    "interval_seconds": 5,
}

# Generic ModScan Register-to-PID Mapping Table
MODSCAN_PID_MAP = [
    {"address": 40001, "pid": "855-PH",   "key": "pH",          "scale": 0.01, "base": 7.35, "var": 0.25},
    {"address": 40002, "pid": "855-COD",  "key": "COD",         "scale": 1.0,  "base": 140.0, "var": 15.0},
    {"address": 40003, "pid": "855-BOD",  "key": "BOD",         "scale": 1.0,  "base": 22.0, "var": 4.0},
    {"address": 40004, "pid": "855-TSS",  "key": "TSS",         "scale": 1.0,  "base": 45.0, "var": 8.0},
    {"address": 40005, "pid": "855-FLOW", "key": "Flow",        "scale": 0.1,  "base": 3.2, "var": 0.5},
    {"address": 40006, "pid": "855-SOX",  "key": "SOX",         "scale": 0.1,  "base": 88.0, "var": 12.0},
    {"address": 40007, "pid": "855-NOX",  "key": "NOx",         "scale": 0.1,  "base": 130.0, "var": 18.0},
    {"address": 40008, "pid": "855-PM",   "key": "PM",          "scale": 0.1,  "base": 38.0, "var": 6.0},
    {"address": 40009, "pid": "855-TEMP", "key": "Temperature", "scale": 0.1,  "base": 125.0, "var": 4.0},
]


def divert_modscan_response(data_payload, config):
    """
    Generic function to divert any ModScan response payload by Parameter ID.
    Accepts:
        - List of dicts: [{"pid": "...", "value": 12.3}, ...]
        - Dict of PID -> value: {"855-PH": 7.42, "855-SOX": 85.1}
        - Dict of Register -> value: {40001: 742, 40002: 140}
    """
    timestamp = datetime.utcnow().isoformat() + "Z"
    readings = []

    # Case 1: List of readings
    if isinstance(data_payload, list):
        for item in data_payload:
            pid = item.get("pid") or item.get("param") or item.get("parameterId")
            val = item.get("value") or item.get("val")
            if pid and val is not None:
                readings.append({
                    "siteId": config["site_id"],
                    "pid": str(pid),
                    "value": round(float(val), 2),
                    "ts": timestamp
                })

    # Case 2: Dict of mappings
    elif isinstance(data_payload, dict):
        for key, val in data_payload.items():
            # Check if key is a register address
            matched_param = None
            if str(key).isdigit():
                addr = int(key)
                matched_param = next((m for m in MODSCAN_PID_MAP if m["address"] == addr), None)

            pid = matched_param["pid"] if matched_param else str(key)
            scale = matched_param["scale"] if matched_param else 1.0
            numeric_val = round(float(val) * scale, 2)

            readings.append({
                "siteId": config["site_id"],
                "pid": pid,
                "value": numeric_val,
                "ts": timestamp
            })

    if not readings:
        print("⚠️ No valid parameters to divert.")
        return False

    headers = {
        "Content-Type": "application/json",
        "x-device-key": config["api_key"],
        "x-api-key": config["api_key"],
    }

    body = {
        "siteId": config["site_id"],
        "readings": readings
    }

    try:
        resp = requests.post(config["endpoint_url"], json=body, headers=headers, timeout=10)
        if resp.status_code in [200, 201]:
            return resp.json()
        else:
            print(f"❌ Server error ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        print(f"❌ Connection error: {e}")
        return False


def generate_simulated_readings():
    """Generates simulated ModScan register frame"""
    frame = {}
    for p in MODSCAN_PID_MAP:
        delta = (random.random() - 0.5) * 2 * p["var"]
        frame[p["pid"]] = round(p["base"] + delta, 2)
    return frame


def main():
    parser = argparse.ArgumentParser(description="Generic ModScan Telemetry Diverter")
    parser.add_argument("--endpoint", default=DEFAULT_CONFIG["endpoint_url"], help="API ingest endpoint URL")
    parser.add_argument("--key", default=DEFAULT_CONFIG["api_key"], help="Device / API logger key")
    parser.add_argument("--site", default=DEFAULT_CONFIG["site_id"], help="Target Site Code")
    parser.add_argument("--interval", type=int, default=DEFAULT_CONFIG["interval_seconds"], help="Polling interval in seconds")
    parser.add_argument("--pid", help="Specific Parameter ID to hit (single hit mode)")
    parser.add_argument("--value", type=float, help="Value for specific Parameter ID")
    parser.add_argument("--once", action="store_true", help="Send once and exit")

    args = parser.parse_args()

    config = {
        "endpoint_url": args.endpoint,
        "api_key": args.key,
        "site_id": args.site,
        "interval_seconds": args.interval,
    }

    print("=" * 60)
    print(" 🚀 PYTHON MODSCAN GENERIC REAL-TIME TELEMETRY DIVERTER")
    print("=" * 60)
    print(f" Target Endpoint: {config['endpoint_url']}")
    print(f" Site ID:         {config['site_id']}")
    print(f" Channels:        {len(MODSCAN_PID_MAP)} parameter channels")
    print("=" * 60 + "\n")

    # Single Parameter Divert Mode
    if args.pid and args.value is not None:
        print(f"🎯 Diverting single parameter: [{args.pid}] = {args.value}")
        res = divert_modscan_response({args.pid: args.value}, config)
        if res:
            print("✅ Successfully diverted parameter!")
            print(json.dumps(res, indent=2))
        sys.exit(0 if res else 1)

    # Continuous Diverter Mode
    print(f"🔄 Polling & diverting all parameters every {config['interval_seconds']}s...")
    print("Press Ctrl+C to terminate.\n")

    cycle = 1
    while True:
        try:
            frame = generate_simulated_readings()
            now_str = datetime.now().strftime("%H:%M:%S")
            print(f"[{now_str}] Cycle #{cycle} · Diverting {len(frame)} parameters to dashboard...")
            res = divert_modscan_response(frame, config)
            if res:
                for pid, val in frame.items():
                    print(f"   └─ [{pid.ljust(12)}] -> {str(val).ljust(8)}")
                print(f"   Status: ✅ Diverted ({res.get('applied', len(frame))} applied)\n")
            if args.once:
                break
            time.sleep(config["interval_seconds"])
            cycle += 1
        except KeyboardInterrupt:
            print("\n👋 Diverter stopped by user.")
            break


if __name__ == "__main__":
    main()
