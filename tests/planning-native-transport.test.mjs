import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const result=spawnSync('python3',['-c',String.raw`
import sys
sys.path.insert(0,'scripts')
from disposable_planning_postgres_target import PSQL_COMMAND, fixture_environment, assert_fixture_client, assert_fixture_identity

def refused(action):
    try: action()
    except (AssertionError, KeyError): return
    raise AssertionError('Unsafe fixture target accepted')

unsafe={'PGHOSTADDR':'203.0.113.1','PGHOST':'remote.invalid','PGPORT':'5432','PGDATABASE':'production','PGUSER':'remote','PGSERVICE':'production','PGSERVICEFILE':'/tmp/untrusted-service','PGOPTIONS':'-c role=other','PATH':'unchanged'}
env=fixture_environment(unsafe)
assert env['PATH']=='unchanged'
assert_fixture_client(PSQL_COMMAND,env)
identity={'database':'icash_reliability','user':'postgres','application':'icash-planning-fixture','port':55443,'serverAddress':'127.0.0.1'}
assert_fixture_identity(identity)
assert_fixture_identity({**identity,'port':5432,'serverAddress':'172.18.0.2'})
for flag,value in [('-h','203.0.113.1'),('-h','localhost'),('-p','5432'),('-d','production'),('-d','postgresql://remote.invalid/db'),('-U','other')]:
    command=list(PSQL_COMMAND);command[command.index(flag)+1]=value
    refused(lambda:assert_fixture_client(command,env))
refused(lambda:assert_fixture_client([*PSQL_COMMAND,'-h','remote.invalid'],env))
for key,value in unsafe.items():
    if key.startswith('PG'):refused(lambda:assert_fixture_client(PSQL_COMMAND,{**env,key:value}))
for key,value in [('database','production'),('user','other'),('application','other'),('port',5433)]:
    refused(lambda:assert_fixture_identity({**identity,key:value}))
print('PASS native planning transport: native and Docker-mapped loopback; remote/DSN/port/database/user/libpq overrides rejected. No database connection.')
`],{cwd:root,encoding:'utf8'});
assert.equal(result.status,0,result.stderr||result.stdout);console.log(result.stdout.trim());
