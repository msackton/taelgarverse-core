import {mockWav, validateWav} from '../../src/pronunciation-data.mjs';

export async function synthesizePronunciation({input, key, region, request}) {
  if (!key) return {buffer: mockWav(), mock: true};
  if (!input.ipa) throw new Error('Add pronunciationIPA before generating with Azure');
  if (!/^[a-z0-9-]+$/.test(region || '')) throw new Error('Set the Azure Speech region in plugin settings');
  let response;
  try {
    response = await request({url: 'https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', method: 'POST',
      headers: {'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm'},
      body: input.ssml, throw: false});
  } catch { throw new Error('Azure Speech request failed; existing audio was kept'); }
  if (response.status !== 200) throw new Error('Azure Speech returned HTTP ' + response.status + '; check the key, region, voice, and IPA. Existing audio was kept.');
  return {buffer: validateWav(response.arrayBuffer), mock: false};
}
