#!/usr/bin/python3
import json
import os
import socket
import sys

# SSH owns stdout; never print errors or accept host-key / OTP prompts.
try:
    if len(sys.argv) != 2 or 'password' not in sys.argv[1].lower():
        sys.exit(1)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(15)
        client.connect(os.environ['RCM_ASKPASS_SOCKET'])
        data = b''
        while len(data) <= 16384:
            part = client.recv(4096)
            if not part:
                break
            data += part
        password = json.loads(data)['password']
        sys.stdout.write(password + '\n')
except Exception:
    sys.exit(1)
