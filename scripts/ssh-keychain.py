#!/usr/bin/python3
"""Single credential operation via stdin. No secrets in argv or files."""
import ctypes as C
import json
import sys


def main():
    value = json.load(sys.stdin)
    security = C.CDLL('/System/Library/Frameworks/Security.framework/Security')
    core = C.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    security.SecKeychainSetUserInteractionAllowed.argtypes = [C.c_bool]
    security.SecKeychainSetUserInteractionAllowed(False)
    find = security.SecKeychainFindGenericPassword
    find.argtypes = [C.c_void_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.POINTER(C.c_uint32), C.POINTER(C.c_void_p), C.POINTER(C.c_void_p)]
    add = security.SecKeychainAddGenericPassword
    add.argtypes = [C.c_void_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.c_uint32, C.c_char_p, C.POINTER(C.c_void_p)]
    security.SecKeychainItemFreeContent.argtypes = [C.c_void_p, C.c_void_p]
    security.SecKeychainItemDelete.argtypes = [C.c_void_p]
    core.CFRelease.argtypes = [C.c_void_p]
    service = b'CodexPortal.SSH'
    account = value['reference'].encode('ascii')
    operation = value['operation']
    item, data, length = C.c_void_p(), C.c_void_p(), C.c_uint32()
    if operation == 'save':
        password = value['password'].encode('utf-8')
        status = add(None, len(service), service, len(account), account, len(password), password, C.byref(item))
        if item.value:
            core.CFRelease(item)
        if status:
            raise RuntimeError(str(status))
        return {'ok': True}
    status = find(None, len(service), service, len(account), account, C.byref(length), C.byref(data), C.byref(item))
    if status == -25300 and operation == 'delete':
        return {'ok': True}
    if status:
        raise RuntimeError(str(status))
    try:
        if operation == 'read':
            return {'password': C.string_at(data, length.value).decode('utf-8')}
        if operation != 'delete':
            raise RuntimeError('operation')
        status = security.SecKeychainItemDelete(item)
        if status:
            raise RuntimeError(str(status))
        return {'ok': True}
    finally:
        security.SecKeychainItemFreeContent(None, data)
        core.CFRelease(item)


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception:
        print('{"error":"KEYCHAIN_UNAVAILABLE"}')
        sys.exit(1)
