"""Validate HealthTwin submission files and public-facing claims."""

from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
README = ROOT / "README.md"
REQUIRED_HEADINGS = (
    "Project Title",
    "Team Details",
    "College / Incubator Information",
    "Problem Statement",
    "Healthcare Use Case",
    "Technical Stack",
    "AI/ML Model or Framework Details",
    "Demo Video",
    "Open-Source License",
    "Architecture Diagram",
    "Presentation",
    "Quickstart",
    "Repo Structure",
    "Disclaimer",
)
IGNORED_PARTS = {
    ".git", ".pytest_cache", ".mypy_cache", ".ruff_cache", "__pycache__",
    "node_modules", "venv", ".venv", "dist", "build", "coverage", "shots",
}
TEXT_SUFFIXES = {
    ".cfg", ".css", ".html", ".ini", ".js", ".jsx", ".json", ".md",
    ".py", ".ps1", ".sh", ".toml", ".ts", ".tsx", ".txt", ".yml", ".yaml",
}
SECRET_PATTERNS = (
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----"),
    re.compile(
        r"(?i)\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)"
        r"\s*[:=]\s*['\"]?(?!<<FILL)([A-Za-z0-9_./+=-]{20,})"
    ),
)


def candidate_files() -> list[Path]:
    """Return public-submission candidates when Git metadata is unavailable."""
    result = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        if any(part in IGNORED_PARTS for part in relative.parts):
            continue
        if relative.name in {"DECISIONS.md", "TEST_REPORT.md", "api.log", "train_log.txt"}:
            continue
        if relative.parts[:2] == ("data", "raw"):
            continue
        if relative.parts[:2] == ("data", "processed") and path.suffix == ".npy":
            continue
        if relative.parts[0] == "shots":
            continue
        result.append(path)
    return result


def tracked_files() -> tuple[list[Path], bool]:
    try:
        completed = subprocess.run(
            ["git", "ls-files", "-z"], cwd=ROOT, check=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return candidate_files(), False
    paths = [ROOT / item.decode() for item in completed.stdout.split(b"\0") if item]
    return [path for path in paths if path.is_file()], True


def check_external(url: str) -> tuple[bool, str]:
    request = Request(url, method="HEAD", headers={"User-Agent": "HealthTwinSubmissionCheck/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            return 200 <= response.status < 400, str(response.status)
    except HTTPError as error:
        if error.code not in {403, 405, 501}:
            return False, str(error.code)
    except (URLError, TimeoutError) as error:
        return False, str(error)

    request = Request(url, headers={"Range": "bytes=0-0", "User-Agent": "HealthTwinSubmissionCheck/1.0"})
    try:
        with urlopen(request, timeout=10) as response:
            return 200 <= response.status < 400, str(response.status)
    except (HTTPError, URLError, TimeoutError) as error:
        return False, str(getattr(error, "code", error))


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []
    readme = README.read_text(encoding="utf-8")

    heading_positions = []
    for heading in REQUIRED_HEADINGS:
        match = re.search(rf"^##\s+{re.escape(heading)}\s*$", readme, re.MULTILINE)
        if match is None:
            errors.append(f"Missing README heading: {heading}")
        else:
            heading_positions.append((match.start(), heading))
    if [name for _, name in heading_positions] != [
        name for _, name in sorted(heading_positions)
    ]:
        errors.append("README mandatory headings are not in the required order")

    placeholders = sorted(set(re.findall(r"<<FILL(?::[^>]+)?>>", readme)))
    if placeholders:
        warnings.append("README placeholders remain: " + ", ".join(placeholders))

    for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", readme):
        target = target.split()[0].strip("<>")
        parsed = urlparse(target)
        if parsed.scheme in {"http", "https"}:
            if "youtube.com" in parsed.netloc and "<<FILL" in target:
                continue
            ok, detail = check_external(target)
            if not ok:
                errors.append(f"External link unavailable ({detail}): {target}")
            continue
        if parsed.scheme or not parsed.path:
            continue
        relative_path = unquote(parsed.path).lstrip("/")
        if not (ROOT / relative_path).is_file():
            errors.append(f"README link does not exist: {target}")

    if not (ROOT / "LICENSE").is_file():
        errors.append("LICENSE is missing")

    for relative in ("docs/architecture.pdf", "docs/presentation.pdf"):
        pdf_path = ROOT / relative
        if not pdf_path.is_file() or pdf_path.stat().st_size < 1000:
            errors.append(f"PDF missing or empty: {relative}")
            continue
        try:
            from pypdf import PdfReader

            if not PdfReader(str(pdf_path)).pages:
                errors.append(f"PDF has no pages: {relative}")
        except Exception as error:  # pypdf also reports malformed PDF files here.
            errors.append(f"PDF cannot be opened ({relative}): {error}")

    metrics_path = ROOT / "results" / "metrics.json"
    try:
        metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
        for line in readme.splitlines():
            match = re.match(r"\|\s*([a-z0-9_]+)\s*\|\s*(auroc|auprc|f1|ece)\s*\|\s*([0-9.]+)\s*\|", line)
            if not match:
                continue
            model, metric, displayed = match.groups()
            expected = metrics["models"][model][metric]
            if not math.isclose(float(displayed), float(expected), abs_tol=0.00005):
                errors.append(
                    f"README metric mismatch: {model}.{metric}={displayed}, JSON={expected}"
                )
    except (OSError, KeyError, ValueError, TypeError) as error:
        errors.append(f"Could not validate README metrics against results/metrics.json: {error}")

    files, has_git = tracked_files()
    total_size = sum(path.stat().st_size for path in files)
    if total_size >= 100 * 1024 * 1024:
        errors.append(f"Submission file set is {total_size / 1024 / 1024:.1f} MB (limit: <100 MB)")
    oversized = [
        f"{path.relative_to(ROOT)} ({path.stat().st_size / 1024 / 1024:.1f} MB)"
        for path in files if path.stat().st_size > 25 * 1024 * 1024
    ]
    if oversized:
        errors.append("Files exceed 25 MB: " + ", ".join(oversized))
    if not has_git:
        warnings.append("No Git metadata: size and secret scans use submission candidates, not tracked files")

    secret_hits = []
    for path in files:
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for pattern in SECRET_PATTERNS:
            if pattern.search(content):
                secret_hits.append(str(path.relative_to(ROOT)))
                break
    if secret_hits:
        errors.append("Possible secrets found in: " + ", ".join(sorted(set(secret_hits))))

    print(f"Submission file set: {total_size / 1024 / 1024:.2f} MB across {len(files)} files")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"FAIL: {error}")
    if errors:
        print(f"Submission check failed with {len(errors)} error(s).")
        return 1
    print("Submission check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())