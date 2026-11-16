#!/usr/bin/env python3
"""Computer-only, bounded recovery using the same manager bootstrap as runtime."""
import os
import importlib.util
import json
import pathlib
import queue
import subprocess
import time
import frida
root=pathlib.Path(__file__).resolve().parents[1]
path=root/'examples/gt4-rawfile-test/relay/manager.py'
spec=importlib.util.spec_from_file_location('gt4_manager_bootstrap',path)
manager=importlib.util.module_from_spec(spec);spec.loader.exec_module(manager)
subprocess.run(['bash',str(root/'scripts/ssh.sh'),'HISTFILE=/dev/null; export HISTFILE; uiopen --bundleid local.gt4bridge.crescent'],check=True,timeout=12)
class Events:
    def put_nowait(self,value):
        event=value.get('payload',{})
        if event.get('kind')=='phone-bootstrap':print(json.dumps(event.get('payload')),flush=True)
device=frida.get_device(os.environ['GT4_FRIDA_DEVICE_ID'],timeout=5) if os.environ.get('GT4_FRIDA_DEVICE_ID') else frida.get_device_manager().add_remote_device('127.0.0.1:27043')
session=manager.attach_phone(device,Events(),time.monotonic()+115)
session.detach()
print(json.dumps({'ready':True,'phase':'paired'}),flush=True)
