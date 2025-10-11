# Kubernetes Manifests

`base.yaml` contains the default rendered manifests for every Tyrum service. The
file is produced from the Helm chart with:

```bash
helm template tyrum infra/helm/tyrum-core > infra/kubernetes/base.yaml
```

Override values using `--values` or `--set` flags when targeting other
environments. Keep the generated manifest in sync whenever the Helm chart or
its defaults change so operators have a static reference for cluster apply
scenarios.
