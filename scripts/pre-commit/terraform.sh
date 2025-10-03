#!/bin/sh
# Lint Terraform stacks by running fmt/validate in touched directories.
set -eu

if [ "$#" -eq 0 ]; then
  exit 0
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform not found; install Terraform to run infrastructure checks." >&2
  exit 1
fi

# Gather unique directories that contain Terraform files.
TMP_DIRS=$(mktemp)
trap 'rm -f "$TMP_DIRS"' EXIT

for file in "$@"; do
  dir=$(dirname "${file}")
  [ "${dir}" = "" ] && dir="."
  printf '%s\n' "${dir}" >>"${TMP_DIRS}"
  # Also include the root if the file lives there to ensure fmt recurses from repo root.
  if [ "${dir}" = "." ]; then
    printf '%s\n' "." >>"${TMP_DIRS}"
  fi
  # If a module lives under modules/<name>, ensure the module directory is captured.
  base=$(dirname "${dir}")
  if [ "${base}" != "${dir}" ] && [ -d "${base}" ]; then
    printf '%s\n' "${base}" >>"${TMP_DIRS}"
  fi
done

# Run fmt/validate for each directory, skipping duplicates.
sort -u "${TMP_DIRS}" | while IFS= read -r dir; do
  [ -d "${dir}" ] || continue
  terraform fmt -check -recursive "${dir}"
  if [ -d "${dir}/.terraform" ] || [ -f "${dir}/.terraform.lock.hcl" ]; then
    terraform -chdir="${dir}" validate -no-color
  else
    echo "[terraform] Skipping validate in ${dir} (run 'terraform init' to enable)." >&2
  fi
done
