"""Read-only D1 capture, encrypted R2 backups and isolated recovery verification."""
import argparse
import datetime as dt
import hashlib
import gzip
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import uuid

import snapshot

ACCOUNT = '2557b5c2e166292ded0f8425b73075e9'
DATABASE = 'dcde8dbd-d827-4405-85b4-97bc2accc906'
BUCKET = 'lvbt-member-backups'
LATEST = 'production/latest.json'
MAX_BYTES = 100 * 1024 * 1024


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise ValueError('Required backup configuration is missing: ' + name)
    return value


def request_json(token, sql):
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DATABASE}/query',
        data=json.dumps({'sql': sql, 'params': []}).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Snapshot API response exceeds capacity; review backup design')
    return json.loads(raw)


def query(token, sql):
    if not sql.lstrip().upper().startswith('SELECT '):
        raise ValueError('Only read-only snapshot queries are permitted')
    response = request_json(token, sql)
    results = response.get('result', [])
    if response.get('success') is not True or len(results) != 1:
        raise ValueError('D1 did not return one complete successful snapshot query')
    result = results[0]; meta = result.get('meta', {})
    if result.get('success') is not True or any(meta.get(k, 0) for k in ('changes', 'rows_written', 'changed_db')):
        raise ValueError('D1 snapshot query failed or unexpectedly changed data')
    return result['results']


def capture(token):
    inventory_rows = query(token, snapshot.INVENTORY_SQL)
    if len(inventory_rows) != 1:
        raise ValueError('Incomplete database inventory')
    inventory = json.loads(inventory_rows[0]['inventory'])
    result = query(token, snapshot.snapshot_query(inventory))
    if len(result) != 1:
        raise ValueError('Incomplete database snapshot')
    captured = json.loads(result[0]['snapshot'])
    return snapshot.complete(captured, inventory)


def pack(captured, manifest):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, value in (('snapshot.json', captured), ('manifest.json', manifest)):
            data = json.dumps(value, ensure_ascii=True, separators=(',', ':')).encode()
            item = tarfile.TarInfo(name); item.size = len(data); item.mode = 0o600
            archive.addfile(item, io.BytesIO(data))
    return output.getvalue()


def unpack_restore(plaintext, destination):
    if len(plaintext) > MAX_BYTES:
        raise ValueError('Backup archive exceeds recovery capacity')
    with gzip.GzipFile(fileobj=io.BytesIO(plaintext)) as compressed:
        unpacked = compressed.read(MAX_BYTES + 65537)
    if len(unpacked) > MAX_BYTES + 65536:
        raise ValueError('Expanded backup exceeds recovery capacity')
    with tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:') as archive:
        members = archive.getmembers()
        if len(members) != 2 or {m.name for m in members} != {'snapshot.json', 'manifest.json'}:
            raise ValueError('Unexpected archive contents')
        if any(not m.isfile() or m.size > MAX_BYTES for m in members):
            raise ValueError('Unsafe archive member')
        manifest = json.load(archive.extractfile('manifest.json'))
        if (manifest.get('formatVersion'), manifest.get('accountId'), manifest.get('databaseId')) != (2, ACCOUNT, DATABASE):
            raise ValueError('Backup belongs to a different source or format')
        captured = json.load(archive.extractfile('snapshot.json'))
    return snapshot.restore(captured, destination)


def age(data, decrypt=False):
    if decrypt:
        identity = required('AGE_IDENTITY')
        with tempfile.TemporaryDirectory(prefix='lvbt-recovery-key-') as directory:
            path = pathlib.Path(directory) / 'identity'; path.write_text(identity + '\n'); path.chmod(0o600)
            result = subprocess.run(['age', '--decrypt', '-i', str(path)], input=data, capture_output=True)
    else:
        result = subprocess.run(['age', '--encrypt', '-r', required('AGE_RECIPIENT')], input=data, capture_output=True)
    if result.returncode != 0:
        raise ValueError('Backup encryption or authenticated decryption failed')
    return result.stdout


def store():
    import boto3
    from botocore.config import Config
    return boto3.client('s3', endpoint_url=f'https://{ACCOUNT}.r2.cloudflarestorage.com',
                       aws_access_key_id=required('R2_ACCESS_KEY_ID'),
                       aws_secret_access_key=required('R2_SECRET_ACCESS_KEY'), region_name='auto',
                       config=Config(retries={'max_attempts': 4, 'mode': 'standard'},
                                     connect_timeout=20, read_timeout=120))


def get(client, key, maximum=MAX_BYTES):
    response = client.get_object(Bucket=BUCKET, Key=key)
    body = response['Body']
    try:
        data = body.read(maximum + 1)
    finally:
        body.close()
    if len(data) > maximum:
        raise ValueError('Stored backup exceeds recovery capacity')
    return data


