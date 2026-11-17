// 0.2 s 8 kHz 16-bit mono silence WAV, built at runtime.
var hdr = [82,73,70,70, 0xA4,0x0C,0,0, 87,65,86,69,
           102,109,116,32, 16,0,0,0, 1,0, 1,0,
           0x40,0x1F,0,0, 0x80,0x3E,0,0, 2,0, 16,0,
           100,97,116,97, 0x80,0x0C,0,0];
var wav = new Uint8Array(3244);
for (var i = 0; i < 44; i++) { wav[i] = hdr[i]; }
export default wav;
