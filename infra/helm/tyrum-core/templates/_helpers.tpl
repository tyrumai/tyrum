{{/* Expand the name of the chart. */}}
{{- define "tyrum-core.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* Create a default fully qualified app name. */}}
{{- define "tyrum-core.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end }}
{{- end }}
{{- end }}

{{/* Create chart name and version as used by the chart label. */}}
{{- define "tyrum-core.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* Common labels */}}
{{- define "tyrum-core.labels" -}}
helm.sh/chart: {{ include "tyrum-core.chart" . }}
app.kubernetes.io/name: {{ include "tyrum-core.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels */}}
{{- define "tyrum-core.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tyrum-core.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Create the name of the service account to use */}}
{{- define "tyrum-core.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "tyrum-core.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end }}
{{- end }}

{{/* Build a qualified name for a service entry. */}}
{{- define "tyrum-core.serviceFullname" -}}
{{- printf "%s-%s" (include "tyrum-core.fullname" .root) .name | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* Render a value that may contain nested templates. */}}
{{- define "tyrum-core.renderValue" -}}
{{- $root := index . 0 -}}
{{- $value := index . 1 -}}
{{- $string := "" -}}
{{- if kindIs "string" $value -}}
  {{- $string = $value -}}
{{- else -}}
  {{- $string = printf "%v" $value -}}
{{- end -}}
{{- $rendered := tpl $string $root -}}
{{- if kindIs "string" $rendered -}}
  {{- if contains $rendered "{{" -}}
    {{- range $i, $_ := until 5 -}}
      {{- if contains $rendered "{{" -}}
        {{- $rendered = tpl $rendered $root -}}
      {{- end -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- $rendered -}}
{{- end }}

{{/* Config map name for a service entry. */}}
{{- define "tyrum-core.serviceConfigName" -}}
{{- printf "%s-config" (include "tyrum-core.serviceFullname" .) -}}
{{- end }}

{{/* Secret name for a service entry. */}}
{{- define "tyrum-core.serviceSecretName" -}}
{{- printf "%s-secrets" (include "tyrum-core.serviceFullname" .) -}}
{{- end }}

{{/* File config map name for a service entry. */}}
{{- define "tyrum-core.serviceFilesName" -}}
{{- printf "%s-files" (include "tyrum-core.serviceFullname" .) -}}
{{- end }}

{{/* Qualified job name. */}}
{{- define "tyrum-core.jobFullname" -}}
{{- include "tyrum-core.serviceFullname" . -}}
{{- end }}

{{/* Labels used to select pods belonging to a service entry. */}}
{{- define "tyrum-core.serviceSelectorLabels" -}}
app.kubernetes.io/name: {{ include "tyrum-core.serviceFullname" . }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .name }}
tyrum.dev/service: {{ .name }}
{{- end }}

{{/* Fully qualified DNS name for a service entry. */}}
{{- define "tyrum-core.serviceHostname" -}}
{{- $fullname := include "tyrum-core.serviceFullname" . -}}
{{- $namespace := default .root.Release.Namespace .namespace -}}
{{- if $namespace -}}
{{- printf "%s.%s.svc.cluster.local" $fullname $namespace -}}
{{- else -}}
{{- printf "%s" $fullname -}}
{{- end -}}
{{- end }}

{{/* Render a deployment manifest for a service entry. */}}
{{- define "tyrum-core.deployment" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if (default true $service.enabled) -}}
{{- $kind := default "Deployment" $service.kind | lower -}}
{{- if ne $kind "deployment" }}
{{- fail (printf "service %s uses unsupported kind %s" $name $service.kind) -}}
{{- end }}
{{- $svcFullname := include "tyrum-core.serviceFullname" (dict "root" $root "name" $name) -}}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $svcFullname }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
spec:
  replicas: {{ default 1 $service.replicaCount }}
  selector:
    matchLabels:
      {{- include "tyrum-core.serviceSelectorLabels" (dict "root" $root "name" $name) | nindent 6 }}
  {{- with $service.strategy }}
  strategy:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  template:
    metadata:
      labels:
        {{- include "tyrum-core.serviceSelectorLabels" (dict "root" $root "name" $name) | nindent 8 }}
        {{- with $root.Values.podLabels }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
        {{- with $service.podLabels }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      {{- $annotations := merge (default (dict) $root.Values.podAnnotations) (default (dict) $service.podAnnotations) }}
      {{- if $annotations }}
      annotations:
        {{- toYaml $annotations | nindent 8 }}
      {{- end }}
    spec:
      {{ $tag := $root.Chart.AppVersion -}}
      {{ if $service.image.tag -}}
        {{- $tag = include "tyrum-core.renderValue" (list $root $service.image.tag) -}}
      {{- end -}}
      {{ if not $tag -}}
        {{- $tag = $root.Chart.AppVersion -}}
      {{- end -}}
      serviceAccountName: {{ include "tyrum-core.serviceAccountName" $root }}
      {{ if $root.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml $root.Values.imagePullSecrets | nindent 8 }}
      {{ end }}
      containers:
        - name: {{ $name }}
          image: {{ printf "%s:%s" $service.image.repository $tag }}
          imagePullPolicy: {{ default "IfNotPresent" $service.image.pullPolicy }}
          {{- with $service.command }}
          command:
            {{- $cmdYaml := tpl (toYaml .) (dict "root" $root "name" $name "service" $service) -}}
            {{- if contains $cmdYaml "{{" -}}
              {{- $cmdYaml = tpl $cmdYaml (dict "root" $root "name" $name "service" $service) -}}
            {{- end -}}
{{ $cmdYaml | nindent 12 }}
          {{- end }}
          {{- with $service.args }}
          args:
            {{- $argsYaml := tpl (toYaml .) (dict "root" $root "name" $name "service" $service) -}}
            {{- if contains $argsYaml "{{" -}}
              {{- $argsYaml = tpl $argsYaml (dict "root" $root "name" $name "service" $service) -}}
            {{- end -}}
{{ $argsYaml | nindent 12 }}
          {{- end }}
          {{- if $service.ports }}
          ports:
            {{ $portsYaml := toYaml $service.ports -}}
            {{- if contains $portsYaml "{{" -}}
              {{- $portsYaml = tpl $portsYaml (dict "root" $root "name" $name "service" $service) -}}
            {{- end -}}
{{ $portsYaml | nindent 12 }}
          {{- else if and $service.service $service.service.port }}
          ports:
            - name: {{ default "http" $service.service.portName }}
              containerPort: {{ $service.service.port }}
              protocol: TCP
          {{- end }}
          {{- if or $service.config $service.secrets $service.envFrom }}
          envFrom:
            {{- if $service.config }}
            - configMapRef:
                name: {{ include "tyrum-core.serviceConfigName" (dict "root" $root "name" $name) }}
            {{- end }}
            {{- if $service.secrets }}
            - secretRef:
                name: {{ include "tyrum-core.serviceSecretName" (dict "root" $root "name" $name) }}
            {{- end }}
            {{- if $service.envFrom }}
              {{- $envFromYaml := tpl (toYaml $service.envFrom) (dict "root" $root "name" $name "service" $service) -}}
              {{- if contains $envFromYaml "{{" -}}
                {{- $envFromYaml = tpl $envFromYaml (dict "root" $root "name" $name "service" $service) -}}
              {{- end -}}
{{ $envFromYaml | nindent 12 }}
            {{- end }}
          {{- end }}
          {{- with $service.env }}
          env:
            {{- $envYaml := tpl (toYaml .) (dict "root" $root "name" $name "service" $service) -}}
            {{- if contains $envYaml "{{" -}}
              {{- $envYaml = tpl $envYaml (dict "root" $root "name" $name "service" $service) -}}
            {{- end -}}
{{ $envYaml | nindent 12 }}
          {{- end }}
          {{- with $service.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- if $service.probes.liveness }}
          livenessProbe:
            {{- toYaml $service.probes.liveness | nindent 12 }}
          {{- end }}
          {{- if $service.probes.readiness }}
          readinessProbe:
            {{- toYaml $service.probes.readiness | nindent 12 }}
          {{- end }}
          {{- if $service.probes.startup }}
          startupProbe:
            {{- toYaml $service.probes.startup | nindent 12 }}
          {{- end }}
          {{ if $service.volumeMounts }}
          volumeMounts:
            {{- $vmYaml := tpl (toYaml $service.volumeMounts) (dict "root" $root "name" $name "service" $service) -}}
            {{- if contains $vmYaml "{{" -}}
              {{- $vmYaml = tpl $vmYaml (dict "root" $root "name" $name "service" $service) -}}
            {{- end -}}
{{ $vmYaml | nindent 12 }}
          {{- end }}
      {{- if $service.volumes }}
      volumes:
        {{- $volYaml := tpl (toYaml $service.volumes) (dict "root" $root "name" $name "service" $service) -}}
        {{- if contains $volYaml "{{" -}}
          {{- $volYaml = tpl $volYaml (dict "root" $root "name" $name "service" $service) -}}
        {{- end -}}
{{ $volYaml | nindent 8 }}
      {{- end }}
      {{- with $service.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $service.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $service.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
{{- end }}

{{/* Render a service manifest for a service entry. */}}
{{- define "tyrum-core.service" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if and (default true $service.enabled) $service.service (default true $service.service.enabled) -}}
{{- $svcFullname := include "tyrum-core.serviceFullname" (dict "root" $root "name" $name) -}}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $svcFullname }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
  {{- with $service.service.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  type: {{ default "ClusterIP" $service.service.type }}
  selector:
    {{- include "tyrum-core.serviceSelectorLabels" (dict "root" $root "name" $name) | nindent 4 }}
  {{- if $service.service.ports }}
  ports:
    {{ $svcPorts := toYaml $service.service.ports -}}
    {{- if contains $svcPorts "{{" -}}
      {{- $svcPorts = tpl $svcPorts (dict "root" $root "name" $name "service" $service) -}}
    {{- end -}}
{{ $svcPorts | nindent 4 }}
  {{- else if $service.service.port }}
  ports:
    - name: {{ default "http" $service.service.portName }}
      port: {{ $service.service.port }}
      targetPort: {{ default $service.service.port $service.service.targetPort }}
      protocol: {{ default "TCP" $service.service.protocol }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Render a config map manifest. */}}
{{- define "tyrum-core.configMap" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if and (default true $service.enabled) $service.config -}}
{{- $svcFullname := include "tyrum-core.serviceFullname" (dict "root" $root "name" $name) -}}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "tyrum-core.serviceConfigName" (dict "root" $root "name" $name) }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
  annotations:
    tyrum.dev/config-purpose: runtime-env
    tyrum.dev/managed-for: {{ $name }}
data:
  {{- range $key, $value := $service.config }}
  {{ if eq $key "OTEL_EXPORTER_OTLP_ENDPOINT" }}
  {{- $raw := trim (printf "%v" $value) -}}
  {{- $default := printf "http://%s:4317" (include "tyrum-core.serviceHostname" (dict "root" $root "name" "otel-collector")) }}
  {{- $globalRaw := trim (printf "%v" $root.Values.global.otel.endpoint) -}}
  {{- $globalOverride := "" -}}
  {{- if ne $globalRaw "" -}}
    {{- $globalEvaluated := trim (include "tyrum-core.renderValue" (list $root $root.Values.global.otel.endpoint)) -}}
    {{- if and $globalEvaluated (not (contains $globalEvaluated "{{")) -}}
      {{- $globalOverride = $globalEvaluated -}}
    {{- end -}}
  {{- end -}}
  {{- $serviceOverride := "" -}}
  {{- if and (ne $raw "") (ne $raw "{{ .Values.global.otel.endpoint }}") -}}
    {{- $serviceEvaluated := trim (include "tyrum-core.renderValue" (list $root $value)) -}}
    {{- if and $serviceEvaluated (not (contains $serviceEvaluated "{{")) -}}
      {{- $serviceOverride = $serviceEvaluated -}}
    {{- end -}}
  {{- end -}}
  {{- $candidate := default $globalOverride $serviceOverride -}}
  {{- if eq $candidate "" -}}
    {{- $candidate = $default -}}
  {{- end -}}
  {{ $key }}: {{ $candidate | quote }}
  {{ else if eq $key "LLM_VLLM_URL" }}
  {{- $raw := trim (printf "%v" $value) -}}
  {{- $default := printf "http://%s:8085/v1/completions" (include "tyrum-core.serviceHostname" (dict "root" $root "name" "mock-llm")) }}
  {{- $globalRaw := trim (printf "%v" $root.Values.global.llm.backendUrl) -}}
  {{- $globalOverride := "" -}}
  {{- if ne $globalRaw "" -}}
    {{- $globalEvaluated := trim (include "tyrum-core.renderValue" (list $root $root.Values.global.llm.backendUrl)) -}}
    {{- if and $globalEvaluated (not (contains $globalEvaluated "{{")) -}}
      {{- $globalOverride = $globalEvaluated -}}
    {{- end -}}
  {{- end -}}
  {{- $serviceOverride := "" -}}
  {{- if and (ne $raw "") (ne $raw "{{ .Values.global.llm.backendUrl }}") -}}
    {{- $serviceEvaluated := trim (include "tyrum-core.renderValue" (list $root $value)) -}}
    {{- if and $serviceEvaluated (not (contains $serviceEvaluated "{{")) -}}
      {{- $serviceOverride = $serviceEvaluated -}}
    {{- end -}}
  {{- end -}}
  {{- $candidate := default $globalOverride $serviceOverride -}}
  {{- if eq $candidate "" -}}
    {{- $candidate = $default -}}
  {{- end -}}
  {{ $key }}: {{ $candidate | quote }}
  {{ else }}
  {{- $rendered := include "tyrum-core.renderValue" (list $root $value) }}
  {{- if contains "\n" $rendered }}
  {{ $key }}: |-
{{ $rendered | nindent 4 }}
  {{- else }}
  {{ $key }}: {{ $rendered | quote }}
  {{ end }}
  {{- end }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Render a secret manifest. */}}
{{- define "tyrum-core.secret" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if and (default true $service.enabled) $service.secrets -}}
{{- $svcFullname := include "tyrum-core.serviceFullname" (dict "root" $root "name" $name) -}}
---
apiVersion: v1
kind: Secret
metadata:
  name: {{ include "tyrum-core.serviceSecretName" (dict "root" $root "name" $name) }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
type: Opaque
stringData:
  {{- range $key, $value := $service.secrets }}
  {{- $rendered := include "tyrum-core.renderValue" (list $root $value) }}
  {{ $key }}: {{ $rendered | quote }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Render a config map containing mounted file data. */}}
{{- define "tyrum-core.fileConfigMap" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if and (default true $service.enabled) $service.files -}}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "tyrum-core.serviceFilesName" (dict "root" $root "name" $name) }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
  annotations:
    tyrum.dev/config-purpose: file-mounts
    tyrum.dev/managed-for: {{ $name }}
data:
  {{- range $key, $value := $service.files }}
  {{- $rendered := include "tyrum-core.renderValue" (list $root $value) }}
  {{ $key }}: |-
{{ $rendered | nindent 4 }}
  {{- end }}
{{- end }}
{{- end }}

{{/* Render a batch job manifest. */}}
{{- define "tyrum-core.job" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $job := .job -}}
{{- if (default true $job.enabled) -}}
{{- $jobFullname := include "tyrum-core.jobFullname" (dict "root" $root "name" $name) -}}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ $jobFullname }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/job: {{ $name }}
  {{- with $job.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- if $job.backoffLimit }}
  backoffLimit: {{ $job.backoffLimit }}
  {{- end }}
  template:
    metadata:
      labels:
        {{- include "tyrum-core.serviceSelectorLabels" (dict "root" $root "name" $name) | nindent 8 }}
        {{- with $job.podLabels }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
      {{- $annotations := merge (default (dict) $root.Values.podAnnotations) (default (dict) $job.podAnnotations) }}
      {{- if $annotations }}
      annotations:
        {{- toYaml $annotations | nindent 8 }}
      {{- end }}
    spec:
      restartPolicy: {{ default "OnFailure" $job.restartPolicy }}
      {{ $tag := $root.Chart.AppVersion -}}
      {{ if $job.image.tag -}}
        {{- $tag = include "tyrum-core.renderValue" (list $root $job.image.tag) -}}
      {{- end -}}
      {{ if not $tag -}}
        {{- $tag = $root.Chart.AppVersion -}}
      {{- end -}}
      serviceAccountName: {{ include "tyrum-core.serviceAccountName" $root }}
      {{ if $root.Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml $root.Values.imagePullSecrets | nindent 8 }}
      {{ end }}
      containers:
        - name: {{ $name }}
          image: {{ printf "%s:%s" $job.image.repository $tag }}
          imagePullPolicy: {{ default "IfNotPresent" $job.image.pullPolicy }}
          {{- with $job.command }}
          command:
            {{- $cmdYaml := tpl (toYaml .) (dict "root" $root "name" $name "service" $job) -}}
            {{- if contains $cmdYaml "{{" -}}
              {{- $cmdYaml = tpl $cmdYaml (dict "root" $root "name" $name "service" $job) -}}
            {{- end -}}
{{ $cmdYaml | nindent 12 }}
          {{- end }}
          {{- with $job.args }}
          args:
            {{- $argsYaml := tpl (toYaml .) (dict "root" $root "name" $name "service" $job) -}}
            {{- if contains $argsYaml "{{" -}}
              {{- $argsYaml = tpl $argsYaml (dict "root" $root "name" $name "service" $job) -}}
            {{- end -}}
{{ $argsYaml | nindent 12 }}
          {{- end }}
      {{- if or $job.config $job.secrets $job.envFrom }}
          envFrom:
            {{- if $job.config }}
            - configMapRef:
                name: {{ include "tyrum-core.serviceConfigName" (dict "root" $root "name" $name) }}
            {{- end }}
            {{- if $job.secrets }}
            - secretRef:
                name: {{ include "tyrum-core.serviceSecretName" (dict "root" $root "name" $name) }}
            {{- end }}
            {{- if $job.envFrom }}
              {{- $jobEnvFrom := tpl (toYaml $job.envFrom) (dict "root" $root "name" $name "service" $job) -}}
              {{- if contains $jobEnvFrom "{{" -}}
                {{- $jobEnvFrom = tpl $jobEnvFrom (dict "root" $root "name" $name "service" $job) -}}
              {{- end -}}
{{ $jobEnvFrom | nindent 12 }}
            {{- end }}
          {{- end }}
          {{ if $job.env }}
          env:
            {{- $jobEnv := tpl (toYaml $job.env) (dict "root" $root "name" $name "service" $job) -}}
            {{- if contains $jobEnv "{{" -}}
              {{- $jobEnv = tpl $jobEnv (dict "root" $root "name" $name "service" $job) -}}
            {{- end -}}
{{ $jobEnv | nindent 12 }}
          {{- end }}
          {{ with $job.resources }}
          resources:
            {{- toYaml . | nindent 12 }}
          {{ end }}
          {{ with $job.volumeMounts }}
          volumeMounts:
            {{- $jobVm := tpl (toYaml .) (dict "root" $root "name" $name "service" $job) -}}
            {{- if contains $jobVm "{{" -}}
              {{- $jobVm = tpl $jobVm (dict "root" $root "name" $name "service" $job) -}}
            {{- end -}}
{{ $jobVm | nindent 12 }}
          {{ end }}
      {{- if $job.volumes }}
      volumes:
        {{- $jobVolumes := tpl (toYaml $job.volumes) (dict "root" $root "name" $name "service" $job) -}}
        {{- if contains $jobVolumes "{{" -}}
          {{- $jobVolumes = tpl $jobVolumes (dict "root" $root "name" $name "service" $job) -}}
        {{- end -}}
{{ $jobVolumes | nindent 8 }}
      {{- end }}
      {{- with $job.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $job.affinity }}
      affinity:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $job.tolerations }}
      tolerations:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      {{- with $job.securityContext }}
      securityContext:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
{{- end }}

{{/* Render an HPA manifest. */}}
{{- define "tyrum-core.hpa" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if and (default true $service.enabled) $service.hpa (default false $service.hpa.enabled) -}}
{{- $svcFullname := include "tyrum-core.serviceFullname" (dict "root" $root "name" $name) -}}
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ $svcFullname }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ $svcFullname }}
  minReplicas: {{ default 1 $service.hpa.minReplicas }}
  maxReplicas: {{ default 3 $service.hpa.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ default 70 $service.hpa.targetCPUUtilizationPercentage }}
    {{- if $service.hpa.targetMemoryUtilizationPercentage }}
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: {{ $service.hpa.targetMemoryUtilizationPercentage }}
    {{- end }}
{{- end }}
{{- end }}

{{/* Render a helm test pod. */}}
{{- define "tyrum-core.testPod" -}}
{{- $root := .root -}}
{{- $name := .name -}}
{{- $service := .service -}}
{{- if and (default true $service.enabled) $service.test -}}
{{- $svcFullname := include "tyrum-core.serviceFullname" (dict "root" $root "name" $name) -}}
{{- $test := $service.test -}}
{{- $image := default $root.Values.helmTest.image $test.image -}}
{{- $timeout := default $root.Values.helmTest.timeoutSeconds $test.timeoutSeconds -}}
---
apiVersion: v1
kind: Pod
metadata:
  name: {{ printf "%s-test" $svcFullname | trunc 63 | trimSuffix "-" }}
  labels:
    {{- include "tyrum-core.labels" $root | nindent 4 }}
    app.kubernetes.io/component: {{ $name }}
    tyrum.dev/service: {{ $name }}
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": hook-succeeded,hook-failed
spec:
  restartPolicy: Never
  containers:
    - name: {{ printf "%s-check" $name }}
      image: {{ $image }}
      imagePullPolicy: IfNotPresent
      {{ if $test.command }}
      command:
        {{- $cmds := dict "items" (list) }}
        {{- range $cmd := $test.command }}
        {{- $_ := set $cmds "items" (append (get $cmds "items") (tpl $cmd $root)) }}
        {{- end }}
        {{- toYaml (get $cmds "items") | nindent 8 }}
      {{ else }}
      {{- $defaultScheme := default "http" $test.scheme -}}
      {{- $defaultPort := 80 -}}
      {{- if and $service.service $service.service.port -}}
        {{- $defaultPort = $service.service.port -}}
      {{- else if and $service.service $service.service.ports -}}
        {{- $firstPort := index $service.service.ports 0 -}}
        {{- if $firstPort.port -}}
          {{- $defaultPort = $firstPort.port -}}
        {{- end -}}
      {{- end -}}
      {{- $targetPort := default $defaultPort $test.port -}}
      {{- $targetPath := default "/" $test.path -}}
      command:
        - /bin/sh
        - -c
        - >-
          curl -fsS --max-time {{ $timeout }} {{ $defaultScheme }}://{{ $svcFullname }}:{{ $targetPort }}{{ $targetPath }}
      {{ end }}
      {{- with $test.args }}
      args:
        {{- $args := dict "items" (list) }}
        {{- range $arg := . }}
        {{- $_ := set $args "items" (append (get $args "items") (tpl $arg $root)) }}
        {{- end }}
        {{- toYaml (get $args "items") | nindent 8 }}
      {{- end }}
      {{- with $test.env }}
      env:
        {{- toYaml . | nindent 8 }}
      {{- end }}
{{- end }}
{{- end }}
