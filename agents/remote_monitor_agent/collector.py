"""Coletores leves e inventário Windows, sem fabricar dados ausentes."""
from __future__ import annotations

import json
import platform
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone
from typing import Any

import psutil


def normalize_percent(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    return round(min(number, 100.0), 2)


def _temperatures() -> list[dict[str, Any]] | None:
    try:
        sensors = psutil.sensors_temperatures()
    except (AttributeError, OSError, NotImplementedError):
        return None
    result = []
    for source, entries in (sensors or {}).items():
        for entry in entries:
            current = getattr(entry, "current", None)
            if current is not None:
                result.append({"source": source, "label": entry.label or source, "celsius": float(current)})
    return result or None


def collect_light() -> dict[str, Any]:
    memory = psutil.virtual_memory()
    boot = psutil.boot_time()
    volumes = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (OSError, PermissionError):
            continue
        volumes.append(
            {
                "device": part.device,
                "mountpoint": part.mountpoint,
                "filesystem": part.fstype,
                "total_bytes": usage.total,
                "used_bytes": usage.used,
                "free_bytes": usage.free,
                "percent": normalize_percent(usage.percent),
            }
        )
    net = psutil.net_io_counters()
    addresses = psutil.net_if_addrs()
    connectivity = any(
        stat.isup
        and "loopback" not in name.lower()
        and any(
            address.family in {socket.AF_INET, socket.AF_INET6}
            and not address.address.startswith(("127.", "::1"))
            for address in addresses.get(name, [])
        )
        for name, stat in psutil.net_if_stats().items()
    )
    temperatures = _temperatures()
    disk_percent = max(
        (volume["percent"] for volume in volumes if volume["percent"] is not None),
        default=None,
    )
    temperature_c = max(
        (sensor["celsius"] for sensor in temperatures or []),
        default=None,
    )
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "cpu_percent": normalize_percent(psutil.cpu_percent(interval=None)),
        "ram_percent": normalize_percent(memory.percent),
        "disk_percent": disk_percent,
        "temperature_c": temperature_c,
        "memory": {
            "total_bytes": memory.total,
            "available_bytes": memory.available,
            "used_bytes": memory.used,
            "percent": normalize_percent(memory.percent),
        },
        "volumes": volumes,
        "uptime_seconds": max(0, int(time.time() - boot)),
        "network": {
            "connected": connectivity,
            "bytes_sent": net.bytes_sent,
            "bytes_received": net.bytes_recv,
            "packets_sent": net.packets_sent,
            "packets_received": net.packets_recv,
        },
        "temperatures": temperatures,
    }


def _powershell_json(script: str, timeout: int = 30) -> dict[str, Any]:
    powershell = shutil.which("powershell") or shutil.which("pwsh")
    if not powershell or platform.system() != "Windows":
        return {"status": "unavailable", "reason": "PowerShell/WMI disponível somente no Windows"}
    try:
        completed = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        return {"status": "error", "error": f"timeout após {timeout}s"}
    except OSError as exc:
        return {"status": "error", "error": str(exc)}
    if completed.returncode != 0:
        return {"status": "error", "error": (completed.stderr or "PowerShell falhou").strip()[:1000]}
    try:
        return {"status": "available", "data": json.loads(completed.stdout)}
    except json.JSONDecodeError:
        return {"status": "error", "error": "PowerShell retornou JSON inválido"}


def collect_inventory(timeout: int = 45) -> dict[str, Any]:
    script = r"""
$ErrorActionPreference='Stop'
$o=Get-CimInstance Win32_OperatingSystem | Select Caption,Version,BuildNumber,OSArchitecture,LastBootUpTime
$bios=Get-CimInstance Win32_BIOS | Select Manufacturer,SMBIOSBIOSVersion,SerialNumber
$board=Get-CimInstance Win32_BaseBoard | Select Manufacturer,Product,SerialNumber
$cpu=@(Get-CimInstance Win32_Processor | Select Name,Manufacturer,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed)
$ram=@(Get-CimInstance Win32_PhysicalMemory | Select Manufacturer,PartNumber,Capacity,Speed)
$disks=@(Get-CimInstance Win32_DiskDrive | Select Model,SerialNumber,Size,MediaType,InterfaceType)
$gpu=@(Get-CimInstance Win32_VideoController | Select Name,AdapterRAM,DriverVersion)
$temp=@(Get-CimInstance -Namespace root/wmi MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Where-Object {$_.CurrentTemperature -gt 0} | ForEach-Object {[pscustomobject]@{source=$_.InstanceName;celsius=[math]::Round(($_.CurrentTemperature/10)-273.15,2)}})
[pscustomobject]@{os=$o;bios=$bios;motherboard=$board;cpu=$cpu;ram=$ram;disks=$disks;gpu=$gpu;temperatures=$temp}|ConvertTo-Json -Depth 6 -Compress
"""
    result = _powershell_json(script, timeout)
    result["collected_at"] = datetime.now(timezone.utc).isoformat()
    if result["status"] == "unavailable":
        result["basic"] = {
            "hostname": socket.gethostname(),
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        }
    return result


def collect_pending_updates(timeout: int = 60) -> dict[str, Any]:
    script = r"""
$ErrorActionPreference='Stop'
$session=New-Object -ComObject Microsoft.Update.Session
$searcher=$session.CreateUpdateSearcher()
$result=$searcher.Search("IsInstalled=0 and IsHidden=0")
$items=@($result.Updates | ForEach-Object {[pscustomobject]@{title=$_.Title;kb=@($_.KBArticleIDs);severity=$_.MsrcSeverity;downloaded=$_.IsDownloaded}})
[pscustomobject]@{count=$items.Count;updates=$items}|ConvertTo-Json -Depth 5 -Compress
"""
    result = _powershell_json(script, timeout)
    result["checked_at"] = datetime.now(timezone.utc).isoformat()
    return result
