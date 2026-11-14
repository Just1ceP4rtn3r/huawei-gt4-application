import json
import pathlib
import sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'relay'))
from watch_logs import WatchLogs

result={'v':1,'t':'watchlog','events':[[1,42,'sendMsg.fail',['undefined',987]]]}
text=json.dumps(result,separators=(',',':'))
chunks=[text[i:i+48] for i in range(0,len(text),48)]
parts=[{'session':'1234abcd','part':i+1,'total':len(chunks),'text':p} for i,p in enumerate(chunks)]
logs=WatchLogs()
assert logs.receive(parts[0]) is None
assert logs.receive(parts[0]) is None
assert logs.receive(parts[1])==result
assert logs.receive(parts[1]) is None
for invalid in [dict(parts[0],total=21),dict(parts[0],text='x'*49),dict(parts[0],text='\n'),dict(parts[0],part=0)]:
    try:WatchLogs().receive(invalid)
    except ValueError:pass
    else:raise AssertionError('Unbounded or malformed diagnostic accepted')
print('Watch diagnostic reassembly passed: complete-only records, duplicate suppression, strict size/count/ASCII bounds')
