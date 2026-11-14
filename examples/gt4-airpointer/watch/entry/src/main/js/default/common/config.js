// This is our local receiver's advertised Wear Engine route, NOT an Apple signing identity.
// Match relay/protocol.js. Real device routing support still requires validation.
export default {
    peerPackage: 'local.gt4bridge.crescent',
    peerFingerprint: '41AA272C4F19BC53493F79B526855CBEA93B9311A82EEA18E98F5A2163776A28',
    gyroUnit: 'rad/s',
    accelUnit: 'g',
    yawAxis: 'z',
    pitchAxis: 'x',
    yawSign: -1,
    pitchSign: -1,
    interval: 'game',
    frameMs: 50
};
