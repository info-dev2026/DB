#!/usr/bin/env python3
"""
================================================================================
MODSCAN PARAMETER ID TELEMETRY DIVERTER (ZERO SITE ID REQUIRED)
================================================================================

Description:
  Standalone Python program for sending / hitting ModScan telemetry directly
  using Parameter ID (PID) ONLY — WITHOUT adding or needing any Site ID.

  The backend ingestion engine automatically resolves the target site and
  updates the live dashboard buffer, signals, and charts using the unique PID.

Usage Examples:
  1. Single Parameter ID Hit:
     python modscan_pid_diverter.py --pid 1001 --value 45.2

  2. Multiple Parameter IDs (Key-Value):
     python modscan_pid_diverter.py --pairs "1001=45.2,1002=7.4,1003=18.5"
     python modscan_pid_diverter.py --data '{"1001": 45.2, "1002": 7.4}'

  3. Continuous Simulation Stream (Hits every 5 seconds with random variation):
     python modscan_pid_diverter.py --pid 1001 --base 25.0 --jitter 2.0 --loop --interval 5

  4. List All Parameter IDs from Server:
     python modscan_pid_diverter.py --list-pids

  5. Interactive Mode (No arguments):
     python modscan_pid_diverter.py
================================================================================
"""

import sys
import os
import time
import json
import random
import argparse
from datetime import datetime, timezone

# Windows console UTF-8 fix
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
    print("❌ Error: 'requests' package is missing.")
    print("👉 Please install it using: pip install requests")
    sys.exit(1)

# ANSI Color Codes
class Colors:
    CYAN    = "\033[96m"
    GREEN   = "\033[92m"
    YELLOW  = "\033[93m"
    RED     = "\033[91m"
    MAGENTA = "\033[95m"
    BLUE    = "\033[94m"
    BOLD    = "\033[1m"
    DIM     = "\033[2m"
    RESET   = "\033[0m"

# ==============================================================================
# ⚙️ STEP 1: CONFIGURE STACK NAME & AUTO PARAMETER ID
# ==============================================================================
def generate_param_id_from_stack(stack_name: str, param_key: str = "PM", site_code: str = None) -> str:
    """
    Automatically generates a Parameter ID with reference to the manually declared stack name.
    Strictly guarantees that the Parameter ID contains BOTH character and number.
    """
    import re
    if not stack_name or not str(stack_name).strip():
        stack_name = "STACK 1"

    raw = str(stack_name).strip()
    upper_raw = raw.upper()

    numbers = re.findall(r"\d+", raw)
    num_str = numbers[0] if numbers else "1"

    clean_site = str(site_code or "").replace("_", "").replace("-", "").upper()
    if clean_site == "EOCP123":
        if num_str == "1" or "STACK 1" in upper_raw or "STACK-1" in upper_raw or "STACK_1" in upper_raw:
            return "EOC-STACK-1"
        elif num_str == "2" or "STACK 2" in upper_raw or "STACK-2" in upper_raw or "STACK_2" in upper_raw:
            return "STACK-2-PM"

    slug = re.sub(r"[^A-Za-z0-9]+", "-", raw).strip("-").upper()
    if not re.search(r"[A-Z]", slug):
        slug = f"STACK-{slug}"
    if not re.search(r"[0-9]", slug):
        slug = f"{slug}-{num_str}"

    clean_key = (param_key or "PM").strip().upper()
    if clean_key and clean_key not in slug:
        slug = f"{slug}-{clean_key}"

    return slug


# Declare Stack Name manually (e.g. "STACK 1", "STACK 2", "Boiler Stack 1"):
STACK_NAME = os.getenv("SZ_STACK_NAME", "STACK 1")

# Parameter ID generated automatically with reference to Stack Name (character + number):
DEFAULT_PARAMETER_ID = generate_param_id_from_stack(STACK_NAME, "PM")
DEFAULT_VALUE = 35.0                  # 👈 Default telemetry value to send

