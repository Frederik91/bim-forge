param([string]$OutputRoot)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$run = [guid]::NewGuid().ToString('N')
if (-not $OutputRoot) { $OutputRoot = Join-Path ([IO.Path]::GetTempPath()) "bim-forge-ifc-258-$run" }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) { throw 'OutputRoot must be a fresh disposable directory.' }
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
$build = Join-Path $OutputRoot 'build'
$generator = Join-Path $OutputRoot 'generator'
$spool = Join-Path $OutputRoot 'spool'
$artifacts = Join-Path $OutputRoot 'artifacts'
$output = Join-Path $OutputRoot 'generated'
New-Item -ItemType Directory -Path "$build/experiments/ifc", "$build/experiments/ifc-link", "$generator/ifc", "$generator/ifc-link", $spool, $artifacts, $output | Out-Null
Copy-Item -LiteralPath "$repository/deploy/ifc-link/Dockerfile" -Destination "$build/Dockerfile"
Copy-Item -LiteralPath "$repository/experiments/ifc/requirements.txt" -Destination "$build/experiments/ifc/requirements.txt"
Copy-Item -LiteralPath "$repository/experiments/ifc-link/link.py", "$repository/experiments/ifc-link/runtime_worker.py" -Destination "$build/experiments/ifc-link"
Copy-Item -LiteralPath "$repository/experiments/ifc/ifc_model.py" -Destination "$generator/ifc/ifc_model.py"
Copy-Item -LiteralPath "$repository/experiments/ifc-link/fixture.py" -Destination "$generator/ifc-link/fixture.py"
$image = "bim-forge-ifc-qualification:258-$run"
$worker = "bim-forge-ifc-258-$run"
$workerId = $null
$previous = @{}
foreach ($key in @('IFC_EXTERNAL_SPOOL', 'IFC_FIXTURE', 'QUAL_ARTIFACTS')) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
Push-Location $repository
try {
  & docker build --file "$build/Dockerfile" --tag $image $build 2>&1 | Tee-Object -FilePath "$artifacts/build.txt"
  if ($LASTEXITCODE) { throw 'Converter image build failed.' }
  $imageId = (& docker image inspect $image --format '{{.Id}}').Trim()
  if ($LASTEXITCODE) { throw 'Converter image inspection failed.' }
  $isolation = @('--network', 'none', '--read-only', '--init', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '65032:33', '--cpus', '0.5', '--memory', '2304m', '--memory-swap', '2304m', '--pids-limit', '64', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777')
  & docker run --rm @isolation --mount "type=bind,source=$generator,target=/qualification,readonly" --mount "type=bind,source=$output,target=/out" --entrypoint python $imageId /qualification/ifc-link/fixture.py /out/tiny 2>&1 | Tee-Object -FilePath "$artifacts/generate.txt"
  if ($LASTEXITCODE) { throw 'Real IFC fixture generation failed.' }
  $fixture = Join-Path $output 'tiny/synthetic.ifc'
  $workerId = (& docker run --detach --name $worker --label 'bim-forge.qualification=258' @isolation --mount "type=bind,source=$spool,target=/spool" $imageId).Trim()
  if ($LASTEXITCODE) { throw 'Isolated converter start failed.' }
  & docker inspect $workerId | Set-Content -LiteralPath "$artifacts/worker-inspect.json"
  $inspection = Get-Content -LiteralPath "$artifacts/worker-inspect.json" -Raw | ConvertFrom-Json
  $container = $inspection[0]
  if ($container.HostConfig.NetworkMode -ne 'none' -or -not $container.HostConfig.ReadonlyRootfs -or -not $container.HostConfig.Init -or $container.Config.User -ne '65032:33' -or
      $container.HostConfig.Memory -ne 2415919104 -or $container.HostConfig.MemorySwap -ne 2415919104 -or $container.HostConfig.NanoCpus -ne 500000000 -or $container.HostConfig.PidsLimit -ne 64 -or
      $container.HostConfig.CapDrop -notcontains 'ALL' -or $container.HostConfig.SecurityOpt -notcontains 'no-new-privileges:true' -or
      $container.Mounts.Count -ne 1 -or $container.Mounts[0].Destination -ne '/spool' -or -not $container.Mounts[0].RW) {
    throw 'Actual converter isolation differs from the required configuration.'
  }
  $record = @{ root = $OutputRoot; image = $image; imageId = $imageId; workerId = $workerId; worker = $worker; fixture = $fixture; originalSha256 = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant(); fixtureBytes = (Get-Item -LiteralPath $fixture).Length; sourceCommit = (& git rev-parse HEAD).Trim() }
  $record | ConvertTo-Json | Set-Content -LiteralPath "$artifacts/run.json"
  $env:IFC_EXTERNAL_SPOOL = $spool
  $env:IFC_FIXTURE = $fixture
  $env:QUAL_ARTIFACTS = $artifacts
  & npm run build:demo 2>&1 | Tee-Object -FilePath "$artifacts/build-demo.txt"
  if ($LASTEXITCODE) { throw 'Demo build failed.' }
  & npm run test:ifc-workspace 2>&1 | Tee-Object -FilePath "$artifacts/linked-workspace.txt"
  if ($LASTEXITCODE) { throw 'Linked workspace browser qualification failed. Inspect the retained artifacts.' }
  & node --test --test-concurrency=1 demo/linked-navigation-qualification.test.ts 2>&1 | Tee-Object -FilePath "$artifacts/linked-navigation.txt"
  if ($LASTEXITCODE) { throw 'Linked Inside camera seam qualification failed. Inspect the retained artifacts.' }
} finally {
  if ($workerId) {
    & docker logs $workerId 2>&1 | Set-Content -LiteralPath "$artifacts/worker.log"
    & docker stop --time 5 $workerId | Out-Null
    & docker inspect $workerId | Set-Content -LiteralPath "$artifacts/worker-stopped.json"
  }
  foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
  Pop-Location
  Write-Output "Retained qualification artifacts: $artifacts"
}
