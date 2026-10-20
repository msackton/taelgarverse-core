// Audited against the 24-mile hex grid in world-map-regions-new.png.
// Source hashes prevent reusing a calibration after an image is replaced or cropped.
// 245 horizontal grid edges spanning 123 hexes give 20.166667 px per hex;
// fitted edge residuals are 0.091 px. Use the underlying 121/6 px spacing.
export const HEX_GRID = {milesAcross:24,pixelsAcross:121/6};
export const MAP_CALIBRATIONS = [
  {"image":"assets/taelgar-world-map.png","width":11329,"height":9419,"referenceScale":0.5,"sha256":"900916f3d14b8a55a57fc0d220a9a0f69d62d4c89d9a124afe3a92712f43981a"},
  {"image":"assets/world-map-regions-new.png","width":7200,"height":4536,"referenceScale":1,"sha256":"0240203fcb6588b34c4d4799e0af63a98f78c0b4c623efaa5444745923f07867"},
  {"image":"assets/north-sentinels-map.png","width":1042,"height":953,"referenceScale":1,"sha256":"b8e21a1131ebb11c744bee81311c2b92b1301ce00db4d49ca02453f1be9f726f"},
  {"image":"assets/region-central-highlands.png","width":1876,"height":2930,"referenceScale":0.5,"sha256":"f20a346a93b9807c766a46a6e5f264dc116b51867d27e97d9e3b2f3bc3f4c961"},
  {"image":"assets/region-drankorian-hinterland.png","width":4429,"height":2232,"referenceScale":0.5,"sha256":"fd72c6130b8b0dd39ee89af3e40b2d1d0c68714bc8ea578c86305db53c65173e"},
  {"image":"assets/sembara-region-map.png","width":2192,"height":2507,"referenceScale":0.5,"sha256":"8014e04aafa8314022cfe5a017ddeda9e2d55666eb0abb502150373d02eee5db"},
  {"image":"assets/sembara-regions.png","width":2308,"height":2468,"referenceScale":0.5,"sha256":"d9f0f94036483065b5a15e86afdc84c2f7bb2704b81abb4a3ca4b8532dda8913"},
  {"image":"assets/north-green-sea-region.png","width":2534,"height":1076,"referenceScale":0.6666666666666666,"sha256":"4bb3154966e59f9d6494cc5e97f8b6734bfa9a84abcbd412120f7cd94ec34e56"},
  {"image":"assets/region-northwest-coast.png","width":1340,"height":1187,"referenceScale":1,"sha256":"b70115e8d291d334e540318d388e81317929c18bbf2149855b4e87b42cc0a20f"},
  {"image":"assets/upper-istaros-region-map.png","width":2013,"height":1693,"referenceScale":0.5,"sha256":"b71779d4949a66e122f9e9efdda42bbb297da6f57655eaa9f7376e07c8674153"},
  {"image":"assets/region-west-green-sea.png","width":1753,"height":3220,"referenceScale":0.5,"sha256":"d4f27c12509c7b2673a68ae272622686c752f5ffa56ef090c719d1b8d877699a"},
];
