$edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$tmp='E:\pindou\.tmp'
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
$a = @('--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--disable-breakpad',
  '--user-data-dir=E:\pindou\.tmp\p7','--virtual-time-budget=90000','--window-size=1560,1000',
  '--screenshot=E:\pindou\.tmp\selftest.png','--dump-dom',
  'http://127.0.0.1:8765/index.html?selftest=1&cols=64&palette=coco-291')
$p = Start-Process -FilePath $edge -ArgumentList $a -RedirectStandardOutput "$tmp\selftest.dom" -RedirectStandardError "$tmp\selftest.err" -PassThru -NoNewWindow
$p | Wait-Process -Timeout 150 -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$dom = Get-Content "$tmp\selftest.dom" -Raw -Encoding UTF8
"dom=$($dom.Length)"
if($dom -match '(?s)<pre id="selftestResult">(.*?)</pre>'){ $matches[1].Trim() } else { "未找到 selftestResult" }
"shot=$((Get-Item "$tmp\selftest.png" -ErrorAction SilentlyContinue).Length)"
