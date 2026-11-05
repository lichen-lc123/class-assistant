"""Read the small supplied BIFF8 files without installing an XLS library.
Read-only; rejects unsupported continuation records rather than guessing values.
"""
import json
import struct
from pathlib import Path

def u16(b,o=0): return struct.unpack_from('<H',b,o)[0]
def u32(b,o=0): return struct.unpack_from('<I',b,o)[0]

def stream(path):
    b=Path(path).read_bytes()
    assert b[:8]==bytes.fromhex('D0CF11E0A1B11AE1')
    size=1<<u16(b,30); mini_size=1<<u16(b,32)
    def sector(n): return b[(n+1)*size:(n+2)*size]
    fat=[]
    for n in struct.unpack_from('<109I',b,76):
        if n<0xFFFFFFFA: fat.extend(struct.unpack('<'+'I'*(size//4),sector(n)))
    def chain(n, table):
        result=[]; seen=set()
        while n<0xFFFFFFFA:
            assert n not in seen and n<len(table)
            result.append(n); seen.add(n); n=table[n]
        return result
    directory=b''.join(sector(n) for n in chain(u32(b,48),fat))
    entries=[]
    for o in range(0,len(directory),128):
        e=directory[o:o+128]; length=u16(e,64)
        if length>=2:
            entries.append((e[:length-2].decode('utf-16le'),e[66],u32(e,116),struct.unpack_from('<Q',e,120)[0]))
    root=next(e for e in entries if e[1]==5)
    book=next(e for e in entries if e[0] in ('Workbook','Book'))
    if book[3]>=u32(b,56): return b''.join(sector(n) for n in chain(book[2],fat))[:book[3]]
    minis=b''.join(sector(n) for n in chain(root[2],fat))[:root[3]]
    minifat_bytes=b''.join(sector(n) for n in chain(u32(b,60),fat))
    minifat=list(struct.unpack('<'+'I'*(len(minifat_bytes)//4),minifat_bytes))
    return b''.join(minis[n*mini_size:(n+1)*mini_size] for n in chain(book[2],minifat))[:book[3]]

def records(b):
    offset=0
    while offset+4<=len(b):
        code,length=struct.unpack_from('<HH',b,offset)
        if code==0 and length==0: break
        yield offset,code,b[offset+4:offset+4+length]
        offset+=4+length

def unicode_string(b,offset,small=False):
    count=b[offset] if small else u16(b,offset)
    offset+=1 if small else 2
    flags=b[offset]; offset+=1
    rich=u16(b,offset) if flags&8 else 0
    if flags&8: offset+=2
    ext=u32(b,offset) if flags&4 else 0
    if flags&4: offset+=4
    width=2 if flags&1 else 1
    end=offset+count*width
    assert end<=len(b), 'Unsupported split string'
    text=b[offset:end].decode('utf-16le' if width==2 else 'latin1')
    return text,end+rich*4+ext

def inspect(path):
    book=stream(path); recs=list(records(book)); strings=[]; sheets=[]
    for offset,code,data in recs:
        if code==0x00FC:
            total=u32(data,4); pos=8
            for _ in range(total):
                text,pos=unicode_string(data,pos); strings.append(text)
        elif code==0x0085:
            title,_=unicode_string(data,6,True)
            sheets.append({'name':title,'offset':u32(data),'cells':[]})
    for sheet in sheets:
        for offset,code,data in recs:
            if offset<sheet['offset']: continue
            if code==0x000A: break
            if code==0x00FD:
                row,col=struct.unpack_from('<HH',data); value=strings[u32(data,6)]
            elif code==0x0203:
                row,col=struct.unpack_from('<HH',data); value=struct.unpack_from('<d',data,6)[0]
            elif code==0x027E:
                row,col=struct.unpack_from('<HH',data); rk=u32(data,6)
                value=(struct.unpack('<i',struct.pack('<I',rk))[0]>>2) if rk&2 else struct.unpack('<d',b'\0\0\0\0'+struct.pack('<I',rk&~3))[0]
                if rk&1: value/=100
            elif code==0x0204:
                row,col=struct.unpack_from('<HH',data); value,_=unicode_string(data,6)
            else: continue
            if value!='': sheet['cells'].append({'row':row+1,'col':col+1,'value':value})
    return {'path':str(path),'sheets':sheets}

if __name__=='__main__':
    import sys
    for path in sys.argv[1:]: print(json.dumps(inspect(path),ensure_ascii=False))
