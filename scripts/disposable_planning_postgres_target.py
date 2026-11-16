"""Fixed disposable psql destination, including Docker-mapped localhost fixtures."""
PSQL_COMMAND = ('psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                '-h', '127.0.0.1', '-p', '55443', '-U', 'postgres', '-d', 'icash_reliability')
FIXTURE_PG_ENV = {'PGPASSWORD': 'isolated-fixture-only', 'PGCONNECT_TIMEOUT': '5',
                  'PGHOSTADDR': '127.0.0.1', 'PGAPPNAME': 'icash-planning-fixture', 'PGSSLMODE': 'disable'}


def fixture_environment(inherited):
    # libpq's PGHOSTADDR can redirect a literal -h; service/options variables can
    # inject connection defaults. Keep only our complete fixed PG configuration.
    return {**{k: v for k, v in inherited.items() if not k.startswith('PG')}, **FIXTURE_PG_ENV}


def assert_fixture_client(command, environment):
    assert tuple(command) == PSQL_COMMAND, 'Only the exact disposable loopback psql command is permitted'
    assert {k: v for k, v in environment.items() if k.startswith('PG')} == FIXTURE_PG_ENV, 'Unexpected libpq connection override'


def assert_fixture_identity(identity):
    assert identity['database'] == 'icash_reliability', 'Wrong fixture database'
    assert identity['user'] == 'postgres', 'Wrong fixture user'
    assert identity['application'] == FIXTURE_PG_ENV['PGAPPNAME'], 'Wrong fixture application identity'
    assert identity['port'] in (5432, 55443), 'Wrong fixture server port'
    # inet_server_addr is the database container's bridge address in CI, even
    # though libpq connects only to the fixed loopback client endpoint above.
    # It is not the client connection destination and must not be used as one.
