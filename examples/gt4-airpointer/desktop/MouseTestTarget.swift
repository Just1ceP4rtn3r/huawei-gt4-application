// Local acceptance surface. Logs only mouse events received by this test window.
import AppKit
import CoreGraphics
func report(_ value:[String:Any]) {
    if let data=try? JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]),let text=String(data:data,encoding:.utf8){print(text);fflush(stdout)}
}
final class Target:NSView {
    override func draw(_ rect:NSRect) {
        NSColor(calibratedWhite:0.12,alpha:1).setFill();rect.fill()
        ("GT4 Mouse Test\nMove / Left / Right / Drag / Scroll" as NSString).draw(in:NSRect(x:30,y:100,width:450,height:100),withAttributes:[.font:NSFont.systemFont(ofSize:24),.foregroundColor:NSColor.white])
    }
    override func mouseDown(with e:NSEvent){report(["event":"leftDown","clicks":e.clickCount])}
    override func mouseUp(with e:NSEvent){report(["event":"leftUp"])}
    override func rightMouseDown(with e:NSEvent){report(["event":"rightDown"])}
    override func rightMouseUp(with e:NSEvent){report(["event":"rightUp"])}
    override func mouseDragged(with e:NSEvent){report(["event":"drag","dx":e.deltaX,"dy":e.deltaY])}
    override func scrollWheel(with e:NSEvent){report(["event":"scroll","dy":e.scrollingDeltaY])}
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let window=NSWindow(contentRect:NSRect(x:120,y:160,width:520,height:280),styleMask:[.titled,.closable],backing:.buffered,defer:false)
window.title="GT4 Mouse Test";window.contentView=Target(frame:NSRect(x:0,y:0,width:520,height:280))
window.makeKeyAndOrderFront(nil);app.activate(ignoringOtherApps:true)
DispatchQueue.main.asyncAfter(deadline:.now()+0.5){
    let f=window.frame, main=CGDisplayBounds(CGMainDisplayID())
    let point=CGPoint(x:f.midX,y:main.height-f.midY)
    CGEvent(mouseEventSource:nil,mouseType:.mouseMoved,mouseCursorPosition:point,mouseButton:.left)?.post(tap:.cghidEventTap)
    report(["event":"ready","x":point.x,"y":point.y])
}
app.run()
