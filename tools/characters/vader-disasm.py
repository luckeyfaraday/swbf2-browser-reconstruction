"""Disassemble a retained DXBC resource with the system d3dcompiler_47 (no execution).
Usage: python vader-disasm.py INPUT.res OUTPUT.asm"""
import ctypes,sys,pathlib,struct
lib=ctypes.WinDLL('C:/Windows/System32/d3dcompiler_47.dll');fn=lib.D3DDisassemble
fn.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_uint,ctypes.c_char_p,ctypes.POINTER(ctypes.c_void_p)];fn.restype=ctypes.c_long
data=pathlib.Path(sys.argv[1]).read_bytes();start=data.index(b'DXBC');data=data[start:start+struct.unpack_from('<I',data,start+24)[0]]
blob=ctypes.c_void_p();buf=ctypes.create_string_buffer(data,len(data))
hr=fn(buf,len(data),0,None,ctypes.byref(blob))
if hr<0:raise SystemExit('D3DDisassemble HRESULT '+hex(hr&0xffffffff))
vt=ctypes.cast(ctypes.cast(blob,ctypes.POINTER(ctypes.c_void_p))[0],ctypes.POINTER(ctypes.c_void_p))
ptr=ctypes.WINFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p)(vt[3])(blob);size=ctypes.WINFUNCTYPE(ctypes.c_size_t,ctypes.c_void_p)(vt[4])(blob)
text=ctypes.string_at(ptr,size).decode('utf-8','replace');pathlib.Path(sys.argv[2]).write_text(text);print(len(text.splitlines()),'lines')
