"""Create vector map cards from CS2 depot screenshots; preserve downloaded backgrounds."""
from pathlib import Path
from urllib.request import urlopen
import json,base64,hashlib,concurrent.futures
root=Path(__file__).resolve().parents[1];out=root/'dist/assets/maps';out.mkdir(parents=True,exist_ok=True)
maps=['dust2','mirage','inferno','nuke','ancient','anubis','overpass','train','vertigo','cache']
def build(key):
 url=f'https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/thumbs/de_{key}_1_png.png'
 data=urlopen(url,timeout=45).read();(out/f'{key}.png').write_bytes(data)
 name='DUST II' if key=='dust2' else key.upper()
 svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#050c18" stop-opacity=".12"/><stop offset="1" stop-color="#050c18" stop-opacity=".94"/></linearGradient></defs><image href="data:image/png;base64,{base64.b64encode(data).decode()}" width="640" height="320" preserveAspectRatio="xMidYMid slice"/><rect width="640" height="320" fill="url(#shade)"/><path d="M34 270H86" stroke="#d8ecff" stroke-width="5"/><text x="32" y="243" font-family="Arial,sans-serif" font-weight="900" font-size="68" fill="white" letter-spacing="3">{name}</text></svg>'''
 (out/f'{key}.svg').write_text(svg)
 return {'map':key,'source':url,'sha256':hashlib.sha256(data).hexdigest(),'rights':'Valve Corporation; CS2 game depot asset. Vector layout created for ScoreDeck.'}
with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: records=list(pool.map(build,maps))
(out/'sources.json').write_text(json.dumps(records,indent=2)+'\n')
print(f'Built {len(records)} map cards')
