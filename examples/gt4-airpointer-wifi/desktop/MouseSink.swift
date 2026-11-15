// SPDX-License-Identifier: AGPL-3.0-or-later
import Foundation
import CoreGraphics
import Darwin

struct Button: Codable { let id:Int; let kind:String; let age:Double }
struct Frame: Codable {
    let v:Int, t:String, session:String, seq:Int, sent:Double
    let armed:Bool, dx:Double, dy:Double, scroll:Double, buttons:[Button]
    var backend:String? = nil
}
struct Decision {
    var dx:Double=0,dy:Double=0,scroll:Double=0
    var buttons:[String]=[]
    var release=false
}
final class Gate {
    var session="",sequence=0,retired:[String]=[],seen:Set<Int>=[],seenOrder:[Int]=[]
    var lastReceived:Double?,offset:Double?,armed=false
    var watchdog:Double=0.5
    func accept(_ frame:Frame,at now:Double)->Decision? {
        guard frame.v==1,frame.t=="pointer",(1...64).contains(frame.session.utf8.count),
              frame.session.utf8.allSatisfy({($0>=48 && $0<=57) || $0==45}),
              frame.seq>0,frame.seq<9_000_000_000_000_000,frame.sent.isFinite,
              frame.dx.isFinite,frame.dy.isFinite,frame.scroll.isFinite,
              abs(frame.dx)<=100,abs(frame.dy)<=100,abs(frame.scroll)<=60,
              frame.buttons.count<=8,frame.buttons.allSatisfy({$0.id>0 && $0.id<Int.max/2 && $0.age.isFinite && $0.age>=0 && $0.age<=1000 && ["left","right","double","drag"].contains($0.kind)}) else {return nil}
        var decision=Decision()
        if frame.session != session {
            guard !retired.contains(frame.session) else {return nil}
            if !session.isEmpty {retired.append(session);if retired.count>16 {retired.removeFirst()}}
            session=frame.session;sequence=0;seen=[];seenOrder=[];offset=nil;armed=false;decision.release=true
        }
        guard frame.seq>sequence else {return nil}
        sequence=frame.seq
        let observedOffset=now-frame.sent/1000
        if let baseline=offset,observedOffset-baseline>0.25 {
            armed=false;decision.release=true;return decision
        }
        offset=min(offset ?? observedOffset,observedOffset)
        lastReceived=now
        watchdog=frame.backend=="experimental-ping" ? 1.5 : 0.5
        armed=frame.armed
        if !armed {decision.release=true;return decision}
        decision.dx=frame.dx;decision.dy=frame.dy;decision.scroll=frame.scroll
        let lag=max(0,observedOffset-(offset ?? observedOffset))*1000
        for button in frame.buttons where button.age+lag<=350 && !seen.contains(button.id) {
            seen.insert(button.id);seenOrder.append(button.id);decision.buttons.append(button.kind)
            if seenOrder.count>128 {seen.remove(seenOrder.removeFirst())}
        }
        return decision
    }
    func expired(at now:Double)->Bool {
        guard armed,let lastReceived,now-lastReceived>watchdog else {return false}
        armed=false;return true
    }
}
final class Sink {
    let enabled:Bool,quiet:Bool
    let gate=Gate()
    var dragging=false,accepted=0,rejected=0
    init(enabled:Bool,quiet:Bool=false){self.enabled=enabled;self.quiet=quiet}
    func point()->CGPoint {CGEvent(source:nil)?.location ?? .zero}
    func post(_ type:CGEventType,at position:CGPoint,button:CGMouseButton = .left,count:Int64=1) {
        guard enabled,let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:position,mouseButton:button) else {return}
        event.setIntegerValueField(.mouseEventClickState,value:count)
        event.post(tap:.cghidEventTap)
    }
    func release(){
        if dragging {post(.leftMouseUp,at:point());dragging=false}
    }
    func clamped(_ p:CGPoint)->CGPoint {
        var ids=[CGDirectDisplayID](repeating:0,count:16),count:UInt32=0
        guard CGGetActiveDisplayList(16,&ids,&count) == .success,count>0 else {return p}
        var nearest=p,best=Double.infinity
        for id in ids.prefix(Int(count)) {
            let r=CGDisplayBounds(id)
            let q=CGPoint(x:max(r.minX,min(r.maxX-1,p.x)),y:max(r.minY,min(r.maxY-1,p.y)))
            let d=pow(q.x-p.x,2)+pow(q.y-p.y,2)
            if d<best {nearest=q;best=d}
        }
        return nearest
    }
    func apply(_ d:Decision) {
        if d.release {release()}
        if d.dx != 0 || d.dy != 0 {
            let before=point(),after=clamped(CGPoint(x:before.x+d.dx,y:before.y+d.dy))
            if enabled,let event=CGEvent(mouseEventSource:nil,mouseType:dragging ? .leftMouseDragged:.mouseMoved,mouseCursorPosition:after,mouseButton:.left) {
                event.setIntegerValueField(.mouseEventDeltaX,value:Int64((after.x-before.x).rounded()))
                event.setIntegerValueField(.mouseEventDeltaY,value:Int64((after.y-before.y).rounded()))
                event.post(tap:.cghidEventTap)
            }
        }
        if enabled,d.scroll != 0 {
            CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:1,wheel1:Int32(d.scroll.rounded()),wheel2:0,wheel3:0)?.post(tap:.cghidEventTap)
        }
        for kind in d.buttons {
            if kind=="drag" {
                post(dragging ? .leftMouseUp:.leftMouseDown,at:point());dragging.toggle();continue
            }
            release()
            let right=kind=="right",count=kind=="double" ? 2:1
            for i in 1...count {
                post(right ? .rightMouseDown:.leftMouseDown,at:point(),button:right ? .right:.left,count:Int64(i))
                post(right ? .rightMouseUp:.leftMouseUp,at:point(),button:right ? .right:.left,count:Int64(i))
            }
        }
    }
    func line(_ line:String) {
        guard line.utf8.count<=4096,let data=line.data(using:.utf8),let frame=try? JSONDecoder().decode(Frame.self,from:data),
              let result=gate.accept(frame,at:ProcessInfo.processInfo.systemUptime) else {rejected+=1;return}
        accepted+=1;apply(result)
        if !quiet {
            let value:[String:Any] = ["t":"desktop","session":frame.session,"seq":frame.seq,"enabled":enabled,"armed":gate.armed,
                "dx":result.dx,"dy":result.dy,"scroll":result.scroll,"buttons":result.buttons,"dragging":dragging,"cursorX":point().x,"cursorY":point().y]
            if let bytes=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]),let text=String(data:bytes,encoding:.utf8){print(text);fflush(stdout)}
        }
    }
    func tick(){if gate.expired(at:ProcessInfo.processInfo.systemUptime){release();fputs("Input timeout: paused, drag released\n",stderr)}}
}
func frame(_ seq:Int,armed:Bool=true,dx:Double=1,buttons:[Button]=[],session:String="1-1",sent:Double?=nil)->Frame {
    Frame(v:1,t:"pointer",session:session,seq:seq,sent:sent ?? Double(seq)*50,armed:armed,dx:dx,dy:0,scroll:0,buttons:buttons)
}
func selfTest() {
    let gate=Gate(),button=Button(id:1,kind:"drag",age:0)
    assert(gate.accept(frame(1,buttons:[button]),at:0.05)?.buttons==["drag"])
    assert(gate.accept(frame(1,buttons:[button]),at:0.06)==nil)
    assert(gate.accept(frame(2,buttons:[button]),at:0.1)?.buttons.isEmpty==true)
    assert(gate.accept(frame(3,dx:Double.nan),at:0.15)==nil)
    assert(gate.accept(frame(3,dx:101),at:0.15)==nil)
    assert(gate.accept(frame(3,armed:false),at:0.15)?.release==true)
    assert(gate.accept(frame(4),at:0.2) != nil)
    assert(gate.expired(at:0.71))
    let lowRate=Gate();var beacon=frame(1);beacon.backend="experimental-ping"
    assert(lowRate.accept(beacon,at:0.05) != nil)
    assert(!lowRate.expired(at:0.8));assert(lowRate.expired(at:1.56))
    let late=gate.accept(frame(5,buttons:[Button(id:2,kind:"left",age:0)]),at:1.2)
    assert(late?.release==true && late?.buttons.isEmpty==true)
    assert(gate.accept(frame(1,session:"2-1"),at:1.3) != nil)
    assert(gate.accept(frame(6,session:"1-1"),at:1.4)==nil)
    assert(gate.accept(frame(2,buttons:[Button(id:3,kind:"left",age:600)],session:"2-1"),at:1.35)?.buttons.isEmpty==true)
    let sink=Sink(enabled:false,quiet:true)
    sink.apply(Decision(buttons:["drag"]));assert(sink.dragging)
    sink.apply(Decision(release:true));assert(!sink.dragging)
    print("Desktop self-test passed: validation, replay, stale input, button deduplication and drag release")
}
let args=Set(CommandLine.arguments.dropFirst())
if args.contains("--permission-status"){print(CGPreflightPostEventAccess() ? "allowed":"not-allowed");exit(0)}
if args.contains("--self-test"){selfTest();exit(0)}
if args.contains("--request-access"){print(CGRequestPostEventAccess() ? "Accessibility allowed":"Allow this receiver/terminal in System Settings > Privacy & Security > Accessibility, then rerun.");exit(0)}
if !args.isSubset(of:["--enable","--dry-run"]){fputs("Usage: GT4AirPointerSink [--dry-run|--enable|--self-test|--request-access]\n",stderr);exit(64)}
let enabled=args.contains("--enable")
if enabled && !CGPreflightPostEventAccess(){fputs("Accessibility permission required. Run --request-access and allow the receiver/terminal in System Settings. No mouse events posted.\n",stderr);exit(77)}
let sink=Sink(enabled:enabled)
signal(SIGINT,SIG_IGN);signal(SIGTERM,SIG_IGN)
let intSource=DispatchSource.makeSignalSource(signal:SIGINT,queue:.main)
let termSource=DispatchSource.makeSignalSource(signal:SIGTERM,queue:.main)
for source in [intSource,termSource]{source.setEventHandler{sink.release();exit(0)};source.resume()}
let watchdog=DispatchSource.makeTimerSource(queue:.main)
watchdog.schedule(deadline:.now()+0.1,repeating:0.1);watchdog.setEventHandler{sink.tick()};watchdog.resume()
DispatchQueue.global(qos:.userInteractive).async {
    while let line=readLine(){DispatchQueue.main.sync{sink.line(line)}}
    DispatchQueue.main.async{sink.release();exit(0)}
}
RunLoop.main.run()
