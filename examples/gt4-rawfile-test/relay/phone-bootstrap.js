// Restore the existing application's known GT4 connection through its own controls.
// Never confirms a new pairing, changes a key, or reads health/personal data.
import ObjC from '../../../tools/frida-agent/node_modules/frida-objc-bridge/index.js';
const getIvar=new NativeFunction(Module.getGlobalExportByName('class_getInstanceVariable'),'pointer',['pointer','pointer']);
const getOffset=new NativeFunction(Module.getGlobalExportByName('ivar_getOffset'),'long',['pointer']);
function field(o,name){const ivar=getIvar(o.$class.handle,Memory.allocUtf8String(name));if(ivar.isNull())throw Error('Missing connection field '+name);return o.handle.add(Number(getOffset(ivar)));}
function onMain(fn){return new Promise((resolve,reject)=>ObjC.schedule(ObjC.mainQueue,()=>{try{resolve(fn());}catch(e){reject(e);}}));}
let owner=null,previousIdle=null,root=null,lastAction='',actionAt=0,started=0,recovered=false;
let originalArguments=null;
function ready(){return field(owner,'isPaired').readU8()===1 && field(owner,'channelReady').readU8()===1 && !field(owner,'writer').readPointer().isNull()
    && field(owner,'busy').readU8()===0 && field(owner,'writing').readU8()===0;}
function controls(v,result){if(!v || result.length>120)return;
  if(v.isKindOfClass_(ObjC.classes.UIControl) && v.isEnabled())result.push(v);
  const children=v.subviews();for(let i=0;i<Number(children.count());i++)controls(children.objectAtIndex_(i),result);
}
function title(control){
  if(control.isKindOfClass_(ObjC.classes.UIButton)){
    const t=control.currentTitle();if(t)return String(t);
    const config=control.configuration();if(config){const text=config.title();if(text)return String(text);}
    const label=control.titleLabel();if(label){const text=label.text();if(text)return String(text);}return '';
  }
  const value=control.accessibilityLabel();return value?String(value):'';
}
function activate(control,action){const events=Number(control.allControlEvents());control.sendActionsForControlEvents_(events&8192?8192:64);lastAction=action;actionAt=Date.now();return {ready:false,phase:action,controlClass:control.$className,events,...connectionState()};}
function connectionState(){const pointer=field(owner,'peripheral').readPointer(),central=field(owner,'central').readPointer();return {
    paired:field(owner,'isPaired').readU8()===1,channelReady:field(owner,'channelReady').readU8()===1,
    peripheralState:pointer.isNull()?null:Number(new ObjC.Object(pointer).state()),bluetoothState:central.isNull()?null:Number(new ObjC.Object(central).state())};}
rpc.exports={
  nativeios(){return onMain(()=>{
    const defaults=ObjC.classes.NSUserDefaults.standardUserDefaults();
    if(originalArguments===null)originalArguments=defaults.volatileDomainForName_('NSArgumentDomain').retain();
    const temporary=originalArguments.mutableCopy();
    temporary.setObject_forKey_('nativeIOS','phoneIdentityProfile');
    defaults.setVolatileDomain_forName_(temporary,'NSArgumentDomain');temporary.release();
    return {identityProfile:String(defaults.stringForKey_('phoneIdentityProfile')),persistent:false};
  });},
  reconnect(){return onMain(()=>{
    if(!owner || !root)throw Error('prepare required');
    const all=[];controls(root,all);
    for(const c of all)if(title(c)==='断开连接')return activate(c,'restarting-physical-connection');
    throw Error('Existing disconnect control unavailable');
  });},
  prepare(){return onMain(()=>{
    const owners=ObjC.chooseSync(ObjC.classes['CrescentRelay.WatchTransport']);if(owners.length!==1)throw Error('Expected one existing WatchTransport');owner=owners[0];
    started=Date.now();
    const app=ObjC.classes.UIApplication.sharedApplication();previousIdle=!!app.isIdleTimerDisabled();app.setIdleTimerDisabled_(true);
    const tabs=ObjC.chooseSync(ObjC.classes.UITabBarController);if(tabs.length!==1)throw Error('Expected one application tab controller');
    tabs[0].setSelectedIndex_(3);const nav=tabs[0].selectedViewController();nav.popToRootViewControllerAnimated_(false);root=nav.topViewController().view();
    const selected=ObjC.classes.NSUserDefaults.standardUserDefaults().stringForKey_('phoneIdentityProfile');
    return {ready:ready(),phase:ready()?'paired':'phone-connecting',applicationState:Number(app.applicationState()),identityProfile:selected?String(selected):'default-enhancedOHOS'};
  });},
  step(){return onMain(()=>{
    if(!owner || !root)throw Error('Connection preparation not initialized');if(ready())return {ready:true,phase:'paired'};
    if(field(owner,'busy').readU8()!==0)return {ready:false,phase:'existing-operation'};
    const all=[];controls(root,all);
    if(Date.now()-actionAt<1800)return {ready:false,phase:lastAction,...connectionState()};
    for(const c of all){const t=title(c);
      if(t==='使用已保存密钥认证' || t==='重新认证')return activate(c,'saved-key-authentication');
    }
    if(!recovered && Date.now()-started>12000){for(const c of all)if(title(c)==='断开连接'){
      recovered=true;return activate(c,'restarting-physical-connection');
    }}
    for(const c of all){const t=title(c);
      if(t.startsWith('HUAWEI WATCH GT 4'))return activate(c,'connecting-known-gt4');
    }
    if(lastAction!=='scanning')for(const c of all){const t=title(c);if(t==='查找手表' || t==='查找附近的 GT4')return activate(c,'scanning');}
    return {ready:false,phase:lastAction || 'waiting-existing-connection',newPairingAllowed:false,...connectionState()};
  });},
  release(){return onMain(()=>{
    if(originalArguments!==null){ObjC.classes.NSUserDefaults.standardUserDefaults().setVolatileDomain_forName_(originalArguments,'NSArgumentDomain');originalArguments.release();originalArguments=null;}
    if(previousIdle!==null)ObjC.classes.UIApplication.sharedApplication().setIdleTimerDisabled_(previousIdle);previousIdle=null;return true;
  });}
};
