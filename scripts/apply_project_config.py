#!/usr/bin/env python3
"""
Apply or dry-run the Tyrum GitHub Projects configuration defined in
`.github/projects/m0-foundations.yml`.

Requires:
  - `gh` CLI authenticated with `project` scope.
  - `pyyaml` for configuration parsing (`pip install pyyaml`).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml  # type: ignore
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit(
        "pyyaml is required to parse the project configuration. "
        "Install it with `pip install pyyaml`."
    ) from exc


CONFIG_DEFAULT = Path(".github/projects/m0-foundations.yml")


@dataclass
class ProjectRef:
    project_id: str
    number: int
    title: str


class GHClient:
    def __init__(self, dry_run: bool):
        self.dry_run = dry_run

    def graphql(self, query: str, variables: Optional[Dict[str, Any]] = None, *, mutate: bool = False) -> Dict[str, Any]:
        """Execute a GraphQL operation with the gh CLI."""
        if mutate and self.dry_run:
            return {}

        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        result = subprocess.run(
            ["gh", "api", "graphql", "--input", "-"],
            input=json.dumps(payload).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            raise RuntimeError(f"gh api graphql failed: {stderr.strip()}")

        response = json.loads(result.stdout)
        if "errors" in response:
            raise RuntimeError(json.dumps(response["errors"], indent=2))
        return response["data"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply the Tyrum project board configuration.")
    parser.add_argument(
        "--config",
        type=Path,
        default=CONFIG_DEFAULT,
        help="Path to the project configuration YAML (default: %(default)s)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute write operations. Without this flag the script runs in dry-run mode.",
    )
    parser.add_argument(
        "--owner",
        help="Override owner login from the configuration (useful for forks).",
    )
    return parser.parse_args()


def load_config(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Configuration file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def resolve_owner_id(client: GHClient, owner_cfg: Dict[str, Any]) -> Tuple[str, str, str]:
    owner_type = owner_cfg.get("type")
    login = owner_cfg.get("login")
    if owner_type not in {"organization", "user"}:
        raise ValueError("owner.type must be 'organization' or 'user'")
    if not login:
        raise ValueError("owner.login is required")

    if owner_type == "organization":
        data = client.graphql(
            """
            query ($login: String!) {
              organization(login: $login) {
                id
              }
            }
            """,
            {"login": login},
        )
        org = data.get("organization")
        if not org:
            raise RuntimeError(f"Organization '{login}' not found or inaccessible")
        return org["id"], login, "organization"

    data = client.graphql(
        """
        query ($login: String!) {
          user(login: $login) {
            id
          }
        }
        """,
        {"login": login},
    )
    user = data.get("user")
    if not user:
        raise RuntimeError(f"User '{login}' not found or inaccessible")
    return user["id"], login, "user"


def find_project(
    client: GHClient,
    owner_login: str,
    owner_type: str,
    project_title: str,
) -> Optional[ProjectRef]:
    if owner_type == "organization":
        data = client.graphql(
            """
            query ($login: String!, $title: String!) {
              organization(login: $login) {
                projects: projectsV2(first: 20, query: $title) {
                  nodes {
                    id
                    number
                    title
                  }
                }
              }
            }
            """,
            {"login": owner_login, "title": project_title},
        )
        container = data.get("organization")
    else:
        data = client.graphql(
            """
            query ($login: String!, $title: String!) {
              user(login: $login) {
                projects: projectsV2(first: 20, query: $title) {
                  nodes {
                    id
                    number
                    title
                  }
                }
              }
            }
            """,
            {"login": owner_login, "title": project_title},
        )
        container = data.get("user")

    if not container:
        raise RuntimeError(f"Owner '{owner_login}' not accessible")

    for node in container["projects"]["nodes"]:
        if node["title"].strip().lower() == project_title.strip().lower():
            return ProjectRef(project_id=node["id"], number=node["number"], title=node["title"])
    return None


def create_project(client: GHClient, owner_id: str, title: str) -> ProjectRef:
    data = client.graphql(
        """
        mutation ($ownerId: ID!, $title: String!) {
          createProjectV2(input: {ownerId: $ownerId, title: $title}) {
            projectV2 {
              id
              number
              title
            }
          }
        }
        """,
        {"ownerId": owner_id, "title": title},
        mutate=True,
    )
    project = data["createProjectV2"]["projectV2"]
    return ProjectRef(project_id=project["id"], number=project["number"], title=project["title"])


def fetch_project_state(client: GHClient, project_id: str) -> Dict[str, Any]:
    data = client.graphql(
        """
        query ($projectId: ID!) {
          node(id: $projectId) {
            ... on ProjectV2 {
              title
              shortDescription
              readme
              fields(first: 50) {
                nodes {
                  ... on ProjectV2FieldCommon {
                    id
                    name
                  }
                  ... on ProjectV2SingleSelectField {
                    id
                    name
                    options {
                      id
                      name
                      color
                      description
                    }
                  }
                }
              }
              items(first: 200) {
                nodes {
                  id
                  content {
                    __typename
                    ... on Issue {
                      id
                      number
                      title
                    }
                    ... on DraftIssue {
                      id
                      title
                      body
                    }
                  }
                  fieldValueByName(name: "Status") {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      optionId
                      name
                    }
                  }
                }
              }
            }
          }
        }
        """,
        {"projectId": project_id},
    )
    node = data["node"]
    if node is None:
        raise RuntimeError("Project not found after creation")
    return node


def update_project_metadata(
    client: GHClient,
    project_id: str,
    *,
    title: str,
    short_description: Optional[str],
    readme: Optional[str],
    current: Dict[str, Any],
    logs: List[str],
) -> None:
    updates: Dict[str, Any] = {"projectId": project_id}
    if current.get("title") != title:
        updates["title"] = title
    if (current.get("shortDescription") or "") != (short_description or ""):
        updates["shortDescription"] = short_description or ""
    if (current.get("readme") or "") != (readme or ""):
        updates["readme"] = readme or ""

    if len(updates) > 1:
        logs.append("Updating project metadata")
        client.graphql(
            """
            mutation ($input: UpdateProjectV2Input!) {
              updateProjectV2(input: $input) {
                projectV2 {
                  id
                }
              }
            }
            """,
            {"input": updates},
            mutate=True,
        )


def ensure_status_options(
    client: GHClient,
    project_id: str,
    status_cfg: Dict[str, Any],
    fields: List[Dict[str, Any]],
    logs: List[str],
) -> Tuple[Dict[str, str], str]:
    status_field_name = status_cfg.get("name", "Status")
    status_field = next(
        (field for field in fields if field.get("name") == status_field_name and "options" in field),
        None,
    )
    if not status_field:
        if client.dry_run:
            logs.append(f"Status field '{status_field_name}' missing; would create it with configured options.")
            placeholder_id = f"pending-field:{status_field_name}"
            return {opt["name"]: opt["name"] for opt in status_cfg["options"]}, placeholder_id

        logs.append(f"Status field '{status_field_name}' not found; creating new single select field")
        data = client.graphql(
            """
            mutation ($input: CreateProjectV2FieldInput!) {
              createProjectV2Field(input: $input) {
                projectV2Field {
                  ... on ProjectV2SingleSelectField {
                    id
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
            """,
            {
                "input": {
                    "projectId": project_id,
                    "dataType": "SINGLE_SELECT",
                    "name": status_field_name,
                    "singleSelectOptions": [
                        {
                            "name": opt["name"],
                            "color": opt["color"],
                            "description": opt.get("description", ""),
                        }
                        for opt in status_cfg["options"]
                    ],
                }
            },
            mutate=True,
        )
        field = data["createProjectV2Field"]["projectV2Field"]
        return {opt["name"]: opt["id"] for opt in field["options"]}, field["id"]

    desired_options = status_cfg["options"]
    existing = status_field.get("options") or []

    normalized_existing = [
        {
            "name": opt["name"],
            "color": opt["color"],
            "description": opt.get("description") or "",
        }
        for opt in existing
    ]
    normalized_desired = [
        {
            "name": opt["name"],
            "color": opt["color"],
            "description": opt.get("description") or "",
        }
        for opt in desired_options
    ]

    if normalized_existing != normalized_desired:
        if client.dry_run:
            logs.append("Status field options differ; would update to match configuration.")
            return {opt["name"]: opt["name"] for opt in desired_options}, status_field["id"]

        logs.append("Updating status field options")
        data = client.graphql(
            """
            mutation ($input: UpdateProjectV2FieldInput!) {
              updateProjectV2Field(input: $input) {
                projectV2Field {
                  ... on ProjectV2SingleSelectField {
                    options {
                      id
                      name
                    }
                  }
                }
              }
            }
            """,
            {
                "input": {
                    "projectId": project_id,
                    "fieldId": status_field["id"],
                    "singleSelectOptions": [
                        {
                            "name": opt["name"],
                            "color": opt["color"],
                            "description": opt.get("description", ""),
                        }
                        for opt in desired_options
                    ],
                }
            },
            mutate=True,
        )
        options = data["updateProjectV2Field"]["projectV2Field"]["options"]
    else:
        options = existing
    return {opt["name"]: opt["id"] for opt in options}, status_field["id"]


def add_issue_item(
    client: GHClient,
    repository_owner: str,
    repository_name: str,
    issue_number: int,
    project_id: str,
    status_field_id: str,
    status_option_id: str,
    existing_issue_items: Dict[int, Dict[str, Any]],
    logs: List[str],
) -> None:
    existing = existing_issue_items.get(issue_number)
    if existing:
        if existing.get("status_option_id") != status_option_id:
            logs.append(f"Updating status for issue #{issue_number}")
            client.graphql(
                """
                mutation ($input: UpdateProjectV2ItemFieldValueInput!) {
                  updateProjectV2ItemFieldValue(input: $input) {
                    projectV2Item {
                      id
                    }
                  }
                }
                """,
                {
                    "input": {
                        "projectId": project_id,
                        "itemId": existing["item_id"],
                        "fieldId": status_field_id,
                        "value": {"singleSelectOptionId": status_option_id},
                    }
                },
                mutate=True,
            )
        return

    logs.append(f"Adding issue #{issue_number} to project")
    issue_data = client.graphql(
        """
        query ($owner: String!, $name: String!, $number: Int!) {
          repository(owner: $owner, name: $name) {
            issue(number: $number) {
              id
            }
          }
        }
        """,
        {"owner": repository_owner, "name": repository_name, "number": issue_number},
    )
    issue = issue_data["repository"]["issue"]
    if not issue:
        raise RuntimeError(f"Issue #{issue_number} not found in {repository_owner}/{repository_name}")

    item_data = client.graphql(
        """
        mutation ($input: AddProjectV2ItemByIdInput!) {
          addProjectV2ItemById(input: $input) {
            item {
              id
            }
          }
        }
        """,
        {"input": {"projectId": project_id, "contentId": issue["id"]}},
        mutate=True,
    )
    item_id = item_data["addProjectV2ItemById"]["item"]["id"]
    client.graphql(
        """
        mutation ($input: UpdateProjectV2ItemFieldValueInput!) {
          updateProjectV2ItemFieldValue(input: $input) {
            projectV2Item {
              id
            }
          }
        }
        """,
        {
            "input": {
                "projectId": project_id,
                "itemId": item_id,
                "fieldId": status_field_id,
                "value": {"singleSelectOptionId": status_option_id},
            }
        },
        mutate=True,
    )


def add_draft_item(
    client: GHClient,
    project_id: str,
    status_field_id: str,
    status_option_id: str,
    draft_cfg: Dict[str, Any],
    existing_drafts: Dict[str, Dict[str, Any]],
    logs: List[str],
) -> None:
    key = draft_cfg["key"]
    summary_line = f"Draft '{draft_cfg['title']}'"
    existing = existing_drafts.get(key)
    if existing:
        if existing.get("status_option_id") != status_option_id:
            logs.append(f"Updating status for {summary_line}")
            client.graphql(
                """
                mutation ($input: UpdateProjectV2ItemFieldValueInput!) {
                  updateProjectV2ItemFieldValue(input: $input) {
                    projectV2Item {
                      id
                    }
                  }
                }
                """,
                {
                    "input": {
                        "projectId": project_id,
                        "itemId": existing["item_id"],
                        "fieldId": status_field_id,
                        "value": {"singleSelectOptionId": status_option_id},
                    }
                },
                mutate=True,
            )
        return

    logs.append(f"Creating draft item for {summary_line}")
    body = draft_cfg.get("body", "").rstrip()
    body_with_key = f"{body}\n\n<!-- slug: {key} -->"

    item_data = client.graphql(
        """
        mutation ($input: AddProjectV2DraftIssueInput!) {
          addProjectV2DraftIssue(input: $input) {
            projectItem {
              id
            }
          }
        }
        """,
        {
            "input": {
                "projectId": project_id,
                "title": draft_cfg["title"],
                "body": body_with_key,
            }
        },
        mutate=True,
    )
    item_id = item_data["addProjectV2DraftIssue"]["projectItem"]["id"]
    client.graphql(
        """
        mutation ($input: UpdateProjectV2ItemFieldValueInput!) {
          updateProjectV2ItemFieldValue(input: $input) {
            projectV2Item {
              id
            }
          }
        }
        """,
        {
            "input": {
                "projectId": project_id,
                "itemId": item_id,
                "fieldId": status_field_id,
                "value": {"singleSelectOptionId": status_option_id},
            }
        },
        mutate=True,
    )


def build_existing_maps(project_state: Dict[str, Any]) -> Tuple[Dict[int, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    issue_items: Dict[int, Dict[str, Any]] = {}
    draft_items: Dict[str, Dict[str, Any]] = {}

    for item in project_state["items"]["nodes"]:
        content = item.get("content") or {}
        status_value = item.get("fieldValueByName") or {}
        status_option_id = status_value.get("optionId")
        if content.get("__typename") == "Issue":
            issue_items[content["number"]] = {
                "item_id": item["id"],
                "status_option_id": status_option_id,
            }
        elif content.get("__typename") == "DraftIssue":
            body = content.get("body") or ""
            key = extract_slug_from_body(body)
            if key:
                draft_items[key] = {
                    "item_id": item["id"],
                    "status_option_id": status_option_id,
                }
    return issue_items, draft_items


def extract_slug_from_body(body: str) -> Optional[str]:
    marker = "<!-- slug:"
    if marker not in body:
        return None
    remainder = body.split(marker, 1)[1]
    slug = remainder.split("-->", 1)[0].strip()
    return slug or None


def main() -> None:
    args = parse_args()
    config = load_config(args.config)
    logs: List[str] = []

    owner_cfg = dict(config.get("owner") or {})
    if args.owner:
        owner_cfg["login"] = args.owner

    client = GHClient(dry_run=not args.apply)

    owner_id, owner_login, owner_type = resolve_owner_id(client, owner_cfg)
    project_cfg = config.get("project") or {}
    project_title = project_cfg.get("title")
    if not project_title:
        raise ValueError("project.title is required in the configuration")

    project_ref = find_project(client, owner_login, owner_type, project_title)
    if not project_ref:
        logs.append(f"Project '{project_title}' does not exist and will be created.")
        if not args.apply:
            print("\n".join(f"DRY-RUN: {line}" for line in logs))
            print("Re-run with --apply to create the project.")
            return
        project_ref = create_project(client, owner_id, project_title)
        logs.append(f"Created project #{project_ref.number} ({project_ref.title}).")

    project_state = fetch_project_state(client, project_ref.project_id)
    update_project_metadata(
        client,
        project_ref.project_id,
        title=project_cfg.get("title", project_state["title"]),
        short_description=project_cfg.get("short_description"),
        readme=project_cfg.get("readme"),
        current=project_state,
        logs=logs,
    )

    status_cfg = config.get("status_field") or {}
    if not status_cfg.get("options"):
        raise ValueError("status_field.options must define at least one column")

    status_options, status_field_id = ensure_status_options(
        client,
        project_ref.project_id,
        status_cfg,
        project_state["fields"]["nodes"],
        logs,
    )

    project_state = fetch_project_state(client, project_ref.project_id)
    issue_items, draft_items = build_existing_maps(project_state)

    seeding_cfg = config.get("seeding") or {}
    issue_numbers = seeding_cfg.get("issue_items") or []
    for issue_entry in issue_numbers:
        number = issue_entry.get("number")
        if number is None:
            continue
        status_name = issue_entry.get("status", "Backlog")
        option_id = status_options.get(status_name)
        if option_id is None:
            raise RuntimeError(f"Status option '{status_name}' not defined for issue #{number}")
        add_issue_item(
            client,
            repository_owner=issue_entry.get("owner") or "VirtunetBV",
            repository_name=issue_entry.get("repo") or "tyrum",
            issue_number=number,
            project_id=project_ref.project_id,
            status_field_id=status_field_id,
            status_option_id=option_id,
            existing_issue_items=issue_items,
            logs=logs,
        )

    drafts_cfg = seeding_cfg.get("draft_items") or []
    for draft in drafts_cfg:
        key = draft.get("key")
        if not key:
            raise ValueError("Each draft item must define a unique 'key'")
        status_name = draft.get("status", "Backlog")
        option_id = status_options.get(status_name)
        if option_id is None:
            raise RuntimeError(f"Status option '{status_name}' not defined for draft '{draft['title']}'")
        add_draft_item(
            client,
            project_ref.project_id,
            status_field_id,
            option_id,
            draft,
            draft_items,
            logs,
        )

    if logs:
        prefix = "DRY-RUN: " if not args.apply else ""
        for line in logs:
            print(f"{prefix}{line}")
    else:
        print("No changes were necessary; project already matches configuration.")


if __name__ == "__main__":
    main()
