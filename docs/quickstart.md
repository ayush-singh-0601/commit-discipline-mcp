# Guided quickstart

This demo creates a disposable Node.js repository, plans two stages, runs the test suite before each commit, and finishes with a clean worktree.

## Windows PowerShell

Install the CLI once:

```powershell
npm.cmd install --global commit-discipline-mcp@0.1.0
commit-discipline --help
```

Create a clean demo repository with a real test command:

```powershell
$demo = Join-Path $env:TEMP "commit-discipline-demo-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $demo | Out-Null
Set-Location $demo

git init
git config user.name "Commit Discipline Demo"
git config user.email "demo@example.com"

npm.cmd init -y
npm.cmd pkg set scripts.test="node --test"
Set-Content README.md "# Commit Discipline Demo"

git add README.md package.json
git commit -m "chore: initialize demo"
```

Create the plan outside the repository so the worktree remains clean:

```powershell
$stagesFile = Join-Path $env:TEMP "commit-discipline-stages-$([guid]::NewGuid()).json"
$stages = @'
[
  {
    "id": "core",
    "title": "Add sum function",
    "description": "Implement the sum module",
    "files": ["src/sum.js"]
  },
  {
    "id": "tests",
    "title": "Test sum function",
    "description": "Cover the sum module with Node test",
    "files": ["test/sum.test.js"]
  }
]
'@
[System.IO.File]::WriteAllText($stagesFile, $stages)

commit-discipline plan-task --description "Add a tested sum function" --stages-file $stagesFile
commit-discipline task-status
```

Implement and commit each stage:

```powershell
New-Item -ItemType Directory -Path src | Out-Null
Set-Content src/sum.js "module.exports = (left, right) => left + right;"
commit-discipline commit-stage core --message "feat: add sum function"

New-Item -ItemType Directory -Path test | Out-Null
$testSource = @'
const test = require("node:test");
const assert = require("node:assert/strict");
const sum = require("../src/sum.js");

test("adds two numbers", () => {
  assert.equal(sum(2, 3), 5);
});
'@
[System.IO.File]::WriteAllText((Join-Path $demo "test\sum.test.js"), $testSource)
commit-discipline commit-stage tests --message "test: cover sum function"

commit-discipline finish-task
git log --oneline
git status --short
```

The final status command should print nothing. Git history should contain the initial commit and two focused stage commits.

## macOS and Linux

Install the CLI and create the demo repository:

```bash
npm install --global commit-discipline-mcp@0.1.0

demo="$(mktemp -d)/commit-discipline-demo"
mkdir -p "$demo"
cd "$demo"

git init
git config user.name "Commit Discipline Demo"
git config user.email "demo@example.com"

npm init -y
npm pkg set scripts.test="node --test"
printf '# Commit Discipline Demo\n' > README.md
git add README.md package.json
git commit -m "chore: initialize demo"
```

Create the plan outside the repository:

```bash
stages_file="$(mktemp)"
cat > "$stages_file" <<'JSON'
[
  {
    "id": "core",
    "title": "Add sum function",
    "description": "Implement the sum module",
    "files": ["src/sum.js"]
  },
  {
    "id": "tests",
    "title": "Test sum function",
    "description": "Cover the sum module with Node test",
    "files": ["test/sum.test.js"]
  }
]
JSON

commit-discipline plan-task --description "Add a tested sum function" --stages-file "$stages_file"
commit-discipline task-status
```

Implement and commit both stages:

```bash
mkdir -p src
printf 'module.exports = (left, right) => left + right;\n' > src/sum.js
commit-discipline commit-stage core --message "feat: add sum function"

mkdir -p test
cat > test/sum.test.js <<'JS'
const test = require("node:test");
const assert = require("node:assert/strict");
const sum = require("../src/sum.js");

test("adds two numbers", () => {
  assert.equal(sum(2, 3), 5);
});
JS

commit-discipline commit-stage tests --message "test: cover sum function"
commit-discipline finish-task
git log --oneline
git status --short
```

## Try a guardrail

Start another clean plan, then modify a file that is not declared in its current stage. `commit-stage` will refuse to commit until the unrelated change is reverted, stashed, or added to an appropriate plan.

You can also preview the active stage without running tests or changing Git:

```sh
commit-discipline commit-stage core --message "feat: preview" --dry-run --json
```