# Optional: Configure multiple Parameter IDs for batch sending
PARAMETER_MAP = {
    # "1001": 42.5,   # "PID": Value
    # "1002": 18.0,
}

# ==============================================================================
# API & Network Configuration
# ==============================================================================
DEFAULT_URL = os.getenv("SZ_API_URL", "http://127.0.0.1:4000/api/datalogger/readings")
DEFAULT_KEY = os.getenv("SZ_DEVICE_KEY", "sz_generic_logger_key_2026")


def clean_endpoint_url(raw_url):
    """Ensures endpoint points to /api/datalogger/readings."""
    url = raw_url.strip().rstrip("/")
    if not url.endswith("/api/datalogger/readings"):
        if "/api/datalogger" in url:
            url = url.split("/api/datalogger")[0] + "/api/datalogger/readings"
        else:
            url = url + "/api/datalogger/readings"
    return url


def get_base_url(readings_url):
    """Extracts base protocol://host:port from readings URL."""
    if "/api/datalogger" in readings_url:
        return readings_url.split("/api/datalogger")[0]
    return readings_url.rstrip("/")


def send_telemetry_by_pid(readings_dict, endpoint_url=DEFAULT_URL, api_key=DEFAULT_KEY, verbose=False):
    """
    Sends telemetry to backend using Parameter IDs ONLY — NO site ID added.
    
    Args:
        readings_dict (dict): Mapping of {pid: value}, e.g. {"1001": 42.5, "1002": 7.35}
        endpoint_url (str): Ingestion endpoint URL
        api_key (str): Device authentication key
        verbose (bool): Whether to print raw debug output

    Returns:
        dict: Parsed JSON response from server or None on failure
    """
    clean_url = clean_endpoint_url(endpoint_url)
    
    # Strictly NO siteId in the payload!
    payload = {}
    for pid, val in readings_dict.items():
        if val is None or str(val).strip().upper() in ["NA", "N/A", "NONE", "NULL"]:
            payload[str(pid).strip()] = "NA"
        else:
            try:
                payload[str(pid).strip()] = round(float(val), 2)
            except (ValueError, TypeError):
                payload[str(pid).strip()] = val

    headers = {
        "Content-Type": "application/json",
        "x-device-key": api_key,
        "x-api-key": api_key,
        "User-Agent": "SZ-ModScan-PID-Diverter/3.1",
    }

    t0 = time.time()
    try:
        resp = requests.post(clean_url, json=payload, headers=headers, timeout=10)
        elapsed_ms = round((time.time() - t0) * 1000)

        if resp.status_code in [200, 201]:
            data = resp.json()
            if verbose:
                print(f"{Colors.DIM}[DEBUG Raw Response]: {json.dumps(data, indent=2)}{Colors.RESET}")
            return {"ok": True, "status": resp.status_code, "elapsed_ms": elapsed_ms, "data": data}
        else:
            return {"ok": False, "status": resp.status_code, "elapsed_ms": elapsed_ms, "error": resp.text}
    except Exception as e:
        elapsed_ms = round((time.time() - t0) * 1000)
        return {"ok": False, "status": 0, "elapsed_ms": elapsed_ms, "error": str(e)}


