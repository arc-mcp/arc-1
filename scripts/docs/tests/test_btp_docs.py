"""Credential-free contract tests; temporary Git repos never contact a remote."""

import copy
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml
from mkdocs.exceptions import PluginError

MODULE = Path(__file__).resolve().parents[1] / "btp_docs.py"
spec = importlib.util.spec_from_file_location("btp_docs", MODULE)
docs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(docs)


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / "docs_page").mkdir()
        (self.root / "docs_page/setup.md").write_text("# Setup\n\n## Identity\n\nPublic guide.\n")
        (self.root / "src").mkdir()
        (self.root / "src/config.ts").write_text("// fixture source, not test evidence\n")
        (self.root / "package.json").write_text(json.dumps({"version": "1.2.0"}))
        self.entry = {
            "id": "setup", "file": "docs_page/setup.md", "anchor": "identity",
            "task": "Set up PP", "scenarios": ["single-pp", "multi-pp"], "owner": "Basis owner",
            "kind": "guide", "feature_status": "experimental",
            "source_review": {"commit": "a" * 40, "date": "2026-09-05", "evidence": ["src/config.ts"]},
        }
        self.data = {"schema_version": 1, "entries": [self.entry]}

    def git(self, *args):
        result = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
                                 "-c", "user.name=Docs fixture", "-c", "user.email=fixture@example.invalid",
                                 *args], cwd=self.root, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def init_repo(self):
        self.git("init", "-b", "main")
        self.git("add", ".")
        self.git("commit", "-m", "fixture: public source")
        return self.git("rev-parse", "HEAD")

    def test_valid_closed_schema_and_real_heading_anchor(self):
        self.assertEqual(docs.validate_manifest(self.root, self.data), [self.entry])

    def test_rejects_unknown_fields_status_and_unsupported_evidence_claims(self):
        changes = [{"feature_status": "released-yesterday"}, {"customer_verified": True},
                   {"kind": "proposal", "feature_status": "supported"}, {"scenarios": ["automatic-admin"]}]
        for change in changes:
            with self.subTest(change=change):
                data = copy.deepcopy(self.data)
                data["entries"][0].update(change)
                with self.assertRaises(ValueError):
                    docs.validate_manifest(self.root, data)
        self.entry["source_review"]["live_test_passed"] = True
        with self.assertRaises(ValueError):
            docs.validate_manifest(self.root, self.data)

    def test_rejects_missing_file_dead_anchor_and_path_escape(self):
        for change in [{"file": "docs_page/missing.md"}, {"anchor": "does-not-exist"},
                       {"file": "../private.md"}, {"file": "/tmp/private.md"}]:
            with self.subTest(change=change):
                data = copy.deepcopy(self.data)
                data["entries"][0].update(change)
                with self.assertRaises(ValueError):
                    docs.validate_manifest(self.root, data)

    def test_preserves_explicit_html_anchor_and_ignores_code_headings(self):
        (self.root / "docs_page/setup.md").write_text('# Setup\n<a id="identity"></a>\n```\n## Fake\n```\n')
        docs.validate_manifest(self.root, self.data)
        self.entry["anchor"] = "fake"
        with self.assertRaises(ValueError):
            docs.validate_manifest(self.root, self.data)

    def test_rejects_duplicate_ids_files_yaml_keys_and_invalid_review_dates(self):
        duplicate = copy.deepcopy(self.data)
        duplicate["entries"].append(copy.deepcopy(self.entry))
        with self.assertRaises(ValueError):
            docs.validate_manifest(self.root, duplicate)
        duplicate["entries"][1]["id"] = "different-id"
        with self.assertRaises(ValueError):
            docs.validate_manifest(self.root, duplicate)
        with self.assertRaises(ValueError):
            yaml.load("schema_version: 1\nschema_version: 2\n", Loader=docs.UniqueLoader)
        self.entry["source_review"]["date"] = "2026-02-30"
        with self.assertRaises(ValueError):
            docs.validate_manifest(self.root, self.data)

    def test_rejects_private_or_missing_evidence_and_symlinked_docs(self):
        for evidence in [".arc1/private.json", "src/missing.ts", "src/../package.json"]:
            self.entry["source_review"]["evidence"] = [evidence]
            with self.assertRaises(ValueError):
                docs.validate_manifest(self.root, self.data)
        self.entry["source_review"]["evidence"] = ["src/config.ts"]
        target = self.root / "docs_page/setup.md"
        target.unlink()
        target.symlink_to(self.root / "src/config.ts")
        with self.assertRaises(ValueError):
            docs.validate_manifest(self.root, self.data)

    def test_main_and_spec_branches_are_development_not_package_version_releases(self):
        commit = self.init_repo()
        self.assertEqual(docs.provenance(self.root), {"commit": commit, "version": "1.2.0", "state": "development"})
        self.git("checkout", "-b", "codex/proposed-only-feature")
        self.assertEqual(docs.provenance(self.root)["state"], "development")
        self.git("tag", "v1.1.0")
        self.assertEqual(docs.provenance(self.root)["state"], "development")

    def test_exact_tag_requires_matching_version_and_clean_tree(self):
        self.init_repo()
        self.git("tag", "v1.2.0")
        info = docs.provenance(self.root)
        self.assertEqual(info["state"], "tag")
        self.assertIn("publication and tag signature not verified", docs.provenance_text(info))
        (self.root / "docs_page/setup.md").write_text("# Changed local instructions\n")
        local = docs.provenance(self.root)
        self.assertEqual(local["state"], "local")
        self.assertIsNone(docs.source_url(self.root, local, "docs_page/setup.md"))

    def test_untracked_sources_are_local_and_unknown_git_is_not_invented(self):
        self.init_repo()
        (self.root / "docs_page/untracked.md").write_text("# New guide\n")
        self.assertEqual(docs.provenance(self.root)["state"], "local")
        with patch.object(docs, "_git", return_value=None):
            info = docs.provenance(self.root)
        self.assertEqual(info["state"], "unknown")
        self.assertIsNone(info["commit"])
        self.assertNotIn("raw.githubusercontent.com", docs.llms_text(self.root, [self.entry], info))
        # A source export nested in another checkout must not borrow the outer repo's SHA.
        nested = self.root / "export"
        nested.mkdir()
        (nested / "package.json").write_text('{"version":"1.2.0"}')
        self.assertEqual(docs.provenance(nested)["state"], "unknown")

    def test_generated_urls_match_files_at_asserted_commit(self):
        commit = self.init_repo()
        info = docs.provenance(self.root)
        url = docs.source_url(self.root, info, self.entry["file"])
        self.assertEqual(url, f"https://raw.githubusercontent.com/arc-mcp/arc-1/{commit}/docs_page/setup.md")
        self.assertIn("Public guide", self.git("show", f"{commit}:docs_page/setup.md"))
        with self.assertRaises(ValueError):
            docs.source_url(self.root, info, "docs_page/not-at-this-commit.md")

    def test_generation_is_deterministic_and_never_copies_evidence_contents(self):
        self.init_repo()
        info = docs.provenance(self.root)
        one = docs.llms_text(self.root, [self.entry], info)
        self.assertEqual(one, docs.llms_text(self.root, [self.entry], info))
        self.assertIn("Source-reviewed 2026-09-05", one)
        self.assertNotIn("fixture source", one)
        self.assertEqual(docs.navigation([self.entry]), docs.navigation([self.entry]))

    def test_proposals_history_and_unknowns_never_enter_operational_index(self):
        self.init_repo()
        info = docs.provenance(self.root)
        for status, kind in [("proposed", "proposal"), ("historical", "historical"), ("unknown", "guide")]:
            with self.subTest(status=status):
                excluded = copy.deepcopy(self.entry)
                excluded.update({"feature_status": status, "kind": kind,
                                 "task": "ARC1_MULTI_TARGET_AUTHORIZATION proposed unpaged SAPTargets"})
                docs.validate_manifest(self.root, {"schema_version": 1, "entries": [excluded]})
                self.assertNotIn("ARC1_MULTI_TARGET_AUTHORIZATION", docs.llms_text(self.root, [excluded], info))
                self.assertNotIn("unpaged SAPTargets", docs.navigation([excluded]))

    def test_hook_renders_current_state_and_writes_only_build_output(self):
        (self.root / "docs").mkdir()
        (self.root / "docs/btp-setup-index.yaml").write_text(yaml.safe_dump(self.data))
        self.init_repo()
        output = self.root / "site"
        output.mkdir()
        config = SimpleNamespace(site_dir=output)
        page = SimpleNamespace(file=SimpleNamespace(src_uri="setup.md"))
        original = (self.root / "docs_page/setup.md").read_text()
        with patch.object(docs, "ROOT", self.root):
            docs.on_config(config)
            rendered = docs.on_page_markdown(original, page, config, None)
            self.assertIn("Experimental multi-target", rendered)
            self.assertTrue(rendered.startswith("# Setup\n"))
            docs.on_post_build(config)
            self.assertTrue((output / "llms.txt").is_file())
            self.assertEqual((self.root / "docs_page/setup.md").read_text(), original)
            page.file.src_uri = "unrelated.md"
            self.assertEqual(docs.on_page_markdown("# Untouched", page, config, None), "# Untouched")
            page.file.src_uri = "btp-documentation.md"
            with self.assertRaises(PluginError):
                docs.on_page_markdown("# Missing marker", page, config, None)
            rendered = docs.on_page_markdown("# Sources\n\n" + docs.INDEX_MARKER, page, config, None)
            self.assertIn("setup.md#identity", rendered)
            self.assertNotIn(docs.INDEX_MARKER, rendered)

    def test_invalid_manifest_fails_build_event(self):
        (self.root / "docs").mkdir()
        self.entry["anchor"] = "broken"
        (self.root / "docs/btp-setup-index.yaml").write_text(yaml.safe_dump(self.data))
        with patch.object(docs, "ROOT", self.root), self.assertRaises(PluginError):
            docs.on_config(SimpleNamespace())

    def test_live_preview_rebuild_reloads_manifest_and_git_state(self):
        (self.root / "docs").mkdir()
        manifest = self.root / "docs/btp-setup-index.yaml"
        manifest.write_text(yaml.safe_dump(self.data))
        self.init_repo()
        with patch.object(docs, "ROOT", self.root):
            docs.on_config(SimpleNamespace())
            self.assertEqual(docs._state[1]["state"], "development")
            self.entry["feature_status"] = "proposed"
            self.entry["kind"] = "proposal"
            manifest.write_text(yaml.safe_dump(self.data))
            docs.on_pre_build(SimpleNamespace())
            self.assertEqual(docs._state[1]["state"], "local")
            self.assertEqual(docs.operational(docs._state[0]), [])


