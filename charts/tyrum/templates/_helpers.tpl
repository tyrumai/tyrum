{{- define "tyrum.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "tyrum.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "tyrum.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "tyrum.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "tyrum.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "tyrum.probe" -}}
{{- $root := .root -}}
{{- $cfg := index $root.Values.probes .name -}}
httpGet:
  path: /healthz
  port: {{ $root.Values.service.port }}
{{- with $cfg }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}

{{- define "tyrum.startArgs" -}}
{{- $root := .root -}}
{{- $role := .role -}}
- {{ $role | quote }}
- "--home"
- {{ $root.Values.runtime.home | quote }}
- "--db"
- {{ $root.Values.runtime.db | quote }}
- "--host"
- {{ $root.Values.runtime.host | quote }}
- "--port"
- {{ printf "%v" $root.Values.service.port | quote }}
{{- with $root.Values.runtime.trustedProxies }}
- "--trusted-proxies"
- {{ . | quote }}
{{- end }}
{{- if $root.Values.runtime.tlsReady }}
- "--tls-ready"
{{- end }}
{{- if $root.Values.runtime.tlsSelfSigned }}
- "--tls-self-signed"
{{- end }}
{{- if $root.Values.runtime.allowInsecureHttp }}
- "--allow-insecure-http"
{{- end }}
{{- end -}}
