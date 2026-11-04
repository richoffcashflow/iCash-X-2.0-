import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Real pipes reproduce the TextIO/select buffering failure without PostgreSQL,
// provider traffic or changing the existing five-second fixture deadline.
const script=String.raw`
import importlib.util
from pathlib import Path
import select
import subprocess
import sys
import time

spec=importlib.util.spec_from_file_location('fixture',Path('scripts/test-owner-preflight-priority-postgres.py'))
fixture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def check(source,marker='ready'):
    child=subprocess.Popen([sys.executable,'-u','-c',source],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    try:
        assert select.select([child.stdout],[],[],2)[0], 'child did not write its first chunk'
        started=time.monotonic()
        fixture.wait_for_marker(child,marker)
        assert time.monotonic()-started<2, 'readiness must not wait for the five-second timeout'
        assert child.poll() is None, 'the holder must remain alive until released'
        child.stdin.write('x');child.stdin.flush()
        child.wait(timeout=2)
        assert child.returncode==0, child.stderr.read()
    finally:
        if child.poll() is None:
            child.kill();child.wait(timeout=2)

# One atomic write ensures readline would pre-buffer the marker behind 't'.
check("import os,sys;os.write(1,b't\\nready\\n');sys.stdin.read(1)")
check("import os,sys;os.write(1,b't\\nnoise\\n ready \\r\\n');sys.stdin.read(1)")
# A marker split across reads must retain its incomplete prefix.
check("import os,sys,time;os.write(1,b't\\nrea');time.sleep(.05);os.write(1,b'dy\\n');sys.stdin.read(1)")
failed=subprocess.Popen([sys.executable,'-c',"import sys;sys.stderr.write('fixture failed');sys.exit(7)"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
failed.wait(timeout=2)
try:
    fixture.wait_for_marker(failed,'ready')
    raise AssertionError('an exited holder cannot establish a live lock')
except AssertionError as error:
    assert str(error)=='fixture failed', str(error)
print('PASS bounded native marker reader: batched/split lines, live holder, and exited-holder diagnostics.')
`;
const result=spawnSync('python3',['-c',script],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:15000});
assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
console.log(result.stdout.trim());
