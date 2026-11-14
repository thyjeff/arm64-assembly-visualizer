"""sync_and_test.py - Deploy project files to the Pi and run the Milestone 1 acceptance test."""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pi_config import connect_pi, REMOTE_BASE

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sync_and_test():
    print(f"Connecting to Raspberry Pi ({os.getenv('PI_HOST', '169.254.100.2')})...")
    ssh = connect_pi()
    sftp = ssh.open_sftp()

    remote_base = REMOTE_BASE

    for d in ["", "examples", "scripts", "backend", "backend/app"]:
        try:
            sftp.mkdir(f"{remote_base}/{d}".rstrip("/"))
        except Exception:
            pass

    files_to_sync = [
        "examples/01_arithmetic.s",
        "examples/02_arithmetic_c_driver.c",
        "examples/03_gpio_led.s",
        "scripts/remote_m1_runner.py",
        "backend/app/schemas.py",
        "backend/app/config.py",
        "backend/app/gdb_engine.py",
        "backend/app/builder.py",
    ]

    print("Syncing files to Raspberry Pi 5...")
    for local_f in files_to_sync:
        local_path = os.path.join(PROJECT_ROOT, local_f)
        if os.path.exists(local_path):
            print(f"  Uploading {local_f}")
            sftp.put(local_path, f"{remote_base}/{local_f}")

    sftp.close()
    ssh.exec_command(f"chmod +x {remote_base}/scripts/remote_m1_runner.py")

    print("\nExecuting Milestone 1 Acceptance Test on Raspberry Pi 5...")
    _, stdout, stderr = ssh.exec_command(f"python3 {remote_base}/scripts/remote_m1_runner.py")

    for line in iter(stdout.readline, ""):
        print(line, end="")

    err = stderr.read().decode("utf-8")
    if err:
        print("REMOTE STDERR:", err)

    exit_status = stdout.channel.recv_exit_status()
    print(f"\nRemote execution finished with exit code {exit_status}.")
    ssh.close()
    return exit_status == 0


if __name__ == "__main__":
    sys.exit(0 if sync_and_test() else 1)
