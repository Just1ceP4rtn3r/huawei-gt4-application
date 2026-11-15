import router from '@system.router';
export default {
    data:{},
    onShow:function(){var self=this;this.startTimer=setTimeout(function(){self.open();},300);},
    onHide:function(){clearTimeout(this.startTimer);},
    onDestroy:function(){clearTimeout(this.startTimer);},
    open:function(){router.replace({uri:'pages/control/control'});}
};
