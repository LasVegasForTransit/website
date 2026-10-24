import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[2] / 'src'))
import snapshot


class SnapshotTests(unittest.TestCase):
    def fixture(self):
        db = sqlite3.connect(':memory:')
        db.executescript('''
            CREATE TABLE people(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, payload BLOB, big INTEGER, amount REAL);
            CREATE TABLE consent_records(id TEXT PRIMARY KEY, person_id INTEGER REFERENCES people(id), withdrawn_at TEXT);
            CREATE INDEX consent_person ON consent_records(person_id);
            CREATE TABLE audit(value TEXT);
            CREATE TRIGGER audit_insert AFTER INSERT ON people BEGIN INSERT INTO audit VALUES('insert'); END;
        ''')
        db.execute('INSERT INTO people(name,payload,big,amount) VALUES(?,?,?,?)', ('é\x00x', b'\x00\xff', 2**63-1, 1.2345678901234567))
        db.execute('INSERT INTO people(name,payload,big,amount) VALUES(?,?,?,?)', ('', b'', -(2**63), -1e-200))
        db.execute('INSERT INTO people(name,payload,big,amount) VALUES(?,?,?,?)', (None, None, 2**53+1, None))
        db.execute("INSERT INTO consent_records VALUES('consent',1,'2026-10-15T00:00:00Z')")
        return db

    def test_complete_roundtrip_preserves_values_schema_rowids_sequences_and_triggers(self):
        db = self.fixture()
        captured = snapshot.capture_local(db)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'fresh.sqlite'
            result = snapshot.restore(captured, path)
            self.assertTrue(result['typedValuesMatch'])
            recovered = sqlite3.connect(path)
            self.assertEqual(snapshot.capture_local(recovered), captured)
            self.assertEqual(recovered.execute('SELECT count(*) FROM audit').fetchone()[0], 3)
            recovered.close()
        db.close()

    def test_wide_mixed_rows_use_compact_query_without_changing_cell_types(self):
        db = sqlite3.connect(':memory:')
        names = ['column"' + str(i) for i in range(120)]
        db.execute('CREATE TABLE mixed(' + ','.join(snapshot.quote(name) for name in names) + ')')
        values = [None, 'é\x00text', b'\x00\xff', 2**63-1, -(2**63), 1.25]
        for offset in range(3):
            row = [values[(i+offset) % len(values)] for i in range(len(names))]
            db.execute('INSERT INTO mixed VALUES(' + ','.join('?' for _ in names) + ')', row)
        inventory = json.loads(db.execute(snapshot.INVENTORY_SQL).fetchone()[0])
        self.assertLess(len(snapshot.snapshot_query(inventory).encode()), 10000)
        captured = snapshot.capture_local(db)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'mixed.sqlite'
            self.assertTrue(snapshot.restore(captured, path)['typedValuesMatch'])
            with sqlite3.connect(path) as restored:
                self.assertEqual(snapshot.capture_local(restored), captured)
        db.close()

    def test_refuses_existing_destination_and_imprecise_real(self):
        db = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'exists.sqlite'
            path.touch()
            with self.assertRaises(ValueError): snapshot.restore(snapshot.capture_local(db), path)
        # SQLite literal formatting differs by platform/version. Simulate a formatter
        # that loses precision so this verifies the source-side guard on every runner.
        db.create_function('quote', 1, lambda value: '0.0')
        db.execute('INSERT INTO people(amount) VALUES(?)', (1.25,))
        with self.assertRaises(ValueError): snapshot.capture_local(db)
        db.close()

    def test_large_row_does_not_exhaust_compound_select_terms(self):
        db = sqlite3.connect(':memory:')
        names = ['field' + str(i) for i in range(520)]
        db.execute('CREATE TABLE large(' + ','.join(snapshot.quote(n) for n in names) + ')')
        db.execute('INSERT INTO large VALUES(' + ','.join('?' for _ in names) + ')', tuple(range(520)))
        captured = snapshot.capture_local(db)
        with tempfile.TemporaryDirectory() as directory:
            result = snapshot.restore(captured, pathlib.Path(directory) / 'large.sqlite')
            self.assertTrue(result['typedValuesMatch'])
        db.close()

    def test_refuses_incomplete_snapshot_missing_table_or_column(self):
        db = self.fixture(); captured = snapshot.capture_local(db); db.close()
        captured['tables'] = [t for t in captured['tables'] if t['name'] != 'people']
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): snapshot.restore(captured, pathlib.Path(directory) / 'fresh.sqlite')

    def test_canonical_schema_fits_atomic_query_and_restores(self):
        db = sqlite3.connect(':memory:')
        migrations = pathlib.Path(__file__).parents[3] / 'platform-storage/migrations'
        for migration in sorted(migrations.glob('*.sql')):
            db.executescript(migration.read_text())
        inventory = json.loads(db.execute(snapshot.INVENTORY_SQL).fetchone()[0])
        self.assertGreater(len(inventory['tables']), 70)
        self.assertLess(len(snapshot.snapshot_query(inventory).encode()), 95000)
        captured = snapshot.capture_local(db)
        with tempfile.TemporaryDirectory() as directory:
            self.assertTrue(snapshot.restore(captured, pathlib.Path(directory) / 'fresh.sqlite')['typedValuesMatch'])
        db.close()

    def test_shared_database_extensions_fit_atomic_backup_and_restore(self):
        db = sqlite3.connect(':memory:')
        migrations = pathlib.Path(__file__).parents[3] / 'platform-storage/migrations'
        for migration in sorted(migrations.glob('*.sql')):
            db.executescript(migration.read_text())
        for number in range(16):
            columns = ','.join('field' + str(i) + ' TEXT' for i in range(12))
            db.execute('CREATE TABLE integration_state_' + str(number) + '(' + columns + ')')
        inventory = json.loads(db.execute(snapshot.INVENTORY_SQL).fetchone()[0])
        self.assertLess(len(snapshot.snapshot_query(inventory).encode()), 95000)
        captured = snapshot.capture_local(db)
        with tempfile.TemporaryDirectory() as directory:
            self.assertTrue(snapshot.restore(captured, pathlib.Path(directory) / 'extended.sqlite')['typedValuesMatch'])
        db.close()

    def test_wide_typed_rows_preserve_every_column_after_query_compaction(self):
        db = sqlite3.connect(':memory:')
        names = ['field' + str(i) for i in range(45)]
        db.execute('CREATE TABLE wide(' + ','.join(snapshot.quote(name) + ' BLOB' for name in names) + ')')
        examples = [None, '', 'é\x00text', b'\x00\xff', 2**63-1, -(2**63), 1.2345678901234567, -1e-200, 2**53+1]
        values = tuple(examples[i % len(examples)] for i in range(len(names)))
        db.execute('INSERT INTO wide VALUES(' + ','.join('?' for _ in names) + ')', values)
        captured = snapshot.capture_local(db)
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'wide.sqlite'
            self.assertTrue(snapshot.restore(captured, path)['typedValuesMatch'])
            recovered = sqlite3.connect(path)
            self.assertEqual(recovered.execute('SELECT * FROM wide').fetchone(), values)
            self.assertEqual(snapshot.capture_local(recovered), captured)
            recovered.close()
        db.close()

    def test_rejects_appended_sql_before_any_external_file_write(self):
        db = self.fixture(); captured = snapshot.capture_local(db); db.close()
        with tempfile.TemporaryDirectory() as directory:
            outside = pathlib.Path(directory) / 'outside.sqlite'
            table = next(s for s in captured['schema'] if s['type'] == 'table')
            table['sql'] += "; ATTACH DATABASE '" + str(outside) + "' AS outside"
            with self.assertRaises(sqlite3.ProgrammingError):
                snapshot.restore(captured, pathlib.Path(directory) / 'fresh.sqlite')
            self.assertFalse(outside.exists())

    def test_handles_without_rowid_and_rejects_virtual_or_generated_tables(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE keyed(a TEXT, b TEXT, PRIMARY KEY(a,b)) WITHOUT ROWID')
        db.execute("INSERT INTO keyed VALUES('a','b')")
        with tempfile.TemporaryDirectory() as directory:
            result = snapshot.restore(snapshot.capture_local(db), pathlib.Path(directory) / 'fresh.sqlite')
            self.assertTrue(result['typedValuesMatch'])
        db.execute('CREATE TABLE generated(a INTEGER, b INTEGER GENERATED ALWAYS AS (a+1))')
        with self.assertRaises(ValueError): snapshot.capture_local(db)
        db.close()


if __name__ == '__main__': unittest.main()