def print_diversion_result(result, original_payload):
    """Prints a formatted human-readable table of diversion results."""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not result["ok"]:
        print(f"\n{Colors.RED}❌ HTTP Failure ({result['status']}) [{result['elapsed_ms']}ms] at {now_str}{Colors.RESET}")
        print(f"{Colors.RED}   Error: {result.get('error', 'Unknown error')}{Colors.RESET}")
        return

    data = result["data"]
    applied = data.get("applied", 0)
    diverted = data.get("diverted", [])
    skipped = data.get("skipped", [])

    print(f"\n{Colors.GREEN}✔ Successfully Processed ({result['elapsed_ms']}ms) at {now_str} — Applied: {applied}{Colors.RESET}")

    if diverted:
        print(f"\n{Colors.BOLD}{'PARAM ID':<16} {'RESOLVED SITE':<18} {'PARAM':<10} {'VALUE':<10} {'SIGNAL':<10} {'STATUS'}{Colors.RESET}")
        print("-" * 75)
        for d in diverted:
            pid = str(d.get("requestedPid") or d.get("pid") or "-")
            site = str(d.get("siteCode") or "-")
            key = str(d.get("key") or "-")
            val = str(d.get("value") if d.get("value") is not None else "NA")
            sig = str(d.get("signal") or "green")
            stat = str(d.get("status") or "diverted")

            sig_color = Colors.GREEN if sig == "green" else Colors.YELLOW if sig == "orange" else Colors.RED if sig == "red" else Colors.DIM
            print(f"{Colors.CYAN}{pid:<16}{Colors.RESET} {Colors.BOLD}{site:<18}{Colors.RESET} {key:<10} {Colors.GREEN}{val:<10}{Colors.RESET} {sig_color}{sig:<10}{Colors.RESET} {Colors.GREEN}{stat}{Colors.RESET}")

    if skipped:
        print(f"\n{Colors.YELLOW}⚠️  Skipped Parameters ({len(skipped)}):{Colors.RESET}")
        for s in skipped:
            pid = str(s.get("pid") or "-")
            reason = str(s.get("reason") or "Unknown")
            print(f"   • PID {Colors.YELLOW}{pid}{Colors.RESET}: {reason}")


def fetch_all_pids(endpoint_url=DEFAULT_URL, api_key=DEFAULT_KEY):
    """Fetches all active Parameter IDs from the backend without requiring siteId."""
    base = get_base_url(endpoint_url)
    url = f"{base}/api/datalogger/parameters"
    headers = {"x-device-key": api_key, "x-api-key": api_key}

    try:
        resp = requests.get(url, headers=headers, timeout=8)
        if resp.status_code == 200:
            return resp.json().get("parameters", [])
        return []
    except Exception as e:
        print(f"{Colors.RED}❌ Could not fetch parameter list: {e}{Colors.RESET}")
        return []


def ping_backend(endpoint_url=DEFAULT_URL, api_key=DEFAULT_KEY):
    """Pings backend datalogger health."""
    base = get_base_url(endpoint_url)
    url = f"{base}/api/datalogger/ping"
    headers = {"x-device-key": api_key}
    t0 = time.time()
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        ms = round((time.time() - t0) * 1000)
        if resp.status_code == 200:
            print(f"{Colors.GREEN}✔ Connection Successful! Ping: {ms}ms | Server TS: {resp.json().get('ts')}{Colors.RESET}")
            return True
        else:
            print(f"{Colors.RED}❌ Server responded with code {resp.status_code}: {resp.text}{Colors.RESET}")
            return False
    except Exception as e:
        print(f"{Colors.RED}❌ Connection failed ({url}): {e}{Colors.RESET}")
        return False


