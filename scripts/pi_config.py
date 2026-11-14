"""
pi_config.py - Shared Raspberry Pi connection settings for all scripts.

Credentials are read from environment variables - never hardcode them.
Usage:
    export PI_HOST=169.254.100.2
    export PI_USER=pi
    export PI_PASSWORD=your_password
    python scripts/pi_preflight.py
"""
import os

PI_HOST = os.getenv("PI_HOST", "169.254.100.2")
PI_USER = os.getenv("PI_USER", "pi")
PI_PASSWORD = os.getenv("PI_PASSWORD", "")

REMOTE_BASE = os.getenv("PI_REMOTE_BASE", "/home/pi/arm64_visualizer")


def connect_pi():
    """Open an SSH connection to the Pi using env-var credentials."""
    import paramiko

    if not PI_PASSWORD:
        raise SystemExit(
            "PI_PASSWORD environment variable is not set.\n"
            "  Linux/macOS : export PI_PASSWORD=your_password\n"
            "  Windows PS  : $env:PI_PASSWORD = 'your_password'\n"
            "  Windows CMD : set PI_PASSWORD=your_password"
        )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(PI_HOST, port=22, username=PI_USER, password=PI_PASSWORD, timeout=10)
    return client
