import sys,zipfile,struct,hashlib,json
from pathlib import Path
def check_pe(data,name):
    assert data[:2]==b'MZ', name
    pe=struct.unpack_from('<I',data,60)[0]
    assert data[pe:pe+4]==b'PE\0\0',name
    machine,count=struct.unpack_from('<HH',data,pe+4)
    opt=struct.unpack_from('<H',data,pe+20)[0]
    for i in range(count):
        pos=pe+24+opt+40*i
        size,offset=struct.unpack_from('<II',data,pos+16)
        assert not size or offset+size<=len(data), 'Truncated PE: '+name
    return machine
if __name__=='__main__':
    with zipfile.ZipFile(sys.argv[1]) as z:
        assert z.testzip() is None
        mf=next(n for n in z.namelist() if n.endswith('/PACKAGE-SHA256.json'))
        prefix=mf[:-len('PACKAGE-SHA256.json')]
        hashes=json.loads(z.read(mf)); count=0
        for rel,expected in hashes.items():
            data=z.read(prefix+rel)
            assert hashlib.sha256(data).hexdigest()==expected,rel
            if rel.lower().endswith(('.exe','.dll')):
                check_pe(data,rel);count+=1
        exe=z.read(prefix+'ScoreDeck CS.exe')
        assert len(exe)==205635584
        assert hashlib.sha256(exe).hexdigest()=='a1296966d5fb832080e277601aa90dba1dc7f3e7ef66e5cfc5d8762022491386'
        assert check_pe(exe,'main')==0x8664
        print('PASS: ZIP CRC,',len(hashes),'file hashes,',count,'PE files, official main EXE')