def run_interactive_mode(endpoint_url, api_key):
    """Interactive CLI menu when run without command-line arguments."""
    while True:
        print("\n" + "=" * 65)
        print(f"{Colors.CYAN}{Colors.BOLD}   MODSCAN TELEMETRY DIVERTER (PID ONLY — NO SITE ID) {Colors.RESET}")
        print("=" * 65)
        print(f"  Target Endpoint : {Colors.BOLD}{clean_endpoint_url(endpoint_url)}{Colors.RESET}")
        print(f"  API Device Key  : {Colors.DIM}{api_key[:6]}...{api_key[-4:] if len(api_key)>10 else api_key}{Colors.RESET}")
        print("-" * 65)
        print(f"  {Colors.BOLD}[1]{Colors.RESET} Hit Single Parameter ID (e.g. PID: 1001, Value: 42.5)")
        print(f"  {Colors.BOLD}[2]{Colors.RESET} Hit Multiple Parameter IDs (Batch Key-Value)")
        print(f"  {Colors.BOLD}[3]{Colors.RESET} Continuous Live Simulation Stream (Periodic loop)")
        print(f"  {Colors.BOLD}[4]{Colors.RESET} List All Active Parameter IDs from Server")
        print(f"  {Colors.BOLD}[5]{Colors.RESET} Test Server Connection (Ping)")
        print(f"  {Colors.BOLD}[6]{Colors.RESET} Change Endpoint URL / API Key")
        print(f"  {Colors.BOLD}[0]{Colors.RESET} Exit")
        print("-" * 65)

        choice = input(f"{Colors.YELLOW}Enter option (0-6): {Colors.RESET}").strip()

        if choice == "0":
            print("Exiting. Goodbye!")
            break

        elif choice == "1":
            pid = input(f"\n{Colors.BOLD}Enter Parameter ID (PID) [e.g. 1001 or PERFECT_2026-PM-1]: {Colors.RESET}").strip()
            if not pid:
                print(f"{Colors.RED}PID cannot be empty.{Colors.RESET}")
                continue
            val_str = input(f"{Colors.BOLD}Enter Telemetry Value [e.g. 45.2 or NA]: {Colors.RESET}").strip()
            try:
                val = float(val_str)
            except ValueError:
                val = val_str

            print(f"\n📡 Hitting Parameter ID {Colors.CYAN}{pid}{Colors.RESET} with value {Colors.GREEN}{val}{Colors.RESET} (NO site ID)...")
            res = send_telemetry_by_pid({pid: val}, endpoint_url, api_key)
            print_diversion_result(res, {pid: val})

        elif choice == "2":
            print(f"\nEnter pairs in format: {Colors.CYAN}PID=VALUE,PID=VALUE{Colors.RESET}")
            print(f"Example: {Colors.DIM}1001=45.2, 1002=7.35, 1003=18.0{Colors.RESET}")
            raw = input(f"{Colors.BOLD}Enter pairs: {Colors.RESET}").strip()
            if not raw:
                continue
            payload = {}
            for chunk in raw.split(","):
                if "=" in chunk:
                    k, v = chunk.split("=", 1)
                    k = k.strip()
                    v = v.strip()
                    try:
                        payload[k] = float(v)
                    except ValueError:
                        payload[k] = v
            if payload:
                print(f"\n📡 Hitting {len(payload)} parameters without site ID...")
                res = send_telemetry_by_pid(payload, endpoint_url, api_key)
                print_diversion_result(res, payload)
            else:
                print(f"{Colors.RED}No valid PID=VALUE pairs found.{Colors.RESET}")

        elif choice == "3":
            pid = input(f"\n{Colors.BOLD}Enter Parameter ID (PID) to stream [e.g. 1001]: {Colors.RESET}").strip()
            if not pid:
                continue
            base_str = input(f"{Colors.BOLD}Enter Base Value [default 30.0]: {Colors.RESET}").strip() or "30.0"
            jitter_str = input(f"{Colors.BOLD}Enter Max Random Jitter (+/-) [default 2.5]: {Colors.RESET}").strip() or "2.5"
            interval_str = input(f"{Colors.BOLD}Enter Interval Seconds [default 5]: {Colors.RESET}").strip() or "5"

            base = float(base_str)
            jitter = float(jitter_str)
            interval = float(interval_str)

            print(f"\n🚀 Streaming live simulated hits for PID {Colors.CYAN}{pid}{Colors.RESET} every {interval}s (Ctrl+C to stop)...")
            count = 1
            try:
                while True:
                    cur_val = round(base + (random.random() - 0.5) * 2 * jitter, 2)
                    res = send_telemetry_by_pid({pid: cur_val}, endpoint_url, api_key)
                    print(f"[{count:04d}] Sent PID {pid} = {cur_val} -> Applied: {res.get('data', {}).get('applied', 0)} ({res.get('elapsed_ms')}ms)")
                    count += 1
                    time.sleep(interval)
            except KeyboardInterrupt:
                print(f"\n{Colors.YELLOW}Stream stopped by user.{Colors.RESET}")

        elif choice == "4":
            print(f"\n🔍 Querying active Parameter IDs from {get_base_url(endpoint_url)}...")
            params = fetch_all_pids(endpoint_url, api_key)
            if not params:
                print(f"{Colors.YELLOW}No parameters returned or endpoint unreachable.{Colors.RESET}")
            else:
                print(f"\n{Colors.GREEN}✔ Found {len(params)} Total Parameters across sites:{Colors.RESET}")
                print(f"{Colors.BOLD}{'PID':<16} {'NAME / KEY':<16} {'SITE CODE':<18} {'CURRENT VAL':<12} {'SIGNAL'}{Colors.RESET}")
                print("-" * 72)
                for p in params[:40]:  # Show first 40
                    pid = str(p.get("pid", "-"))
                    name = str(p.get("name") or p.get("key") or "-")
                    site = str(p.get("siteCode", "-"))
                    val = str(p.get("currentValue") if p.get("currentValue") is not None else "-")
                    sig = str(p.get("signal", "-"))
                    print(f"{Colors.CYAN}{pid:<16}{Colors.RESET} {name:<16} {Colors.BOLD}{site:<18}{Colors.RESET} {val:<12} {sig}")
                if len(params) > 40:
                    print(f"{Colors.DIM}... and {len(params) - 40} more parameters.{Colors.RESET}")

        elif choice == "5":
            ping_backend(endpoint_url, api_key)

        elif choice == "6":
            new_url = input(f"Enter new endpoint URL [{endpoint_url}]: ").strip()
            if new_url:
                endpoint_url = clean_endpoint_url(new_url)
            new_key = input(f"Enter new API key [{api_key}]: ").strip()
            if new_key:
                api_key = new_key
            print(f"{Colors.GREEN}✔ Settings updated.{Colors.RESET}")


