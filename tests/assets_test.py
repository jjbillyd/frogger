"""Check exported skinning, mesh budgets, finite vertices and animation channels."""
import json, struct, math
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
for name, bones, budget in [('frog',13,18000),('crocodile',11,24000),('log',1,4000),('car',0,10000),('truck',0,16000)]:
    data=(ROOT/'Assets/models'/f'{name}.glb').read_bytes()
    assert data[:4]==b'glTF'
    assert struct.unpack_from('<I',data,8)[0]==len(data)
    length=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+length]);binary=data[28+length:]
    def read(idx):
        a=doc['accessors'][idx];view=doc['bufferViews'][a['bufferView']]
        dims={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        fmt,size={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}[a['componentType']]
        start=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',size*dims)
        return [struct.unpack_from('<'+fmt*dims,binary,start+i*stride) for i in range(a['count'])]
    assert len(doc['meshes'])==1, 'Export contains unrelated scene geometry'
    triangles=0
    for mesh in doc['meshes']:
        for p in mesh['primitives']:
            triangles+=doc['accessors'][p['indices']]['count']//3
            assert all(math.isfinite(v) for row in read(p['attributes']['POSITION']) for v in row)
            if bones:
                attrs=p['attributes'];assert 'JOINTS_0'in attrs and 'WEIGHTS_0'in attrs
                assert all(abs(sum(w)-1)<1e-4 for w in read(attrs['WEIGHTS_0']))
                assert all(0<=v<bones for row in read(attrs['JOINTS_0']) for v in row)
    assert triangles<=budget,(name,triangles,budget)
    if bones:
        assert len(doc['skins'])==1 and len(doc['skins'][0]['joints'])==bones
        assert len(doc['animations'])==1
        assert any(len(set(read(s['output'])))>1 for s in doc['animations'][0]['samplers']), 'Animation is static'
    print(f'{name}: {triangles:,} triangles, {bones} bones, {len(data):,} bytes — OK')
