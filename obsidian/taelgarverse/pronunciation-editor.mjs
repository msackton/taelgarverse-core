import {ViewPlugin, Decoration, WidgetType} from '@codemirror/view';
import {editorLivePreviewField, editorInfoField} from 'obsidian';
import {parseNameEntries} from './pronunciation-names.mjs';

// Inline CodeMirror widgets leave the authored name mappings fully editable.
export function namesEditorExtension(feature) {
  class NameAudioWidget extends WidgetType {
    constructor(entry, file, view, stamp) { super(); this.entry = entry; this.file = file; this.view = view; this.stamp = stamp; }
    eq(other) { return this.file.path === other.file.path && this.entry.key === other.entry.key && this.stamp === other.stamp; }
    toDOM() {
      const doc = this.view.dom.ownerDocument, host = doc.createElement('span'); host.className = 'taelgar-name-audio';
      const choiceKey = this.file.path + '|' + this.entry.key;
      const selector = {key: this.entry.key, locale: feature.analogChoices.get(choiceKey)};
      const options = () => ({...selector, sourceProvider: () => this.view.state.doc.toString(), editorView: this.view});
      const current = () => feature.inputForSource(this.file, this.view.state.doc.toString(), selector);
      const summary = doc.createElement('span'); summary.className = 'taelgar-name-audio-route';
      let input;
      try { input = current(); } catch { return host; }
      const profile = feature.languageProfiles.get(String(this.entry.language).trim().toLocaleLowerCase('en').replaceAll('’', "'"));
      const select = doc.createElement('select'); select.setAttribute('aria-label', 'Speech analog for ' + this.entry.name);
      const addOption = (label, value) => { const item = doc.createElement('option'); item.value = value; item.textContent = label; select.appendChild(item); };
      addOption('Default voice', 'default');
      for (const choice of profile?.options || []) addOption(choice.label + ' · ' + choice.locale, choice.locale);
      if (select.options.length) {
        if (input.route === 'Voice override') { addOption('Voice override · ' + input.locale, 'override'); select.disabled = true; selector.locale = 'override'; }
        else if (![...select.options].some(item => item.value === selector.locale)) selector.locale = profile?.automatic ? profile.options[0].locale : 'default';
        for (const item of select.options) item.selected = item.value === selector.locale;
        select.addEventListener('change', () => { selector.locale = select.value; feature.analogChoices.set(choiceKey, selector.locale); const next = current(); summary.textContent = next.route; summary.title = next.analog; });
        host.appendChild(select);
      }
      const gender = doc.createElement('select'); gender.setAttribute('aria-label', 'Voice gender for ' + this.entry.name);
      for (const [value, label] of [['default', 'Default voice'], ['female', 'Female'], ['male', 'Male']]) {
        const option = doc.createElement('option'); option.value = value; option.textContent = label;
        option.selected = value === (feature.settings.voiceChoices?.[choiceKey] || 'default'); gender.appendChild(option);
      }
      gender.disabled = input.voiceOverride;
      gender.title = input.voiceOverride ? 'A specific pronunciationVoice override fixes this voice; remove that override to choose male/female.' : 'Choose an Azure voice. Remembered for this name; Preview and Generate use the same choice.';
      gender.addEventListener('change', () => { feature.setGenderChoice(this.file, this.entry.key, gender.value).catch(error => { gender.title = error.message; }); });
      host.appendChild(gender);
      const mode = doc.createElement('select'); mode.setAttribute('aria-label', 'Pronunciation input for ' + this.entry.name);
      for (const [value, label] of [['default', 'Default input'], ['pronunciation', 'Pronunciation / IPA'], ['name', 'Name only']]) {
        const option = doc.createElement('option'); option.value = value; option.textContent = label;
        option.selected = value === (feature.settings.speechModes?.[choiceKey] || 'default'); mode.appendChild(option);
      }
      mode.title = 'Name only ignores written pronunciation and IPA while keeping the selected language and voice. Remembered for this name.';
      mode.addEventListener('change', () => { feature.setSpeechMode(this.file, this.entry.key, mode.value).catch(error => { mode.title = error.message; }); });
      host.appendChild(mode);
      input = current();
      summary.textContent = input.route; summary.title = input.analog; host.appendChild(summary);
      const button = (label, action) => { const item = doc.createElement('button'); item.type = 'button'; item.textContent = label; item.addEventListener('click', action); host.appendChild(item); return item; };
      const audio = feature.audioForInput(this.file, input);
      if (audio) button(audio.path.endsWith('.mock.wav') ? 'Play test tone' : 'Play audio', () => feature.play(feature.audioForInput(this.file, current())));
      const generate = button(audio ? 'Regenerate audio' : 'Generate audio', async () => {
        generate.disabled = true;
        try { await feature.run(this.file, options()); }
        finally { generate.disabled = false; feature.refreshEditors(); }
      });
      generate.title = 'Speak ' + (input.pronunciation || input.name) + ' · ' + input.route;
      const preview = button('Preview', () => feature.preview(this.file, options()));
      preview.title = 'Preview with Azure when configured (usage charges apply); otherwise approximate device speech. Saves no file.';
      return host;
    }
    ignoreEvent() { return true; }
  }
  return ViewPlugin.fromClass(class {
    constructor(view) { this.view = view; feature.editors.add(this); this.refresh(); }
    refresh() {
      this.stamp = feature.editorRevision;
      this.enabled = feature.enabled;
      if (!feature.enabled || feature.disposed || this.view.state.field(editorLivePreviewField, false) !== true) { this.decorations = Decoration.none; return; }
      const file = this.view.state.field(editorInfoField, false)?.file;
      if (!file?.path) { this.decorations = Decoration.none; return; }
      const source = this.view.state.doc.toString();
      this.decorations = Decoration.set(parseNameEntries(source)
        .filter(entry => this.view.visibleRanges.some(range => entry.to >= range.from && entry.to <= range.to))
        .flatMap(entry => {
          try {
            const stamp = JSON.stringify([feature.editorRevision, feature.inputForSource(file, source, {key: entry.key})]);
            return [Decoration.widget({widget: new NameAudioWidget(entry, file, this.view, stamp), side: 1}).range(entry.to)];
          } catch { return []; } // Incomplete frontmatter must not disable the editor extension.
        }), true);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.transactions.some(transaction => transaction.reconfigured) || this.enabled !== feature.enabled || this.stamp !== feature.editorRevision || update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false)) this.refresh();
    }
    destroy() { feature.editors.delete(this); }
  }, {decorations: value => value.decorations});
}