def publish(client, ciphertext, manifest):
    created = dt.datetime.fromisoformat(manifest['createdAt'])
    key = 'production/' + created.strftime('%Y/%m/%d/%H%M%S-') + str(uuid.uuid4()) + '.tar.gz.age'
    checksum = hashlib.sha256(ciphertext).hexdigest()
    client.put_object(Bucket=BUCKET, Key=key, Body=ciphertext, ContentType='application/octet-stream')
    if hashlib.sha256(get(client, key)).hexdigest() != checksum:
        raise ValueError('R2 ciphertext readback differs; backup was not committed')
    pointer = manifest | {'key': key, 'sha256': checksum, 'bytes': len(ciphertext)}
    # Per-backup receipt allows selecting an older retained backup without guessing.
    receipt = json.dumps(pointer, separators=(',', ':')).encode()
    client.put_object(Bucket=BUCKET, Key=key + '.json', Body=receipt, ContentType='application/json')
    client.put_object(Bucket=BUCKET, Key=LATEST, Body=receipt, ContentType='application/json')
    if get(client, LATEST, 8192) != receipt:
        raise ValueError('R2 success pointer readback differs')
    return pointer


def validate_pointer(pointer, now=None, max_hours=26):
    now = now or dt.datetime.now(dt.timezone.utc)
    if (pointer.get('formatVersion'), pointer.get('accountId'), pointer.get('databaseId')) != (2, ACCOUNT, DATABASE):
        raise ValueError('Backup receipt belongs to a different source or format')
    created = dt.datetime.fromisoformat(pointer['createdAt'])
    age_seconds = (now - created).total_seconds()
    if age_seconds < -300 or age_seconds > max_hours * 3600:
        raise ValueError('Latest committed backup is overdue or has a future timestamp')
    if not re.fullmatch(r'production/[A-Za-z0-9/_.-]+\.age', pointer.get('key', '')) or '..' in pointer['key']:
        raise ValueError('Invalid backup object key')
    if not re.fullmatch(r'[a-f0-9]{64}', pointer.get('sha256', '')):
        raise ValueError('Invalid ciphertext checksum')
    if not isinstance(pointer.get('bytes'), int) or not 0 < pointer['bytes'] <= MAX_BYTES:
        raise ValueError('Invalid backup size')


def committed(client, receipt=LATEST, max_hours=26):
    if receipt != LATEST and (not receipt.startswith('production/') or '..' in receipt or not receipt.endswith('.age.json')):
        raise ValueError('Invalid retained backup receipt')
    pointer = json.loads(get(client, receipt, 8192)); validate_pointer(pointer, max_hours=max_hours)
    ciphertext = get(client, pointer['key'])
    if len(ciphertext) != pointer['bytes'] or hashlib.sha256(ciphertext).hexdigest() != pointer['sha256']:
        raise ValueError('Stored ciphertext size or checksum differs from committed backup')
    return pointer, ciphertext


def run(mode, receipt=LATEST):
    os.umask(0o077)
    client = store()
    if mode == 'backup':
        captured = capture(required('D1_READ_TOKEN'))
        created = dt.datetime.now(dt.timezone.utc).isoformat()
        manifest = {'formatVersion': 2, 'accountId': ACCOUNT, 'databaseId': DATABASE, 'createdAt': created}
        with tempfile.TemporaryDirectory(prefix='lvbt-backup-check-') as directory:
            result = snapshot.restore(captured, pathlib.Path(directory) / 'fresh.sqlite')
        pointer = publish(client, age(pack(captured, manifest)), manifest)
        return {'operation': mode, 'createdAt': created, 'encryptedBytes': pointer['bytes'], **result}
    pointer, ciphertext = committed(client, receipt, max_hours=26 if receipt == LATEST else 30*24)
    if mode == 'check':
        return {'operation': mode, 'createdAt': pointer['createdAt'], 'ciphertextVerified': True}
    with tempfile.TemporaryDirectory(prefix='lvbt-isolated-restore-') as directory:
        result = unpack_restore(age(ciphertext, decrypt=True), pathlib.Path(directory) / 'fresh.sqlite')
    return {'operation': mode, 'createdAt': pointer['createdAt'], **result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('backup', 'restore-test', 'check'))
    parser.add_argument('--receipt', default=LATEST, help='Retained .age.json receipt; restore-test only')
    args = parser.parse_args()
    if args.receipt != LATEST and args.mode != 'restore-test':
        parser.error('Only restore tests can select an older receipt')
    try:
        print(json.dumps(run(args.mode, args.receipt), sort_keys=True))
    except Exception as error:
        # Provider exceptions can contain raw SQL or data. Never print them in public CI.
        print('Member backup operation failed (' + type(error).__name__ + '). Check configuration, capacity and provider access; see the recovery guide.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
