"""Lossless SQLite snapshots. Remote operations only generate SELECT statements."""
import json
from contextlib import closing
import math
import pathlib
import re
import sqlite3

SCHEMA_SQL = """SELECT type,name,tbl_name,sql FROM sqlite_master
WHERE sql IS NOT NULL AND name NOT GLOB '_cf_*' AND name NOT GLOB 'sqlite_*'
ORDER BY type,name"""
INVENTORY_SQL = """SELECT json_object('schema',
(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql))
 FROM (""" + SCHEMA_SQL + """)), 'tables',
(SELECT json_group_array(json_object('name',m.name,'sql',m.sql,'columns',
 (SELECT json_group_array(json_object('cid',p.cid,'name',p.name,'type',p.type,
 'notnull',p.[notnull],'dflt_value',p.dflt_value,'pk',p.pk,'hidden',p.hidden))
 FROM pragma_table_xinfo(m.name) p))) FROM
 (SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT GLOB '_cf_*'
 ORDER BY name) m)) AS inventory"""


def quote(name):
    if not isinstance(name, str) or not name or '\x00' in name:
        raise ValueError('Invalid schema identifier')
    return '"' + name.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def typed(expression):
    # SQLite's own SQL literal plus an atomic source-side exactness guard.
    # Some SQLite versions cannot round-trip every finite double, even via quote().
    return (f"json_array(typeof({expression}),iif(typeof({expression})='real',"
            f"iif(CAST(quote({expression})AS REAL)={expression},quote({expression}),NULL),hex({expression})))")


def rowid_alias(table):
    sql = table['sql']
    if not isinstance(sql, str) or not re.match(r'CREATE\s+TABLE\b', sql.lstrip(), re.I):
        raise ValueError('Virtual tables are not supported by this snapshot format')
    if any(c.get('hidden') != 0 for c in table['columns']):
        raise ValueError('Generated or hidden columns require a reviewed snapshot format')
    if re.search(r'\)\s*WITHOUT\s+ROWID(?:\s*,\s*STRICT)?\s*$', sql, re.I):
        return None
    names = {c['name'].lower() for c in table['columns']}
    for alias in ('_rowid_', 'rowid', 'oid'):
        if alias not in names:
            return alias
    raise ValueError('All SQLite row identifier aliases are shadowed')


def snapshot_query(inventory):
    parts = []
    for table in inventory['tables']:
        name = table['name']; columns = table['columns']; alias = rowid_alias(table)
        expressions = ([alias] if alias else []) + [quote(c['name']) for c in columns]
        order = alias or ','.join(quote(c['name']) for c in sorted(columns, key=lambda c: c['pk']) if c['pk'])
        if not order:
            raise ValueError('Snapshot table has no stable ordering')
        aliases = ['c' + str(i) for i in range(len(expressions))]
        projection = ','.join(e + ' AS ' + a for e, a in zip(expressions, aliases))
        rows = ("(SELECT json_group_array(json_array(" + ','.join(typed(a) for a in aliases)
                + ')) FROM (SELECT ' + projection + ' FROM ' + quote(name) + ' ORDER BY ' + order + '))')
        parts.append("json_object('name'," + literal(name) + ",'rowid'," + (literal(alias) if alias else 'NULL')
                     + ",'rows'," + rows + ')')
    schema = "(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (" + SCHEMA_SQL + '))'
    query = "SELECT json_object('formatVersion',2,'schema'," + schema + ",'tables',json_array(" + ','.join(parts) + ')) AS snapshot'
    if len(query.encode()) > 95_000:
        raise ValueError('Schema exceeds the safe single-query snapshot limit; review backup capacity')
    return query


