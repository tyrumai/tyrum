# ADR-007: Sandbox Enforcement

**Status**: Accepted
**Date**: 2026-02-21

## Context

The gateway's tool executor runs untrusted tool invocations (shell commands,
file operations, code execution) on behalf of agents.  The current mitigation
is a workspace path boundary check in `tool-executor.ts` that restricts file
operations to a configured workspace directory.

OS-level sandboxing (namespaces, seccomp, AppArmor) provides a stronger
defense-in-depth layer but is inherently a deployment concern -- the
container runtime and orchestrator must apply the restrictions, not the
application process itself.

## Decision

1. **Workspace path boundary** remains in the application layer
   (`tool-executor.ts`).  It is the first line of defense and is always
   active regardless of deployment target.

2. **OS-level sandboxing is a deployment concern.**  The gateway does not
   attempt to call `prctl(2)` or load seccomp filters at runtime.  Instead,
   deployment manifests (Helm charts, Docker Compose, systemd units) must
   apply appropriate restrictions.

3. **Reference securityContext** is provided in the Helm chart for the
   tool-runner deployment.  Teams deploying the gateway MUST review and
   adapt the profile to their environment.

## Reference Profiles

### Kubernetes securityContext (Helm)

```yaml
securityContext:
  runAsNonRoot: true
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
```

### Example AppArmor annotation

```yaml
annotations:
  container.apparmor.security.beta.kubernetes.io/toolrunner: runtime/default
```

### Example seccomp profile snippet (for custom profiles)

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": ["SCMP_ARCH_X86_64"],
  "syscalls": [
    {
      "names": ["read", "write", "openat", "close", "fstat", "mmap",
                 "mprotect", "munmap", "brk", "pread64", "pwrite64",
                 "ioctl", "access", "pipe", "select", "sched_yield",
                 "dup2", "nanosleep", "getpid", "socket", "connect",
                 "sendto", "recvfrom", "sendmsg", "recvmsg",
                 "shutdown", "bind", "listen", "accept4",
                 "clone", "execve", "wait4", "kill", "fcntl",
                 "getcwd", "chdir", "mkdir", "rmdir", "unlink",
                 "readlink", "stat", "lstat", "futex",
                 "epoll_create1", "epoll_ctl", "epoll_wait",
                 "exit", "exit_group", "rt_sigaction", "rt_sigprocmask",
                 "rt_sigreturn", "set_tid_address", "set_robust_list",
                 "getrandom", "arch_prctl"],
      "action": "SCMP_ACT_ALLOW"
    }
  ]
}
```

## Consequences

- Operators are responsible for applying OS-level sandboxing in their
  deployment environment.
- The Helm chart ships with secure defaults (`runAsNonRoot`,
  `readOnlyRootFilesystem`, drop all capabilities).
- The application-layer path boundary continues to be tested and enforced
  regardless of external sandboxing.
