import router from '@system.router';
import brightness from '@system.brightness';
import rawfileTest from '../../common/rawfile-target-test';
import managed from '../../common/managed-link';
import bridge from '../../common/bridge';
var timer=null,view=null;
var reportIndex=0;
function report(){if(managed.idle()){
 var s=rawfileTest.snapshot(),count=s.results.length,page=count?reportIndex++%count:0;
 s.results=count?[s.results[page]]:[];
 managed.emit('state','',0,{test:'DEMO-02',version:'1.6.38',page:page,pages:count,file:s});
}}
function update(r){
 if(view){view.status=r.phase==='verified'?'Target verified':r.phase==='complete'?'Target test complete':r.phase==='failed'?'Rawfile test failed':'Checking file';
 view.detail=r.phase==='verified'?r.bytes+' bytes OK\n'+r.uri.slice(15):r.error||r.step;}
 report();
}
function stop(){clearInterval(timer);timer=null;bridge.stop();managed.stop();try{brightness.setKeepScreenOn({keepScreenOn:false});}catch(e){}view=null;}
export default {
 data:{status:'Checking file',detail:'BLE diagnostics / DEMO-02'},
 onShow:function(){view=this;managed.start();try{brightness.setKeepScreenOn({keepScreenOn:true});}catch(e){}
  bridge.start(function(){},function(m){if(m.t==='command'){
   if(m.op==='test')rawfileTest.start(update,m.args||{});else if(m.op==='status'||m.op==='logs')report();
  }},report);
  var lastReport=0;timer=setInterval(function(){rawfileTest.tick();if(Date.now()-lastReport>2000){lastReport=Date.now();report();}},250);rawfileTest.start(update);
 },
 onHide:stop,onDestroy:stop,
 open:function(){stop();router.replace({uri:'pages/control/control'});}
};
