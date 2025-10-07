# Android Emulator Executor

This guide covers the headless Android emulator that backs the generic mobile executor. The containerized service boots a disposable emulator instance, exposes ADB over TCP, and surfaces health through the shared Docker Compose stack.

## Resource Profile
- **CPU:** 4 vCPUs recommended (2 vCPUs minimum). Hardware acceleration is used automatically when `/dev/kvm` is present; otherwise the emulator falls back to software execution (slow but functional).
- **Memory:** 6 GiB recommended (3 GiB minimum). Provision at least 8 GiB for Docker Desktop or the host VM so the emulator can reserve RAM and headroom for graphics buffers.
- **Disk:** Runtime state is written to a tmpfs mounted at `/tmp/android-runtime`. The Compose service allocates 8 GiB (`size=8g`) which satisfies the Android 34 `google_apis;x86_64` image. All state is discarded on shutdown.
- **Networking:** Exposes ADB on `5555/tcp`, the emulator console on `5554/tcp`, and gRPC streaming on `8554/tcp`. We deliberately use the non-Play Store image to avoid Google sign-in prompts.

## Running the Emulator Locally
```bash
docker compose -f infra/docker-compose.yml up android-executor --build
```
The service publishes the ports to the host so you can connect via `adb connect localhost:5555` once the health check reports success. Hardware acceleration is enabled automatically when `/dev/kvm` is available; otherwise the emulator runs under software emulation. Expect significantly longer boot times (4–6 minutes) without KVM.

### Verifying Health
Use the repo script to confirm that `adb devices` shows the executor online:
```bash
scripts/verify_android_executor.sh
```
The script fails fast if the service is not running or the device state is anything other than `device`. It also echoes the exact `adb connect` command that host tooling should use.

## Hardware Acceleration & CI Readiness
- **Local Linux hosts:** Ensure virtualization is enabled in BIOS and load KVM modules (`lsmod | grep kvm`). Grant the container `/dev/kvm` (`docker compose ... --device /dev/kvm:/dev/kvm`) to enable hardware acceleration. Without KVM the emulator still works, but boot can exceed five minutes.
- **GitHub Actions runners:** `ubuntu-24.04` runners expose `/dev/kvm` out of the box. The acceptance check in `infra/docker-compose.yml` waits up to eight minutes before failing, which comfortably covers the CI path.
- **Apple Silicon:** Docker Desktop cannot forward Apple’s Hypervisor Framework into Linux containers. Running the emulator inside Docker on ARM macOS currently relies on QEMU’s software translation, which is too unstable for everyday use (SIGTRAP crashes during early boot). Use an x86_64 development VM (e.g. `colima --arch x86_64`, an EC2 c7i instance, or the GitHub Codespaces default runner) when Android executor testing is required.
- **Windows:** Enable Hyper-V/WSL2 virtualization and expose `/dev/kvm` via `wsl --install --no-distribution` then install Ubuntu. Without acceleration expect the same slow-but-functional behaviour as on macOS.

## Troubleshooting
| Symptom | Likely Cause | Suggested Fix |
| --- | --- | --- |
| `adb devices` shows `offline` | Boot still in progress or slow software emulation | Re-run `scripts/verify_android_executor.sh` after ~30s; inspect `docker compose logs android-executor` for progress. |
| `qemu-system` errors mentioning `/dev/kvm` | Hardware acceleration requested but device not present | Remove any `--device /dev/kvm` mapping or ensure the host exposes it. The container falls back to `-accel off` automatically. |
| `Address already in use` for ports | Another emulator instance bound to 5554/5555/8554 | Stop conflicting containers or adjust the published ports via Compose overrides. |
| `Select call returned error : Interrupted system call` followed by emulator crash | Running on Apple Silicon via Docker Desktop; the nested x86 emulator is unsupported | Use an x86_64 host/VM. See “Hardware Acceleration & CI Readiness” above for options. |
| Health check keeps restarting | Host too resource constrained or no KVM | Allocate additional CPU/RAM (Docker Desktop Resources), or run the service in isolation (`docker compose ... up android-executor`). |

## Design Notes
- The base image installs the Android 34 `google_apis;x86_64` system image. This keeps CI fast while still running ARM APKs via Android’s built-in translation layer.
- The entrypoint recreates the AVD in a tmpfs for every boot, guaranteeing disposable state and avoiding credential persistence.
- Ports `5554`/`5555` are proxied to the emulator’s loopback listeners via `socat`, so `adb connect localhost:5555` works from the host even though the emulator itself binds to `127.0.0.1` internally.
- Health is reported when the emulator reports `sys.boot_completed=1`. Compose polls `adb devices` to keep the UI simple.