def validate(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get('formatVersion') != 2:
        raise ValueError('Unsupported snapshot format')
    schema = snapshot.get('schema'); tables = snapshot.get('tables')
    if not isinstance(schema, list) or not isinstance(tables, list) or not tables:
        raise ValueError('Incomplete snapshot')
    names = [t['name'] for t in tables]
    if len(names) != len(set(names)) or any(n.startswith('_cf_') for n in names):
        raise ValueError('Invalid snapshot table inventory')
    defined = {s['name'] for s in schema if s['type'] == 'table'}
    if defined != set(names) - {'sqlite_sequence'}:
        raise ValueError('Snapshot is missing application tables')
    for item in schema:
        if item['type'] not in ('table', 'index', 'trigger', 'view'):
            raise ValueError('Unsupported schema object')
        if not re.match(r'CREATE\s+(?:UNIQUE\s+)?' + item['type'] + r'\b', item['sql'].lstrip(), re.I):
            raise ValueError('Unexpected schema statement')
    for table in tables:
        columns = table['columns']
        if len({c['name'] for c in columns}) != len(columns) or any(c['hidden'] for c in columns):
            raise ValueError('Invalid snapshot columns')
        width = len(columns) + (1 if table['rowid'] else 0)
        for row in table['rows']:
            if len(row) != width:
                raise ValueError('Incomplete snapshot row')
            for cell in row:
                sql_value(cell)


def sql_value(cell):
    if not isinstance(cell, list) or len(cell) != 2 or not isinstance(cell[1], str):
        raise ValueError('Unrepresentable SQLite storage value')
    kind, value = cell
    if kind == 'null' and value == '':
        return 'NULL'
    if kind in ('text', 'blob'):
        if not re.fullmatch(r'(?:[0-9A-F]{2})*', value):
            raise ValueError('Invalid hexadecimal storage value')
        binary = "X'" + value + "'"
        return 'CAST(' + binary + ' AS TEXT)' if kind == 'text' else binary
    if kind == 'integer':
        number = int(bytes.fromhex(value).decode('ascii'))
        if not -(2**63) <= number < 2**63:
            raise ValueError('Integer outside SQLite range')
        return str(number)
    if kind == 'real':
        if not re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?', value) or not math.isfinite(float(value)):
            raise ValueError('Invalid decimal storage value')
        return value
    raise ValueError('Unsupported SQLite storage type')


def complete(captured, inventory):
    if captured['schema'] != inventory['schema']:
        raise ValueError('Database schema changed during capture; retry on a stable schema')
    by_name = {t['name']: t for t in inventory['tables']}
    if {t['name'] for t in captured['tables']} != set(by_name):
        raise ValueError('Snapshot inventory differs from the atomic capture')
    for table in captured['tables']:
        table['columns'] = by_name[table['name']]['columns']
        if table['rowid'] != rowid_alias(by_name[table['name']]):
            raise ValueError('Snapshot row identifier differs from inventory')
    validate(captured)
    return captured


def capture_local(db):
    inventory = json.loads(db.execute(INVENTORY_SQL).fetchone()[0])
    captured = json.loads(db.execute(snapshot_query(inventory)).fetchone()[0])
    return complete(captured, inventory)


def authorize(action, first, second, database, trigger):
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_CREATE_VTABLE):
        return sqlite3.SQLITE_DENY
    if database not in (None, 'main'):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and second in ('load_extension', 'readfile', 'writefile'):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and first not in ('foreign_keys', 'foreign_key_check', 'integrity_check', 'table_xinfo'):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def restore(snapshot, destination, sql_path=None):
    validate(snapshot)
    destination = pathlib.Path(destination)
    if destination.exists():
        raise ValueError('Restore destination must be a new local file')
    statements = ['PRAGMA foreign_keys=OFF;', 'BEGIN;']
    statements += [s['sql'] + ';' for s in snapshot['schema'] if s['type'] == 'table']
    for table in snapshot['tables']:
        if table['name'] == 'sqlite_sequence':
            statements.append('DELETE FROM sqlite_sequence;')
        columns = ([table['rowid']] if table['rowid'] else []) + [c['name'] for c in table['columns']]
        for row in table['rows']:
            statements.append('INSERT INTO ' + quote(table['name']) + '(' + ','.join(map(quote, columns))
                              + ') VALUES(' + ','.join(map(sql_value, row)) + ');')
    statements += [s['sql'] + ';' for s in snapshot['schema'] if s['type'] != 'table']
    statements += ['COMMIT;', 'PRAGMA foreign_keys=ON;']
    sql = '\n'.join(statements) + '\n'
    if sql_path:
        with pathlib.Path(sql_path).open('x') as output:
            output.write(sql)
        pathlib.Path(sql_path).chmod(0o600)
    # Exclusive creation prevents an accidental restore over existing local data.
    with destination.open('xb'):
        pass
    destination.chmod(0o600)
    with closing(sqlite3.connect(destination)) as recovered:
        recovered.set_authorizer(authorize)
        if hasattr(recovered, 'enable_load_extension'):
            recovered.enable_load_extension(False)
        # execute() rejects appended statements while accepting a complete CREATE TRIGGER.
        for statement in statements:
            recovered.execute(statement)
        if recovered.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('Restored database failed integrity checks')
        if recovered.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Restored database has invalid relationships')
        if capture_local(recovered) != snapshot:
            raise ValueError('Restored schema, types or values differ from the snapshot')
    return {'tables': len(snapshot['tables']), 'rows': sum(len(t['rows']) for t in snapshot['tables']),
            'typedValuesMatch': True, 'integrity': 'ok', 'foreignKeyViolations': 0}