class RepositoryTests(unittest.TestCase):
    def test_actual_manifest_and_source_review_paths(self):
        data = yaml.load((docs.ROOT / "docs/btp-setup-index.yaml").read_text(), Loader=docs.UniqueLoader)
        entries = docs.validate_manifest(docs.ROOT, data)
        self.assertEqual(len(entries), 8)
        for entry in entries:
            for path in entry["source_review"]["evidence"]:
                self.assertIsNotNone(docs._git(docs.ROOT, "cat-file", "-e", f"{entry['source_review']['commit']}:{path}"))
        self.assertNotIn("ARC1_MULTI_TARGET_AUTHORIZATION", docs.llms_text(docs.ROOT, entries, docs.provenance(docs.ROOT)))

    def test_ci_is_readonly_and_build_inputs_trigger_publication(self):
        # BaseLoader preserves YAML's 'on' key as text (rather than YAML 1.1 boolean).
        workflow = yaml.load((docs.ROOT / ".github/workflows/docs-source.yml").read_text(), Loader=yaml.BaseLoader)
        self.assertIn("pull_request", workflow["on"])
        self.assertNotIn("pull_request_target", workflow["on"])
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        for step in workflow["jobs"]["source-index"]["steps"]:
            if "uses" in step:
                self.assertRegex(step["uses"], r"@[0-9a-f]{40}$")
        pages = yaml.load((docs.ROOT / ".github/workflows/pages.yml").read_text(), Loader=yaml.BaseLoader)
        for path in ["docs/btp-setup-index.yaml", "scripts/docs/**", "package.json", "examples/btp/**"]:
            self.assertIn(path, pages["on"]["push"]["paths"])


if __name__ == "__main__":
    unittest.main()
