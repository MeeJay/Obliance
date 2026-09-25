# sync-cloud.ps1 — bring work done in Claude Code cloud sessions (GitHub) back
# into this local clone, safely.
#
# Usage (one line, from any PowerShell window):
#   powershell -ExecutionPolicy Bypass -File D:\Obliance\sync-cloud.ps1
#   powershell -ExecutionPolicy Bypass -File D:\Obliance\sync-cloud.ps1 -Branch claude/mobile-phase0
#   powershell -ExecutionPolicy Bypass -File D:\Obliance\sync-cloud.ps1 -List
#
# What it does:
#   1. Refuses to run during a merge/rebase or while 000-RegularUpdate.lock exists.
#   2. Stashes local uncommitted changes (including untracked files) if any.
#   3. git fetch origin --prune, then shows the cloud branches and what is new.
#   4. Merges origin/<Branch> (default: dev) into the current local branch
#      (fast-forward when possible, a normal merge commit otherwise).
#   5. Re-applies the stash. On any conflict it STOPS and tells you what to do:
#      nothing is reset, forced or deleted.
param(
  [string]$Branch = 'dev',
  [switch]$List
)

$ErrorActionPreference = 'Continue'
$repo = 'D:\Obliance'
Set-Location $repo

function Git { & git @args; return $LASTEXITCODE }

if (Test-Path "$repo\000-RegularUpdate.lock") { Write-Host 'A RegularUpdate is running (lock present). Try again later.' -ForegroundColor Red; exit 1 }
if ((Test-Path "$repo\.git\MERGE_HEAD") -or (Test-Path "$repo\.git\rebase-merge") -or (Test-Path "$repo\.git\rebase-apply")) {
  Write-Host 'A merge or rebase is already in progress. Finish or abort it first (git merge --abort).' -ForegroundColor Red; exit 1
}

$current = (& git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Local branch: $current" -ForegroundColor Cyan

Write-Host 'Fetching origin...' -ForegroundColor Cyan
if ((Git fetch origin --prune) -ne 0) { Write-Host 'git fetch failed (network / SSH key?).' -ForegroundColor Red; exit 1 }

Write-Host "`nRemote branches, most recent first (cloud sessions usually push to claude/*):" -ForegroundColor Cyan
& git for-each-ref --sort=-committerdate --count=15 --format='  %(committerdate:relative)  %(refname:short)  -  %(subject)' refs/remotes/origin
if ($List) { exit 0 }

$target = "origin/$Branch"
& git rev-parse --verify --quiet $target *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "`n$target does not exist. Use -List to see the branches." -ForegroundColor Red; exit 1 }

$incoming = (& git rev-list --count "HEAD..$target").Trim()
Write-Host "`n$incoming new commit(s) on $target not in $current :" -ForegroundColor Cyan
& git log --oneline --no-decorate "HEAD..$target" | Select-Object -First 30
if ($incoming -eq '0') { Write-Host 'Already up to date.' -ForegroundColor Green; exit 0 }

$stashed = $false
$dirty = (& git status --porcelain)
if ($dirty) {
  $msg = "sync-cloud autostash $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
  if ((Git stash push --include-untracked -m $msg) -ne 0) { Write-Host 'git stash failed; nothing was changed.' -ForegroundColor Red; exit 1 }
  $stashed = $true
  Write-Host "Local changes stashed ($msg)." -ForegroundColor Yellow
}

Write-Host "`nMerging $target into $current..." -ForegroundColor Cyan
if ((Git merge --no-edit $target) -ne 0) {
  Write-Host "`nMERGE CONFLICT. Nothing was lost." -ForegroundColor Red
  Write-Host '  - Fix the conflicted files, then: git add -A ; git commit --no-edit'
  Write-Host '  - Or cancel the merge:          git merge --abort'
  if ($stashed) { Write-Host '  - Then re-apply your local changes: git stash pop' }
  exit 2
}

if ($stashed) {
  if ((Git stash pop) -ne 0) {
    Write-Host "`nThe merge succeeded, but re-applying your local changes conflicted." -ForegroundColor Red
    Write-Host '  Your changes are still safe in the stash (git stash list). Resolve the files, then: git stash drop'
    exit 3
  }
  Write-Host 'Local changes re-applied.' -ForegroundColor Green
}

Write-Host "`nDone: $current now contains $target." -ForegroundColor Green
Write-Host 'Reminder: client i18n keys waiting in client/src/i18n/_pending must be merged before any client build (see CLAUDE.md, App mobile).'
exit 0
