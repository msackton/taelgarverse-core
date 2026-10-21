import {mockWav, validateWav, speechSsml} from '../../src/pronunciation-data.mjs';

export async function synthesizePronunciation({input, key, region, request}) {
  if (!key) return {buffer: mockWav(), mock: true};
  if (!/^[a-z0-9-]+$/.test(region || '')) throw new Error('Set the Azure Speech region in plugin settings');
  let voice = input.voice;
  if (voice === 'auto') {
    let available;
    try { available = await request({url: 'https://' + region + '.tts.speech.microsoft.com/cognitiveservices/voices/list', method: 'GET', headers: {'Ocp-Apim-Subscription-Key': key}, throw: false}); }
    catch { throw new Error('Could not load Azure voices; existing audio was kept'); }
    if (available.status !== 200 || !Array.isArray(available.json)) throw new Error('Azure voice lookup failed (HTTP ' + available.status + '); existing audio was kept');
    voice = available.json.find(candidate => candidate.Locale === input.locale && (!input.gender || input.gender === 'auto' || String(candidate.Gender).toLowerCase() === input.gender) && candidate.VoiceType === 'Neural' && typeof candidate.ShortName === 'string' && !/[:]|Multilingual|HD/.test(candidate.ShortName))?.ShortName;
    if (!voice) throw new Error('No Azure ' + (input.gender && input.gender !== 'auto' ? input.gender + ' ' : '') + 'neural voice is available for ' + input.locale + '; choose another analog or a voice override');
  }
  let response;
  try {
    response = await request({url: 'https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', method: 'POST',
      headers: {'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm'},
      body: voice === input.voice ? input.ssml : speechSsml({...input, voice}), throw: false});
  } catch { throw new Error('Azure Speech request failed; existing audio was kept'); }
  if (response.status !== 200) throw new Error('Azure Speech returned HTTP ' + response.status + '; check the key, region, voice, and IPA. Existing audio was kept.');
  return {buffer: validateWav(response.arrayBuffer), mock: false, voice};
}
