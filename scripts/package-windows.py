"""Overlay current ScoreDeck sources and native Replay onto an existing portable."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--base', type=pathlib.Path, required=True)
args = parser.parse_args()
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
name = f'ScoreDeck-CS-{version}-Windows-x64-Portable'
target = root / 'release' / f'{name}.zip'
assert args.base.resolve() != target.resolve()
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=root).decode().split('\0')
updates = {'resources/app/' + p: (root / p).read_bytes() for p in set(files) if p and (root / p).is_file()}
for rel in ['modules/replay/ProjectReplay.exe', 'modules/replay/replay-source.exe']:
    updates['resources/app/' + rel] = (root / rel).read_bytes()
for rel in ['README.md', f'README-{version}.md', f'VERIFICATION-{version}.md', 'VERSION.txt']:
    updates[rel] = (root / rel).read_bytes()
updates['START-HERE.txt'] = (f'ScoreDeck CS {version}\n完整解压后运行 ScoreDeck CS.exe。\n'
    'Replay 已升级为 0.2.6，Linux 录制端请同步升级；中继协议不变。\n'
    'RadarHUD 新增清除缓存，缓存最多保存两小时。\n'
    '升级前保留旧目录中的 ScoreDeck CS Portable Data。\n').encode('utf-8')
hashes = {}
with zipfile.ZipFile(args.base) as src, zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as dst:
    prefix = src.namelist()[0].split('/')[0] + '/'
    def write(rel, data):
        assert rel not in hashes, rel
        dst.writestr(name + '/' + rel, data)
        hashes[rel] = hashlib.sha256(data).hexdigest()
    for entry in src.infolist():
        rel = entry.filename[len(prefix):]
        if entry.is_dir() or rel in updates or rel == 'PACKAGE-SHA256.json' or rel.startswith('BUILD-MANIFEST') or '/verification/' in rel:
            continue
        assert not any(x in rel for x in ['Portable Data/', 'Portable Cache/', 'control-key.txt']), rel
        write(rel, src.read(entry))
    for rel, data in sorted(updates.items()):
        write(rel, data)
    manifest = {'version': version, 'basePortable': args.base.name,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'sourceIncludesWorkingTreeChanges': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip()),
        'replay': json.loads((root / 'modules/replay/UPSTREAM.json').read_text()),
        'replayExeSha256': hashes['resources/app/modules/replay/ProjectReplay.exe'], 'files': len(hashes)}
    write(f'BUILD-MANIFEST-{version}.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())
    dst.writestr(name + '/PACKAGE-SHA256.json', json.dumps(hashes, indent=2))
with zipfile.ZipFile(target) as check:
    assert check.testzip() is None
    for rel, digest in hashes.items():
        assert hashlib.sha256(check.read(name + '/' + rel)).hexdigest() == digest, rel
with target.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
target.with_suffix('.sha256.txt').write_text(digest + '  ' + target.name + '\n', encoding='utf-8')
print(json.dumps({'file': str(target), 'bytes': target.stat().st_size, 'sha256': digest, 'verifiedFiles': len(hashes)}))
