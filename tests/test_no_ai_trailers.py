import json
import subprocess
import unittest
from pathlib import Path


HOOK = Path(__file__).parents[1] / ".rulesync" / "hooks" / "no-ai-trailers.py"


def run_hook(payload: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        check=False,
        text=True,
    )


class NoAiTrailersTest(unittest.TestCase):
    def test_blocks_forbidden_commit_trailer(self) -> None:
        result = run_hook(
            {
                "tool_name": "shell",
                "tool_input": {"command": "git commit -m 'feat: x\n\nCo-Authored-By: bot'"},
            },
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("Commit blocked", result.stderr)

    def test_allows_clean_commit(self) -> None:
        result = run_hook(
            {"tool_name": "shell", "tool_input": {"command": "git commit -m 'feat: add probe'"}},
        )

        self.assertEqual(result.returncode, 0)

    def test_allows_non_commit_command(self) -> None:
        result = run_hook(
            {"tool_name": "shell", "tool_input": {"command": "printf 'Co-Authored-By'"}},
        )

        self.assertEqual(result.returncode, 0)

    def test_allows_unknown_input(self) -> None:
        result = subprocess.run(
            ["python3", str(HOOK)],
            input="not-json",
            capture_output=True,
            check=False,
            text=True,
        )

        self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
