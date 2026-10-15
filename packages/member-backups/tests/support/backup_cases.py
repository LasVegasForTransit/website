import datetime as dt
import io
import json
import os
import shutil
import pathlib
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).parents[2] / 'src'))
import backup
import snapshot


class BackupTests(unittest.TestCase):
    def test_pointer_rejects_stale_future_wrong_target_and_uncommitted_keys(self):
        now = dt.datetime.now(dt.timezone.utc)
        good = {'formatVersion': 2, 'accountId': backup.ACCOUNT, 'databaseId': backup.DATABASE,
                'createdAt': now.isoformat(), 'key': 'production/2026/10/snapshot.age',
                'sha256': 'a' * 64, 'bytes': 100}
        backup.validate_pointer(good, now)
        for changes in ({'createdAt': (now-dt.timedelta(hours=27)).isoformat()},
                        {'createdAt': (now+dt.timedelta(hours=1)).isoformat()},
                        {'databaseId': 'preview'}, {'key': '../snapshot.age'}, {'sha256': 'x'}):
            with self.assertRaises(ValueError): backup.validate_pointer(good | changes, now)

    def test_archive_restores_without_executing_archived_programs(self):
        db = sqlite3.connect(':memory:'); db.execute('CREATE TABLE people(id INTEGER PRIMARY KEY, consent TEXT)')
        db.execute("INSERT INTO people VALUES(1,'withdrawn')")
        captured = snapshot.capture_local(db); db.close()
        manifest = {'formatVersion': 2, 'accountId': backup.ACCOUNT, 'databaseId': backup.DATABASE}
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            archive = backup.pack(captured, manifest)
            result = backup.unpack_restore(archive, root / 'fresh.sqlite')
            self.assertTrue(result['typedValuesMatch'])
            bad = io.BytesIO()
            with tarfile.open(fileobj=bad, mode='w:gz') as tar:
                entry = tarfile.TarInfo('../escape'); entry.size = 1; tar.addfile(entry, io.BytesIO(b'x'))
            with self.assertRaises(ValueError): backup.unpack_restore(bad.getvalue(), root / 'bad.sqlite')
            with self.assertRaises(ValueError): backup.unpack_restore(backup.pack(captured, manifest | {'databaseId':'preview'}), root / 'wrong.sqlite')

    @unittest.skipUnless(shutil.which('age'), 'age is installed in the operational workflow')
    def test_encryption_roundtrip_rejects_ciphertext_damage(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            key = pathlib.Path(directory) / 'identity'
            subprocess.run(['age-keygen', '-o', str(key)], check=True, capture_output=True)
            public = subprocess.run(['age-keygen', '-y', str(key)], check=True, capture_output=True).stdout.decode().strip()
            with patch.dict(os.environ, {'AGE_RECIPIENT': public, 'AGE_IDENTITY': key.read_text()}):
                encrypted = backup.age(b'private synthetic fixture')
                self.assertEqual(backup.age(encrypted, decrypt=True), b'private synthetic fixture')
                with patch.dict(os.environ, {'AGE_IDENTITY': 'invalid identity'}):
                    with self.assertRaises(ValueError): backup.age(encrypted, decrypt=True)
                damaged = bytearray(encrypted); damaged[-1] ^= 1
                with self.assertRaises(ValueError): backup.age(bytes(damaged), decrypt=True)

    def test_failed_readback_never_publishes_success_pointer(self):
        class Store:
            def __init__(self): self.keys = []
            def put_object(self, **args): self.keys.append(args['Key'])
            def get_object(self, **args): return {'Body': io.BytesIO(b'corrupt')}
        store = Store()
        with self.assertRaises(ValueError): backup.publish(store, b'ciphertext', {'createdAt':'2026-10-15T00:00:00+00:00'})
        self.assertEqual(len(store.keys), 1)
        self.assertNotIn(backup.LATEST, store.keys)

    def test_committed_readback_detects_corruption(self):
        class Store:
            def __init__(self): self.objects = {}
            def put_object(self, **args): self.objects[args['Key']] = args['Body']
            def get_object(self, **args): return {'Body': io.BytesIO(self.objects[args['Key']])}
        store = Store()
        manifest = {'formatVersion': 2, 'accountId': backup.ACCOUNT, 'databaseId': backup.DATABASE,
                    'createdAt': dt.datetime.now(dt.timezone.utc).isoformat()}
        pointer = backup.publish(store, b'ciphertext', manifest)
        self.assertEqual(backup.committed(store)[1], b'ciphertext')
        store.objects[pointer['key']] = b'corruption'
        with self.assertRaises(ValueError): backup.committed(store)

    def test_read_only_api_rejects_writes_and_partial_responses(self):
        for response in ({'success':False}, {'success':True,'result':[]},
                         {'success':True,'result':[{'success':True,'results':[], 'meta':{'changes':1}}]}):
            with patch.object(backup, 'request_json', return_value=response):
                with self.assertRaises(ValueError): backup.query('token', 'SELECT 1')
        with self.assertRaises(ValueError): backup.query('token', 'DELETE FROM people')


if __name__ == '__main__': unittest.main()
