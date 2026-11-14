"""Bounded reassembly of experimental watch diagnostic ping fragments, on Mac only."""
import json
import re

class WatchLogs:
    def __init__(self):
        self.session=None
        self.total=0
        self.parts={}
        self.completed=set()

    def receive(self,part):
        token=part.get('session','')
        index=part.get('part')
        total=part.get('total')
        text=part.get('text')
        if not isinstance(token,str) or not re.fullmatch('[0-9a-f]{8}',token):raise ValueError('Invalid log session')
        if type(index) is not int or type(total) is not int or not 1<=index<=total<=20:raise ValueError('Invalid log part')
        if not isinstance(text,str) or not 1<=len(text)<=48 or any(ord(c)<32 or ord(c)>126 for c in text):raise ValueError('Invalid log text')
        if token in self.completed:return None
        if token!=self.session:
            if index!=1:raise ValueError('Log stream must start at part one')
            self.session=token;self.total=total;self.parts={}
        if total!=self.total:raise ValueError('Changed log part count')
        if index in self.parts and self.parts[index]!=text:raise ValueError('Changed log fragment')
        self.parts[index]=text
        if len(self.parts)!=total:return None
        result=json.loads(''.join(self.parts[i] for i in range(1,total+1)))
        if not isinstance(result,dict) or result.get('v')!=1 or result.get('t')!='watchlog':raise ValueError('Invalid watch log')
        events=result.get('events')
        if not isinstance(events,list) or len(events)>24:raise ValueError('Invalid log events')
        for row in events:
            if not isinstance(row,list) or len(row)!=4 or type(row[0]) is not int or type(row[1]) is not int or not isinstance(row[2],str) or len(row[2])>40 or not isinstance(row[3],list) or len(row[3])>3:raise ValueError('Invalid log record')
        self.completed.add(token)
        if len(self.completed)>8:self.completed={token}
        self.parts={}
        return result
