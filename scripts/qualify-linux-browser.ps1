param(
  [string]$SourceRef = 'HEAD',
  [string]$BaseImage = 'bim-forge-spatial-local:domain-35f867e',
  [string]$OutputRoot,
  [string[]]$Tests = @(
    'demo/floor-plan-guide-browser.test.ts', 'demo/request-draft.test.ts',
    'demo/canvas-studio-browser.test.ts', 'demo/request-chat.test.ts', 'demo/workspace-shell.test.ts',
    'demo/spatial-plan-integration-browser.test.ts', 'demo/spatial-tasks-browser.test.ts', 'demo/spatial-tasks.test.ts',
    'demo/spatial-markup-browser.test.ts', 'demo/view-navigation-browser.test.ts', 'demo/model-plan-browser.test.ts',
    'demo/spatial-task-layer-browser.test.ts', 'demo/design-system-browser.test.ts', 'demo/preview-build.test.ts'
  )
)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$run = [guid]::NewGuid().ToString('N')
if (-not $OutputRoot) { $OutputRoot = Join-Path ([IO.Path]::GetTempPath()) "bim-forge-linux-browser-258-$run" }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) { throw 'OutputRoot must be a fresh disposable directory.' }
if ($Tests.Count -lt 1) { throw 'Select at least one complete test file.' }
foreach ($test in $Tests) {
  if ($test -notmatch '^demo/[a-z0-9-]+\.test\.ts$') { throw "Invalid test path: $test" }
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
$context = Join-Path $OutputRoot 'context'
$artifacts = Join-Path $OutputRoot 'artifacts'
New-Item -ItemType Directory -Path $context, $artifacts | Out-Null
$containerId = $null
Push-Location $repository
try {
  $source = (& git rev-parse --verify --end-of-options "$SourceRef^{commit}").Trim()
  if ($LASTEXITCODE -or $source -notmatch '^[a-f0-9]{40}$') { throw 'SourceRef must resolve to a local commit.' }
  $tree = (& git rev-parse "$source^{tree}").Trim()
  $baseId = (& docker image inspect $BaseImage --format '{{.Id}}').Trim()
  if ($LASTEXITCODE -or $baseId -notmatch '^sha256:[a-f0-9]{64}$') { throw 'BaseImage must resolve to an existing reviewed local image.' }
  $baseTag = "bim-forge-linux-browser-base:258-$run"
  & docker tag $baseId $baseTag
  if ($LASTEXITCODE) { throw 'Cannot give the verified local base image its owned build tag.' }
  $archive = Join-Path $OutputRoot 'source.tar'
  & git archive --format=tar "--output=$archive" $source
  if ($LASTEXITCODE) { throw 'Pinned source archive failed.' }
  & tar -xf $archive -C $context
  if ($LASTEXITCODE -or (Test-Path -LiteralPath "$context/.git")) { throw 'Source extraction failed or included Git metadata.' }
  foreach ($test in $Tests) {
    if (-not (Test-Path -LiteralPath (Join-Path $context $test) -PathType Leaf)) { throw "Pinned source omits $test" }
  }
  $metadata = @{ source = $source; tree = $tree; sourceArchiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant();
    dockerignoreSha256 = (Get-FileHash -LiteralPath "$context/.dockerignore" -Algorithm SHA256).Hash.ToLowerInvariant(); baseImage = $BaseImage; baseImageId = $baseId; tests = $Tests }
  $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$context/qualification-source.json"
  $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$artifacts/source.json"
  $dockerfile = @'
ARG QUAL_BASE=bim-forge-spatial-local:domain-35f867e
FROM ${QUAL_BASE}
USER root
WORKDIR /qualification
ENV NODE_ENV=development PLAYWRIGHT_BROWSERS_PATH=/opt/qualification-browsers HOME=/tmp/qualification-home
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund && npx playwright install --with-deps chromium && npm cache clean --force
COPY --chown=65032:33 . .
RUN npm run build:demo && npm run build:design-gallery
USER 65032:33
ENTRYPOINT ["node", "qualification-runner.mjs"]
'@
  $runner = @'
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
const source = JSON.parse(fs.readFileSync('qualification-source.json', 'utf8'));
const hash = name => createHash('sha256').update(fs.readFileSync(name)).digest('hex');
if (hash('.dockerignore') !== source.dockerignoreSha256 || fs.existsSync('.git')) throw new Error('Pinned source packaging integrity failed.');
fs.mkdirSync(process.env.HOME, {recursive:true});
const command = (executable, args) => {
  const result = spawnSync(executable, args, {encoding:'utf8', timeout:30000});
  if (result.status !== 0) throw new Error(`${executable} prerequisite failed: ${result.error ?? result.stderr}`);
  return (result.stdout + result.stderr).trim();
};
const receipt = { source, platform:process.platform, node:process.version, commands:[], results:[],
  tools: { chromiumExecutable:chromium.executablePath(), chromium: command(chromium.executablePath(), ['--version']), prlimit: command('/usr/bin/prlimit', ['--version']),
    pdfinfo: command('/usr/bin/pdfinfo', ['-v']), pdftoppm: command('/usr/bin/pdftoppm', ['-v']), pdftotext: command('/usr/bin/pdftotext', ['-v']) },
  networkInterfaces: fs.readdirSync('/sys/class/net'), total:{tests:0, pass:0, fail:0, cancelled:0, skipped:0, todo:0} };
if (receipt.networkInterfaces.some(name => name !== 'lo')) throw new Error('Tests require Docker network none.');
const save = () => fs.writeFileSync('/artifacts/linux-summary.json', JSON.stringify(receipt,null,2));
save();
function run(executable, args, output, env = process.env) {
  receipt.commands.push([executable,...args]);
  const result = spawnSync(executable, args, {env, encoding:'utf8', timeout:600000, maxBuffer:8*1024*1024});
  const log = (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? '\n'+result.error.stack : '');
  fs.writeFileSync(output, log); return {result,log};
}
const validation = run('npm', ['run','validate'], '/artifacts/validate.txt');
receipt.validation = { exitCode:validation.result.status, signal:validation.result.signal };
console.log(`validate: ${validation.result.status === 0 ? 'PASS' : 'FAIL'}`);
save();
for (const file of source.tests) {
  const name = path.basename(file, '.test.ts'); const directory = '/artifacts/'+name;
  fs.mkdirSync(directory,{recursive:true});
  const env = {...process.env, QUAL_ARTIFACTS:directory, PLAN_INTEGRATION_ARTIFACTS:directory,
    MARKUP_BROWSER_EVIDENCE:directory, TASK_AGENT_EVIDENCE:directory};
  if (file === 'demo/view-navigation-browser.test.ts') env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = chromium.executablePath();
  console.log(`START ${file}`);
  const {result,log} = run('node',['--test','--test-concurrency=1','--test-reporter=tap',file],directory+'/test.tap',env);
  const counts = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key => {
    const matches = [...log.matchAll(new RegExp('^# '+key+' (\\d+)$','gm'))];
    return [key, Number(matches.at(-1)?.[1] ?? 0)];
  }));
  for (const key of Object.keys(receipt.total)) receipt.total[key] += counts[key];
  const value = {file, sourceSha256:hash(file), browserSelection:env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? 'Playwright default', exitCode:result.status, signal:result.signal, ...counts};
  receipt.results.push(value); save();
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${file}: ${JSON.stringify(counts)}`);
  if (result.status !== 0) console.log(log.slice(-12000));
}
receipt.complete = true;
receipt.passed = receipt.validation.exitCode === 0 && receipt.results.length === source.tests.length && receipt.results.every(result => result.exitCode === 0 && result.tests > 0 && result.fail === 0 && result.cancelled === 0 && result.skipped === 0 && result.todo === 0);
function inventory(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const filename = path.join(directory,entry.name);
    if (entry.isDirectory()) return inventory(filename);
    if (!entry.isFile() || filename === '/artifacts/linux-summary.json' || !/\.(png|zip|tap|txt|json)$/.test(filename)) return [];
    return [{name:path.relative('/artifacts',filename),bytes:fs.statSync(filename).size,sha256:hash(filename)}];
  });
}
receipt.artifacts = inventory('/artifacts');
save(); console.log(JSON.stringify(receipt.total));
process.exitCode = receipt.passed ? 0 : 1;
'@
  [IO.File]::WriteAllText("$context/Qualification.Dockerfile", $dockerfile.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText("$context/Qualification.Dockerfile.dockerignore", "# Include the pinned Git archive for QA. Keep its original .dockerignore as test input.`n", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText("$context/qualification-runner.mjs", $runner.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
  $image = "bim-forge-linux-browser:258-$run"
  & docker build --build-arg "QUAL_BASE=$baseTag" --file "$context/Qualification.Dockerfile" --tag $image $context 2>&1 | Tee-Object -FilePath "$artifacts/image-build.txt"
  if ($LASTEXITCODE) { throw 'Linux QA image build failed.' }
  $imageId = (& docker image inspect $image --format '{{.Id}}').Trim()
  $name = "bim-forge-linux-browser-258-$run"
  $containerId = (& docker create --name $name --label 'bim-forge.qualification=258-linux-browser' --network none --read-only --init --cap-drop ALL --security-opt no-new-privileges:true --cpus 2 --memory 4g --memory-swap 4g --pids-limit 512 --shm-size 512m --tmpfs /tmp:rw,nosuid,nodev,size=1g,mode=1777 --mount "type=bind,source=$artifacts,target=/artifacts" --mount "type=bind,source=$artifacts,target=/qualification/artifacts" $imageId).Trim()
  if ($LASTEXITCODE) { throw 'Linux QA container creation failed.' }
  @{ source = $source; image = $image; imageId = $imageId; containerId = $containerId; name = $name; root = $OutputRoot } | ConvertTo-Json | Set-Content -LiteralPath "$artifacts/owned-handles.json"
  & docker inspect $containerId | Set-Content -LiteralPath "$artifacts/container-before.json"
  $inspection = Get-Content -LiteralPath "$artifacts/container-before.json" -Raw | ConvertFrom-Json
  $configuration = $inspection[0].HostConfig
  if ($configuration.NetworkMode -ne 'none' -or -not $configuration.ReadonlyRootfs -or -not $configuration.Init -or $inspection[0].Config.User -ne '65032:33' -or
      $configuration.Memory -ne 4294967296 -or $configuration.MemorySwap -ne 4294967296 -or $configuration.NanoCpus -ne 2000000000 -or $configuration.PidsLimit -ne 512 -or
      $configuration.CapDrop -notcontains 'ALL' -or $configuration.SecurityOpt -notcontains 'no-new-privileges:true') { throw 'Actual Linux QA isolation differs from the required configuration.' }
  & docker start --attach $containerId 2>&1 | Tee-Object -FilePath "$artifacts/execution.txt"
  $executionExitCode = $LASTEXITCODE
  & docker inspect $containerId | Set-Content -LiteralPath "$artifacts/container-after.json"
  $after = Get-Content -LiteralPath "$artifacts/container-after.json" -Raw | ConvertFrom-Json
  if (Test-Path -LiteralPath "$artifacts/linux-summary.json") {
    $summary = Get-Content -LiteralPath "$artifacts/linux-summary.json" -Raw | ConvertFrom-Json
    $summary | Add-Member -NotePropertyName ownedHandles -NotePropertyValue (@{ source = $source; image = $image; imageId = $imageId; containerId = $containerId; name = $name; root = $OutputRoot })
    $summary | Add-Member -NotePropertyName isolation -NotePropertyValue (@{ network = $configuration.NetworkMode; readOnlyRoot = $configuration.ReadonlyRootfs; user = $inspection[0].Config.User; memory = $configuration.Memory; memorySwap = $configuration.MemorySwap; nanoCpus = $configuration.NanoCpus; pids = $configuration.PidsLimit; capDrop = $configuration.CapDrop; securityOpt = $configuration.SecurityOpt; tmpfs = $configuration.Tmpfs; mountDestinations = @($inspection[0].Mounts | ForEach-Object { $_.Destination }) })
    $inventory = @(Get-ChildItem -LiteralPath $artifacts -Recurse -File | Where-Object { $_.Name -ne 'linux-summary.json' } | ForEach-Object {
      @{ name = [IO.Path]::GetRelativePath($artifacts, $_.FullName).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $summary | Add-Member -Force -NotePropertyName artifacts -NotePropertyValue $inventory
    $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath "$artifacts/linux-summary.json"
  }
  if ($executionExitCode -or $after[0].State.ExitCode -ne 0 -or $summary.passed -ne $true) { throw 'Linux regression failed. Inspect the retained suite logs and linux-summary.json.' }
} finally {
  if ($containerId) {
    $running = (& docker inspect $containerId --format '{{.State.Running}}').Trim()
    if ($running -eq 'true') { & docker stop --time 5 $containerId | Out-Null }
  }
  Pop-Location
  Write-Output "Retained Linux qualification artifacts: $artifacts"
}
