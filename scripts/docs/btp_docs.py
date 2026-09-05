"""Closed BTP index schema and deterministic, local-only MkDocs build hook.

Only public, explicitly listed docs are indexed. No cloud calls, customer configuration,
credential reads or model invocations. Review metadata is never refreshed by a build.
"""

import datetime
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import markdown
import yaml
from mkdocs.exceptions import PluginError

ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-f]{40}")
STATUSES = {"supported", "mixed", "experimental", "proposed", "historical", "unknown"}
KINDS = {"guide", "reference", "proposal", "historical"}
OPERATIONAL = {"supported", "mixed", "experimental"}
STATUS_TEXT = {
    "supported": "Supported feature guidance",
    "mixed": "Mixed scope: single-target guidance and experimental multi-target sections",
    "experimental": "Experimental multi-target: mutation-free, default off",
    "proposed": "Proposal: not an operational setup requirement",
    "historical": "Historical: not current setup guidance",
    "unknown": "Feature applicability unverified",
}
INDEX_MARKER = "<!-- BTP_TASK_INDEX -->"
_state = None


class UniqueLoader(yaml.SafeLoader):
    """Reject duplicate YAML fields instead of silently accepting the last value."""


def _mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if not isinstance(key, str) or key in result:
            raise ValueError("Manifest keys must be unique strings")
        result[key] = loader.construct_object(value_node)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


def _keys(value, expected, label):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError(f"{label}: expected exactly {', '.join(sorted(expected))}")


def _text(value, label):
    if not isinstance(value, str) or not value.strip() or re.search(r"[\n\r<>|\[\]`]", value):
        raise ValueError(f"{label}: expected nonempty plain text")


def _file(root, value, canonical=False):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        raise ValueError("Invalid repository file path")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(p in {".", ".."} for p in value.split("/")):
        raise ValueError("File paths must stay inside the repository")
    if canonical and not re.fullmatch(r"docs_page/[a-z0-9][a-z0-9/-]*\.md", value):
        raise ValueError("Canonical entry must be a public docs_page Markdown file")
    if not canonical and not (
        value in {"mta.yaml", "package.json", "xs-security.json"}
        or value.startswith(("src/", "tests/", "docs/adr/", "docs/plans/"))
    ):
        raise ValueError("Evidence must be a public source, test, ADR or plan path")
    path = root / value
    if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Missing or escaping repository file: {value}")
    # Do not accidentally publish a symlinked private file, even inside the checkout.
    if any(part.is_symlink() for part in [path, *path.parents] if part != root.parent):
        raise ValueError(f"Symlinked source is not indexable: {value}")
    return path