def main():
    parser = argparse.ArgumentParser(
        description="Hit ModScan Telemetry by Parameter ID (PID) without adding Site ID",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python modscan_pid_diverter.py --pid 1001 --value 45.2
  python modscan_pid_diverter.py --pairs "1001=45.2,1002=7.4"
  python modscan_pid_diverter.py --data '{"1001": 45.2, "1002": 7.4}'
  python modscan_pid_diverter.py --pid 1001 --base 30.0 --jitter 2.0 --loop --interval 5
  python modscan_pid_diverter.py --list-pids
  python modscan_pid_diverter.py --ping
"""
    )

    parser.add_argument("--pid", help="Target Parameter ID (PID, e.g. 1001, 1002, PERFECT_2026-PM-1)")
    parser.add_argument("--value", help="Telemetry value to send (e.g. 45.2, or NA)")
    parser.add_argument("--data", help='JSON dictionary string of PIDs to values, e.g. \'{"1001": 45.2, "1002": 7.4}\'')
    parser.add_argument("--pairs", help='Comma-separated PID=VALUE list, e.g. "1001=45.2,1002=7.4"')
    parser.add_argument("--url", default=DEFAULT_URL, help=f"Ingestion endpoint URL (default: {DEFAULT_URL})")
    parser.add_argument("--key", default=DEFAULT_KEY, help="Device / API logger authentication key")
    parser.add_argument("--loop", action="store_true", help="Run in continuous simulation loop")
    parser.add_argument("--interval", type=float, default=5.0, help="Loop interval in seconds (default: 5.0)")
    parser.add_argument("--base", type=float, help="Base value for loop simulation")
    parser.add_argument("--jitter", type=float, default=1.5, help="Random variation (+/-) for simulation loop")
    parser.add_argument("--list-pids", action="store_true", help="Query and list all active Parameter IDs from server")
    parser.add_argument("--ping", action="store_true", help="Test server connectivity and exit")
    parser.add_argument("--verbose", action="store_true", help="Print raw debug response JSON")

    args = parser.parse_args()

    # If no arguments provided, launch interactive mode
    if len(sys.argv) == 1:
        run_interactive_mode(args.url, args.key)
        return

    # Option: Ping
    if args.ping:
        ping_backend(args.url, args.key)
        return

    # Option: List PIDs
    if args.list_pids:
        params = fetch_all_pids(args.url, args.key)
        print(f"\n{Colors.GREEN}✔ Found {len(params)} Parameters on Server:{Colors.RESET}")
        print(f"{Colors.BOLD}{'PID':<16} {'NAME / KEY':<16} {'SITE CODE':<18} {'CURRENT VAL':<12} {'SIGNAL'}{Colors.RESET}")
        print("-" * 72)
        for p in params:
            pid = str(p.get("pid", "-"))
            name = str(p.get("name") or p.get("key") or "-")
            site = str(p.get("siteCode", "-"))
            val = str(p.get("currentValue") if p.get("currentValue") is not None else "-")
            sig = str(p.get("signal", "-"))
            print(f"{Colors.CYAN}{pid:<16}{Colors.RESET} {name:<16} {Colors.BOLD}{site:<18}{Colors.RESET} {val:<12} {sig}")
        return

    # Parse readings payload from args
    readings = {}

    if args.data:
        try:
            parsed = json.loads(args.data)
            if isinstance(parsed, dict):
                readings.update(parsed)
            elif isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict) and "pid" in item:
                        readings[str(item["pid"])] = item.get("value")
        except json.JSONDecodeError as e:
            print(f"{Colors.RED}❌ Invalid JSON in --data: {e}{Colors.RESET}")
            sys.exit(1)

    if args.pairs:
        for chunk in args.pairs.split(","):
            if "=" in chunk:
                k, v = chunk.split("=", 1)
                try:
                    readings[k.strip()] = float(v.strip())
                except ValueError:
                    readings[k.strip()] = v.strip()

    # Determine target PID and values
    target_pid = args.pid or (DEFAULT_PARAMETER_ID if (args.value is not None or not readings) else None)

    if target_pid:
        val = args.value
        if val is None and args.base is not None:
            val = args.base
        elif val is None:
            val = DEFAULT_VALUE

        try:
            readings[str(target_pid).strip()] = float(val)
        except (ValueError, TypeError):
            readings[str(target_pid).strip()] = val

    # Include any parameters from PARAMETER_MAP if not already set
    if not readings and PARAMETER_MAP:
        readings.update(PARAMETER_MAP)

    if not readings:
        print(f"{Colors.RED}❌ No parameter ID specified. Use --pid <ID> --value <VAL>, --pairs, or --data.{Colors.RESET}")
        print(f"👉 Set DEFAULT_PARAMETER_ID in the script, run with -h for help, or run without arguments for interactive mode.")
        sys.exit(1)

    # Single hit or Continuous Loop
    if not args.loop:
        print(f"\n📡 Hitting {len(readings)} parameter(s) by PID (NO site ID added)...")
        res = send_telemetry_by_pid(readings, args.url, args.key, verbose=args.verbose)
        print_diversion_result(res, readings)
    else:
        print(f"\n🚀 Running continuous stream every {args.interval}s for {len(readings)} parameter(s) (Ctrl+C to stop)...")
        iteration = 1
        try:
            while True:
                # Add jitter if base / jitter provided
                current_frame = {}
                for pid, base_val in readings.items():
                    if isinstance(base_val, (int, float)):
                        jitter_offset = (random.random() - 0.5) * 2 * args.jitter
                        current_frame[pid] = round(base_val + jitter_offset, 2)
                    else:
                        current_frame[pid] = base_val

                res = send_telemetry_by_pid(current_frame, args.url, args.key, verbose=args.verbose)
                now_str = datetime.now().strftime("%H:%M:%S")
                if res["ok"]:
                    applied = res.get("data", {}).get("applied", 0)
                    print(f"[{now_str} #{iteration:04d}] ✔ Diverted {applied} PID(s): {current_frame} ({res['elapsed_ms']}ms)")
                else:
                    print(f"[{now_str} #{iteration:04d}] ❌ Error: {res.get('error')}")

                iteration += 1
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print(f"\n{Colors.YELLOW}Stopped continuous loop.{Colors.RESET}")


if __name__ == "__main__":
    main()
