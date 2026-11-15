// Explicit AP renewal for a live, owned TCP session. This is not an OTA command.
export class ApRenewal {
  constructor({write, valid, event, schedule=setTimeout, cancel=clearTimeout, interval=20000}) {
    Object.assign(this,{write,valid,event,schedule,cancel,interval});this.epoch=0;this.timer=null;this.pending=Promise.resolve();
  }
  start() { this.stop();const epoch=this.epoch;const current=()=>this.epoch===epoch;
    const tick=async()=>{this.timer=null;if(!current())return;
      try {if(!this.valid())throw Error('AP renewal session invalid');await this.write(current);
        if(current()){this.event({state:'written'});this.timer=this.schedule(()=>{this.pending=tick();},this.interval);}
      }catch(e){if(current()){this.stop();this.event({state:'stopped',reason:String(e)});}}
    };
    this.timer=this.schedule(()=>{this.pending=tick();},this.interval);
  }
  stop(){this.epoch++;if(this.timer!==null)this.cancel(this.timer);this.timer=null;return this.pending;}
}