class _Ids(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        self.ids.update(value for key, value in attrs if key == "id")


def validate_manifest(root, data):
    """Schema v1 is deliberately closed; source evidence is not live-test evidence."""
    _keys(data, {"schema_version", "entries"}, "manifest")
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise ValueError("Unsupported manifest schema version")
    if not isinstance(data["entries"], list) or not data["entries"]:
        raise ValueError("Expected a nonempty entries list")
    ids, files = set(), set()
    for entry in data["entries"]:
        _keys(entry, {"id", "file", "anchor", "task", "scenarios", "owner", "kind",
                      "feature_status", "source_review"}, "entry")
        for field in ("id", "task", "owner", "kind", "feature_status"):
            _text(entry[field], field)
        if not re.fullmatch(r"[a-z][a-z0-9-]*", entry["id"]) or entry["id"] in ids:
            raise ValueError("Invalid or duplicate entry ID")
        ids.add(entry["id"])
        path = _file(root, entry["file"], canonical=True)
        if entry["file"] in files:
            raise ValueError("Duplicate canonical file")
        files.add(entry["file"])
        if entry["kind"] not in KINDS or entry["feature_status"] not in STATUSES:
            raise ValueError("Unknown kind or feature status")
        if entry["kind"] in {"proposal", "historical"} and entry["feature_status"] in OPERATIONAL:
            raise ValueError("Proposal/history cannot claim operational status")
        scenarios = entry["scenarios"]
        if (not isinstance(scenarios, list) or not scenarios
                or any(s not in ("single-pp", "multi-pp") for s in scenarios)
                or len(set(scenarios)) != len(scenarios)):
            raise ValueError("Expected unique supported scenarios")
        anchor = entry["anchor"]
        if not isinstance(anchor, str) or (anchor and not re.fullmatch(r"[a-z0-9_-]+", anchor)):
            raise ValueError("Invalid anchor")
        if anchor:
            parser = _Ids()
            parser.feed(markdown.markdown(path.read_text(), extensions=["toc", "fenced_code"]))
            if anchor not in parser.ids:
                raise ValueError(f"Dead anchor: {entry['file']}#{anchor}")
        review = entry["source_review"]
        _keys(review, {"commit", "date", "evidence"}, "source_review")
        if not isinstance(review["commit"], str) or not SHA.fullmatch(review["commit"]):
            raise ValueError("Source review needs a full commit SHA")
        if not isinstance(review["date"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", review["date"]):
            raise ValueError("Review date must be a quoted ISO date")
        datetime.date.fromisoformat(review["date"])
        if not isinstance(review["evidence"], list) or not review["evidence"]:
            raise ValueError("Source review needs evidence paths")
        for evidence in review["evidence"]:
            _file(root, evidence)
    return data["entries"]


def _git(root, *args):
    try:
        result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True,
                                timeout=10, check=False)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def provenance(root):
    version = json.loads((root / "package.json").read_text())["version"]
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Invalid package version for provenance")
    commit = _git(root, "rev-parse", "HEAD")
    # A copied source folder inside some other repository must not borrow its commit.
    top = _git(root, "rev-parse", "--show-toplevel")
    status = _git(root, "status", "--porcelain", "--untracked-files=normal")
    tags = _git(root, "tag", "--points-at", "HEAD")
    known = bool(commit and SHA.fullmatch(commit) and top and Path(top).resolve() == root.resolve())
    if not known or status is None or tags is None:
        return {"commit": None, "version": version, "state": "unknown"}
    state = "local" if status else ("tag" if f"v{version}" in tags.splitlines() else "development")
    return {"commit": commit, "version": version, "state": state}


def provenance_text(info):
    labels = {
        "tag": "Exact release-tag checkout (publication and tag signature not verified)",
        "development": "Development/source documentation, not a release-tag checkout",
        "local": "Local/uncommitted documentation, not a release artifact",
        "unknown": "Unverified source provenance: Git metadata unavailable",
    }
    commit = info["commit"] or "unknown"
    tag = f"; exact tag `v{info['version']}`" if info["state"] == "tag" else ""
    return f"{labels[info['state']]}. Package `{info['version']}`; commit `{commit}`{tag}."


def source_url(root, info, path):
    if info["state"] not in {"tag", "development"}:
        return None
    if _git(root, "cat-file", "-e", f"{info['commit']}:{path}") is None:
        raise ValueError(f"Indexed file is absent from asserted commit: {path}")
    return f"https://raw.githubusercontent.com/arc-mcp/arc-1/{info['commit']}/{quote(path, safe='/')}"


def operational(entries):
    return [e for e in entries if e["kind"] in {"guide", "reference"} and e["feature_status"] in OPERATIONAL]


def llms_text(root, entries, info):
    lines = ["# ARC-1 BTP setup sources", "", "> Compact operational index; canonical Markdown remains authoritative.",
             "", provenance_text(info), "", "Match the deployed artifact to this exact source before following commands.",
             "Source review is not live BTP/SAP verification. Unknown compatibility needs owner review.",
             "Do not supply secrets, raw bindings or full OAuth callback URLs to an assistant.",
             "Multi-target is experimental and mutation-free. Proposals are excluded from this index.",
             "", "## Setup and administration", ""]
    for entry in operational(entries):
        url = source_url(root, info, entry["file"])
        link = f"[{entry['task']}]({url})" if url else f"{entry['task']} — `{entry['file']}` (local source)"
        review = entry["source_review"]
        section = f"; section #{entry['anchor']}" if entry["anchor"] else ""
        lines.append(f"- {link}: {entry['feature_status']}; {', '.join(entry['scenarios'])}; owner: {entry['owner']}{section}. "
                     f"Source-reviewed {review['date']} at {review['commit']}; not a live-test result.")
    return "\n".join(lines) + "\n"


def navigation(entries):
    rows = ["| Task | Scope / status | Owner |", "|---|---|---|"]
    for entry in operational(entries):
        relative = entry["file"].removeprefix("docs_page/")
        suffix = f"#{entry['anchor']}" if entry["anchor"] else ""
        rows.append(f"| [{entry['task']}]({relative}{suffix}) | {', '.join(entry['scenarios'])}; "
                    f"{entry['feature_status']} | {entry['owner']} |")
    return "\n".join(rows)


def _banner(root, info, entry=None):
    lines = ['!!! note "Documentation source and applicability"', "", f"    {provenance_text(info)}",
             "    Match the deployed artifact to this source; no compatible release range is inferred."]
    if entry:
        review = entry["source_review"]
        lines += [f"    {STATUS_TEXT[entry['feature_status']]}. Source-reviewed {review['date']} against",
                  f"    `{review['commit']}`. This is not live BTP/SAP acceptance."]
        url = source_url(root, info, entry["file"])
        if url:
            lines += [f"    [Read the matching Markdown source]({url})."]
    return "\n".join(lines) + "\n\n"


def on_config(config):
    global _state
    try:
        data = yaml.load((ROOT / "docs/btp-setup-index.yaml").read_text(), Loader=UniqueLoader)
        entries = validate_manifest(ROOT, data)
        info = provenance(ROOT)
        for entry in operational(entries):
            source_url(ROOT, info, entry["file"])
        _state = (entries, info)
    except (ValueError, OSError, KeyError, yaml.YAMLError) as error:
        raise PluginError(f"BTP documentation index: {error}") from error
    return config


def on_page_markdown(markdown, page, config, files):
    entries, info = _state
    path = f"docs_page/{page.file.src_uri}"
    entry = next((e for e in entries if e["file"] == path), None)
    if page.file.src_uri == "btp-documentation.md":
        if markdown.count(INDEX_MARKER) != 1:
            raise PluginError("BTP documentation page needs exactly one index marker")
        markdown = markdown.replace(INDEX_MARKER, navigation(entries))
    elif not entry:
        return markdown
    heading, separator, body = markdown.partition("\n")
    return heading + separator + "\n" + _banner(ROOT, info, entry) + body


def on_post_build(config):
    entries, info = _state
    (Path(config.site_dir) / "llms.txt").write_text(llms_text(ROOT, entries, info), encoding="utf-8")
