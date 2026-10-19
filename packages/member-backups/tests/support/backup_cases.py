import contextlib
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
import urllib.error
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).parents[2] / 'src'))
import backup
import snapshot


class BackupTests(unittest.TestCase):
    def http_failure_log(self, status, payload):
        body = io.BytesIO(payload if isinstance(payload, bytes) else json.dumps(payload).encode())
        error = urllib.error.HTTPError('https://invalid.example/private@example.invalid', status,
                                       'SELECT secret FROM people; secret-token', {}, body)
        output = io.StringIO()
        with patch.object(backup.urllib.request, 'urlopen', side_effect=error), \
             patch.object(backup, 'run', side_effect=lambda *_: backup.request_json('secret-token', 'SELECT secret FROM people')), \
             patch.object(sys, 'argv', ['backup.py', 'backup']), contextlib.redirect_stderr(output):
            self.assertEqual(backup.main(), 1)
        logged = output.getvalue()
        self.assertTrue(logged.startswith('{'), logged)
        return json.loads(logged), logged

    def test_d1_quota_diagnostic_requires_recognized_message(self):
        quota = "Your account has exceeded D1's free tier daily row read limit. SELECT secret FROM people; private@example.invalid"
        diagnostic, logged = self.http_failure_log(400, {'errors': [{'code': 7500, 'message': quota}]})
        self.assertEqual(diagnostic, {'event': 'member_backup_d1_http_error', 'http_status': 400,
                                     'category': 'database_daily_quota', 'cloudflare_error_codes': [7500]})
        for private in ('SELECT', 'private@example.invalid', 'secret-token', quota):
            self.assertNotIn(private, logged)
        diagnostic, _ = self.http_failure_log(400, {'errors': [{'code': 7500, 'message': 'Unrelated provider failure'}]})
        self.assertEqual(diagnostic['category'], 'provider_http_error')
        self.assertEqual(diagnostic['cloudflare_error_codes'], [7500])

    def test_d1_auth_diagnostic_uses_status_without_exposing_body(self):
        for status in (401, 403):
            diagnostic, logged = self.http_failure_log(status, {'errors': [{'code': 10000,
                'message': 'Authorization failed for private@example.invalid; token=secret-token; SELECT * FROM people'}]})
            self.assertEqual(diagnostic['category'], 'provider_authorization')
            self.assertEqual(diagnostic['http_status'], status)
            self.assertEqual(diagnostic['cloudflare_error_codes'], [10000])
            for private in ('private@example.invalid', 'secret-token', 'SELECT', 'Authorization failed'):
                self.assertNotIn(private, logged)

    def test_d1_invalid_json_and_unexpected_shapes_remain_safe(self):
        for payload in (b'not json: SELECT private@example.invalid secret-token', b'[]', b'null',
                        b'{"errors": "private@example.invalid"}', b'\xff'):
            diagnostic, logged = self.http_failure_log(502, payload)
            self.assertEqual(diagnostic['category'], 'provider_http_error')
            self.assertEqual(diagnostic['http_status'], 502)
            self.assertEqual(diagnostic['cloudflare_error_codes'], [])
            for private in ('private@example.invalid', 'secret-token', 'SELECT'):
                self.assertNotIn(private, logged)

    def test_d1_codes_are_bounded_numbers_and_response_read_is_capped(self):
        entries = [{'code': code, 'message': 'private@example.invalid'}
                   for code in (True, '7500', -1, 1.5, 2**40, *range(1000, 1020))]
        diagnostic, logged = self.http_failure_log(400, {'errors': entries})
        self.assertEqual(diagnostic['cloudflare_error_codes'], list(range(1000, 1008)))
        self.assertNotIn('private@example.invalid', logged)
        class Body(io.BytesIO):
            def __init__(self):
                super().__init__(b'x' * 100_000)
                self.requested = []
            def read(self, size=-1):
                self.requested.append(size)
                return super().read(size)
        body = Body()
        error = urllib.error.HTTPError('https://invalid.example', 500, 'private reason', {}, body)
        with patch.object(backup.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(backup.D1HttpError) as caught:
                backup.request_json('secret-token', 'SELECT secret FROM people')
        self.assertEqual(body.requested, [backup.MAX_ERROR_BYTES])
        self.assertLessEqual(backup.MAX_ERROR_BYTES, 8192)
        self.assertTrue(body.closed)
        self.assertEqual(caught.exception.diagnostic['category'], 'provider_http_error')

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
