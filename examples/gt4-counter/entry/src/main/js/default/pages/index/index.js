export default {
  data: {
    count: 0,
    hint: 'Tap +1 to count'
  },
  increment() {
    if (this.count < 999) {
      this.count = this.count + 1;
      this.hint = this.count === 999 ? 'Maximum reached' : 'Tap +1 to count';
    }
  },
  reset() {
    this.count = 0;
    this.hint = 'Counter reset';
  }
};
