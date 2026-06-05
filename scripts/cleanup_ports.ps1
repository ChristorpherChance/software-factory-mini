# Cleanup ports for software-factory-mini
# 按端口精准杀进程，绝不按进程名误伤其他 node/python。
# 用 netstat -ano 取端口归属 PID —— 它对 uvicorn --reload 这类
# 父子共享监听 socket 的情况比 Get-NetTCPConnection 更完整可靠。
$ports = @(9100, 8001, 8000, 3000)
$killed = $false

foreach ($p in $ports) {
    # 匹配 "  TCP  0.0.0.0:PORT  ...  LISTENING  PID" 的行，抓最后一列 PID
    $lines = netstat -ano | Select-String -Pattern ":$p\s" | Select-String -Pattern "LISTENING"
    if (-not $lines) {
        Write-Host "[Skip] Port $p not in use"
        continue
    }

    $pids = @()
    foreach ($line in $lines) {
        $cols = ($line.ToString().Trim() -split '\s+')
        $procId = $cols[-1]
        if ($procId -match '^\d+$' -and $procId -ne '0') { $pids += $procId }
    }
    $pids = $pids | Select-Object -Unique

    foreach ($procId in $pids) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "exited" }
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        if ($?) {
            Write-Host "[OK] Port $p - killed PID $procId ($name)"
            $killed = $true
        } else {
            # 进程已不存在（僵尸句柄），socket 由 Windows TCP 栈延迟回收
            Write-Host "[Wait] Port $p - PID $procId ($name) - socket releasing"
        }
    }
}

if ($killed) {
    Write-Host "[OK] Services stopped"
} else {
    Write-Host "[i] Nothing to kill"
}
